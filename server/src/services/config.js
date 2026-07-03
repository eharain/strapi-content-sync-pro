'use strict';

const crypto = require('crypto');

// Preferred secret encryption backend. Optional at runtime: if the package
// isn't resolvable we fall back to the built-in AES-256-GCM below, so the
// plugin still works with zero extra setup.
let SecureKeystore = null;
try {
  SecureKeystore = require('secure-keystore-js');
} catch (_) {
  SecureKeystore = null;
}

const STORE_KEY = 'remote-server-config';

const SENSITIVE_FIELDS = ['apiToken', 'sharedSecret'];
const VALID_SYNC_MODES = ['paired', 'single_side'];
const MASK = '••••••••';
const ENC_PREFIX = 'enc:v1:';    // built-in AES-256-GCM fallback marker
const KEYSTORE_PREFIX = 'skv1:'; // secure-keystore-js value marker

module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({
      type: 'plugin',
      name: 'strapi-content-sync-pro',
    });
  }

  // Secret used to derive the encryption key, from the app's secret keys. If
  // those change the stored secrets can no longer be decrypted (they read back
  // as ciphertext and fail auth visibly), which is safer than plaintext.
  function getUserKey() {
    const keys = strapi.config.get('server.app.keys');
    return (Array.isArray(keys) ? keys.join(',') : String(keys || '')) || 'strapi-content-sync-pro';
  }

  function getKey() {
    return crypto.createHash('sha256').update(getUserKey()).digest();
  }

  function encrypt(plain) {
    if (plain == null || plain === '') return plain;
    if (typeof plain === 'string' && (plain.startsWith(ENC_PREFIX) || plain.startsWith(KEYSTORE_PREFIX))) {
      return plain; // already encrypted
    }
    // Preferred: secure-keystore-js (PBKDF2 + AES-256-GCM, per-value salt).
    if (SecureKeystore?.encryptValue) {
      try {
        return SecureKeystore.encryptValue(String(plain), getUserKey());
      } catch (_) {
        // fall through to built-in
      }
    }
    // Built-in fallback.
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
    const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ENC_PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
  }

  function decrypt(val) {
    if (typeof val !== 'string') return val;
    // secure-keystore-js token
    if (val.startsWith(KEYSTORE_PREFIX)) {
      if (SecureKeystore?.decryptValue) {
        try { return SecureKeystore.decryptValue(val, getUserKey()); } catch { return val; }
      }
      return val;
    }
    // built-in AES-256-GCM token
    if (val.startsWith(ENC_PREFIX)) {
      try {
        const raw = Buffer.from(val.slice(ENC_PREFIX.length), 'base64');
        const iv = raw.subarray(0, 12);
        const tag = raw.subarray(12, 28);
        const data = raw.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
      } catch {
        return val;
      }
    }
    return val; // legacy plaintext
  }

  return {
    async getConfig({ safe = true } = {}) {
      const store = getStore();
      const data = await store.get({ key: STORE_KEY });

      if (!data) {
        return null;
      }

      const normalized = {
        syncMode: 'paired',
        ...data,
      };

      if (!safe) {
        // Decrypt sensitive fields for internal use (signing / auth).
        for (const field of SENSITIVE_FIELDS) {
          if (normalized[field]) normalized[field] = decrypt(normalized[field]);
        }
        return normalized;
      }

      const sanitized = { ...normalized };
      for (const field of SENSITIVE_FIELDS) {
        if (sanitized[field]) {
          sanitized[field] = MASK;
        }
      }
      return sanitized;
    },

    async setConfig(config) {
      const store = getStore();

      const existing = await store.get({ key: STORE_KEY }) || {};

      const merged = { ...existing };

      if (config.baseUrl !== undefined) {
        merged.baseUrl = config.baseUrl;
      }
      // Sensitive fields: ignore the mask sentinel (a UI that re-submits the
      // masked value must not overwrite the real secret), otherwise encrypt.
      if (config.apiToken !== undefined && config.apiToken !== MASK) {
        merged.apiToken = encrypt(config.apiToken);
      }
      if (config.syncDirection !== undefined) {
        if (!['push', 'pull', 'bidirectional'].includes(config.syncDirection)) {
          throw new Error('syncDirection must be "push", "pull", or "bidirectional"');
        }
        merged.syncDirection = config.syncDirection;
      }
      if (config.instanceId !== undefined) {
        merged.instanceId = config.instanceId;
      }
      if (config.sharedSecret !== undefined && config.sharedSecret !== MASK) {
        merged.sharedSecret = encrypt(config.sharedSecret);
      }
      if (config.syncMode !== undefined) {
        if (!VALID_SYNC_MODES.includes(config.syncMode)) {
          throw new Error(`syncMode must be one of: ${VALID_SYNC_MODES.join(', ')}`);
        }
        merged.syncMode = config.syncMode;
      }

      if (!merged.syncMode) {
        merged.syncMode = 'paired';
      }

      await store.set({ key: STORE_KEY, value: merged });

      // Return a safe (masked) view — never leak secrets from a write.
      const safe = { ...merged };
      for (const field of SENSITIVE_FIELDS) {
        if (safe[field]) safe[field] = MASK;
      }
      return safe;
    },
  };
};
