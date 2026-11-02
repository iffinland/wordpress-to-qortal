# Phase 3 — Batch planning, media, disk protection and QDN identity

| Field | Value |
| --- | --- |
| Document | Phase 3 implementation and developer guide |
| Date | 2026-11-03 |
| Status | Implemented on a dedicated agent branch; no QDN publication and no live WordPress migration |
| Scope | Universal site identity, project-scoped QDN namespace, batch planning, disk preflight and limits, streaming media downloads, deduplication, reference counts, persistent mappings and conflicts |
| Phase 2 baseline | commit `f34e5229dd0eee1cef5d611f57569d6c72920d01` |
| Companion documents | [Architecture](ARCHITECTURE.md), [Phase 1](PHASE-1-ENGINE.md), [Phase 2](PHASE-2-WORDPRESS-ADAPTER.md), [Requirements](PRODUCT-REQUIREMENTS.md), [Roadmap](IMPLEMENTATION-ROADMAP.md) |

This document describes what Phase 3 actually implements. Every capability has
a test file and a command in section 12. Values marked **unverified** are
explicitly not proven by this phase.

## 1. Outcome

Phase 3 adds the safe preparation layer between Phase 2 discovery and a future
publisher:

- every project receives an automatic, persistent, cryptographically random
  site identity and a project-scoped QDN namespace;
- source-to-QDN identity mappings are persisted, bound to the exact
  (service, name, identifier) triple, and protected against silent reassignment;
- plans select a deterministic, configurable batch (default 15) of new,
  modified or route-changed items from a completed discovery batch;
- media URLs are validated, estimated with HEAD where possible, downloaded as
  bounded streams to `.part` files, SHA-256 verified, atomically finalized into
  a content-addressed store, deduplicated and reference-counted;
- disk space, per-run bytes, per-file bytes, file counts and unknown-size policy
  are enforced before and during downloads;
- all durable records stay in the Phase 1 journal/snapshot store and the local
  migration workspace.

Phase 3 does **not**:

- publish to QDN, sign a transaction, or read wallet keys/seeds/passwords;
- delete local migration files or Qortal Core data;
- implement deleted-source reconciliation;
- implement the desktop GUI, `.deb` packaging, or Phase 4+ functionality.

## 2. Module map

| Path | Responsibility |
| --- | --- |
| `lib/engine/identity.js` | Site identity, namespace, QDN triple derivation, name validation, mappings, conflicts, explicit target migration |
| `lib/engine/config.js` | Universal planning/disk/media defaults and validated overrides |
| `lib/engine/disk.js` | Filesystem probe, free-space measurement, preflight, unknown-size accounting, runtime reserve check |
| `lib/engine/planner.js` | Discovery-batch selection, classification, media estimates, disk preflight, plan persistence |
| `lib/engine/source-index.js` | Streaming reader for the latest verified discovery index |
| `lib/engine/media.js` | Plan download orchestration, receipts, references, reuse, inspection |
| `lib/media/url-policy.js` | HTTP(S)-only policy, private/loopback blocking, redirect validation |
| `lib/media/downloader.js` | Streaming GET/HEAD, `.part` resume, caps, disk guard, hashing, finalization |
| `lib/media/store.js` | Content-addressed paths, hash verification, atomic finalize, symlink rejection |
| `lib/engine/storage/schema.js` | Store version 2, identity/plan/media state, forward migration |
| `bin/qms.js` | `identity`, `plan`, `media`, `disk` commands |
| `lib/engine/host/server.js` | Host methods for the same operations |
| `test-support/media/server.js` | Deterministic local media server (Range, HEAD, unknown length, redirects, interruption) |
| `test-support/phase3/helpers.js` | Generic synthetic WordPress fixtures |

Nothing under `lib/engine` or `lib/media` contains a historical example-site
name, owner account, content identifier or resource prefix. The only Corbett
names in the engine remain in the pre-existing read-only compatibility layer.

## 3. Universal site identity and QDN namespace

### 3.1 Site identity

Each project document (`qms-project@1`) contains an optional additive
`identity` object:

~~~json
{
  "schema": "qms-site-identity@1",
  "siteId": "site_<32 lowercase hex characters>",
  "namespace": "ns<14 lowercase base32 characters>",
  "createdAt": "2026-11-03T00:00:00.000Z"
}
~~~

- `siteId` is generated from 16 random bytes. It is never derived from a
  project name, WordPress title, slug, URL or target Qortal name.
- It persists in `project.json`; legacy Phase 1/2 projects receive one lazily
  while the exclusive project lock is held.
- The namespace is `'ns' + base32(sha256(siteId))[0..14]` (70 bits). It is
  deterministic from the immutable site id, independent of any mutable field.
- `project.id` (`prj_...`) remains the local storage/query identifier. It is
  not a published QDN identity. `siteId` is the local site identity; the QDN
  name/namespace/identifier triple is the publication identity.

### 3.2 QDN identifier derivation

~~~text
identifier = <prefix>-<namespace>-<kind><base32(sha256(sourceKey))[0..16]>
~~~

- `prefix` defaults to `qms` (1–8 lowercase alphanumerics). It is project
  configuration, never a hardcoded example-site prefix.
- `sourceKey` is the Phase 2 stable key (`post:101`, `media:301`, ...).
- `kind` is one of `con`, `term`, `img`, `aud`, `vid`, `doc`, `idx`, `man`.
- The full identifier is capped at 64 characters and validated against
  `^[a-z0-9][a-z0-9_-]*$`.
- The mapping is bound to the complete triple
  (service, name, identifier):
  - post/page → `DOCUMENT`
  - image/audio/video/other media → `IMAGE`/`AUDIO`/`VIDEO`/`FILE`
- A slug, title, route or content edit never changes the identifier. Only an
  explicit target migration can change the name, and only an explicit prefix
  migration can change the identifier.

### 3.3 Qortal name validation

`target.qdnName` is required for planning. Phase 3 accepts 3–40 characters,
starting and ending with an alphanumeric, with alphanumerics, `_` or `-` inside.
Invalid names fail with `TARGET_NAME_REQUIRED` or `TARGET_NAME_INVALID` before
a plan is written.

**Unverified:** the exact character set accepted by the deployed Qortal Core
version must be re-confirmed in Phase 4/5. The publisher remains the final
authority; a target name that Core rejects must fail before approval.

### 3.4 Same name, multiple sites

Two projects may target the same Qortal name. Their namespaces and identifiers
differ because they derive from different `siteId` values. Tests cover two
projects with overlapping WordPress post IDs and slugs, and both projects use
the same target name.

### 3.5 Mappings

Persistent state (`state.identity`) holds:

~~~text
mappings[sourceKey] = {
  sourceKey, contentType, sourceType,
  service, name, identifier,
  contentHash, routeHash, slug,
  status: reserved | published | skipped,
  alternate, planId, firstMappedAt, updatedAt, revision,
  pendingRouteUpdate
}
triples["service|name|identifier"] = sourceKey
conflicts[id] = { kind, sourceKey, planId, details, resolvedAt, resolution }
history[] = explicit migration audit
~~~

- A mapping is created/reserved only when a plan is **ready** and is committed
  in the same journal transaction as the compact plan record. A crashed or
  rejected plan reserves nothing.
- A second project cannot read or write these records; state is per project.
- The triple index refuses to assign a triple owned by another source key.
- `status: reserved` means “identity reserved for a prepared batch”. Phase 5
  changes it to `published` only after exact read-back verification. Phase 3
  never claims publication.

### 3.6 Classification

Candidates are classified as `new`, `modified`, `unchanged`, `route_changed`,
`conflict`, `error` or `unsupported`.

- No mapping → `new` unless the derived triple already belongs to another
  source key → `IDENTITY_COLLISION` conflict.
- Same content hash and same route projection → `unchanged`.
- Same content hash, different slug/old URL → `route_changed`; the same
  identifier is retained and `pendingRouteUpdate` is set for a future
  route/index update.
- Different content hash → `modified`; the update targets the same triple.
- Mapping triple differs from the derived triple (name/prefix change) →
  `IDENTITY_MIGRATION_REQUIRED` conflict; no silent reassignment.
- Requested unsupported content types are reported with counts, not dropped.

### 3.7 Explicit target migration

Changing `target.qdnName` or `settings.identity.resourcePrefix` while mappings
exist is refused by `project.update` with `IDENTITY_MIGRATION_REQUIRED`.

The explicit two-step API is:

~~~bash
qms identity migrate-preview <projectId> --qdn-name <new-name> [--prefix <new-prefix>]
qms identity migrate-apply <projectId> --token <token>
~~~

The preview is persisted with a revision-bound token. Apply fails if mappings
changed after the preview. A name-only migration keeps identifiers (only the
name changes); a prefix change derives new identifiers and records the
migration in `history`. The audit trail is kept; old identifiers are not
silently reused by another source item.

**Unverified:** Phase 3 cannot check remote ownership or existing QDN resources
under the new name. Phase 5 must verify ownership and collisions before
publishing a migrated mapping.

## 4. Persistent state (store version 2)

`CURRENT_STORE_VERSION` is now `2`. Migration `1 → 2` adds:

~~~text
identity: null | { siteId, namespace, target, revision, mappings, triples, conflicts, history }
plans:    { [planId]: compact plan record }
media:    { assets, downloads, itemRefs, counters }
~~~

- Item bodies are never stored in the journal. Plan files contain item metadata,
  selected identifiers and media references, not full content bodies.
- The state store stays single-writer and crash-safe; the project lock and
  crash-recovery semantics are unchanged from Phase 1.
- `plans[planId]` stores counts, classification statistics, disk summary, media
  summary, plan file path, conflict count and download progress. The full plan
  is written atomically to `artifacts/plans/<planId>/plan.json`.
- `media.assets[hash]` stores hash, byte length, MIME type, relative path,
  reference count, source URLs and timestamps.
- `media.downloads[url]` stores the latest receipt/status and plan/item links.
- `media.itemRefs[itemId]` is the authoritative item→asset reference list used
  to recompute counts.
- Store version 99+ still fails closed without writing.

### 4.1 Measured state size

Measured by `test/phase3/state.test.js` with 200 synthetic posts, batch size
200, no media (one plan, 34 transactions):

| Metric | Measured |
| --- | --- |
| Item payload bytes | 620,300 |
| Compacted state snapshot | 242,073 bytes |
| In-memory state document | 172,718 bytes |
| Journal bytes before compaction | 873,714 bytes |
| Write amplification | 3.61× snapshot |
| Plan file | 174,570 bytes |
| Transactions | 34 |

The state is metadata-dominant and remains smaller than the item bodies it
references. Write amplification comes from the Phase 1 design that writes a
complete state document per transaction; it is acceptable at this volume but
must be watched as mappings grow.

**SQLite recommendation:** do not migrate yet. Re-evaluate behind the existing
store interface if measured needs exceed roughly 50k mapped items, if indexed
queries become necessary, or if journal write amplification exceeds an accepted
threshold. No SQLite change was made in Phase 3.

## 5. Batch planning

### 5.1 Inputs

Planning reads only the latest **completed** Phase 2 discovery batch through
`latest.json`. An incomplete/cancelled/failed batch is never used. Index
metadata is streamed from `index.jsonl`; item bodies are loaded only for the
selected candidates (bounded by batch size).

### 5.2 Defaults and validation

| Setting | Default |
| --- | --- |
| Batch size | 15 |
| Maximum scanned entries | 50,000 |
| Order | newest published first, then source key |
| Content types | post, page |
| Media estimates | enabled |
| Route changes | included |
| Estimated fee per resource | 0.01 QORT (configurable estimate) |

Batch size must be an integer 1–1000. `0`, negatives, fractions and strings are
rejected with `CONFIG_INVALID`.

### 5.3 Selection and determinism

- Candidates are filtered by content type, publication status, search, published
  date range and modified date range.
- Candidates are ordered deterministically by published timestamp and source
  key. Equal inputs produce the same selected keys and the same plan id.
- Actionable items (`new`, `modified`, `route_changed`) fill the batch to the
  configured size. Conflicts, errors and unsupported items are reported but do
  not consume batch slots.
- Previously reserved items with the same content hash and route are
  `unchanged`; they are not selected again. This prevents accidental duplicate
  imports.
- A plan is persisted only after the full classification, media estimate and
  disk preflight. Cancellation leaves no partial plan or reservation.
- A repeated plan id is derived from project, site, batch, content root,
  mapping revision, config, filters and selected keys (timestamps excluded).

### 5.4 Batch plan model (`qms-plan@1`)

The plan file contains:

- `planId`, `projectId`, `siteId`, namespace, target triple settings;
- source batch id/content root/truncation flag;
- filters and effective config;
- selected entries with `sourceKey`, content hash, route hash, classification,
  QDN triple, media count and warnings;
- per-media estimate (`known`, `unknown`, `missing`, `blocked`,
  `skipped_external`) with bytes/content type/final URL where available;
- `stats` (scanned/new/modified/unchanged/route_changed/conflict/error/
  unsupported/selected/withdrawn=0);
- disk report (`availableBytes`, reserve, known/unknown/projected/required,
  `fits`, reason and message);
- `estimates` (content/media/total resource counts, `feePerResource`,
  `estimatedFee`, `feeCurrency`, and a note that this is not a live fee quote);
- warnings/errors and conflict records.

`qms-plan-record@1` in state is a compact pointer and summary, not a duplicate
of the full plan. `plan.get` re-reads the file and fails with `PLAN_STALE` if it
does not match the persisted record.

### 5.5 Route changes and deleted sources

A slug/route change is not a new source identity and not a content revision. It
updates route metadata on the same mapping and sets `pendingRouteUpdate`.

A truncated discovery batch is not evidence of deletion. The plan records
`SOURCE_BATCH_TRUNCATED` and `withdrawn: 0`. Full deleted-source reconciliation
belongs to a later phase.

## 6. Disk protection

### 6.1 Defaults

| Setting | Default |
| --- | --- |
| Free-space reserve | 10 GiB |
| Max bytes per run | 2 GiB (`0` = unlimited) |
| Max file bytes | 256 MiB |
| Max files per run | 500 |
| Unknown content-length policy | `reject` |
| Unknown estimate per file | required for `estimate` |
| Safety factor | 1.0 |

All are project settings and can be overridden per run through host/CLI options.
The reserve is measured on the filesystem that actually contains the project
workspace (`fs.statfs` `bavail × bsize`), not on an arbitrary path.

### 6.2 Unknown sizes are never zero

- `reject` (default): any unknown media content-length blocks the plan with
  `MEDIA_UNKNOWN_SIZE`.
- `cap`: each unknown file is accounted at `maxFileBytes`.
- `estimate`: each unknown file is accounted at the explicitly configured
  `unknownSizeBytes`.
- The plan shows `unknownCount` and the accounted `unknownBytes`. Unknown is
  never silently treated as 0.

### 6.3 Preflight and runtime enforcement

- Preflight refuses a plan when `projected + reserve > available`, or when
  per-file/count/byte caps are exceeded, or when unknown policy refuses.
- A blocked plan is persisted for inspection but reserves no identity mappings.
- Before each download run the disk preflight is repeated.
- During streaming, the downloader checks the reserve at start and roughly every
  1 MiB, and catches `ENOSPC`. A breach pauses the run, keeps `.part` state,
  records a pause receipt, and never finalizes the file.
- `maxBytesPerRun` is reserved before a download and enforced during streaming
  through `maxTotalBytes`; a download that would exceed the remaining budget
  pauses instead of truncating a valid file into place.

## 7. Media pipeline

### 7.1 URL policy

- Only `http:` and `https:` URLs. `file:`, `data:`, `javascript:`, `blob:`,
  `ftp:`, `mailto:` and `tel:` are rejected.
- Credentials in URLs are rejected.
- Loopback, private, link-local, unique-local and cloud-metadata addresses are
  blocked unless loopback is explicitly enabled for a controlled fixture.
- DNS answers are checked when a hostname is used. This is an application-level
  SSRF defence, not a substitute for OS egress controls.
- External media (different origin from the source base URL) is linked-only by
  default. It is downloaded only when `media.allowExternalMedia` is explicitly
  true.
- Redirects are followed manually one at a time (maximum 3 by default), each
  target is revalidated, and HTTPS→HTTP downgrade is refused.
- Local paths are content-addressed from hashes; URLs never become file names.
  `..` path traversal and symlinked asset/part paths are rejected.

### 7.2 HEAD estimates

HEAD is used when available. Known content-length/content-type are recorded.
405/501, missing length or other recoverable HEAD failures produce `unknown`,
not zero. 404/410 produce `missing`, redirect policy failures produce `blocked`.

### 7.3 Download and finalization

- Streaming response bodies; no whole-file buffering.
- Temporary file `<sha256(url)>.part` plus `.part.json` metadata.
- Resume uses a bounded `Range` request only when the part metadata matches the
  URL and the part is not larger than the expected size. A server that ignores
  Range causes a clean restart instead of corruption.
- The part hash is recomputed from disk; the final SHA-256 is computed again at
  finalization. A mismatch, wrong byte count or unexpected HTML response never
  becomes a final asset.
- Finalization is fsync + atomic rename into
  `media/assets/<hash[0..2]>/<sha256 hex>`.
- A valid existing asset is reused; a corrupt existing asset is reported, never
  silently overwritten.
- Interrupted streams keep the part for the next run. Cancellation also keeps
  the part and records `cancelled`; no final file is created.

### 7.4 Deduplication and references

- Same URL with a verified receipt and a valid asset is reused without HTTP.
- Different URLs with identical bytes deduplicate to one content-addressed
  asset after hashing.
- `refCount` is recomputed from `media.itemRefs`: one asset shared by two items
  has `refCount = 2`; `sourceCount` counts distinct source URLs.
- Downloads are recorded per URL with status, hash, bytes, MIME type, item ids,
  plan id and timestamps. A partially downloaded or unverified file is never
  reported as `verified`.

## 8. Run, event, host and CLI integration

Run kinds:

| Kind | Behavior |
| --- | --- |
| `plan.create` | index → classify → select → media estimate → disk preflight → persist |
| `media.download` | validate plan/source hashes → reconcile refs → disk preflight → bounded download workers |

All operations use Phase 1 run cancellation, project lock and `qms-event@1`
ordering. New stable event codes include `PLAN_INDEX_LOADED`,
`PLAN_CLASSIFIED`, `PLAN_SELECTED`, `PLAN_CONFLICTS_PRESENT`,
`SOURCE_BATCH_TRUNCATED`, `SOURCE_INDEX_SCAN_TRUNCATED`, `MEDIA_SIZE_UNKNOWN`,
`EXTERNAL_MEDIA_LINKED_ONLY`, `PLAN_MEDIA_MISSING`, `MEDIA_VERIFIED`,
`MEDIA_REUSED`, `MEDIA_DEDUPLICATED`, `MEDIA_PROGRESS`, `MEDIA_PAUSED`,
`MEDIA_SKIPPED_EXTERNAL` and `SOURCE_CHANGED_AFTER_PLANNING`.

Host methods:

~~~text
identity.get, identity.migrationPreview, identity.applyMigration,
identity.resolveConflict
plan.create, plan.list, plan.get
media.download, media.inspect, media.reconcile
~~~

CLI:

~~~bash
qms identity show <projectId>
qms identity conflicts <projectId> [--all]
qms identity resolve <projectId> <conflictId> --resolution skip|alternate|abort
qms identity migrate-preview <projectId> --qdn-name <name> [--prefix <prefix>]
qms identity migrate-apply <projectId> --token <token>
qms plan create <projectId> [--batch-size 15] [--after ...] [--before ...]
qms plan create <projectId> --modified-after ... --content-types post,page
qms plan create <projectId> --reserve-gib 10 --max-file-bytes 512MiB
qms plan create <projectId> --unknown-size-policy cap
qms plan list <projectId>
qms plan get <projectId> <planId>
qms media download <projectId> --plan <planId> [--concurrency 4]
qms media inspect <projectId>
qms media reconcile <projectId>
qms disk check <projectId>
~~~

`--allow-external` and `--allow-loopback` exist for controlled fixtures and
explicit opt-in. Loopback must not be enabled for production sources without a
specific reason.

Project creation/update also accepts `--qdn-name`, `--prefix` and
`--batch-size`.

## 9. Publishing and cleanup boundaries

### 9.1 Migration Workspace vs Qortal Core storage

| Area | Owner | Phase 3 behavior |
| --- | --- | --- |
| `artifacts/source/...` | Migration app | Read-only planning input |
| `artifacts/plans/...` | Migration app | Written atomically; never deleted |
| `media/assets`, `media/tmp`, receipts | Migration app | Written only inside project root |
| Qortal Core QDN data | Qortal Core | Never read or modified |

### 9.2 No publish, no delete

- No QDN publish, signing, wallet or blockchain call exists in Phase 3.
- No local migration file is deleted.
- `media.tmp` `.part` cleanup is limited to overwriting/removing the app's own
  temporary part after successful verification or an explicit restart decision.
- Phase 5 will produce publish plans and read-back verification. Phase 8 owns
  verified cleanup.

### 9.3 Phase 8 cleanup prerequisites

Cleanup may delete a local asset only when:

1. every referencing item is published and verified, or explicitly withdrawn;
2. no pending/failed/paused plan or unverified mapping references it;
3. reference counts and the QDN mapping/receipt were reconciled;
4. the asset is not needed to rebuild an index/manifest;
5. the cleanup is recorded in history and identity/sync metadata is preserved.

## 10. Security and safety

- No wallet/seed/password is read, logged or stored.
- Source credentials never enter Phase 3 state, plans, receipts or events.
- Media URLs cannot select arbitrary local files, `file:` paths or private
  network targets under secure defaults.
- All downloaded data stays under the project root.
- Symlinked asset/part paths are refused; final paths are hash-derived.
- A caller cannot download a blocked plan.
- A blocked/failed run remains inspectable; no cursor advances silently after a
  failure.
- A second engine instance cannot open a project while a plan/download holds the
  lock.

## 11. Limitations and risks

- **No live test.** All tests use local synthetic WordPress/media fixtures. No
  live WordPress site, QDN resource or Qortal node was contacted.
- **No publish verification.** Phase 3 mappings are `reserved`; only Phase 5 can
  mark them `published` after exact read-back.
- **Qortal name rule uncertainty.** The exact Core name character set must be
  confirmed in Phase 4/5.
- **HEAD estimates are not authoritative.** A server may change size/content
  after HEAD; the downloader rechecks byte count and hashes, but a changed file
  is a new revision, not an update of the old one.
- **Unknown-size streams.** If the server provides no content-length and closes
  early without a protocol error, an unknown-length stream cannot be proven
  complete beyond the bytes received; the hash is still recorded for the bytes
  stored. Use `reject` unless a bounded policy is explicitly accepted.
- **DNS rebinding.** DNS answers are validated, but a hostile DNS server can
  change answers between checks. OS-level egress policy is still recommended.
- **Stale references after edits.** Phase 3 does not remove old media references
  when a content revision stops referencing an asset. This is safe for cleanup
  (it keeps files longer) but Phase 8 must reconcile references before deleting.
- **Target migration is local-only.** It does not verify remote ownership,
  existing resources or whether the old/new names are controlled by the same
  owner.
- **No deletion reconciliation.** A missing source item is not marked withdrawn
  from an incomplete scan.
- **Single-writer state.** Read-only concurrent access is not exposed; the
  project lock prevents concurrent writers.
- **Plan/media records grow with projects.** Measure before crossing ~50k
  mapped items; SQLite remains a future option behind the store interface.
- **External media policy is per plan/config.** Changing it requires a new plan;
  old plans retain their decision.
- **Fee estimate is not a live quote.** The default 0.01 QORT per resource is
  configurable and shown for planning review only; Phase 5 must read the current
  network fee and show the final amount before approval.

## 12. Tests and evidence

Commands from the Phase 3 worktree:

~~~bash
npm ci
npm test                 # 139 tests: 102 Phase 1/2 + 37 Phase 3
npm run test:phase3      # 37 Phase 3 tests
npm run check            # npm test + viewer build + CMS build
~~~

Phase 3 test files:

| File | Covers |
| --- | --- |
| `test/phase3/identity.test.js` | Immutable site id, namespace uniqueness under one Qortal name, legacy identity creation, slug/content stability, route changes, target migration, collisions/alternate resolution, invalid names, overlong identifiers |
| `test/phase3/planner.test.js` | Default and configurable 15-item batches, determinism, date/modified filters, restart, project isolation, truncated batches, large archive bounded planning, unsupported types, target requirement |
| `test/phase3/disk.test.js` | Preflight/reserve, early refusal, unknown-size policies, per-file/file-count/byte caps, runtime caps, full-disk pause |
| `test/phase3/media.test.js` | Streaming/hashing/receipts, shared URL dedupe, identical-bytes dedupe, reuse, missing/blocked/external, redirect policy, URL/path/symlink safety, unknown size, interruption/resume, cancellation, blocked plan |
| `test/phase3/state.test.js` | Compact state/no bodies, event ordering, restart reconstruction, measured sizes/write amplification, project lock during download |
| `test/phase3/host-cli.test.js` | Host identity/plan/media methods, notifications, CLI identity/plan/media/disk commands |

### 12.1 Acceptance mapping

| Criterion | Evidence |
| --- | --- |
| AC3.1 Exactly 15 posts per configurable batch | `planner.test.js` default 15 and invalid values |
| AC3.2 Plan shows item/media counts, known/unknown bytes, estimated fee, free/reserve/fits | `planner.test.js` (fee defaults), `disk.test.js`, plan model |
| AC3.3 Refuse when projected + reserve exceeds free space | `disk.test.js` preflight refusal, zero mappings/GETs |
| AC3.4 Per-run file/byte and per-file caps pause with state | `disk.test.js` runtime caps |
| AC3.5 Interrupted downloads never look final; resume works | `media.test.js` `.part` + Range test |
| AC3.6 Shared media stored once and reference counted | `media.test.js` shared URL and identical bytes |
| AC3.7 Unchanged item is not republished/selected again | `planner.test.js` third plan selected 0 |
| AC3.8 Modified item uses same triple; collision is a conflict | `identity.test.js` slug/content/migration/collision |
| AC3.9 Project lock prevents concurrent work | `state.test.js` lock; existing Phase 1 lock tests |
| AC3.10 Disk-full/limits leave recoverable state | `disk.test.js` full-disk pause; receipts/parts preserved |

### 12.2 Test totals

- Baseline before Phase 3: **102/102**.
- Final: **139/139** passing (37 new Phase 3 tests).
- `npm run check`: 139 tests pass + viewer build + CMS build.
- All networks are local fixture servers (`127.0.0.1`).

## 13. Phase 4 and Phase 5 integration requirements

Phase 4 (desktop shell) should:

1. read the plan/review model directly (counts, known/unknown bytes, disk report,
   media statuses, conflicts) and never infer support from adapter ids;
2. expose explicit controls for reserve, per-run bytes/files, per-file bytes,
   unknown-size policy, external media and concurrency;
3. show paused/partial/blocked/failed states and the exact recovery action;
4. never claim a file is complete before a `verified` receipt;
5. surface identity conflicts and the two-step target migration; never let a
   user edit target fields around the migration API;
6. store media only under the project workspace and never offer a “delete Qortal
   data” action.

Phase 5 (publication) must:

1. convert `reserved` mappings to `published` only after exact QDN read-back
   (service, name, identifier) + content hash verification;
2. verify name ownership and target collisions remotely before publishing;
3. keep the same identifiers for modified content; publish indexes/manifests
   last;
4. treat a failed/partial publish as inspectable and retry only explicit failed
   resources;
5. never claim deletion from QDN (QDN has no on-chain delete).

## 14. Conclusion

Phase 3 provides a universal, tested preparation layer: automatic immutable
site identity, project-scoped QDN namespaces, conflict-safe mappings,
deterministic batch planning, enforced disk safety, and verified
content-addressed media. It stops exactly before publication and destructive
cleanup. The remaining uncertainties are explicitly listed above and are inputs
to Phase 4/5, not claims of completion.
