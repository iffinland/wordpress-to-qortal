# Phase 1 — Engine foundation, projects, state and events

| Field | Value |
| --- | --- |
| Document | Phase 1 implementation and developer guide |
| Date | 2026-11-02 |
| Status | Implemented on a dedicated agent branch; Phase 2 not started |
| Scope | Reusable engine, multi-project storage, crash-safe state, `qms-event@1`, host protocol, CLI compatibility |
| Companion documents | [Architecture](ARCHITECTURE.md), [Audit](PHASE-0-ARCHITECTURE-AUDIT.md), [Requirements](PRODUCT-REQUIREMENTS.md), [Roadmap](IMPLEMENTATION-ROADMAP.md) |

This document describes what Phase 1 actually implements. Archived Phase 0
proposals remain design intent; where Phase 1 chose differently, the difference
is stated explicitly.

## 1. Outcome

Phase 1 delivers a headless, Electron-free Node.js engine that can:

- create, list, open, update and archive multiple independent projects;
- keep each project's configuration and state in its own XDG-compatible root;
- persist run and event state through an append-only journal plus atomic
  snapshots, surviving process kills without losing committed work;
- refuse concurrent writers, with explicit stale-lock recovery;
- migrate older state schemas forward and fail closed on newer ones;
- stream ordered, versioned `qms-event@1` events that reconstruct progress;
- serve a JSON-RPC-style host over stdio;
- leave every existing Corbett CLI command, profile, manifest, batch workflow,
  and `cr-*` QDN identifier untouched.

Phase 1 performs **no WordPress import, no media download, and no QDN
publication**. The only operation implemented is a local, read-only project
validation.

## 2. Module map

| Path | Responsibility |
| --- | --- |
| `lib/engine/index.js` | `createEngine()` factory, public exports, engine version |
| `lib/engine/projects.js` | Project CRUD, per-project roots, handle lifecycle |
| `lib/engine/lock.js` | Exclusive writer lock, heartbeat, stale detection, explicit recovery |
| `lib/engine/runs.js` | Run records, phases, progress, cancellation, reconstruction |
| `lib/engine/events.js` | `qms-event@1` envelope, validation, redaction, ordering, persistence |
| `lib/engine/validate.js` | Local project validation operation (no network) |
| `lib/engine/storage/paths.js` | XDG data root, project path layout, path-escape guards |
| `lib/engine/storage/atomic.js` | Temp-file + fsync + rename writes, journal append + fsync, hashing |
| `lib/engine/storage/schema.js` | Schema versions, forward migrations, fail-closed assertions |
| `lib/engine/storage/journal.js` | Journal + snapshot store, replay, recovery, compaction, write serialization |
| `lib/engine/compat/index.js` | Read-only bridge to the legacy profile/config modules and script registry |
| `lib/engine/host/server.js` | JSON-RPC host, event notifications, request dispatch |
| `lib/engine/host/client.js` | JSON-RPC client used by tests and future shells |
| `bin/qms.js` | `qms` CLI (project, run, state, events, host, compat) |

No module under `lib/engine` imports Electron, opens a network connection, or
contains presentation strings for a GUI. A regression test enforces the
Electron-free rule.

## 3. Storage decision: journal + snapshot instead of SQLite

Phase 0 proposed SQLite with a journal/snapshot fallback. Phase 1 evaluated both
and chose the fallback for the foundation phase.

| Criterion | SQLite (`node:sqlite` or native) | Journal + snapshot (chosen) |
| --- | --- | --- |
| Packaging in Electron | Native/builtin module risk; version coupling | Zero dependencies, pure JS |
| Determinism in crash tests | WAL behaviour depends on OS/fs timing | Whole-transaction records are easy to inspect and truncate |
| Transaction semantics | Strong (SQL, constraints) | Strong enough: one committed state record per transaction |
| Query needs in Phase 1 | Minimal: one project, few runs | Sufficient |
| Migration tooling | `PRAGMA user_version` + SQL migrations | Explicit versioned JSON migrations |
| Scale ceiling | High | Suitable for Phase 1 state; revisit when item/mapping volume grows |

**Decision:** journal + snapshot now, behind the `JournalStore` interface. If
Phase 3+ state volume or query complexity makes JSON impractical, SQLite can be
introduced behind the same store surface without changing projects, runs or the
event contract. This is recorded as a Phase 2/3 decision point, not a promise.

Trade-off accepted: every transaction writes a complete state document and
fsyncs it. State is small in Phase 1 (kilobytes). Compaction runs every 50
transactions or 2 MiB, so the journal cannot grow without bound. Large content
blobs never enter the state store; they belong in project files.

## 4. On-disk layout

```text
$XDG_DATA_HOME/qortal-migration-studio/     (default ~/.local/share/...)
├── projects/
│   └── <project-id>/                        prj_ + 16 base36 chars, stable
│       ├── project.json                     qms-project@1 portable settings
│       ├── lock.json                        exclusive writer lock
│       ├── state/
│       │   ├── snapshot.json                qms-state-snapshot@1
│       │   └── journal.jsonl                qms-journal@1 + committed transactions
│       ├── runs/                            reserved for run artifacts
│       └── artifacts/                       reserved for prepared outputs
└── trash/<project-id>-<timestamp>/          archived projects with --delete-data
```

- `QMS_DATA_ROOT` overrides the root (used by tests and portable installs).
- A relative or missing `XDG_DATA_HOME` falls back to `~/.local/share`.
- Project IDs are validated against `^prj_[a-z0-9][a-z0-9-]{3,47}$`; all other
  path segments are derived from the validated ID. Path traversal is rejected
  with `INVALID_PROJECT_ID` or `PATH_ESCAPE`.
- There is **no shared registry file**. The project list is a directory scan, so
  creating or editing one project never rewrites another project's metadata.

### 4.1 qms-project@1

```json
{
  "schema": "qms-project@1",
  "version": 1,
  "id": "prj_...",
  "name": "Corbett Report",
  "slug": "corbett-report",
  "createdAt": "2026-11-02T21:00:00.000Z",
  "updatedAt": "2026-11-02T21:00:00.000Z",
  "archivedAt": null,
  "source": { "adapter": "wordpress", "baseUrl": null },
  "target": { "qdnName": null, "siteName": null, "contentName": null, "mediaName": null },
  "template": { "id": null },
  "compatibility": {
    "profileId": "corbettreport",
    "resourcePrefix": "cr",
    "qdnIdentifiers": { "qdn_manifest": "cr-qdn-manifest" }
  },
  "settings": {}
}
```

Compatibility is a snapshot of the resolved profile, so the project keeps its
identifiers even if the profile file changes later; validation reports a warning
instead of silently republishing under new identifiers.

### 4.2 qms-state-snapshot@1 and qms-journal@1

The snapshot carries `storeVersion`, `lastTxnSeq` and the full state document.
The journal starts with a header line and then repeats, per committed
transaction:

```text
{"t":"begin","txnSeq":N,"storeVersion":1,"at":"..."}
{"t":"state","storeVersion":1,"state":{...},"checksum":"sha256:..."}
{"t":"commit","txnSeq":N,"checksum":"sha256:...","at":"..."}
```

A transaction becomes visible only after its commit line is fsynced. Replay
applies only complete, checksum-matching transactions newer than the snapshot.
The checksum covers `{txnSeq, storeVersion, state}`.

## 5. Crash recovery and locking

**Committed work is never lost.** A crash can leave a torn last line, an
uncommitted complete record, or a stale snapshot temp file. On the next open:

1. the snapshot (if present) is validated;
2. journal records newer than the snapshot are replayed;
3. a parse failure, missing commit, or checksum mismatch in the **tail** is
   discarded and reported in `store.recovery`;
4. the store persists a fresh snapshot and rewrites the journal header;
5. a fresh snapshot always precedes the journal rewrite, so a crash during
   compaction leaves snapshot state ahead of stale journal records, which replay
   skips by `txnSeq`.

If corruption appears **before** a later committed transaction, the store throws
`STATE_JOURNAL_CORRUPT` instead of truncating committed data.

Writers:

- `lock.json` is created with `O_EXCL` and fsynced; a second process receives
  `PROJECT_LOCKED` with owner details.
- `JournalStore` also serializes transactions inside one process, so concurrent
  host requests cannot lose updates.
- Before every write the store calls the lock guard; losing the lock yields
  `LOCK_LOST` and no write.
- A lock is stale when the owning process on the same host is gone, or when the
  heartbeat is older than `staleAfterMs` (default 120 s).
- Stale recovery is **explicit**: pass `recoverStaleLock: true` (CLI
  `--recover-stale`). The old lock is renamed to `lock.json.stale-<epoch>` for
  audit. Corrupt locks are never taken over automatically.
- Release verifies the token; a foreign process cannot delete the lock.

## 6. Schema versions and migrations

- `CURRENT_STORE_VERSION = 1`; project documents are version 1.
- `STATE_MIGRATIONS` maps a source version to a forward-only function. Version 0
  is the documented legacy snapshot; opening it migrates to 1, rewrites the
  snapshot, and reports `recovery.migratedFrom`.
- A snapshot or journal whose version is **newer** than supported throws
  `STATE_VERSION_UNSUPPORTED` ("requires a newer Qortal Migration Studio")
  before any write. Tests assert the file is byte-identical afterwards.
- Adding a migration requires: bump `CURRENT_STORE_VERSION`, add the migration
  function, add a fixture-based test, and confirm older snapshots still open.

## 7. qms-event@1

Envelope:

```json
{
  "schema": "qms-event@1",
  "seq": 42,
  "id": "evt_...",
  "timestamp": "2026-11-02T21:00:00.000Z",
  "project_id": "prj_...",
  "run_id": "run_...",
  "item_id": null,
  "phase": "paths",
  "type": "progress_updated",
  "level": "info",
  "code": "VALIDATION_PATHS_OK",
  "message": "Project paths verified",
  "progress": { "completed": 1, "total": 3, "bytes": 0 },
  "retryable": false,
  "details": {},
  "correlation_id": null
}
```

Event types (all implemented and tested):

| Type | Meaning |
| --- | --- |
| `operation_started` | A run began; includes `kind` |
| `progress_updated` | Phase start or measured progress |
| `warning_emitted` | Recoverable issue; does not fail the run |
| `operation_completed` | Terminal success |
| `operation_failed` | Terminal failure with code, message, retryability |
| `operation_cancelled` | Terminal cancellation |
| `state_snapshot` | Durable state checkpoint reference (open, run start/finish, compaction) |

Ordering and reconstruction:

- `seq` is allocated inside the same transaction that persists the event, so it
  is gap-free and monotonic per project across restarts.
- Events are stored in the project state and mirrored into the run record
  (bounded at 5 000 per run; the project log keeps 10 000 with a dropped
  counter).
- `runs.get(runId)` / `run.progress` return progress reconstructed from the run
  snapshot plus persisted events, not from in-memory state.
- Credential-like keys (`password`, `token`, `apiKey`, `seed`,
  `privateKey`, `wallet`, cookies, authorization) are redacted recursively
  before persistence.
- Invalid envelopes are rejected with `INVALID_EVENT`.

## 8. Engine API

```js
import { createEngine } from './lib/engine/index.js';

const engine = createEngine();                 // QMS_DATA_ROOT / XDG
const project = await engine.projects.create({
  name: 'Corbett Report',
  profileId: 'corbettreport',                  // copies cr-* identifiers
  settings: { batchSize: 15 }
});

const handle = await engine.projects.open(project.id, { recoverStaleLock: false });
const result = await handle.validate();        // local only, no network
handle.events.subscribe((event) => { /* qms-event@1 */ });
const progress = handle.progress(result.runId); // reconstruction
await handle.close();
```

Surface:

| Call | Purpose |
| --- | --- |
| `engine.projects.create/list/get/open/update/archive` | Project lifecycle |
| `engine.projects.closeAll()` | Release all locks |
| `handle.update(patch)` | Rename/settings/source/target/template/compatibility |
| `handle.snapshot()` | Project + storage + runs summary |
| `handle.runs.start({kind})` | Start a persisted run with a context |
| `context.phase/progress/warn/complete/fail/cancel` | Run controls and events |
| `handle.runs.cancel(runId)` | Abort an active run |
| `handle.events.list({runId, afterSeq, limit})` | Persisted event replay |
| `handle.store.compact({reason})` | Manual snapshot/compaction |
| `engine.compat.*` | Legacy profile/config/script compatibility |

Presentation logic, retries of real network work, adapters and publishers are
deliberately absent from Phase 1.

## 9. Host protocol

`qms host` speaks newline-delimited JSON-RPC 2.0 on stdio. Requests are handled
concurrently so `run.cancel` can reach a running operation; state writes stay
serialized. Responses use the request `id`; errors carry
`data.code/data.details/data.retryable`.

Methods: `engine.info`, `project.create|list|get|open|close|update|archive|snapshot|validate`,
`state.compact`, `run.list|get|progress|events|cancel`, `events.list`.

Events are pushed as notifications:

```json
{ "jsonrpc": "2.0", "method": "qms.event", "params": { "schema": "qms-event@1" } }
```

Opening a project subscribes the session to its event stream. A GUI should call
`project.open` (snapshot in the response), then apply notifications by `seq`,
and use `run.progress` / `events.list` after a reconnect.

## 10. CLI

```bash
npm run qms -- project create --name "Corbett Report" --profile corbettreport
npm run qms -- project list
npm run qms -- project validate <projectId>
npm run qms -- state compact <projectId>
npm run qms -- events <projectId> --run <runId>
npm run qms -- host
npm run qms -- compat list
npm run qms -- compat exec batch:status
```

Compatibility guarantees:

- All pre-existing npm scripts keep their exact commands; a regression test
  asserts the Phase 0 script map.
- No legacy source file changed except `src/profile.js`, which gained an
  optional `{ baseDir }` argument. Its default behavior (cwd-relative
  `profiles/<id>`) is unchanged, and existing profile tests still pass.
- `qms compat exec <script>` runs the same npm scripts, refusing unknown names.
- Profiles, manifests, batch state, QDN identifiers (`cr-*`), and Corbett Report
  output remain untouched.

## 11. Tests and evidence

Commands (from the worktree):

```bash
npm ci
npm test          # 56 tests: 15 legacy + 41 Phase 1
npm run check     # npm test + viewer build + CMS build
```

Phase 1 test files:

| File | Covers |
| --- | --- |
| `test/engine/projects.test.js` | Isolation, reopen/restart, archive/trash, settings, traversal, second writer, XDG |
| `test/engine/journal.test.js` | Persistence, torn tail, uncommitted txn, rollback, concurrency, compaction, migration, newer-version fail-closed, lock guard |
| `test/engine/lock.test.js` | Exclusive lock, stale recovery, heartbeat expiry, lost lock, foreign release, corrupt lock |
| `test/engine/events.test.js` | All seven types, ordering, restart continuity, redaction, cancellation, failure, reconstruction, schema rejection |
| `test/engine/crash.test.js` | SIGKILL mid-journal-write, SIGKILL mid-project-run with stale lock, stray temp file |
| `test/engine/host.test.js` | JSON-RPC lifecycle, event notifications/order, snapshots, malformed input |
| `test/engine/cli-compat.test.js` | Script map, profile golden identifiers, CLI flows, legacy `batch:status`, no Electron |

Acceptance mapping:

| Criterion | Evidence |
| --- | --- |
| AC1.1 Two isolated projects | `projects.test.js` "two isolated projects…" |
| AC1.2 Reopen restores state exactly | same test, fresh engine instance |
| AC1.3 Crash recoverability | `crash.test.js`; state-layer crash only (no planner/fetch/download exist yet) |
| AC1.4 Second writer refused; stale recovery explicit | `lock.test.js`, `projects.test.js` |
| AC1.5 Migration and newer-schema rejection | `journal.test.js` |
| AC1.6 Ordered events and reconstruction | `events.test.js`, `host.test.js` |
| AC1.7 Existing tests and CLI | `npm test` 56/56, `cli-compat.test.js` |
| AC1.8 No Electron in engine | `cli-compat.test.js` "no Electron dependency" |

## 12. Known limits and Phase 2 inputs

- No source adapter, content model, media planner, publisher or CMS work exists
  yet. Phase 1 intentionally stops at the foundation.
- Validation is local (paths, compatibility record, disk headroom). It does not
  contact WordPress or Qortal.
- Run kinds other than `project.validate` reuse the same context API but have no
  domain implementation yet.
- Journal state is single-writer; multi-process read-only access is not exposed.
- `deleteLocalData` archives to `trash/` instead of a secure erase; permanent
  deletion is out of scope.
- A crash between marking a project archived and moving its directory can leave
  an archived directory in place; it is still listed with `--all`.
- Phase 2 should add the WordPress adapter behind the run/event contract, then
  prove adapter conformance without changing storage or host semantics.
