'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const createSyncMedia = require('../server/src/services/sync-media');

const UID = 'api::event.event';

// A content type with one single and one multiple media field.
const CONTENT_TYPES = {
  [UID]: {
    info: { pluralName: 'events' },
    options: { draftAndPublish: true },
    attributes: {
      title: { type: 'string' },
      cover: { type: 'media', multiple: false },
      gallery: { type: 'media', multiple: true },
    },
  },
};

const MEDIA_FIELDS = [
  { field: 'cover', multiple: false },
  { field: 'gallery', multiple: true },
];

function makeStrapi() {
  const strapi = {
    log: { warn() {}, info() {}, error() {} },
    contentTypes: CONTENT_TYPES,
    plugin() {
      return {
        service(name) {
          if (name === 'dependencyResolver') {
            return { getMediaFields: (uid) => (uid === UID ? MEDIA_FIELDS : []) };
          }
          if (name === 'syncConfig') {
            return { getSyncConfig: async () => ({ contentTypes: [{ uid: UID, enabled: true }] }) };
          }
          throw new Error(`unexpected service ${name}`);
        },
      };
    },
  };
  return strapi;
}

/** Run `fn` with global.strapi and global.fetch stubbed, then restore both. */
async function withStubs(fetchImpl, fn) {
  const prevStrapi = global.strapi;
  const prevFetch = global.fetch;
  const strapi = makeStrapi();
  global.strapi = strapi;
  global.fetch = fetchImpl;
  try {
    return await fn(createSyncMedia({ strapi }));
  } finally {
    global.strapi = prevStrapi;
    global.fetch = prevFetch;
  }
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const REMOTE = { baseUrl: 'https://remote.example.com', apiToken: 'tok' };

test('single-side link pull reads the peer plain content REST API, not a plugin route', async () => {
  const calls = [];
  await withStubs(
    async (url) => {
      calls.push(url);
      return jsonResponse({
        data: [
          {
            documentId: 'doc-1',
            cover: { documentId: 'f-1', name: 'hero.jpg', ext: '.jpg', size: 120.5 },
            gallery: [
              { documentId: 'f-2', name: 'a.png', ext: '.png', size: 10 },
              { documentId: 'f-3', name: 'b.png', ext: '.png', size: 11 },
            ],
          },
        ],
        meta: { pagination: { page: 1, pageCount: 1 } },
      });
    },
    async (service) => {
      const out = await service.fetchRemoteEntityMediaLinksViaRest(REMOTE, { uid: UID, page: 1, pageSize: 100 });

      const requested = new URL(calls[0]);
      assert.equal(requested.origin + requested.pathname, 'https://remote.example.com/api/events');
      assert.ok(!requested.pathname.includes('strapi-content-sync-pro'));
      assert.equal(requested.searchParams.get('fields[0]'), 'documentId');
      assert.equal(requested.searchParams.get('populate[0]'), 'cover');
      assert.equal(requested.searchParams.get('populate[1]'), 'gallery');

      assert.equal(out.hasMore, false);
      assert.deepEqual(out.links, [
        {
          uid: UID,
          documentId: 'doc-1',
          fields: {
            cover: { multiple: false, files: [{ documentId: 'f-1', name: 'hero.jpg', ext: '.jpg', size: 120.5 }] },
            gallery: {
              multiple: true,
              files: [
                { documentId: 'f-2', name: 'a.png', ext: '.png', size: 10 },
                { documentId: 'f-3', name: 'b.png', ext: '.png', size: 11 },
              ],
            },
          },
        },
      ]);
    }
  );
});

test('an entity with no media yields empty field lists so removals propagate', async () => {
  await withStubs(
    async () => jsonResponse({ data: [{ documentId: 'doc-2', cover: null, gallery: [] }], meta: {} }),
    async (service) => {
      const out = await service.fetchRemoteEntityMediaLinksViaRest(REMOTE, { uid: UID });
      assert.deepEqual(out.links[0].fields, {
        cover: { multiple: false, files: [] },
        gallery: { multiple: true, files: [] },
      });
    }
  );
});

test('a v4-shaped { data: … } media payload is unwrapped rather than dropped', async () => {
  await withStubs(
    async () => jsonResponse({
      data: [{
        documentId: 'doc-3',
        cover: { data: { documentId: 'f-9', name: 'x.jpg', ext: '.jpg', size: 5 } },
        gallery: [],
      }],
      meta: {},
    }),
    async (service) => {
      const out = await service.fetchRemoteEntityMediaLinksViaRest(REMOTE, { uid: UID });
      assert.deepEqual(out.links[0].fields.cover.files, [
        { documentId: 'f-9', name: 'x.jpg', ext: '.jpg', size: 5 },
      ]);
    }
  );
});

test('pagination follows the REST meta pageCount', async () => {
  await withStubs(
    async () => jsonResponse({ data: [{ documentId: 'd', cover: null, gallery: [] }], meta: { pagination: { pageCount: 3 } } }),
    async (service) => {
      assert.equal((await service.fetchRemoteEntityMediaLinksViaRest(REMOTE, { uid: UID, page: 1 })).hasMore, true);
      assert.equal((await service.fetchRemoteEntityMediaLinksViaRest(REMOTE, { uid: UID, page: 3 })).hasMore, false);
    }
  );
});

test('a REST failure carries the HTTP status so the transport chain can react', async () => {
  await withStubs(
    async () => jsonResponse({ error: { status: 403, name: 'ForbiddenError' } }, 403),
    async (service) => {
      await assert.rejects(
        () => service.fetchRemoteEntityMediaLinksViaRest(REMOTE, { uid: UID }),
        (err) => err.status === 403 && /403/.test(err.message)
      );
    }
  );
});

test('a content type with no media fields makes no request at all', async () => {
  await withStubs(
    async () => { throw new Error('should not fetch'); },
    async (service) => {
      const out = await service.fetchRemoteEntityMediaLinksViaRest(REMOTE, { uid: 'api::tag.tag' });
      assert.deepEqual(out.links, []);
      assert.equal(out.hasMore, false);
    }
  );
});
