# Phase 8 — Crash-safe recovery, two-phase cleanup, durable history and diagnostics

| Field | Value |
| --- | --- |
| Phase | 8 — Recovery, cleanup and history hardening |
| Priority | P1 |
| Status | Implemented and verified at fixture/integration level (2026-11-04) |
| Branch | `agent/qortal-wordpress-to-qortal/20261104T105329Z-qortal-migration-studio-phase-8` |
| Baseline | `17e3888` (Phase 7 test-runner remediation) |
| Store version | 5 (`qms-state@1`, migration 4 → 5 adds `qms-recovery-state@1`) |
| Companion | [Roadmap](IMPLEMENTATION-ROADMAP.md), [Architecture](ARCHITECTURE.md), [Requirements](PRODUCT-REQUIREMENTS.md), [Testing](TESTING.md) |

## 1. Scope and guarantees

Phase 8 makes long-lived projects safe to interrupt. It adds four cooperating
layers without changing Phase 5 read-back semantics or Phase 7 sync authority.
Bounded scan checkpoints, pause/resume/cancel and startup reconciliation of
stale checkpoint files are documented in
[`BOUNDED-SOURCE-SCANS.md`](BOUNDED-SOURCE-SCANS.md).

1. **Recovery** — durable checkpoints plus an explicit interrupted/ambiguous
   state model.
2. **Cleanup** — quarantine first, purge later, with remote-evidence gates.
3. **History** — a hash-chained audit ledger that survives media deletion.
4. **Diagnostics** — a metadata-only support bundle with double redaction.

Non-negotiable rules implemented in code and tests:

- A killed process never leaves a half-written checkpoint. Checkpoints and audit
  entries are atomically written and fsynced.
- A publication whose submission result is unknown becomes `ambiguous` and
  is **never** resubmitted. Reconciliation is a read-only exact QDN read-back.
- Cleanup is refused unless every publication resource in scope is
  `remote_verified` with exact read-back evidence.
- Shared media is protected by the Phase 3 reference counts and per-item
  evidence, recomputed at preview time.
- Cleanup cannot touch `state/`, `project.json`, `lock.json`, `runs/`, `recovery/`,
  `history/`, source batches/manifests, publication plans, publication
  receipts or cleanup records.
- No path can escape the real project root. Symlinks anywhere in a path are
  refused; absolute and `..` paths are refused before any filesystem call.
- A support bundle that still contains a canary, a credential pattern, a wallet
  address or a content body is refused instead of written.

## 2. Recovery model

### 2.1 Run checkpoints

Every `RunService` operation writes
`<project>/recovery/runs/<runId>.json`
(`qms-recovery-checkpoint@1`) through
`RecoveryService.onRunStart/onRunCheckpoint/onRunFinish`. A checkpoint
contains the run kind, phase, step, cursor, total, pid, resumability, a typed
resume action and a bounded step history. Writes use temp-file + fsync + rename.

Checkpoints are placed at these boundaries:

| Stage | Checkpoint | Resume action |
| --- | --- | --- |
| Source discovery | connect, terms done, every 50 content items | `source.discover` |
| Planning | classify start/done, media estimate start | `planning.create` |
| Media download | download start + every completed record | `media.download` |
| Handoff preparation | `stg_prepare_*` stage start | `publication.prepare` (idempotent, reuses an equivalent handoff) |
| Receipt import | stage start, `receipt_written` | `publication.importStoredReceipt` |
| Verification | stage start | `publication.verify` (read-only) |
| Cleanup | per-file progress hook and persisted record | `cleanup.resume` |

`RunContext.checkpoint()` is atomic. The test hook
`createEngine({ onCheckpoint })` fires only at real checkpoints, which is
how the crash worker kills itself at a precise stage.

### 2.2 Stage checkpoints

Handoff preparation, receipt import and verification are not `RunService`
operations. They still write durable stage journals under
`recovery/stages/<stageId>.json` (`qms-recovery-stage@1`). A stage
from a previous pid is marked `interrupted` on project open, and resumable
stages appear in the same recovery status list as runs.

### 2.3 Interrupted and ambiguous states

On every project open, `RecoveryService.recoverOnOpen()`:

- marks persisted runs still in `running` as `interrupted` with
  `PROCESS_EXITED_WHILE_RUNNING`, preserving the last checkpoint;
- marks stale stage journals `interrupted`;
- converts `submitted` publication resources with no receipt/verification
  evidence into `ambiguous` and sets `requiresReconciliation`.

`recovery.status()` reports candidates, ambiguous resources, corrupt
checkpoints and cleanup summaries. `recovery.resume()` re-drives the operation
idempotently; it refuses to resume a live run and refuses operations without a
safe continuation. `recovery.dismiss()` abandons a run without retrying.

### 2.4 Publication idempotency and reconciliation

- Resource identifiers remain deterministic (`res_…` from content/media keys).
- `publication.prepare()` now returns an existing equivalent handoff instead of
  creating a duplicate when plan + selection match.
- Receipt import writes the sealed receipt file before the state transaction and
  records a `receipt_written` checkpoint, so a crash is recoverable.
- `recovery.reconcilePublication()` uses `verifyResources` only. It
  never calls a publisher, signs a transaction or resubmits. Exact
  `remote_verified` promotes the resource; anything else stays ambiguous.

## 3. Two-phase cleanup

### 3.1 Preview

`cleanup.preview()` is read-only apart from a small preview record under
`cleanup/previews/`. It lists:

- content-addressed media assets;
- incomplete `media/tmp/*.part` files;
- handoff payload copies (`payload/media`, `payload/content`) for
  remotely verified handoffs only.

Each item carries `eligible`, a stable reason
(`SHARED_MEDIA_REFERENCED`, `UNVERIFIED_REFERENCE`,
`NO_REMOTE_EVIDENCE`, `UNREFERENCED_MEDIA`, `SYMLINK_REFUSED`),
byte size, hash, reference count and referencing item ids. Totals separate
eligible, protected and unsafe files, and the measured free-disk value is
included (when a probe is available).

Eligibility rules:

1. Every requested/publication handoff must be `remote_verified` and every
   resource record must be `remote_verified`.
2. A media asset is eligible only when a verified media resource publishes its
   exact hash **and** every item referencing it maps to a verified content
   resource. Any unverified reference protects it.
3. Unreferenced assets are protected unless `includeUnreferenced` is
   explicitly requested.

### 3.2 Phase 1 — quarantine

`cleanup.start()` recomputes the preview and refuses when
`CLEANUP_NOT_ELIGIBLE` applies. Before moving any file it:

1. writes a sealed history snapshot (`history/snapshots/…`);
2. writes a sealed cleanup receipt (`cleanup/receipts/<cleanupId>.json`) with
   handoff/resource evidence (identifier, hash, bytes, tx signature);
3. persists the cleanup record and audit entry;
4. renames eligible files into
   `cleanup/quarantine/<cleanupId>/<original relative path>`, preserving
   the directory shape.

Progress is persisted every 25 files and a durable manifest is written after the
move loop. Re-running an interrupted cleanup detects already-moved files and
never counts them twice.

### 3.3 Phase 2 — purge and restore

- `cleanup.restore()` renames files back, refuses to overwrite an
  existing target, verifies recorded hashes for media and reports per-file
  failures. It remains available for the whole retention window.
- `cleanup.purge()` is refused while the retention window is active
  (`CLEANUP_RETENTION_ACTIVE`) unless an explicit `force` is passed.
  It sums real file sizes, deletes the quarantine tree (refusing symlinks),
  measures free space before/after and reports
  `bytesReclaimed`, `filesDeleted` and `diskFreeDeltaBytes`.
- Retention defaults to 14 days and is configurable per project setting or per
  call (0–3650 days).

### 3.4 Path safety

`assertSafeProjectPath()`:

- rejects empty/NUL strings and absolute paths;
- normalizes separators and rejects any `..` segment;
- resolves the candidate inside the resolved project root;
- walks every existing path component with `lstat` and rejects symlinks;
- compares the real path of each component against the real project root.

Explicit cleanup paths are additionally restricted to deletable prefixes
(`media/assets`, `media/tmp`, `publication/handoffs/*/payload`).
Any other explicit path raises `CLEANUP_NOT_ELIGIBLE`.

## 4. Durable history

`HistoryService` writes `<project>/history/audit.jsonl` as a
hash-chained, append-only ledger of `qms-audit-entry@1` records. Each entry
has `prev` and `checksum = sha256(prev + stable JSON(entry))`. A torn
final line from a crash is ignored; committed entries remain valid.

Recorded types include: run started/completed/failed/cancelled/paused/interrupted/
resumed/dismissed, checkpoint written/corrupt, publication prepared/receipt
imported/verified/reconciled/ambiguous, cleanup previewed/started/quarantined/
interrupted/resumed/restored/purged/refused, history snapshots and project open.

`history.timeline()` merges the ledger with state-derived evidence
(published resources with tx signature and SHA-256, receipt events, cleanup
records, sync scans) so phases from before Phase 8 still appear. `history.snapshot()`
writes a sealed, self-contained document under `history/snapshots/`. Cleanup
never deletes this directory, so publication evidence remains readable after
local media is gone.

The desktop **Recovery** view shows the timeline with type filters, content hash
and tx signature, and can export a snapshot.

## 5. Diagnostics and support bundle

`handle.supportBundle()` builds `qms-support-bundle@1` with:

- app/settings/keyring metadata;
- project document summary (no raw settings secrets);
- state health, journal bytes, recovery status;
- run/recovery candidates, cleanup records and the bounded timeline;
- media metadata and the engine log tail (100 lines).

Redaction is applied twice:

1. `sanitizeDiagnostics()` redacts secret-like keys, wallet/address keys and
   content-body keys, truncates long strings and caps depth/array size.
2. `assertSafeBundle()` serializes the whole bundle and refuses to write it if
   a caller-supplied canary, a bearer/JWT/private-key pattern, a Qortal address
   or a content body key remains.

The bundle is written with mode 0700 directory / 0600 file. A real secret in the
input never reaches disk; the test injects five canaries and asserts absence.

## 6. Desktop integration

The Electron app adds a **Recovery** view (header and Dashboard entry) with:

- interrupted run/stage list, resume and dismiss;
- ambiguous publication list with a node URL field and read-back reconciliation;
- cleanup preview (eligible/protected/unsafe + reason), quarantine start,
  cleanup list, resume, restore and purge with explicit retention override;
- durable history timeline with type filter, content hash, tx signature and
  snapshot export;
- support bundle export.

IPC additions: `recovery.status/resume/dismiss/reconcile`,
`cleanup.preview/start/list/get/restore/purge/resume`,
`history.list/export`. `diagnostics.export` now delegates to the
engine support bundle. All payloads pass the existing IPC validation layer, and
all channels keep the trusted-sender check.

## 7. Tests and evidence

New Phase 8 suites (node:test, `test/phase8/`):

| File | Coverage |
| --- | --- |
| `recovery.test.js` | kill during discovery, planning, download, preparation, receipt import, verification; ambiguous reconciliation; network loss; torn checkpoint/power loss; no duplicate assets/resources; ambiguous not resubmitted |
| `cleanup.test.js` | full lifecycle with receipt/snapshot before deletion; refusal for pending/failed; shared-media protection; interrupted cleanup resume; traversal/absolute/protected-path/symlink refusal; disk-full resume; retention restore; purge measured bytes |
| `diagnostics.test.js` | five-canary bundle test, credential patterns, content-body exclusion, hash-chained ledger, sealed snapshot, path escape |
| `host.test.js` | Phase 8 RPC surface, engine info schemas, cleanup refusal, support bundle, resume validation, unknown method |
| `migration.test.js` | store v4→v5 migration, fail-closed newer version |

Crash simulation is a real process kill: `test-support/phase8/crashWorker.mjs`
runs one engine operation and `SIGKILL`s itself at a named checkpoint, so the
engine never gets a chance to run failure handlers. The parent reopens with
stale-lock recovery and asserts resumption/idempotency.

Desktop coverage: `desktop/tests/renderer/recovery.spec.tsx` (resume,
cleanup preview/quarantine, history evidence, support bundle, ambiguous
reconciliation requiring a node URL).

Exact counts are recorded in [TESTING.md](TESTING.md) and the final task report.

### What is fixture-proven vs live-proven

- Fixture-proven: all Phase 8 behavior above, including real process kills,
  disk-full and network-loss paths, using the repository WordPress, media and
  QDN fixture servers.
- Live-proven (inherited Phase 5.2): exact QDN read-back against a real Qortal
  node for one synthetic resource. Phase 8 did **not** publish, sign or modify
  any live resource.
- Not claimed: kill-testing on physical power loss, filesystem-level corruption
  beyond torn JSON, or cleanup behavior on a different filesystem than the
  project root.

## 8. Operational notes

- Retention defaults to 14 days. Purge is irreversible; restore is the safe
  action during the window.
- A corrupt checkpoint is reported, not repaired. The affected operation is
  marked not resumable; other operations continue.
- If a project was opened by an older build (store v4), it migrates forward on
  open. An unknown newer store version fails closed before any write.
- Recovery never stores credentials. Resuming an authenticated discovery run
  requires the caller to supply credentials again (`recovery.resume` accepts
  an `auth` override); nothing is persisted.

## 9. Known limitations

- The cleanup candidate scan caps at 200,000 files and the preview stores 5,000
  items in state (the receipt stores the full eligible list).
- `bytesReclaimed` is the sum of deleted file sizes; the filesystem free-space
  delta is reported separately and can differ because of allocation, hardlinks
  or a concurrently changing workspace.
- Undo after purge is impossible by design.
- Reconciliation requires reachable read-only QDN access; without it the state
  stays ambiguous and no submission occurs.

