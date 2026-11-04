# Phase 7 — Incremental synchronization, withdrawal and conflicts

| Field | Value |
| --- | --- |
| Phase | 7 |
| Status | Implemented and fixture-verified (2026-11-04) |
| Base commit | 2a92a167c2d1c34d46c69a05b507d6e15a515c15 (Phase 6 completion) |
| Branch | agent/qortal-wordpress-to-qortal/20261104T065459Z-qortal-migration-studio-phase-7 |
| Engine version | 0.1.8-phase7 |
| Store version | 4 |
| Scope | 7A incremental engine, 7B conflicts/withdrawal, 7C desktop delta publishing |

## 1. Outcome

A project can now check a WordPress source for changes after the first
migration, review a deterministic delta, resolve conflicts, prepare only the
changed resources, and continue through the existing Phase 5 Hub handoff. The
feature is explicit and manual by design: there is no scheduled or background
synchronization and no transaction signing in the desktop application.

The Phase 7 source scan is a normal discovery batch. The engine classifies that
batch against the persistent identity mappings and the last successful scan
watermark. It never publishes by itself.

## 2. Engine architecture

### 2.1 Persistent state

Store version 4 adds state.sync:

    sync:
      schema: qms-sync-state@1
      revision
      watermarks[adapterId]      last complete scan and last full reconciliation
      scans[scanId]              status, counts, capped delta lists, checkpoint ref
      items[sourceKey]           last seen hash/metadata and last full scan id
      conflicts[conflictId]      source/local/QDN evidence and audit history
      withdrawals[withdrawalId]  preserved mapping snapshot and tombstone metadata
      adoptions[]                read-only adoption/reconciliation reports
      counters

Item bodies and QDN payloads never enter the JSON state. Full scan evidence is
written to artifacts/sync/<scanId>/report.json. State keeps the first 2,000
entries per delta class so a large project cannot bloat the journal; the report
keeps the complete list.

### 2.2 Artifacts

    <project>/artifacts/sync/
      <scanId>/
        report.json              full scan evidence, counts, conflicts, withdrawals
        checkpoint.json          crash-safe classification checkpoint
        catalog.json             visible catalog (withdrawn excluded by default)
        tombstones/<hash>.json   explicitly requested local tombstone markers

### 2.3 Scan statuses

| Status | Meaning | Planning allowed |
| --- | --- | --- |
| scanning | Source discovery is running. | No |
| classifying | Discovery completed; classification is running. | No |
| interrupted | A classification pass stopped at a checkpoint, or a crash was recovered. | No |
| completed | Complete source scan and complete classification. | Yes |
| incomplete | Discovery was truncated or partial. | No |
| failed | Source discovery failed. Never reported as "no changes". | No |
| cancelled | The operator cancelled the scan. | No |

A failed or incomplete scan has counts.failed or an explicit incomplete
warning and complete=false. preparePlan rejects every status other than
completed.

### 2.4 Watermarks and modes

- auto performs a full reconciliation when there is no watermark or when the
  last full reconciliation is older than settings.sync.fullReconcileDays
  (default 7), otherwise an incremental scan.
- incremental sends modified_after = scanStartedAt - overlapHours
  (default 48 h) to the WordPress adapter and keeps a 48 h overlap, so edits to
  old content are detected regardless of the original publication date.
- full scans all published content and is the only mode allowed to infer
  deletions or missing mappings.
- Watermarks advance only after a complete scan. An incomplete scan leaves the
  previous watermark in place, so the next run re-covers the same window.
- Known items absent from a successful incremental scan are classified
  unchanged with reason NOT_MODIFIED_SINCE_WATERMARK. Absence from a full
  complete scan is the only evidence used for source withdrawal.

### 2.5 Classification

| Result | Condition | Effect |
| --- | --- | --- |
| new | Source key has no mapping. | Delta plan candidate. |
| modified | Content hash differs from the mapping. | Same-identity update candidate. |
| route_changed | Content is identical but slug/route changed. | Update candidate. |
| unchanged | Hash and route match a verified mapping, or an incremental scan did not return it. | No publication. |
| unpublished | Source status is draft/private/trash/future, or the mapping exists but was never published. | Withdrawal candidate when the source status is non-public; never published automatically. |
| withdrawn | Mapping existed but the item is missing from a complete full scan. | Withdrawal policy / conflict. |
| conflict | Identity collision, mapping mismatch or other candidate conflict. | Persisted conflict; blocks affected publication. |
| not_scanned | Mapping exists but no completed scan proves its current state. | No inference. |

### 2.6 Checkpoints and recovery

Classification writes an atomic checkpoint every pass. A bounded pass
(classifyBatchSize, used by tests and suitable for large projects) stops with
status interrupted and recoverable=true. sync.resume continues from the
checkpoint without duplicating already-classified entries. On project open, any
scan left in scanning or classifying is changed to interrupted; it is never
promoted to success. If discovery itself was interrupted, resuming reports
requires_rescan because there is no verified source batch to classify.

## 3. Conflicts

Conflict records use qms-sync-conflict@1 and store:

- deterministic id derived from kind, source key and evidence hash;
- source, local (mapping snapshot) and qdn evidence;
- status, severity, resolution, resolution note, automatic flag and history;
- explicit authorization when an external QDN overwrite is allowed.

### 3.1 Kinds and resolutions

| Kind | Detection | Allowed resolutions |
| --- | --- | --- |
| QDN_EXTERNAL_CHANGE | Operator or verifier supplies a QDN hash/triple that differs from the mapping. | take_source, keep_qdn, skip |
| WITHDRAWAL_CONFLICT | Source withdrawn or unpublished while a mapping remains. | withdraw_local, keep_published, tombstone |
| SOURCE_CHANGED_SINCE_SCAN | Planned hash differs from current source evidence. | replan, skip |
| LOCAL_DRAFT_DIFFERS | Local CMS override differs (extension point). | keep_draft, take_source, skip |
| Identity kinds | Existing Phase 3 identity collision/mapping issues. | skip, alternate, abort |

keep_qdn acknowledges the external version but does not authorize an overwrite.
take_source records authorization.overwriteQdn=true. The publication guard blocks
a selected source until an external-change conflict is open-free or explicitly
authorized with take_source.

### 3.2 Publication guard

PublicationService.prepare now receives a guard from the project handle. The
guard runs before any handoff payload is packaged and blocks when:

- the plan references a source batch that is no longer the latest scan;
- any selected mapping is locally withdrawn;
- any selected source has an unresolved blocking sync conflict;
- an external QDN change was acknowledged with keep_qdn instead of take_source;
- an identity conflict for the source is unresolved.

This preserves the Phase 5 handoff protocol; it only adds a preflight check.

## 4. Withdrawal and tombstones

- A source deletion is detected only from a complete full scan. Explicit non-public source statuses (draft/private/trash/future) returned by a full scan also become withdrawal candidates.
- The default policy is local hide: the mapping status becomes withdrawn, a
  withdrawal record preserves the triple, hashes, publication evidence and
  timestamps, and the visible catalog excludes the entry.
- Withdrawal never changes the QDN triple and never calls a network delete.
  Every result and record contains networkDeleted=false and
  qdnDataPreserved=true.
- review leaves the mapping active and creates an open WITHDRAWAL_CONFLICT.
- keep leaves the mapping active with no local withdrawal.
- tombstone prepares a local qms-tombstone@1 marker with published=false and
  networkDeleted=false. Publishing tombstone markers is not part of Phase 7 and
  must remain a separate explicit Hub action.

## 5. Existing migration adoption (AC7.9)

sync.adoptExisting reads the existing identity mappings, publication resources
and handoff metadata without modifying them. It verifies:

- duplicate QDN triples;
- mapping name against the project target;
- deterministic identity derivation for post/page mappings.

Issues are reported, never auto-corrected. Adoption writes a durable
qms-sync-adoption-report@1 and an adopted watermark that requires a full
reconciliation before incremental confidence. Verified QDN identities and
receipts are unchanged.

## 6. Desktop GUI (7C)

The Electron app has a new Sync view:

- manual Check for updates with full-reconciliation and withdrawal-policy controls;
- live run progress and Cancel scan;
- explicit counts for new, modified, unchanged, withdrawn, conflicting,
  unpublished and not-checked items;
- honest failed/incomplete/interrupted banners and Resume scan;
- reviewable delta plan with resource count, fee estimate and projected disk;
- Continue to Hub publication, which opens the existing Publishing view with the
  delta plan preselected;
- conflict list with source/local/QDN evidence and audited resolution buttons;
- withdrawal actions with repeated "does not delete published QDN data" wording;
- existing-migration adoption card and evidence history;
- persistent synchronization history from the engine.

No wallet keys, seeds or credentials are collected. No scheduled sync or
autonomous signing was added. The GUI calls the same local engine host and the
same Phase 5 publication workflow.

## 7. API surface

Engine project handle:

    project.sync.status()
    project.sync.check(options)
    project.sync.resume({ scanId })
    project.sync.get(scanId)
    project.sync.history()
    project.sync.preparePlan({ scanId, selection, ... })
    project.sync.conflicts()
    project.sync.resolveConflict({ conflictId, resolution, note })
    project.sync.withdraw({ scanId, sourceKeys, policy, note })
    project.sync.prepareTombstones({ scanId, sourceKeys, note })
    project.sync.adoptExisting({ note })
    project.sync.adoptionReports()
    project.sync.withdrawalList()
    project.sync.catalog()
    project.sync.writeCatalog({ scanId })
    project.sync.recordQdnEvidence(evidence)
    project.sync.assertPublicationSafe({ plan, sourceKeys })

Host JSON-RPC methods: sync.status, sync.check, sync.resume, sync.get,
sync.history, sync.plan, sync.conflicts, sync.resolveConflict, sync.withdraw,
sync.prepareTombstones, sync.adopt, sync.adoptions, sync.withdrawals,
sync.catalog, sync.writeCatalog, sync.recordQdnEvidence.

## 8. Acceptance evidence

| AC | Evidence |
| --- | --- |
| AC7.1 new post published once | test/phase7/sync.test.js — new post detected after a verified Phase 5 publication; the next incremental scan reports 1 new and no republish. |
| AC7.2 modified old post | Same suite — a 2020 post edited later is returned by the overlap window and classified modified. |
| AC7.3 unchanged not republished | Same suite — after exact read-back verification, the next scan reports the two mappings as unchanged and preparePlan returns noChanges=true. |
| AC7.4 honest source deletion | Same suite — withdrawal result and record contain networkDeleted=false; the test never asserts a QDN delete. |
| AC7.5 withdrawal policy + audit | Same suite — default hide, review policy, unpublished-status withdrawal, mapping status, withdrawal history and catalog exclusion. |
| AC7.6 persisted conflict + audited resolution | Same suite — external QDN evidence persists, blocks publication, keep_qdn still blocks, take_source authorizes; survives restart. |
| AC7.7 failed scan is not no changes | Same suite — HTTP 500 scan returns failed, counts=null, noChanges=false; no watermark and no plan. |
| AC7.8 partial index not rewritten | Same suite — truncated scan is incomplete, no withdrawals, watermark unchanged, catalog write and plan refused. |
| AC7.9 existing adoption | Same suite — verified Phase 5 mappings adopted with identical triples and a persisted report. |
| AC7.10 Hub workflow, no secrets | AC7.1 uses the unchanged publication.prepare, receipt import and exact QDN read-back; desktop IPC never exposes a signer. |
| AC7.11 GUI integration | desktop/tests/renderer/sync.spec.tsx — 7 tests: manual scan + counts + plan handoff, failed scan, partial scan, resume, adoption, conflict resolution, withdrawal/tombstone honesty. |
| AC7.12 Corbett + generic CMS regressions | Corbett build green; generic template 19 tests green; full root suite 346 tests, all passing. |
| AC7.13 no background service/signing | Code has no timer or scheduler; only explicit IPC actions; no signing method or key input. |
| AC7.14 durable history after restart | Engine tests reopen the project and read scan history, reports, conflicts and adoption reports. |

### Test counts (this branch)

- Root suite: 346 tests, 346 passed, 0 failed, 0 skipped.
- Phase 7 suite: 13 tests (12 engine + 1 host RPC), all passing.
- Desktop: 35 tests / 11 files, all passing, including 7 new sync GUI tests.
- Generic CMS template: 19 tests / 3 files, all passing.
- Builds: viewer/migration build, Corbett CMS build, generic template bundle
  build and validator all succeeded.
- Desktop typecheck: tsc for renderer/shared and main/preload succeeds.

## 9. Compatibility

- Phase 5 publication protocol, handoff package, receipts and exact read-back
  are unchanged; the only addition is the pre-publication guard.
- Phase 5.2 broker and External Auth code were not modified.
- Phase 6 generic CMS manifest compatibility is unchanged; its tests and build pass.
- Corbett branding, routes, cr-* identifiers and golden fixtures pass.
- Existing project storage and recovery behavior is preserved; store version 4
  is a forward-only addition with a tested migration from version 0-3.
- Existing mappings, publication receipts and resource identities are preserved
  by adoption and withdrawal.

## 10. Security boundaries observed

- No live QDN publication, wallet, seed, key, VM, UFW, Tailscale, Caddy, Webmin
  or broker change was made.
- All tests use fixture WordPress/QDN servers and deterministic clocks.
- External QDN evidence is supplied explicitly; Phase 7 does not silently read
  or overwrite a live resource.
- No cron, timer, service or scheduled background sync was added.

## 11. Known limitations and remaining alpha blockers

1. Real WordPress acceptance not yet run. Phase 7 was verified with the
   deterministic WordPress fixture, including application-password code paths
   inherited from Phase 2, but not against a live public site in this phase.
2. Real Hub delta publication not yet run. The delta plan uses the verified
   Phase 5 handoff, but an actual operator-approved publish and exact read-back
   of a Phase 7 delta is still required for alpha acceptance.
3. Automatic live QDN comparison is not wired. Conflict evidence currently
   enters through recordQdnEvidence (or future verifier integration); Phase 7
   does not poll QDN on its own.
4. Discovery resumability is coarse. Classification resumes at a checkpoint; an
   interrupted source-discovery request requires a fresh scan. The append-only
   source batch remains available for inspection.
5. Tombstones are preparation-only. They are not publishable through a delta
   plan yet; publishing them would require a separate resource adapter and
   explicit product decision.
6. Unpublished-status discovery depends on source auth and query policy.
   WordPress may restrict draft/private/trash visibility. Missing content in a
   complete full scan still becomes a withdrawal candidate, but the exact status
   may be unknown.
7. Large-project scaling is bounded, not benchmarked. State keeps 2,000 entries
   per class and full reports on disk; very large sites still need performance
   and memory measurements.
8. No scheduling was added by design. A future scheduling extension must build
   on sync.check/sync.plan without changing the no-autonomous-signing boundary.
9. Packaging gate G5 is unchanged. This phase did not produce or install a
   production .deb; the Electron build/typecheck/tests pass, but clean-VM
   packaging remains Phase 9.

## 12. Recommended next steps

1. Run a read-only live WordPress sync against a staging site and compare the
   delta with the source editor.
2. Perform one operator-authorized delta handoff through Hub, import the receipt,
   and verify exact read-back of the changed resources.
3. Add a verifier-to-sync evidence bridge that records the exact observed QDN
   hash without polling or auto-publishing.
4. Decide whether tombstones become a supported publish resource in Phase 8.
5. Continue Phase 8 recovery/cleanup work, then Phase 9 packaging/security review
   before any public alpha claim.
