# GUI Functional Audit — Qortal Migration Studio 0.8.0

Status: audit of commit `d9bdbe0` (release/0.8.0-rc.1), with the defects found here fixed
on the same branch. This document inventories **every control and navigation path** that
participates in the essential migration workflow and states, for each one:

- the UI action and its expected observable result;
- the renderer handler;
- the IPC channel and engine operation;
- success and failure states;
- existing automated coverage;
- missing coverage or a defect.

A control is not considered equivalent to another just because both end up in a related
engine function. In particular, **Run quick scan** and **Confirm quick scan and continue**
are separate renderer paths with different post-scan behaviour, and this distinction is
recorded explicitly below.

Evidence for the audit and the acceptance run is stored in
`docs/migration-studio/evidence/`. The per-control result table is in
`docs/migration-studio/FUNCTIONAL-ACCEPTANCE-REPORT.md`.

## Method

1. Static walk of the renderer (`desktop/src/renderer/**`), the preload bridge
   (`desktop/src/preload/index.ts`), the IPC allowlist (`desktop/src/shared/validation.ts`),
   the IPC handlers (`desktop/src/main/ipc.ts`), the host bridge
   (`desktop/src/main/host.ts`, `lib/engine/host/*`) and the engine services
   (`lib/engine/*`).
2. Packaged reproduction on the private 0.8.0-rc.1 build with the deterministic
   WordPress fixture, driven over CDP under Xvfb.
3. Functional acceptance A–H on the fixed build, asserting recorded run state, index
   files and handoff/verification evidence rather than click outcomes.

## Known defect found by this audit (BUG-004)

The renderer sent an explicit `mode` and bounded `selection` on
`qms:source:discover`, and `desktop/src/main/ipc.ts` forwarded both fields. But the IPC
allowlist in `desktop/src/shared/validation.ts` (case `IPC.sourceDiscover`, lines 450–460)
returned only five fields and **silently dropped `mode`, `selection`, `includeTerms` and
`includeAssets`**.

Consequences:

- the engine received `mode: undefined` and failed closed with
  `SOURCE_SCAN_MODE_REQUIRED` before any WordPress request;
- every **Run quick scan**, **Confirm quick scan and continue** and **Run full inventory**
  failed with the same immediate error;
- no content was indexed, so planning remained impossible;
- the error was rendered at the **top of the wizard** (`ErrorText` + `stepError` above the
  stepper). Step 4 is long, so an owner looking at the scan controls saw only a brief
  state change and then nothing near the button that failed.

This is the owner's reported Quick Scan failure, and it also explains the reported
Full-inventory failure. An interrupted Full checkpoint could not have influenced it: the
mode guard throws before the checkpoint is read.

Fix (with permanent regression tests):

- `desktop/src/shared/validation.ts`: preserve `mode` (validated as `quick|full`),
  `selection` (bounded perPage/maxPages/maxItems/include/slug/contentTypes),
  `includeTerms`, `includeAssets` and `progressEvery`. An absent mode stays absent so the
  engine remains fail-closed.
- `desktop/src/renderer/components/Wizard.tsx`: add `scanError` and render it inside the
  `source-scan` card, next to the controls that failed, in addition to the wizard-level
  alert.
- `desktop/tests/validation.spec.ts`: BUG-004 regression asserting the allowlist output.
- `desktop/tests/renderer/wizard.spec.tsx`: regression asserting the failure is visible
  inside the source-scan panel.

## Control inventory

### App shell and navigation

| Control | UI action → expected behaviour | Renderer handler | IPC → engine | Success / failure states | Automated coverage | Missing coverage / defect |
| --- | --- | --- | --- | --- | --- | --- |
| Header **Dashboard** | Returns to the project list and refreshes projects. | `backToDashboard` in `App.tsx` | `qms:project:list` → `project.list` | List renders; failure sets the shell error. | dashboard/app-recovery specs | None. |
| Header **Publishing** | Opens the publication view for the open project. | `openPublishing` | `qms:project:open` → `project.open` | View renders; stale lock is surfaced. | app-recovery spec | None. |
| Header **Sync** | Opens the incremental-sync view. | `openSync` | `qms:project:open` → `project.open` | View renders. | sync spec | None. |
| Header **Recovery** | Opens recovery/cleanup/history. | `openRecovery` | `qms:project:open` → `project.open` | View renders. | recovery spec | None. |
| Header **Updates** | Opens update details/check. | `Updates` component | `qms:updates:state`/`check` → update registry | Badge only for verified update. | updates spec | None. |
| **Text size** (90–150%) | Changes root text size and persists it. | `textSize.ts` | `localStorage` only | Applies immediately. | text-size spec | None. |
| **Open workspace folder** | Opens the configured data root. | `api().app.openPath` | `qms:app:open-path` (realpath must stay inside data root) | Opens or shows `PATH_NOT_ALLOWED`. | packaging/security specs indirectly | No packaged test. |

### Dashboard / project lifecycle

| Control | UI action → expected behaviour | Renderer handler | IPC → engine | Success / failure states | Automated coverage | Missing coverage / defect |
| --- | --- | --- | --- | --- | --- | --- |
| **New project** | Toggles the create form. | `setShowCreate` | none | Form toggles. | dashboard spec | None. |
| **Create and continue** | Creates a project with a generated site identity, refreshes, and opens it. | `createProject` | `qms:project:create` → `project.create` | Project opened in wizard; validation or duplicate errors shown. | dashboard spec, validation spec | None. |
| **Open** (project card) | Opens the project; completed wizard goes to Progress, otherwise Wizard. | `openProject` | `qms:project:open` → `project.open` | Stale lock opens an explicit recovery banner. | app-recovery spec | None. |
| **Check for updates** (card) | Opens Sync for that project. | `onSync` | project.open + sync view | View renders; quiet dirty-scan label when applicable. | sync spec | None. |
| **History & diagnostics** | Opens durable history/diagnostics. | `onHistory` | project.open + history.list | Renders or errors. | history spec | None. |
| **Recovery & cleanup** | Opens recovery, cleanup and support-bundle view. | `onRecovery` | recovery.status/cleanup.list/history.list | Renders or errors. | recovery spec | None. |
| **Archive** | Confirms, then archives the project without deleting data. | `archive` | `qms:project:archive` → `project.archive` | Archived != published notice; project stays read-only. | dashboard spec | No packaged test. |
| **Recover stale lock** | Explicitly reopens after an unclean shutdown. | `recoverStaleProject` | `qms:project:open` with `recoverStaleLock` | Opens Recovery, or shows the error. | app-recovery spec | None. |

### Wizard

| Control | UI action → expected behaviour | Renderer handler | IPC → engine | Success / failure states | Automated coverage | Missing coverage / defect |
| --- | --- | --- | --- | --- | --- | --- |
| Stepper (steps 1–5) | Navigates to completed steps; persists step. | `goTo` | `qms:project:save-wizard` → `project.update` | Step renders; persistence error shown. | wizard-state + wizard specs | None. |
| Step 1 adapter choice | Selects a source adapter from the registry. | `setAdapterId` | `qms:source:list`/capabilities | Capabilities shown from engine. | wizard spec | None. |
| **Continue** step 1 | Saves the adapter and advances. | `next` | project.update | Validation error if unsupported. | wizard spec | None. |
| **Test connection** | Validates the WordPress REST contract and auth. | `testConnection` | `qms:source:validate` → `source.validate` | Badge + connection report; failure alert stays inside step 2. | wizard spec | No packaged test of the report rendering. |
| **Continue** step 2 | Requires a successful connection. | `next` | project.update | Blocked with an explicit message. | wizard spec | None. |
| **Continue** step 3 | Validates Qortal name, title, tagline, service and saves target. | `next` | `qms:identity:validate-target` → `identity.validateTarget`; project.update | Local validation only; no ownership claim. | wizard spec, qortalName tests | None. |
| **Continue** step 4 | Saves preferences; never starts discovery. | `next` → `savePreferences` | project.update | Shows explicit scan confirmation panel. | wizard spec | None. |
| **Run quick scan** (direct) | Runs the bounded selection and stays on step 4. | `runScan('quick')` | `qms:source:discover` → `source.discover({mode:'quick',selection})` | Completion counts + run state; failure must be visible next to controls. | wizard spec (calls + new error locality), bounded-discovery engine test | **BUG-004**: IPC allowlist dropped mode/selection. Packaged failure reproduced. |
| **Confirm quick scan and continue** | Runs the same bounded scan, saves discovery and advances to plan review. | `runScan('quick',{continueAfter:true})` | same as above, then `plan.create` | Plan review with selected count; blocked if empty. | wizard spec, engine tests | **BUG-004** same root cause; post-scan navigation differs from direct button. |
| **Run full inventory** | Explicit full crawl after acknowledgement. | `runScan('full')` | `source.discover({mode:'full'})` | Long operation; pause/cancel available. | wizard spec, bounded-discovery | **BUG-004** same root cause. |
| **Full-inventory acknowledgement** | Enables the full button and shows worst-case pages. | `setFullScanAcknowledged` | none | Button disabled until ticked. | wizard spec | None. |
| **Pause** | Aborts at a safe boundary and persists the checkpoint. | `pauseScan` | `qms:run:pause` → `run.pause` | Progress message; resume banner; failure shown next to scan controls. | wizard spec, bounded-discovery | Packaged pause covered by acceptance D/F. |
| **Cancel scan** | Ends the run and keeps the project/assets. | `cancelScan` | `qms:run:cancel` → `run.cancel` | Cancelled notice; project preserved. | wizard spec, bounded-discovery | Packaged cancel covered by acceptance E. |
| **Resume interrupted scan from checkpoint** | Re-drives the durable batch. | `resumeInterruptedScan` | `qms:recovery:resume` → `recovery.resume` | Completes from cursor; failure shown locally. | wizard spec, bounded-discovery | Packaged resume covered by D. |
| **Check disk** | Previews free/reserve/fit. | `checkDisk` | `qms:disk:check` → `disk.check` | Fits/does-not-fit; error shown. | wizard + phase3 tests | None. |
| **Refresh preview** (step 5) | Rebuilds the plan preview without persisting. | `loadPreview` | `qms:plan:create` with `persist:false` | Plan/statistics/blocked reasons. | wizard spec, phase3 | None. |
| **Approve local preparation** | Persists a ready plan and opens Progress. | `approve` | `qms:plan:create` with `persist:true` | Disabled with a reason unless a ready non-empty plan exists. | wizard spec | None. |
| **Back / Back to settings** | Navigates and persists. | `goTo` | save-wizard | No destructive action. | wizard spec | None. |
| **Back to dashboard** | Closes the wizard view. | `onClose` | none | Dashboard refreshes. | wizard spec | None. |

### Local preparation

| Control | UI action → expected behaviour | Renderer handler | IPC → engine | Success / failure states | Automated coverage | Missing coverage / defect |
| --- | --- | --- | --- | --- | --- | --- |
| **Start / Resume / repair media** | Downloads and verifies plan media with checkpoints. | `startDownload` | `qms:media:download` → `media.download` | Completed/partial with counts; resumable. | progress spec, phase3 media tests | No packaged media run in the functional harness (H uses the handoff E2E seed). |
| **Pause / Cancel** (media) | Pauses at a boundary or cancels, keeping verified files. | `pause`/`cancel` | `qms:run:pause`/`cancel` | Notices; verified files kept. | progress spec | No packaged test. |
| **Publish through Hub** | Opens the Publishing view. | `onPublishing` | navigation | View renders. | progress spec | None. |
| **History & diagnostics** | Opens History. | `onHistory` | navigation | Renders. | history spec | None. |

### Publication (Hub handoff)

| Control | UI action → expected behaviour | Renderer handler | IPC → engine | Success / failure states | Automated coverage | Missing coverage / defect |
| --- | --- | --- | --- | --- | --- | --- |
| Plan selector + resource checkboxes | Chooses an explicit subset of actionable resources. | `setSelectedPlanId`/`toggle` | `qms:plan:get` | Generate disabled at zero selection. | publishing spec | None. |
| **Generate handoff package** | Writes the handoff directory, verifies every hash, reserves identities. | `prepareHandoff` | `qms:publication:prepare` → `publication.prepare` | Handoff ready; reused handoff reopened; failure leaves a recoverable package. | publishing spec, phase5 handoff tests | Packaged E2E covers prepare/export. |
| **Export Publisher package (.zip)** | Packages the prepared directory without regenerating. | `exportPublisherPackage`/`exportBundleFor` | `qms:publication:exportBundle` → `publication.exportBundle` | ZIP path/size/hash; recovery path reuses the same bytes. | publishing spec, packaged-handoff-e2e | Covered packaged for prepare/export/recovery. |
| **Package existing handoff (.zip)** | Recovery path for a directory without a ZIP. | `exportBundleFor(selectedHandoffId)` | exportBundle | Does not call prepare or duplicate resources. | publishing spec, packaged-handoff-e2e | None. |
| **Import receipt** | Imports Publisher evidence, never promotes to verified. | `importReceipt` | `qms:publication:importReceipt` → `publication.importReceipt` | Receipt evidence shown; tampered/mismatched receipts rejected. | publishing spec, receipts/e2e tests | **Missing packaged UI coverage**; added to packaged-handoff-e2e as part of H. |
| **Run independent QDN verification** | Read-only exact read-back against a node. | `verify` | `qms:publication:verify` → `publication.verify` | Remote verified only on exact bytes; pending remains pending. | phase5 receipts/e2e/host tests | **Missing packaged UI coverage**; added to packaged-handoff-e2e as part of H. |
| **Test connection / Save as preferred node** | Probes a read-only node and stores it. | `testNode`/`saveNode` | `qms:nodes:test`/`set` | Reachable/unreachable; no credentials. | nodes spec | None. |
| **Open published website** | Opens the exact APP/WEBSITE identifier only after verification. | `openPublishedSite` | `qms:app:open-url` | Disabled until `remote_verified`. | publishing spec | None. |
| **Open selected handoff folder** | Opens only a path inside the workspace. | `openHandoffFolder` | `qms:app:open-path` | Path allowlist enforced. | publishing spec/security | None. |

### Synchronization

| Control | UI action → expected behaviour | Renderer handler | IPC → engine | Success / failure states | Automated coverage | Missing coverage / defect |
| --- | --- | --- | --- | --- | --- | --- |
| **Check for updates** | Runs a scoped/auto or full reconciliation scan. | `checkForUpdates` | `qms:sync:check` → `sync.check` | Delta counts; failed/incomplete never shown as no-change. | sync spec, phase7 | No packaged test. |
| **Resume scan** | Re-drives an interrupted sync checkpoint. | `resumeScan` | `sync.resume` | Resumes or stays interrupted. | sync spec, phase7 | None. |
| **Cancel scan** | Cancels the active sync run. | `cancelScan` | `qms:run:cancel` | Cancelled is not a successful sync. | sync spec | None. |
| **Adopt existing migration** | Records an adopted migration without changing identities. | `adoptExisting` | `sync.adopt` | Audited adoption; failures surface. | sync spec | None. |
| **Prepare delta plan** | Plans only new/modified resources. | `preparePlan` | `sync.plan` | No-changes message; then Publishing. | sync spec, phase7 | None. |
| **Conflict resolution choices** | Records a reasoned resolution. | `resolveConflict` | `sync.resolveConflict` | Audited; no silent overwrite. | sync spec | None. |
| **Apply withdrawal policy / Prepare tombstones only** | Applies local withdrawal/tombstones, never a network delete. | `applyWithdrawals`/`prepareTombstones` | `sync.withdraw`/`prepareTombstones` | Explicit "no QDN delete" messaging. | sync spec | None. |
| **Continue to Hub publication** | Opens Publishing with the delta plan. | `continueToPublishing` | navigation | Only enabled with a plan. | sync spec | None. |

### Recovery, cleanup and diagnostics

| Control | UI action → expected behaviour | Renderer handler | IPC → engine | Success / failure states | Automated coverage | Missing coverage / defect |
| --- | --- | --- | --- | --- | --- | --- |
| **Refresh** | Reloads recovery status, cleanups and history. | `refresh` | recovery.status/cleanup.list/history.list | Renders or errors. | recovery spec | None. |
| **Resume** (candidate) | Resumes an interrupted run/stage from its checkpoint. | `resume` | `qms:recovery:resume` → `recovery.resume` | Fresh run continues; not resumable is explained. | recovery spec, phase8 | None. |
| **Dismiss** | Marks an interrupted operation dismissed without retrying publication. | `dismiss` | `recovery.dismiss` | No automatic resubmission. | recovery spec | None. |
| **Reconcile** | Exact read-back for ambiguous publications; never resubmits. | `reconcile` | `recovery.reconcile` | Reconciled counts; failures shown. | recovery spec | None. |
| **Preview cleanup** | Computes quarantine candidates and eligibility. | `previewCleanup` | `cleanup.preview` | Eligible/reasons; nothing changed. | recovery spec | None. |
| **Start cleanup** | Two-phase quarantine with restore window. | `startCleanup` | `cleanup.start` | Moved bytes + restoreBy. | recovery spec, phase8 | None. |
| **Restore** | Restores quarantined files. | `restore` | `cleanup.restore` | Restored count. | recovery spec | None. |
| **Purge** | Permanently purges quarantine with measured reclaim. | `purge` | `cleanup.purge` | Reclaimed bytes; force flag. | recovery spec | None. |
| **Resume cleanup** | Continues an interrupted two-phase cleanup. | `resumeCleanup` | `cleanup.resume` | Completes idempotently. | recovery spec, phase8 | None. |
| **Export history snapshot** | Writes a durable history snapshot. | `exportHistory` | `history.export` | Relative path + entry count. | recovery spec | None. |
| **Export support bundle** | Redacted diagnostics bundle. | `exportBundle` | `support.bundle` (diagnostics.export) | Secrets/bodies excluded. | recovery/history specs | None. |
| History **Open** | Opens the plan in Progress. | `onProgress` | navigation | Renders. | history spec | None. |
| History conflict **Skip / Use alternate / Mark abort** | Records an identity conflict decision. | `resolve` | `identity.resolveConflict` | Audited decision. | history spec | None. |
| **Export diagnostics** / **Open export folder** | Diagnostics export and folder open. | `exportDiagnostics` | support.bundle / open-path | Export path; failure shown. | history spec | None. |

### Updates

| Control | UI action → expected behaviour | Renderer handler | IPC → engine | Success / failure states | Automated coverage | Missing coverage / defect |
| --- | --- | --- | --- | --- | --- | --- |
| **Check for updates** | Checks the registry and GitHub assets. | `Updates.check` | `qms:updates:check` | Badge only for a verified update; unavailable is quiet. | updates spec, test:update | None. |
| **Save and check** | Stores a trusted update node and checks it. | `saveNode` | `updates.setNode` | Validated http(s) URL only. | updates spec | None. |
| **Open release page / Copy download link** | Opens/copies the verified release URL. | `openRelease`/`copyLink` | `updates.openRelease` / clipboard | URL allowlist. | updates spec | None. |

## Cross-cutting observations

1. **Wizard error locality.** `ErrorText` and `stepError` render above the stepper. Step 4 is
   several screens tall, so any failure raised by the scan controls was invisible while the
   owner stayed at the controls. Fixed with a `scan-error` alert inside the source-scan card
   and a regression test asserting containment.
2. **Fail-closed scan mode.** The engine correctly refuses a missing mode. The boundary must
   not silently strip validated fields; the IPC allowlist is now tested for the exact
   discover payload.
3. **No UI double-click path was assumed.** Direct Run quick scan and Confirm quick scan and
   continue both call `runScan`, but only the confirmed path persists discovery and advances
   to planning. Acceptance A and B exercise both separately.
4. **Receipt import is not proof.** The UI and engine keep Publisher-reported status separate
   from exact read-back; acceptance H asserts the promotion happens only after read-back.
5. **Packaged-only failures exist.** Renderer unit tests mock the preload API, so the
   validation-layer drop could not be caught there. The packaged E2E gates are blocking and
   should stay mandatory for public releases.
