# Changelog

## 1.2.0

Verified end to end against two live Strapi 5.52.0 instances on MySQL 8.0.27,
where the source instance did **not** have this plugin installed. With the 1.1.0
code the run reproduced the reported failure exactly (`mediaLinksApplied: 0` and
a `media_links_legacy` 404); swapping in only the fixed file, and changing
nothing else, applied all 7 entity links across `cover` (single media),
`gallery` (multiple media) and `avatar` (a non-Draft&Publish type). A row-level
comparison of both databases confirmed all 11 document/field pairs matched, and
unrelated local media links on the target were left untouched.

### Fixed

- **Media links were never applied in single-side mode** ([#1](https://github.com/eharain/strapi-content-sync-pro/issues/1)).
  Pass 2 could only read links from the peer's `media-sync/entity-media-links`
  endpoint, falling back to `media-sync/morph-links`. Both are routes of *this*
  plugin, and single-side mode means the peer does not run it — so both returned
  404 and the run finished with `mediaLinksApplied: 0` and a
  `media_links_legacy` error, even though the files themselves pulled fine.
  Media links are now derived from the peer's standard content REST API
  (`/api/<plural>?populate=<media fields>`) when neither plugin route is served.
  Files are matched by `documentId`, then by name+ext+size — a URL-synced file is
  re-uploaded on the target and gets a fresh `documentId`.

### Changed

- The link-pull transport chain is now explicit and resolved per run:
  `entity-media-links` → `morph-links` → plain content REST. Only a 404 advances
  the chain; any other failure is reported instead of being masked by a fallback.
  The run summary reports which transport was used via `legacyFallback` /
  `restFallback`.
- Pushing media links in single-side mode now fails with a clear message rather
  than an opaque remote 404. (Single-side profiles are pull-only, so this is
  reachable only through a hand-edited profile.)

### Documentation

- The README and in-app Help still described **morph-link remapping** as the
  media-link mechanism. 1.1.0 replaced that with owner-side entity → file links;
  both now document the actual behaviour — set semantics, `documentId` →
  name+ext+size file matching, and the rule that a field which resolves to no
  local file is left untouched rather than cleared.
- Documented where links are read from per deployment mode, and that single-side
  mode needs `find` on every content type that owns media fields — not just
  Upload permissions. Added two troubleshooting rows for the symptom in #1
  (files pull, links stay at 0).

## 1.1.0

Reliability release. Relation and media syncing were reworked around an explicit
execution strategy, and four correctness bugs were fixed. **Read the behaviour
changes below before upgrading** — the defaults are safer, but they are not
identical to 1.0.8.

### Fixed

- **Bidirectional relations were never synced, in either direction.** The
  owner-relation predicate excluded any field declaring `inversedBy`. Per
  `@strapi/database`'s own relation metadata (`isOwner = !isBidirectional ||
  hasInversedBy`), that side *is* the owner — only `mappedBy` marks the inverse.
- **Media links landed on only one Draft & Publish row.** A published document
  has two rows sharing a `documentId`; the link was resolved with an unordered
  `findOne`, so in practice only the draft got it.
- **The live-sync loop guard never matched.** It was keyed on `syncId`, an
  attribute no content type declares, so Strapi dropped it before insert and the
  guard compared against `undefined` — letting a record ping-pong between
  instances. Now keyed on `documentId`.
- **A one-way profile with "sync deletions" enabled never created anything.**
  The comparator reinterpreted a one-sided record as a delete instead of a
  create. Deletion is now exclusively `reconcileDeletions`' job, which compares
  against a snapshot and can tell a genuine delete from "not created yet".
- **One unresolvable relation failed the whole record's relation write.**
  Relations to `plugin::`/`admin::` targets (e.g. a users-permissions user) are
  now excluded — such a `documentId` rarely resolves on the target instance.
- **Relations could silently never land.** In the relations pass, an unchanged
  `updatedAt` on both sides was treated as "nothing to do", even when the link
  sets differed. Links are now compared directly.

### Changed — behaviour

- **Execution is now globally two-pass, and hybrid two-pass is the default.**
  Pass 1 materializes entities for *every* content type in scope (plus core
  media); pass 2 then links owner-side relations (plus media links). Previously
  each content type ran both passes before the next began, so a relation whose
  target belonged to a later type — or to a cycle — could not resolve. Applies to
  Sync Now, profile execution, and Bulk Transfer (which previously ran a single
  unphased pass per type).
- **Entity→file media links are written from the owning content type**, via the
  new `media-sync/entity-media-links` endpoints, replacing morph-table
  traversal. Links are applied with set semantics, so removing an image at the
  source now removes it at the target instead of leaving a stale row. The legacy
  `media-sync/morph-links` endpoints remain and are used automatically when the
  peer runs an older version.
- **Dependency expansion is constrained and explicit**: depth is fixed at 1,
  direct owner-side in-scope targets only, and every exclusion is reported with a
  reason instead of being dropped silently. A stored `dependencyDepth` above 1 is
  normalized rather than rejected.
- **Deletion reconciliation and the last-sync watermark run after the final
  pass**, so pass 1 can no longer delete records that pass 2 is about to link.

### Added

- `GET /strategy` — the execution-strategy contract, so admin hints are
  generated from the same source as the behaviour.
- `POST /sync-config/enable-preview`, `/enable`, `/disable` — enabling a content
  type now previews what will be enabled, what already is, and what is skipped
  and why, with an option to include direct dependencies. Enabling one type no
  longer resets the direction and field selection of the others.
- `GET /media-sync/entity-media-links`, `POST /media-sync/entity-media-links/apply`
  (HMAC-signed), `GET /media-sync/link-scope`.
- Profile editing gained execution mode, a dependency-sync toggle, and a
  read-only dependency depth that explains why it is fixed.
- `npm test` — 31 cases (`node --test`) over the strategy contract, comparator
  phase semantics, and dependency constraint rules.

### Known limitations

- Components and dynamic zones are not synced; a page's dynamic-zone body will
  not transfer.
- Single types are not syncable — only `api::` collection types are eligible.
