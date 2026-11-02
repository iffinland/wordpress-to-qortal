# Architecture — Qortal Migration Studio

| Field | Value |
| --- | --- |
| Document | Target architecture |
| Product working name | Qortal Migration Studio |
| Executing agent | DeepSeek (`opencode-development` profile) |
| Date | 2026-11-02 |
| Status | Proposed architecture; nothing in this document is implemented unless labeled otherwise |
| Companion audit | [`PHASE-0-ARCHITECTURE-AUDIT.md`](PHASE-0-ARCHITECTURE-AUDIT.md) |

This document separates **verified current behavior** (from the Phase 0 audit)
from **proposed architecture**. Proposals are design decisions for the next
phases, not current capabilities.

> **Phase 2 implementation note (2026-11-02):** the SourceAdapter contract,
> adapter registry, WordPress adapter and `qms-content@1` model are now
> implemented on a dedicated agent branch. See
> [`PHASE-2-WORDPRESS-ADAPTER.md`](PHASE-2-WORDPRESS-ADAPTER.md). Phase 2 keeps
> the journal+snapshot store, represents terms and media as `qms-content@1`
> documents, and writes discovery batches under the project's local artifacts.
>
> **Phase 3 implementation note (2026-11-03):** universal site identity, a
> project-scoped QDN namespace, persistent source→QDN mappings, deterministic
> batch planning, disk preflight/limits, streaming media downloads,
> content-addressed deduplication, reference counts and explicit conflict/target
> migration are implemented. See
> [`PHASE-3-PLANNING-MEDIA-IDENTITY.md`](PHASE-3-PLANNING-MEDIA-IDENTITY.md).
> Phase 3 does not publish to QDN, does not sign, and does not delete local or
> Qortal Core data. The Phase 3 state store is journal+snapshot version 2;
> SQLite remains a measured future option, not a current dependency.

## 1. Architecture goals and constraints

### 1.1 Goals

- One guided desktop application for multiple independent migration projects.
- A reusable, testable Node.js engine that is not tied to the GUI or to Corbett.
- A source-adapter boundary that supports WordPress now and Joomla/Wix later.
- A common, versioned content model with stable source and QDN identities.
- Crash-safe, resumable runs with structured progress and errors.
- Bounded downloads, disk protection and safe cleanup.
- Hub-mediated, key-free publication with exact read-back verification.
- A generic CMS/site template plus optional custom clones.
- A self-contained Debian package and a path to Windows.
- English-first UI with localization-ready strings.

### 1.2 Hard constraints

1. **No private-key collection.** The desktop app must never ask for, store,
   display, log or transmit a Qortal seed, private key or wallet password.
2. **Signing is host-mediated.** In the verified Qortal model, signing happens in
   Qortal Hub inside a rendered Q-App frame. The desktop app prepares and
   verifies; it does not sign.
3. **QDN has no delete.** Withdrawal/tombstone is an app convention, not network
   deletion.
4. **Derived indexes are not authority.** Catalogs/manifests must be rebuildable
   and must not be the only record of what exists.
5. **No false completion.** Submission, status, exact-revision verification and
   index verification are separate states.
6. **Preserve the Corbett workflow.** Existing identifiers and operational flows
   remain a compatibility profile and regression fixture.

## 2. System context

```text
┌──────────────────────────────────────────────────────────────────┐
│                    Qortal Migration Studio (desktop)             │
│                                                                  │
│  ┌────────────────────────┐        ┌──────────────────────────┐  │
│  │ Presentation shell     │  IPC   │ Engine host              │  │
│  │ (Electron renderer)    │<──────>│ (Node.js, bundled)       │  │
│  │ - wizard               │        │ - project manager        │  │
│  │ - plan/review          │        │ - source adapters        │  │
│  │ - progress/history     │        │ - content pipeline       │  │
│  │ - conflict/cleanup     │        │ - media/disk manager     │  │
│  └────────────────────────┘        │ - identity/state store   │  │
│                                    │ - publisher adapter      │  │
│                                    │ - CMS template builder   │  │
│                                    └────────────┬─────────────┘  │
└─────────────────────────────────────────────────┼────────────────┘
                                                  │ read-only HTTP
                                                  ▼
                                   ┌──────────────────────────────┐
                                   │ Source CMS (WordPress REST)  │
                                   └──────────────────────────────┘

Desktop prepares a portable batch/manifest.
User opens a Q-App in Qortal Hub for approval/signing.
Desktop/Q-App verifies exact QDN resources via node/bridge.

┌──────────────────────┐       ┌──────────────────────────────┐
│ Qortal Hub (host)    │       │ Qortal Core node             │
│ - account/approval   │       │ - chain/QDN reads            │
│ - signing            │       │ - arbitrary resource serving │
│ - qortalRequest      │       │ - status/search              │
└──────────────────────┘       └──────────────────────────────┘
```

**Verified boundary:** the desktop process cannot call `qortalRequest` outside a
Q-App frame. The publisher is therefore a separate surface, not a desktop API.

## 3. Component architecture

### 3.1 Desktop shell (proposed: Electron)

Responsibilities:

- window lifecycle, menus, native folder picker, notifications;
- secure renderer with context isolation and a narrow preload API;
- IPC transport to the engine host;
- OS keyring access (main process only);
- auto-update/release integration;
- no domain logic and no direct filesystem/network access from the renderer.

Why Electron for v1: the engine is Node.js, the current publisher relies on
Chromium file-folder selection, and Electron's `.deb` tooling is mature. The
engine boundary is designed so a Tauri shell can replace Electron later without
rewriting domain logic.

### 3.2 Engine host

A long-lived Node.js process (or Electron main-process module) exposing a typed
API. It owns:

- project registry and locks;
- source adapters;
- discovery/normalization/planning;
- media fetch/validation;
- identity mapping and conflict detection;
- run state machines and event emission;
- publication planning/verification (not signing);
- cleanup/history;
- CMS template generation/build orchestration.

The engine must not import Electron APIs. It receives paths, clocks, network
clients and secret providers through dependency injection for testability.

### 3.3 Module boundaries

| Module | Responsibility | Must not do |
| --- | --- | --- |
| `project` | Project CRUD, settings, storage roots, locks | Fetch source content |
| `source` | Adapter registry, capability negotiation, source sessions | Know QDN identifiers |
| `model` | Versioned normalized entities, hashes, validation | Perform I/O |
| `planner` | Diffs, batch selection, classification, estimates | Download media |
| `media` | URL policy, HEAD, download, hash, dedup, ref counts | Publish to QDN |
| `identity` | Source key ↔ QDN triple mapping, revisions, conflicts | Render UI |
| `state` | SQLite/snapshot persistence, migrations, journals | Contain business rules |
| `run` | State machine, pause/resume/cancel, retries, events | Directly write files |
| `publisher` | Publish plan, adapter modes, verification, partial handling | Sign transactions |
| `cms-template` | Generic site package, config, build, manifest adapter | Migrate source data |
| `history` | Runs, items, publications, receipts, exports | Delete project data silently |
| `cleanup` | Eligibility, ref counts, quarantine, deletion | Delete outside project root |
| `security` | Secret provider, path guards, redaction, URL policy | Expose secrets to renderer |
| `diagnostics` | Structured logs, health checks, support bundle | Include credentials/content |

### 3.4 Process and IPC model

**PROPOSAL:** JSON-RPC 2.0-style request/response over Electron IPC with a
separate server-sent event channel for progress. The same protocol can run over
`stdio` for a headless worker or tests.

Request envelope:

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "method": "runs.start",
  "params": {
    "project_id": "prj_...",
    "mode": "incremental",
    "batch_size": 15
  }
}
```

Response envelope:

```json
{
  "jsonrpc": "2.0",
  "id": "req_01H...",
  "result": { "run_id": "run_...", "state": "planning" },
  "error": null
}
```

Event envelope: see `qms-event@1` in the audit. Every event has a monotonically
increasing `seq` per engine process and a stable `code`. The renderer must be
able to reconstruct progress from events plus a `runs.get` snapshot after a
reconnect.

## 4. Public engine API

The following is the proposed contract; names may change before implementation,
but the boundaries should not.

### 4.1 Projects

```ts
interface ProjectService {
  create(input: CreateProjectInput): Promise<Project>;
  list(): Promise<ProjectSummary[]>;
  get(projectId: string): Promise<Project>;
  update(projectId: string, patch: UpdateProjectInput): Promise<Project>;
  archive(projectId: string, options: { deleteLocalData: boolean }): Promise<void>;
  export(projectId: string, destination: string): Promise<ExportResult>;
  importBundle(path: string): Promise<Project>;
  acquireLock(projectId: string): Promise<ProjectLock>;
  releaseLock(lock: ProjectLock): Promise<void>;
}
```

### 4.2 Source adapters

```ts
interface SourceAdapter {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;

  getCapabilities(): SourceCapabilities;

  validateConnection(config: SourceConfig, secrets: SecretProvider): Promise<ValidationReport>;

  discover(config: SourceConfig, secrets: SecretProvider, options: DiscoveryOptions): Promise<DiscoveryReport>;

  listContent(query: ContentQuery): AsyncIterable<SourceItemRef>;
  getContent(ref: SourceItemRef): Promise<SourceItem>;
  listTerms(query: TermQuery): AsyncIterable<SourceTerm>;
  listAssets(query: AssetQuery): AsyncIterable<SourceAsset>;

  normalize(item: SourceItem): NormalizedContent;
  normalizeAsset(asset: SourceAsset): NormalizedAsset;
}
```

### 4.3 Runs

```ts
interface RunService {
  start(input: StartRunInput): Promise<Run>;
  get(runId: string): Promise<RunSnapshot>;
  list(projectId: string): Promise<RunSummary[]>;
  pause(runId: string): Promise<void>;
  resume(runId: string): Promise<void>;
  cancel(runId: string): Promise<void>;
  retryFailed(runId: string, itemIds?: string[]): Promise<Run>;
}
```

### 4.4 Publication

```ts
interface PublisherAdapter {
  readonly mode: 'dry-run' | 'hub-handoff' | 'hub-devserver' | 'disabled';
  getCapabilities(): PublisherCapabilities;

  prepare(plan: PublishPlan): Promise<PreparedPublication>;
  handoff(prepared: PreparedPublication): Promise<HandoffInstructions>;
  importResults(handoff: HandoffInstructions): Promise<PublishResult[]>;
  verify(addresses: QdnAddress[]): Promise<VerificationResult[]>;
}
```

The desktop must never expose a `sign()` method. If a future supported external
signer exists, it is added as another adapter with explicit owner authorization;
the GUI still must not collect keys.

### 4.5 Cleanup and history

```ts
interface CleanupService {
  preview(runId: string): Promise<CleanupPreview>;
  mark(runId: string): Promise<CleanupMarker>;
  apply(marker: CleanupMarker, options: { permanent: boolean }): Promise<CleanupResult>;
  restore(marker: CleanupMarker): Promise<void>;
}

interface HistoryService {
  listRuns(projectId: string): Promise<RunSummary[]>;
  listItems(runId: string, filter?: ItemFilter): Promise<ItemHistory[]>;
  listPublications(itemId: string): Promise<PublicationHistory[]>;
  exportSupportBundle(projectId: string, destination: string): Promise<string>;
}
```

## 5. Data architecture

### 5.1 Storage layout

**PROPOSAL:**

```text
~/.local/share/qortal-migration-studio/        (XDG data)
├── studio.db                                   SQLite metadata (WAL)
├── projects/
│   └── <project-id>/
│       ├── project.json                        portable settings (no secrets)
│       ├── secrets.json                        secret references only (or none)
│       ├── source/                             raw/normalized staging
│       ├── media/                              content-addressed assets
│       │   └── sha256/<prefix>/<hash>
│       ├── runs/<run-id>/
│       │   ├── plan.json
│       │   ├── manifest.json
│       │   ├── receipts/
│       │   └── logs/
│       ├── publications/                       prepared batches/handoffs
│       └── templates/                          generated CMS/site builds
├── receipts/
└── cache/
```

`~/.config/qortal-migration-studio/` may hold UI preferences. Secrets belong in
the OS keyring, not in these files.

> **Phase 1 implementation note (2026-11-02):** the foundation ships the
> journal + atomic-snapshot store described in §5.1 as the fallback, not SQLite.
> Rationale, format and recovery rules are in
> [`PHASE-1-ENGINE.md`](PHASE-1-ENGINE.md). The schema below remains the target
> shape if state volume later justifies SQLite behind the same store interface.
>
> **Phase 3 actual layout (2026-11-03):** the implemented per-project layout is
> `project.json`, `state/snapshot.json`, `state/journal.jsonl`, `runs/`,
> `artifacts/source/<adapter>/batches/<batchId>/`,
> `artifacts/plans/<planId>/plan.json`, `media/assets/<hash[0..2]>/<sha256>`,
> `media/tmp/<sha256(url)>.part`, `media/receipts/` (reserved) and
> `lock.json`. No `studio.db` exists. Compact identity mappings, plan records,
> media receipts and reference counts live in the version-2 journal state; item
> bodies and media bodies never do.

### 5.2 Database schema (proposed)

```sql
-- schema version in schema_migrations
projects(id, name, source_adapter, source_config_json, qdn_config_json,
         template_id, storage_root, created_at, updated_at, archived_at)

source_items(id, project_id, source_type, source_key, external_id, slug,
             status, source_created_at, source_modified_at, content_hash,
             normalized_json, first_seen_at, last_seen_at)

source_terms(id, project_id, source_type, source_key, name, slug, parent_key,
             taxonomy, source_modified_at)

assets(id, project_id, source_url, kind, mime_type, bytes, sha256,
       local_path, download_state, first_seen_at, last_seen_at)

item_assets(item_id, asset_id, role)

qdn_mappings(id, project_id, source_item_id, qdn_service, qdn_name,
             qdn_identifier, content_hash, revision, first_published_at,
             last_verified_at, tx_signature)

runs(id, project_id, mode, state, batch_size, cursor_json, settings_json,
     started_at, ended_at, error_code, error_message)

run_items(run_id, source_item_id, state, classification, content_hash,
          attempt_count, last_error_code, last_error_message)

publications(id, run_id, run_item_id, qdn_service, qdn_name, qdn_identifier,
             content_hash, bytes, estimated_fee, state, tx_signature,
             submitted_at, verified_at, error_code, error_message)

conflicts(id, project_id, source_item_id, kind, source_hash, local_hash,
          qdn_hash, resolved_by, resolution, created_at, resolved_at)

cleanup_markers(id, run_id, state, quarantine_path, created_at, delete_after,
                applied_at)

events(id, project_id, run_id, seq, timestamp, type, level, code, message,
       details_json)
```

Use WAL, foreign keys, `PRAGMA synchronous=FULL` for state transitions, and a
single writer. Large content blobs stay in files; the database stores paths and
hashes.

### 5.3 Versioned formats

| Format | Version | Purpose |
| --- | --- | --- |
| `qms-project@1` | 1 | Portable project settings |
| `qms-content@1` | 1 | Normalized content item |
| `qms-asset@1` | 1 | Normalized asset |
| `qms-plan@1` | 1 | Batch/run plan |
| `qms-manifest@1` | 1 | Published QDN catalog (compatible with current `cr-qdn-manifest` via an adapter) |
| `qms-event@1` | 1 | Progress/error event |
| `qms-receipt@1` | 1 | Cleanup/history receipt |
| `qms-cms-manifest@1` | 1 | Generic CMS dataset |

Migrations are forward-only, idempotent and tested against fixture databases.
Unknown newer versions must fail closed with a clear "requires newer app" message.

### 5.4 Common content model

```json
{
  "schema": "qms-content@1",
  "id": "src_wordpress_post_123",
  "source": { "adapter": "wordpress", "key": "123", "type": "post" },
  "identity": {
    "source_id": 123,
    "slug": "example-post",
    "old_url": "https://example.com/example-post/",
    "canonical_url": null
  },
  "state": "published",
  "title": "Example post",
  "summary": "…",
  "content": {
    "format": "html",
    "html": "<p>…</p>",
    "text": "…",
    "hash": "sha256:…"
  },
  "dates": {
    "created_at": "2020-01-01T10:00:00.000Z",
    "modified_at": "2020-01-02T10:00:00.000Z",
    "published_at": "2020-01-01T10:00:00.000Z"
  },
  "terms": { "categories": [], "tags": [] },
  "authors": { "editorial": "Site Author", "source": null },
  "media": { "featured": null, "images": [], "audio": [], "video": [], "documents": [], "embeds": [] },
  "links": { "internal": [], "external": [] },
  "provenance": { "adapter_version": "1.0.0", "fetched_at": "…", "raw_hash": "sha256:…" }
}
```

Rules:

- `source.key` is stable within the adapter and is the primary external identity.
- `content.hash` is computed over a canonical serialization of the meaningful
  fields (not volatile fetch timestamps).
- Adapters may add adapter-specific fields under `source.extra`; the engine must
  not depend on them.
- No UI strings, QDN names or template branding in the model.

Phase 2 implementation details:

- `content.hash` is `sha256:` over a canonical projection that excludes slug,
  identity URL, source metadata, provenance and `modified_at`; published date,
  status, title, body, terms, authors and media are included.
- Terms and media are normalized as `qms-content@1` items with
  `content_type` `category`, `tag` and `media`. A future split into separate
  term/asset tables can preserve this document contract.
- Discovery batches are append-only under
  `<project>/artifacts/source/<adapter>/batches/<batchId>/`; `latest.json`
  points only at verified completed batches. This is the local migration
  workspace, never Qortal Core storage.

## 6. Source-adapter contract and capability declarations

### 6.1 Capability report

```ts
interface SourceCapabilities {
  contentTypes: Array<'post' | 'page' | 'custom' | string>;
  terms: Array<'category' | 'tag' | 'custom' | string>;
  assets: { images: boolean; audio: boolean; video: boolean; documents: boolean; embeds: boolean };
  states: Array<'published' | 'draft' | 'private' | 'trashed' | 'scheduled' | 'unknown'>;
  incremental: { new: boolean; modified: boolean; deleted: boolean; cursor: 'offset' | 'date' | 'id' | 'etag' | 'none' };
  authentication: Array<'application_password' | 'session' | 'token' | 'none'>;
  limits: { maxPageSize: number; supportsDateFilters: boolean };
}
```

The UI uses this to hide unsupported options and explain limitations. An adapter
must never silently drop a content type it cannot migrate.

### 6.2 Conformance suite

Every adapter must pass a shared suite:

1. deterministic normalization from fixtures;
2. stable source keys across runs;
3. pagination boundaries and short/empty pages;
4. modified-content detection (if declared);
5. deletion/withdrawal detection (if declared);
6. auth failure vs empty result;
7. rate-limit/timeout behavior;
8. media extraction and MIME handling;
9. no adapter-specific leakage into engine core.

### 6.3 Future adapters

Joomla and Wix implement the same contract. Differences are expressed through
capabilities and adapter-specific authentication, not through engine forks. A
new adapter must be testable with a fake server and must not require changes to
the publisher, identity or cleanup modules.

## 7. Migration and synchronization state machines

### 7.1 Project lifecycle

```text
draft -> configured -> validated -> ready -> running -> paused -> ready
                                      |          |
                                      |          +-> completed
                                      |          +-> failed -> ready (retry)
                                      +-> blocked (missing auth/name/disk)
ready -> archived
any -> blocked (with reason)
```

Guards:

- `configured` requires source + target settings.
- `validated` requires connection and capability checks.
- `ready` requires no unresolved blocking conflict and a lock is available.
- `completed` requires all selected items terminal (verified/skipped/withdrawn)
  and no unresolved partial publication.
- `archived` requires explicit user action.

### 7.2 Run state machine

```text
created
  -> planning
  -> fetching
  -> normalizing
  -> media_planning
  -> media_downloading
  -> validating
  -> prepared
  -> awaiting_publish
  -> publishing
  -> verifying
  -> completed
```

Failure/pause transitions:

```text
any active state -> paused (user)
any active state -> failed (error)
failed -> retrying -> (previous state)
paused -> ready_to_resume -> (previous state)
prepared/awaiting_publish -> cancelled
completed -> cleanup_pending -> cleaned
```

Rules:

- Every transition is persisted before the side effect is acknowledged.
- Each step is idempotent and keyed by `(run_id, item_id, step, content_hash)`.
- `publishing` never auto-retries an ambiguous write.
- `verifying` must complete before `completed`.
- A failed index publication does not roll back verified content; it becomes a
  repair task.

### 7.3 Item state machine

```text
discovered
  -> fetched
  -> normalized
  -> planned
  -> media_pending
  -> media_ready
  -> validated
  -> queued
  -> publishing
  -> submitted
  -> verified
  -> withdrawn
```

Alternatives:

```text
any -> skipped (unchanged/unsupported/user choice)
any -> conflict (source/local/QDN mismatch)
any -> failed (with retryable flag)
failed -> retrying -> previous state
verified -> update_pending -> publishing (modified item, same identity)
```

Per-item idempotency key: `(project_id, source.adapter, source.key, content_hash)`.
The QDN triple is stable for that source key unless the user explicitly chooses
a new identity.

### 7.4 Synchronization state machine

```text
idle
  -> scanning
  -> classifying
  -> planning_delta
  -> awaiting_user (conflicts)
  -> preparing
  -> publishing
  -> verifying
  -> idle
```

Classification outcomes:

| Outcome | Condition | Action |
| --- | --- | --- |
| `new` | source key not mapped | plan new resource |
| `modified` | source hash differs from mapping hash | plan same-identity update |
| `unchanged` | source hash equals mapping hash | skip |
| `source_withdrawn` | source reports deleted/private/trashed | apply withdrawal policy |
| `mapping_orphaned` | mapping exists but source item missing | reconciliation report |
| `conflict` | local/QDN content differs unexpectedly | require user resolution |
| `error` | source unavailable/malformed | fail or partial; never "no changes" |

### 7.5 Publication state machine

```text
planned
  -> prepared
  -> handoff_ready
  -> submitted (per resource)
  -> confirmed (transaction/metadata if available)
  -> verified (exact content)
  -> indexed (derived resources verified)
```

Failure states:

```text
partial (some resources submitted/verified, some failed)
failed (no resource confirmed)
ambiguous (host result unclear; do not auto-retry)
declined (user rejected)
```

Completion requires every required resource to be `verified` and the derived
index group to be `indexed`, or an explicit user decision to accept a partial
state with a repair plan.

### 7.6 Cleanup state machine

```text
not_eligible
  -> eligible (verified completed run)
  -> marked
  -> quarantined
  -> deleted
  -> restored (if within quarantine)
```

Guards:

- no pending/failed run references the files;
- no unverified publication references the files;
- ref counts are zero for each asset;
- receipt is written and fsynced;
- real path is inside the project root and not a symlink escape;
- user explicitly confirms permanent deletion.

## 8. QDN preparation and publication architecture

### 8.1 Resource plan

For each item, the engine produces a `PublishResource`:

```ts
interface PublishResource {
  sourceItemId: string;
  kind: 'content' | 'asset' | 'index' | 'manifest';
  service: 'DOCUMENT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'FILE' | 'WEBSITE' | 'APP';
  name: string;
  identifier: string;
  localPath: string;
  contentHash: string;
  bytes: number;
  estimatedFee: number;
  order: number;
}
```

Rules:

- identifiers are stable, prefix-namespaced and ≤64 characters;
- content and asset identifiers are derived from the source key and a stable
  hash, not from mutable slugs alone;
- the manifest/index resources are derived and published last;
- a resource may be blocked if the local file is missing, the hash changed, the
  service limit is exceeded, or the target name is not owned.

### 8.2 Publication order

```text
1. media/assets
2. content entities
3. indexes/categories/tags/media map/url map
4. manifest (last)
```

If a media item fails, dependent content is blocked. If an index fails after
content succeeds, the content remains authoritative and the index is marked for
repair; do not rewrite a partial index from an incomplete view.

### 8.3 Hub handoff mode

The desktop prepares a portable folder:

```text
handoff/
├── publish-plan.json
├── qdn-manifest.json
├── resources/...
├── instructions.md
└── results.template.json
```

The user opens the published Migration Publisher Q-App in Qortal Hub, selects the
folder, reviews the plan, approves publishes, and returns/exports results. The
desktop imports results and verifies exact resources. If the Q-App can write a
result file via `SAVE_FILE`, the user can save it back; otherwise the desktop
performs read-only verification itself.

### 8.4 Hub Dev Mode mode (optional, owner decision)

A loopback-only local publisher UI can be served from the desktop and registered
in Hub Dev Mode → Server. Hub injects `qortalRequest`; the app uses it for
account/approval/publish. Constraints:

- bind to `127.0.0.1` only;
- random per-session token in the URL/header;
- origin/CSRF checks;
- strict CSP;
- path allowlist for the selected project;
- no arbitrary file read API;
- only GET endpoints (the dev proxy does not forward POST bodies);
- clearly labeled as a development-mode integration, not a production host
  contract.

This mode is **not** part of the verified current workflow and requires a
security review and owner approval.

### 8.5 Verification

For each published resource:

1. fetch exact `(service, name, identifier)` through the bridge or node;
2. verify status is available/READY where applicable;
3. parse/validate the payload;
4. compare content hash or canonical relevant payload;
5. verify publisher name/metadata;
6. record evidence and timestamp.

For indexes: verify that the manifest points to the intended resources and that
entrypoints resolve. A stale/partial index is reported honestly.

## 9. Identity, deduplication and conflict architecture

### 9.1 Identity key

```text
(project_id, source.adapter, source.key) -> stable internal item id
item id + immutable site_id/namespace + stable source key -> QDN identifier
```

**Phase 3 implementation:** the persistent identity key is
`(site_id, source.adapter, source.key)`, not the mutable project name or URL.
The site id is random and immutable; the QDN identifier is derived from the site
id namespace and source key only. The mapping stores the last planned/published
content hash and the exact `(service, name, identifier)` triple. Renaming a
slug updates route metadata, not identity, by default. See
[`PHASE-3-PLANNING-MEDIA-IDENTITY.md`](PHASE-3-PLANNING-MEDIA-IDENTITY.md).

### 9.2 Duplicate prevention

- Before publication, compare the planned content hash with the mapping's hash.
- If equal and the resource verifies, mark unchanged; do not publish.
- If different, plan an update to the same triple.
- If a resource exists at the target triple but is not ours, create a conflict;
  do not overwrite silently.
- Use a project lock and publication idempotency keys.

### 9.3 Conflict model

Conflict kinds:

| Kind | Detection | Resolution |
| --- | --- | --- |
| Source changed after planning | source hash differs from planned hash | re-plan; ask user |
| QDN changed since last verify | served hash differs from mapping | keep Qortal / take source / duplicate |
| Local draft differs | CMS/local override exists | keep draft / overwrite / merge manually |
| Identity collision | target triple exists with other content | choose new identifier / abort |
| Withdrawal conflict | source deleted but QDN still active | withraw/hide / keep / tombstone |
| Index stale/partial | index missing items or unreadable | reconcile/repair; never blind rewrite |

Every conflict is persisted with evidence and an audit trail. There is no silent
last-writer-wins for verified content.

## 10. Disk-space management and cleanup safety

### 10.1 Preflight

Before a run:

```text
available = statfs(projectRoot).bavail * bsize
reserve    = config.reserveBytes (default 10 GiB)
projected  = (known media bytes + bounded unknown accounting) * safetyFactor
             + content/index overhead
required   = projected + reserve
if available < required -> refuse or reduce scope
```

**Phase 3 implementation:** `reserveBytes` defaults to 10 GiB and is
configurable; unknown sizes follow `reject|cap|estimate` and are never counted
as zero. Per-run bytes/files, per-file bytes and the reserve are enforced at
preflight and during streaming. Blocked plans reserve no identity mappings.

- Unknown-size assets are counted at the per-file cap or a conservative default.
- The plan shows projected bytes, free bytes, reserve and whether the run fits.
- The check is repeated before each download batch and before large writes.

### 10.2 Download limits

- `maxFilesPerRun`, `maxBytesPerRun`, `maxFileBytes`.
- Per-file timeout and total-run timeout.
- Streaming `.part` files with size enforcement.
- Reject HTML/error pages and unexpected content types.
- Hash and atomically rename only after full verification.
- Record bytes, hash, MIME and source URL.
- On limit/disk pressure: pause, keep completed files, write a resumable state.

### 10.3 Shared media

- Assets are content-addressed by SHA-256 (and source URL for provenance).
- `item_assets` connects items to assets.
- Cleanup decrements references; delete only at zero references and only when no
  pending/failed run or unverified publication references the asset.
- A receipt records the mapping so a cleaned asset can be re-fetched later.

### 10.4 Cleanup safety requirements

1. Only `completed` runs with verified publications are eligible.
2. Never delete the project database, receipts, mappings or QDN history.
3. Never delete a file referenced by another item/run/publication.
4. Never follow symlinks out of the project root; resolve real paths.
5. Write and fsync receipts before deletion.
6. Use a quarantine directory and a configurable retention window.
7. Require explicit confirmation for permanent deletion.
8. Never delete QDN resources; only local files.
9. Log every deletion with path, hash, bytes and reason.
10. Provide a restore path during quarantine.

## 11. Generic CMS and website architecture

### 11.1 Separation

```text
migration engine  ->  publishes qms-manifest/content model
generic CMS       ->  reads qms-manifest (derived), renders site, optional admin
custom template   ->  same contract, different presentation/config
```

The engine must not import template code. The template must not import source
adapters. They communicate through the versioned manifest/content model.

### 11.2 Default template requirements

- Neutral branding and configurable site title/tagline/logo/colors.
- Routes: home, post, page, category, tag, archive, search, about, admin/import.
- Reads a versioned manifest and entrypoints.
- Honest states: loading, empty, partial, stale, error, missing resource.
- Owner/coauthor detection via current name ownership, no hard-coded names.
- Minimal author backend: create/edit/publish posts and pages, upload media,
  adopt imported content (optional per template).
- Sanitized HTML rendering.
- Accessible, responsive, English-first and localization-ready.
- Builds as a root-layout `WEBSITE`/`APP` bundle.

### 11.3 Custom clones

- A clone is a template package plus config/theme/content; it is not a fork of
  the engine.
- The Corbett Report CMS becomes a custom template/profile that preserves its
  public experience, identifiers and import/adoption behavior.
- Template version and engine compatibility are declared and checked at build
  time.
- The Migration Publisher Q-App remains a separate publishing surface; custom
  templates do not need to embed publishing UI.

### 11.4 Migration manifest compatibility

Provide an adapter that reads the current `cr-qdn-manifest` shape and maps it to
the generic CMS dataset. This preserves the existing Corbett catalog while the
new engine emits a versioned `qms-manifest`. The adapter must be read-only and
must not rewrite existing resources.

## 12. Security architecture

### 12.1 Threat model

| Threat | Impact | Mitigation |
| --- | --- | --- |
| Malicious/compromised source HTML | Script execution in CMS/Q-App | Sanitize with a maintained sanitizer; CSP; URL scheme policy; fixtures |
| Malicious media URL | SSRF, local file access, disk exhaustion | Scheme/host allowlist, block private/link-local, size caps, redirect limits |
| Path traversal/symlink | Read/delete arbitrary files | Resolve real paths, enforce project root, reject symlinks, no user globs |
| Credential leakage | WordPress/Qortal compromise | OS keyring, no logs, redaction, no renderer access, short-lived memory |
| Malicious local process | Local API abuse | Loopback bind, random token, origin checks, single-user permissions |
| Renderer compromise | Full app compromise | Context isolation, sandbox, no Node in renderer, narrow preload, CSP |
| Ambiguous publish | Duplicate fees/resources | Idempotency, no auto-retry, per-resource verification |
| Wrong Qortal name | Publish failure or wrong ownership | Ownership check before approval, block mismatches |
| Supply-chain compromise | Arbitrary code | Lockfiles, SBOM, signed builds, dependency review |
| Update compromise | Arbitrary code | Signed updates, pinned keys, rollback protection |

### 12.2 Secrets

- WordPress application password/session credentials and any API key are
  project-scoped secrets in the OS keyring.
- The database stores secret references/IDs, not secret values.
- The renderer never receives secrets; it receives masked status.
- Logs and support bundles redact URLs with credentials, cookies, tokens and
  query strings that may contain secrets.
- No Qortal seed/private key/wallet password is ever requested.

### 12.3 Local services

- Loopback only; never bind `0.0.0.0`.
- Random per-session bearer token; reject requests without it.
- Validate `Origin`/`Host`; reject cross-site requests.
- Serve only the selected project/handoff directory via a path allowlist.
- No arbitrary file-read endpoint.
- Rate-limit and time-bound the server; stop on app exit.
- Treat Hub Dev Mode as a development integration, not a production host.

### 12.4 Rendering safety

- Sanitize all imported/stored HTML before rendering.
- Remove scripts, event handlers, dangerous URL schemes and embedded objects not
  explicitly allowed.
- Re-run sanitization after any transformation that can reintroduce markup.
- Validate links/media URLs independently.
- Add malicious fixtures to the automated suite.

### 12.5 Publication safety

- Show target name ownership, service, counts, bytes and estimated fee.
- Require explicit user approval per publish action; never publish in the
  background.
- Normalize partial results; never auto-retry ambiguous writes.
- Preserve an audit trail of submissions and verifications.
- Do not claim deletion from the network.

## 13. Testing and regression strategy

### 13.1 Test layers

| Layer | Purpose | Examples |
| --- | --- | --- |
| Unit | Pure model/planning logic | hashing, classification, identifier stability, conflict rules |
| Contract | Adapter and publisher contracts | WordPress adapter conformance; hub result normalization |
| Integration | Local fake servers | WordPress REST fixtures, media server, fake Qortal bridge/node |
| State/crash | Durability | kill during fetch/download/publish; resume; lock recovery |
| Disk | Resource safety | disk-full simulation, per-file cap, cleanup ref counts |
| Security | Abuse cases | XSS fixtures, path traversal, SSRF, token/origin checks |
| Packaging | Install/run | clean Debian VM `.deb`, no Node/npm/Git |
| Real host | Qortal behavior | authorized testnet/Hub publish + exact read-back (owner-approved) |
| Regression | Preserve Corbett | golden identifiers, manifests, routes and adoption behavior |

### 13.2 Required fixtures

- WordPress posts with colliding slugs, HTML entities, lazy images, srcset,
  audio/video/documents/iframes, external media and missing media.
- A modified old post and a deleted post.
- A media server that returns HTML, 404, slow body, wrong size and partial body.
- A fake Hub bridge that returns: success, thrown partial, resolved partial,
  decline, timeout, ambiguous, wrong-name and `FETCH_QDN_RESOURCE` parsed object.
- A fake node with `READY`, `MISSING_DATA`, `DOWNLOADING`, 404 and stale index.
- Malicious HTML/URL fixtures.
- Existing `cr-qdn-manifest` fixture for compatibility.

### 13.3 Regression policy

- Pin Corbett profile outputs (identifiers, route rewrites, manifest keys) as
  golden fixtures.
- Any intentional identifier change requires an owner decision and a migration
  note.
- New adapters must not alter WordPress output.
- Publisher changes must not weaken no-key/no-auto-retry guarantees.

## 14. Packaging and release architecture

### 14.1 Linux

**PROPOSAL:** Electron + `electron-builder` (or equivalent) producing:

- `qortal-migration-studio_<version>_amd64.deb`;
- bundled engine and Node runtime;
- desktop entry, icons, MIME/protocol handlers as needed;
- no runtime Node/npm/Git requirement;
- user data under XDG paths, not inside the package;
- uninstall preserves user projects unless explicitly removed.

Build pipeline:

```text
clean checkout
-> install locked dependencies
-> lint/typecheck/unit/contract/integration tests
-> production build of engine, renderer and templates
-> package .deb
-> install in a clean VM/container
-> smoke test create/plan/crash/cleanup
-> checksum + SBOM + provenance
-> sign and publish only with authorization
```

### 14.2 Windows (future)

- Reuse the engine and protocol.
- Replace shell-specific code (paths, keyring, file dialogs, packaging).
- Use the same adapter/publisher/template contracts.
- Plan MSIX/NSIS or equivalent; no domain rewrite.

### 14.3 Release provenance

- Source commit, build commands, dependency lock hash, artifact checksum, SBOM,
  version and intended distribution channel.
- Signed artifacts; documented update trust root.
- Separate "built", "published artifact", "installed", "verified behavior"
  states.

## 15. Observability and diagnostics

- Structured events with stable codes and correlation IDs.
- Per-run metrics: items, bytes, files, retries, failures, publish counts, fees.
- Support bundle: app version, OS, engine version, project/run summary, redacted
  logs, schema versions, health checks. No credentials, cookies, content bodies
  or wallet data.
- Health checks: source reachability/auth, node reachability/sync, disk reserve,
  Qortal name ownership, template compatibility.
- User-facing error messages explain cause, safe next action and whether retry is
  safe.

## 16. Architecture decision records (summary)

| ID | Decision | Status | Rationale |
| --- | --- | --- | --- |
| ADR-01 | Electron for v1; engine boundary allows later Tauri | Proposed | Reuse Node engine, `.deb` maturity, lower risk |
| ADR-02 | In-process engine API + JSON-RPC/IPC; CLI as wrapper | Proposed | Structured progress, testability, no `spawnSync` orchestration |
| ADR-03 | SQLite (or journal+snapshot) for project/state/identity | Proposed | Multi-project, crash safety, queryable history |
| ADR-04 | Versioned common content model and adapter contract | Proposed | New CMS sources without engine forks |
| ADR-05 | Hub-mediated publication; no desktop signing | Verified constraint | No supported external signer found; no key custody |
| ADR-06 | Publisher adapter with handoff and optional dev-server modes | Proposed | Fit Qortal reality and keep UX coherent |
| ADR-07 | Read-back verification is mandatory | Proposed | Prevent false publish success |
| ADR-08 | Derived indexes published last and rebuildable | Verified pattern | Partial index must not corrupt authority |
| ADR-09 | Two-phase cleanup with ref counts and receipts | Proposed | Data-integrity and recovery |
| ADR-10 | Generic CMS template separate from engine | Proposed | Product generalization without breaking Corbett |
| ADR-11 | Sanitize imported HTML | Proposed | Security; current CMS lacks a sanitizer |
| ADR-12 | Self-contained `.deb` with bundled runtime | Proposed | Requirement 19 |

## 17. What remains unverified

- Whether a supported Qortal external signer exists outside the reviewed
  material (currently: not found).
- Current Qortal Core/Hub revisions at implementation time; the references are
  pinned to Core 6.1.9 and Hub 3.0.3.
- Exact SQLite/native-module packaging behavior in the chosen Electron version.
- Qortal service limits and fees at implementation time.
- WordPress behavior across hosting providers/security plugins.
- Whether Hub Dev Mode loopback serving is acceptable for production UX.
- Performance baselines for large archives; no measured budget was established.

## 18. Conclusion

The architecture separates the durable engine from the desktop shell, the
source adapters from the publishing engine, and the generic CMS template from
Corbett-specific presentation. It treats Qortal's signing boundary honestly:
the desktop prepares and verifies; Hub approves and signs. It makes identity,
crash safety, disk safety and truthful publication state first-class.

This design is ready to be implemented in phases. It is not production-ready and
does not by itself validate any migration or publication.
