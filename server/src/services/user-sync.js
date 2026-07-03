'use strict';

/**
 * Two-way sync for users-permissions users.
 *
 * Users are special: /api/users returns a bare array without the password, so
 * the generic content fetcher can't handle them. Instead each instance exposes
 * a signed `/users/export` endpoint that returns users WITH their password hash
 * and role type, and a signed `/users/import` endpoint that upserts them.
 *
 * Identity is matched by EMAIL (stable, unique) rather than documentId, which
 * is generated per-instance. Passwords are already bcrypt hashes and are
 * written through unchanged (the document service does not re-hash — hashing
 * lives in the users-permissions service layer, which we bypass).
 */

const { generateSignature } = require('../utils/hmac');

const USER_UID = 'plugin::users-permissions.user';
const ROLE_UID = 'plugin::users-permissions.role';
const LAST_SYNC_KEY = 'users-last-sync';

const SCALAR_TYPES = new Set([
  'string', 'text', 'richtext', 'email', 'password', 'integer', 'biginteger',
  'float', 'decimal', 'boolean', 'date', 'datetime', 'time', 'uid',
  'enumeration', 'json', 'blocks',
]);
// Never carried across: managed/audit fields and per-instance security tokens.
const RESERVED = new Set([
  'id', 'createdAt', 'updatedAt', 'publishedAt', 'createdBy', 'updatedBy',
  'locale', 'localizations', 'resetPasswordToken', 'confirmationToken',
]);

module.exports = ({ strapi }) => {
  const plugin = () => strapi.plugin('strapi-content-sync-pro');
  const getStore = () => strapi.store({ type: 'plugin', name: 'strapi-content-sync-pro' });

  async function getLastSync() {
    return (await getStore().get({ key: LAST_SYNC_KEY })) || null;
  }
  async function setLastSync(ts) {
    await getStore().set({ key: LAST_SYNC_KEY, value: ts });
  }

  // All syncable scalar attributes of the user model — includes custom fields
  // (e.g. a required `displayName`) so any schema round-trips correctly.
  function userScalarFields() {
    const attrs = strapi.contentTypes[USER_UID]?.attributes || {};
    return Object.entries(attrs)
      .filter(([k, a]) => SCALAR_TYPES.has(a?.type) && !RESERVED.has(k))
      .map(([k]) => k);
  }

  function serializeUser(u) {
    const out = {
      email: u.email,
      documentId: u.documentId || null,
      roleType: u.role?.type || null,
      roleName: u.role?.name || null,
      updatedAt: u.updatedAt || null,
    };
    for (const f of userScalarFields()) {
      if (u[f] !== undefined) out[f] = u[f];
    }
    return out;
  }

  /** Local users (with hash + role) for the peer to pull. */
  async function exportUsers({ since } = {}) {
    const where = {};
    if (since) where.updatedAt = { $gt: since };
    const rows = await strapi.db.query(USER_UID).findMany({ where, populate: ['role'] });
    return rows.map(serializeUser);
  }

  async function resolveRoleId(roleType) {
    if (roleType) {
      const role = await strapi.db.query(ROLE_UID).findOne({ where: { type: roleType } });
      if (role?.id) return role.id;
    }
    // Fallback: the default authenticated role (role is required on create).
    const fallback =
      (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'authenticated' } })) ||
      (await strapi.db.query(ROLE_UID).findOne({ where: { type: 'public' } })) ||
      (await strapi.db.query(ROLE_UID).findOne({}));
    return fallback?.id || null;
  }

  /** Upsert one user locally, matched by email. Writes the hash unchanged. */
  async function applyUser(u) {
    if (!u?.email) return { skipped: true, reason: 'no-email' };

    const existing = await strapi.db.query(USER_UID).findOne({
      where: { email: u.email },
      select: ['id', 'documentId'],
    });
    const roleId = await resolveRoleId(u.roleType);

    // Carry every scalar field the peer sent (username, displayName, provider,
    // confirmed, blocked, custom fields). The password is handled separately:
    // fields of type `password` are auto-hashed by the document service, which
    // would double-hash the already-hashed value and break login. So we exclude
    // it here and write the raw hash via the low-level query engine below.
    const data = {};
    for (const f of userScalarFields()) {
      if (f === 'password') continue;
      if (u[f] !== undefined && u[f] !== null) data[f] = u[f];
    }
    data.email = u.email;
    if (!data.username) data.username = u.username || u.email;
    if (roleId) data.role = roleId;

    let result;
    let userId = existing?.id || null;
    let documentId = existing?.documentId || null;

    if (existing) {
      if (documentId) {
        await strapi.documents(USER_UID).update({ documentId, data });
      } else {
        await strapi.db.query(USER_UID).update({ where: { id: userId }, data });
      }
      result = { updated: true };
    } else {
      const created = await strapi.documents(USER_UID).create({ data });
      userId = created?.id;
      documentId = created?.documentId;
      result = { created: true, documentId };
    }

    // Write the bcrypt hash verbatim, bypassing the auto-hash step.
    if (u.password) {
      if (!userId) {
        const found = await strapi.db.query(USER_UID).findOne({ where: { email: u.email }, select: ['id'] });
        userId = found?.id;
      }
      if (userId) {
        await strapi.db.query(USER_UID).update({ where: { id: userId }, data: { password: u.password } });
      }
    }

    return result;
  }

  async function applyUsers(users = []) {
    let created = 0;
    let updated = 0;
    let errors = 0;
    const errorDetails = [];
    for (const u of users) {
      try {
        const r = await applyUser(u);
        if (r.created) created++;
        else if (r.updated) updated++;
      } catch (err) {
        errors++;
        errorDetails.push({ email: u?.email, error: err.message });
        strapi.log.error(`[data-sync] user apply failed for ${u?.email}: ${err.message}`);
      }
    }
    return { created, updated, errors, errorDetails };
  }

  // ── remote peer calls (signed) ────────────────────────────────────────────
  async function signedFetch(remoteConfig, path, body) {
    const url = new URL(`/api/strapi-content-sync-pro${path}`, remoteConfig.baseUrl);
    const timestamp = Date.now().toString();
    const signature = generateSignature(body, remoteConfig.sharedSecret, timestamp);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${remoteConfig.apiToken}`,
        'Content-Type': 'application/json',
        'x-sync-signature': signature,
        'x-sync-timestamp': timestamp,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Remote ${path} failed: ${res.status} – ${text}`);
    }
    return res.json();
  }

  async function fetchRemoteUsers(remoteConfig, { since } = {}) {
    const json = await signedFetch(remoteConfig, '/users/export', { since: since || null });
    return json?.data || [];
  }

  async function pushUsers(remoteConfig, users) {
    const json = await signedFetch(remoteConfig, '/users/import', { users });
    return json?.data || {};
  }

  /**
   * Orchestrate a two-way (or one-way) user sync.
   * options: { direction: 'push'|'pull'|'both', conflictStrategy, full }
   */
  async function syncUsers(options = {}) {
    const logService = plugin().service('syncLog');
    const configService = plugin().service('config');
    const remoteConfig = await configService.getConfig({ safe: false });
    if (!remoteConfig || !remoteConfig.baseUrl) {
      throw new Error('Remote server not configured');
    }

    const direction = options.direction || 'both';
    const conflictStrategy = options.conflictStrategy || 'latest';
    const since = options.full ? null : await getLastSync();
    const startedAt = new Date().toISOString();

    const [localUsers, remoteUsers] = await Promise.all([
      exportUsers({ since }),
      fetchRemoteUsers(remoteConfig, { since }),
    ]);

    const localByEmail = new Map(localUsers.map((u) => [u.email, u]));
    const remoteByEmail = new Map(remoteUsers.map((u) => [u.email, u]));

    const toPush = [];
    const toPull = [];

    const winner = (l, r) => {
      if (conflictStrategy === 'local_wins') return 'local';
      if (conflictStrategy === 'remote_wins') return 'remote';
      const lt = new Date(l.updatedAt || 0).getTime();
      const rt = new Date(r.updatedAt || 0).getTime();
      if (lt === rt) return 'equal';
      return lt > rt ? 'local' : 'remote';
    };

    for (const [email, l] of localByEmail) {
      const r = remoteByEmail.get(email);
      if (!r) {
        if (direction === 'push' || direction === 'both') toPush.push(l);
      } else {
        const w = winner(l, r);
        if (w === 'local' && (direction === 'push' || direction === 'both')) toPush.push(l);
        else if (w === 'remote' && (direction === 'pull' || direction === 'both')) toPull.push(r);
      }
    }
    for (const [email, r] of remoteByEmail) {
      if (!localByEmail.has(email) && (direction === 'pull' || direction === 'both')) toPull.push(r);
    }

    let pushed = { created: 0, updated: 0, errors: 0 };
    let pulled = { created: 0, updated: 0, errors: 0 };
    if (toPull.length) pulled = await applyUsers(toPull);
    if (toPush.length) pushed = await pushUsers(remoteConfig, toPush);

    await setLastSync(startedAt);

    const summary = {
      direction,
      localCount: localUsers.length,
      remoteCount: remoteUsers.length,
      pushed,
      pulled,
    };
    await logService.log({
      action: 'sync_users',
      contentType: USER_UID,
      direction,
      status: (pushed.errors || pulled.errors) ? 'partial' : 'success',
      message: `Users — pushed ${pushed.created + pushed.updated}, pulled ${pulled.created + pulled.updated}, errors ${pushed.errors + pulled.errors}`,
      details: summary,
    });

    return { syncedAt: new Date().toISOString(), ...summary };
  }

  return {
    exportUsers,
    applyUsers,
    fetchRemoteUsers,
    pushUsers,
    syncUsers,
  };
};
