# Phase 4 — Linux desktop GUI and Debian package

| Field | Value |
| --- | --- |
| Document | Phase 4 implementation and developer guide |
| Date | 2026-11-03 |
| Status | Desktop prototype implemented, tested and packaged; no QDN publication and no live WordPress migration |
| Scope | Electron + React + TypeScript desktop app, secure preload/IPC, engine host integration, setup wizard, planning review, preparation progress, history/diagnostics, Debian .deb |
| Phase 3 baseline | commit 9126a8182f7fc7fad265f3ad9025bb02201953a8 |
| Phase 4 branch | agent/qortal-wordpress-to-qortal/20261103T052517Z-qortal-migration-studio-phase-4 |
| Product name | Qortal Migration Studio |
| Package name | qortal-migration-studio (independent from the legacy root package) |
| Companion documents | Architecture, Phase 1, Phase 2, Phase 3, Requirements, Roadmap |

This document describes what Phase 4 actually implements and what it does not
prove. Values marked **unverified** are explicitly not proven by this phase.

## 1. Outcome

Phase 4 adds a first usable Linux desktop prototype around the existing
headless engine:

- a nontechnical workflow with no terminal commands;
- a secure Electron shell (context isolation, sandboxed renderer, no Node in the
  renderer, narrow preload allowlist, strict IPC validation);
- the engine runs as a child process over newline-delimited JSON-RPC, using
  Electron's bundled Node runtime;
- a five-step setup wizard driven by adapter capabilities and qms-plan@1;
- project dashboard with status, last activity, outstanding reserved work and
  safe archive;
- preparation progress with persisted run reconstruction, cancellation and
  checkpoint/resume;
- history and metadata-only diagnostics export;
- a Debian package with bundled runtime, icons, desktop entry and no external
  Node, npm or Git requirement;
- a correction to the Phase 3 lifecycle semantics so reserved/unpublished work
  is never reported as unchanged or published.

Phase 4 does **not**:

- publish to QDN, sign a transaction, read wallet keys/seeds/passwords, or verify
  remote name ownership;
- implement Phase 5 signing/publication, Phase 8 cleanup, or deleted-source
  reconciliation;
- modify Qortal Core, Hub or the running node;
- replace the legacy CLI workflows or the historical compatibility layer.

## 2. Desktop architecture

~~~text
+---------------------------------------------------------------+
| React renderer (sandboxed, no Node)                           |
|   Dashboard | Setup wizard | Progress | History               |
|   window.qms (contextBridge allowlist only)                   |
+----------------------------|----------------------------------+
                             | ipcRenderer.invoke / qms:event
+----------------------------v----------------------------------+
| Electron main process                                         |
|   - IPC validation + trusted sender check                     |
|   - credential memory / libsecret adapter                     |
|   - diagnostics redaction and export                          |
|   - EngineHost child supervisor                               |
+----------------------------|----------------------------------+
                             | stdio JSON-RPC qms-engine@1
+----------------------------v----------------------------------+
| qms-host child (ELECTRON_RUN_AS_NODE=1)                       |
|   lib/engine, lib/source, lib/media, Phase 1-3 state           |
|   no Electron import, no domain logic in React                |
+---------------------------------------------------------------+
~~~

### 2.1 Process model

- The renderer never gets require, process, filesystem, shell or raw IPC.
- The main process exposes only the methods listed in
  desktop/src/preload/index.ts. There is no generic invoke(channel, ...) bridge.
- Each request is validated against desktop/src/shared/validation.ts before it
  reaches the engine. Unknown channels, unknown fields, invalid identifiers,
  relative paths, non-HTTP source URLs and oversized payloads are rejected.
- The engine host is spawned with process.execPath and
  ELECTRON_RUN_AS_NODE=1. A packaged app therefore needs no system Node.
- Engine events are forwarded to the renderer only after a second redaction pass.
- The engine itself remains Electron-free. React contains no planning, disk,
  media, identity or fee logic.

### 2.2 Desktop source map

| Path | Responsibility |
| --- | --- |
| desktop/src/main/index.ts | App lifecycle, single instance, host startup, smoke mode |
| desktop/src/main/host.ts | Child process, JSON-RPC client, event forwarding, timeouts |
| desktop/src/main/window.ts | BrowserWindow security, CSP, navigation/window guards |
| desktop/src/main/ipc.ts | Allowlisted handlers, trusted sender check, error envelopes |
| desktop/src/main/credentials.ts | Session memory + optional secret-tool persistence |
| desktop/src/main/paths.ts | XDG workspace, config, path restrictions |
| desktop/src/main/diagnostics.ts | Metadata-only export with key redaction |
| desktop/src/preload/index.ts | Narrow window.qms API |
| desktop/src/shared/types.ts | Renderer/main contracts |
| desktop/src/shared/channels.ts | Fixed IPC channel names |
| desktop/src/shared/validation.ts | Strict request sanitizers |
| desktop/src/renderer/ | React screens and presentation-only helpers |
| bin/qms-host.js | Desktop stdio host entry using the real engine |
| test/phase4/ | Engine lifecycle, host contract and auth-header regressions |
| desktop/tests/ | Validation, security, packaging, host, credentials and renderer tests |

Nothing under desktop/src contains a historical example-site name, owner name,
hardcoded QDN identifier or example-site default. The packaging test scans the
desktop source for historical branding.

## 3. Electron security

| Control | Implementation |
| --- | --- |
| Renderer isolation | contextIsolation true, nodeIntegration false, sandbox true |
| Renderer capability | Only window.qms methods through contextBridge |
| IPC allowlist | Fixed channel map; unknown channels rejected |
| IPC validation | Type, length, enum, identifier, path and payload-size checks |
| Sender validation | Main window webContents id plus trusted file/dev-server URL |
| Navigation | Unrecognized navigation prevented |
| New windows | setWindowOpenHandler denies; HTTPS may open in the system browser |
| Webviews | webviewTag false and attach prevented |
| Permissions | All renderer permission requests denied |
| CSP | default-src self, no remote script, object-src none, frame-ancestors none |
| Filesystem | No renderer filesystem API; app.openPath restricted to the workspace |
| Process execution | No shell/exec IPC; host process is fixed at startup |
| Secrets | Memory-only by default; libsecret only when available and opted in |
| Events | Engine redaction plus a second main-process redaction pass |
| Diagnostics | Metadata only; secret-like keys redacted; mode 0600 files |

The production window uses sandbox true. The automated launch test passes
--no-sandbox because the CI container does not provide a setuid Chromium sandbox
helper; this is a test-environment flag, not a product default.

## 4. Engine host integration

The host is the existing lib/engine/host/server.js over stdio, entered through
bin/qms-host.js. Phase 4 adds two host methods needed by the wizard:

- identity.validateTarget — local name/prefix validation only;
- disk.check — read-only disk preflight using the project's effective limits.

It also adds projects.inspect, a read-only dashboard projection from the last
atomic state snapshot. It never takes the project lock and never writes, so the
dashboard can show status while another process owns the project.

Timeouts are bounded per operation: plan creation and media downloads get long
budgets; metadata calls get short ones. run.cancel remains reachable while a long
operation runs because the host handles requests concurrently.

## 5. Setup wizard

The wizard persists progress in project.settings.desktopWizard through the
existing project update API. It never stores credentials there; the IPC validator
rejects secret-like keys before persistence.

| Step | Implemented behavior |
| --- | --- |
| 1. Source CMS | Adapter cards from source.list; content types, auth modes, terms, states, assets and unsupported features are displayed from the capability registry. React does not branch on adapter id. |
| 2. WordPress connection | URL, adapter-reported auth mode, username and password fields; source.validate runs through the real adapter; site name, counts, content types, unsupported features and warnings are shown. |
| 3. Qortal destination | Target name, title and description; local validation through identity.validateTarget; generated siteId and namespace are shown read-only under advanced details. Remote ownership is explicitly deferred to Phase 5. |
| 4. Import preferences | Batch size (default 15), content types, date filters, media concurrency, external-media policy, workspace display, reserve GiB, per-run GiB, per-file MiB, file count, unknown-size policy and reserved-item recovery toggle. Disk check calls disk.check. |
| 5. Plan and review | Consumes qms-plan@1 from a non-persisting preview, then requires explicit approval to persist. Shows selected/new/modified/route-only/unchanged/reserved/conflict counts, media counts and known bytes, disk available/reserve/projected, estimated QDN fee labeled as an estimate, warnings, errors, conflicts, pending-publication counts and selected QDN identifiers. |

Approval persists the plan and reserves identity mappings in one transaction. A
blocked plan is still inspectable and reserves nothing.

## 6. Project lifecycle and screens

### 6.1 Dashboard

- Create/open project; the engine generates a cryptographically random,
  immutable site_id and project namespace automatically.
- Show source adapter/URL, destination name, site identity, last activity,
  active/interrupted operations, last plan, pending publication and unresolved
  conflicts.
- Continue interrupted work by opening the project and the latest plan.
- Archive uses the existing safe archive API with deleteLocalData false.
- Archived is shown as a separate badge and is never equated with published.
- Archived projects are read-only in this prototype; their data is preserved.

### 6.2 Preparation/progress

- Live qms-event@1 stream with operation, phase, structured code, level, message
  and progress.
- File/byte progress where known.
- Cancellation through run.cancel.
- Persisted progress reconstruction after reopening from run records and plan
  download records.
- States shown: ready, running, completed, partial, paused/checkpointed, blocked,
  failed, cancelled.
- Pause is **not** advertised. The UI explicitly says checkpoint/resume and
  reuses verified assets and .part files.
- Reserved/prepared counts are displayed separately from publication.

### 6.3 History and diagnostics

- Identity mappings with distinct labels:
  - Reserved — not published;
  - Prepared locally — not published;
  - Remotely verified;
  - Published (verified).
- Plan history with selected and pending-publication counts and download status.
- Run history, media asset totals, partial files, free disk and reserve.
- Conflict resolution through the existing explicit API (skip, alternate, abort).
- Diagnostic export writes metadata-only JSON with mode 0600. Credentials,
  authorization headers, cookies, wallet material and content bodies are
  excluded by key redaction before writing.

## 7. Reserved versus published — lifecycle correction

Phase 3 classified a mapping with the same content hash and route as unchanged.
For a mapping that was only reserved, that hid the fact that publication never
happened. Phase 4 corrects this without changing identifiers:

- publicationStatus is a separate dimension:
  reserved | prepared | remote_verified | published.
- localPreparation is another dimension: reserved | partial | prepared.
- classifyCandidate returns unchanged only when the mapping is remote_verified or
  published (including legacy status published).
- A same-hash, same-route mapping that is only reserved or prepared returns
  reserved, counted separately in stats.reserved.
- Reserved items are not silently selected again by default, so the normal batch
  progression is preserved. They remain visible in the plan
  (pendingPublication), in identity state and in the dashboard.
- planning.includeReserved true (CLI --include-reserved) explicitly re-selects
  reserved items for recovery/re-preparation. Their site identity, Qortal name
  and identifier are preserved.
- When media verification completes, the mapping's localPreparation becomes
  prepared; publication status remains reserved.
- Phase 5 may set remote_verified/published only after exact QDN read-back.
  Phase 4 never writes those states and never infers publication from hashes or
  local files.

Plan records add pendingPublicationCount; plan files add a pendingPublication
summary with a note that reserved is not published. The plan ID includes the
effective includeReserved setting.

### 7.1 Regression evidence

test/phase4/reserved-lifecycle.test.js covers:

1. three repeated plans with reserved counts 0 → 15 → 20 and unchanged 0;
2. includeReserved re-selection with stable identifiers;
3. close/reopen and repeated planning without losing reserved state;
4. legacy status published and remote_verified mappings remaining unchanged for
   Phase 5 compatibility;
5. media verification marking local preparation without publication;
6. reserved prepared items remaining pending publication on repeated plans.

Existing Phase 3 planner/identity assertions that encoded the old semantics were
updated to assert stats.reserved instead of stats.unchanged.

## 8. Credentials and secrets

- The renderer collects credentials only during the connection step.
- The main process stores them in memory keyed by project.
- If the user opts in **and** secret-tool (libsecret) is available, they are
  stored in the Linux keyring with service
  org.iffinland.qortal-migration-studio and the project id as account.
- If no keyring is available, the UI disables persistence and states that
  credentials are session-only.
- There is no plaintext credential file, no localStorage secret, and no secret in
  project JSON, plans, events, diagnostics or logs.
- Qortal wallet seeds, private keys and wallet passwords are never requested,
  read or stored.
- Process exit clears the in-memory credential map.

## 9. Debian packaging

### 9.1 Build

~~~bash
cd desktop
npm install
npm run build
npm run prepare:engine
npx electron-builder --linux deb
~~~

npm run dist:deb performs the same sequence. Build prerequisites are Node, npm
and standard archive/compression tools; the resulting package does not require
them at runtime.

scripts/prepare-engine.mjs stages:

~~~text
engine-runtime/
  bin/qms-host.js
  lib/...
  src/profile.js
  src/utils/...
  node_modules/{cheerio,dotenv,...}
  package.json
~~~

It does not copy profiles/, fixtures/, .env, tests, historical site data or the
legacy CLI scripts.

### 9.2 Package layout

~~~text
/opt/Qortal Migration Studio/
  qortal-migration-studio          Electron executable
  resources/app.asar               renderer + main + preload
  resources/engine/                bundled engine and runtime dependencies
/usr/share/applications/qortal-migration-studio.desktop
/usr/share/icons/hicolor/<size>/apps/qortal-migration-studio.png
~~~

- App ID: org.iffinland.qortal-migration-studio
- Product: Qortal Migration Studio
- Executable: qortal-migration-studio
- Desktop entry: no terminal, Office category, icon and StartupWMClass
- Project data: XDG data root ($XDG_DATA_HOME/qortal-migration-studio or
  ~/.local/share/qortal-migration-studio), outside the install directory.
- Configuration: ~/.config/qortal-migration-studio/desktop-config.json
  (workspace path only, no secrets).
- Ordinary uninstall removes the install tree, not the XDG project data.
- Dependencies include alternatives for Debian 12 and Debian 13:
  libgtk-3-0 | libgtk-3-0t64, libasound2 | libasound2t64,
  libatspi2.0-0 | libatspi2.0-0t64, plus libnotify, NSS, XSS, XTest,
  xdg-utils, libuuid, libsecret, libgbm and libdrm.

### 9.3 Artifact

The final Phase 4 build produced:

~~~text
desktop/release/qortal-migration-studio-0.4.0-amd64.deb
sha256: b77e9d1a54d43d50f2c2ed95f7a9c3b779093a0e7b416e5135b8e69b2e2fc76c
~~~

Generated installers are intentionally not committed. The worktree path and the
checksum above identify the artifact used for testing.

## 10. Verification evidence

### 10.1 Tests

~~~bash
npm test                 # engine: 146 passing (139 Phase 1-3 + 7 Phase 4)
npm run test:phase4      # 7 Phase 4 engine tests
cd desktop && npm test   # 24 desktop tests
~~~

Phase 4 engine tests:

| File | Covers |
| --- | --- |
| test/phase4/reserved-lifecycle.test.js | reserved vs unchanged, recovery, reopen, media preparation, Phase 5 compatibility |
| test/phase4/host-desktop-contract.test.js | desktop stdio host, engine info, project create/open, target validation, disk check, events, unknown method rejection |
| test/phase4/auth-header.test.js | exact Basic header and secret non-disclosure |

Desktop tests:

| File | Covers |
| --- | --- |
| tests/validation.spec.ts | IPC allowlist, field stripping, path/URL rejection, secret persistence rejection, limits, payload size |
| tests/main/security.spec.ts | contextIsolation/nodeIntegration/sandbox, preload allowlist shape, diagnostics redaction, no plaintext credential file |
| tests/main/packaging.spec.ts | app id/product, deb target, extraResources, icons, no historical branding |
| tests/main/host.spec.ts | real host spawn over stdio, project operations, unknown method rejection |
| tests/main/credentials.spec.ts | session-only behavior and no plaintext fallback |
| tests/renderer/wizard.spec.tsx | adapter capability display, connection validation gate, plan review, explicit approval, identifiers read-only |
| tests/renderer/dashboard.spec.tsx | reserved badge, archived not published, source URL |
| tests/renderer/progress.spec.tsx | reserved vs published, no pause button, resume wording |
| tests/renderer/history.spec.tsx | mapping status separation, diagnostics export |

### 10.2 Builds

- npm run build (desktop): esbuild main/preload + Vite renderer, successful.
- npm run verify:package: successful after build and engine staging.
- npx electron-builder --linux deb: successful.
- apt-get -s install ./release/...deb: dependency simulation successful on
  Debian 13.

### 10.3 Launch verification

Environment: Debian GNU/Linux 13 (trixie) container, no physical display. Xvfb
was obtained without root by extracting Debian packages, started on :99, and the
deb-extracted application was launched with:

- PATH=/usr/bin:/bin (no Node, npm or Git from the development toolchain);
- isolated XDG_DATA_HOME and XDG_CONFIG_HOME;
- --qms-smoke-test --no-sandbox --disable-gpu.

Result: QMS_SMOKE_OK version=0.1.6-phase4 title=Qortal Migration Studio.
This proves the packaged Electron executable, asar, preload, renderer, CSP,
engine host and bundled engine runtime start together without external Node.
DBus/keyring warnings are expected in the headless container.

**Unverified:**

- dpkg -i installation into a full graphical VM (no root and no desktop session
  in this environment); the package was extracted with dpkg-deb -x and launched
  from that tree.
- Keyring persistence in a real desktop session (no secret-tool session in the
  container; session-only path was exercised).
- Real WordPress network connection and real media download from the desktop UI.
  Engine fixtures cover these paths, but no live site was contacted.
- Qortal name ownership, remote collisions and QDN read-back; these are Phase 5.

## 11. MX Linux validation plan

MX Linux 23 (Debian 12 base) and MX Linux 25 (Debian 13 base) should be checked
separately:

1. Verify dependency resolution with apt install ./qortal-migration-studio-0.4.0-amd64.deb.
   Confirm the alternatives resolve to the t64/non-t64 package available in the
   release.
2. Launch from the Whisker menu; confirm the icon, window title and no terminal.
3. Create a project; confirm site_id and namespace appear and are read-only.
4. Connect to a controlled WordPress fixture; confirm auth modes, counts and
   warnings. With a real site, confirm application-password authentication.
5. Run a small plan; check batch size 15, disk reserve, unknown-size policy and
   fee estimate labels.
6. Download media; interrupt network or cancel; reopen the app and confirm the
   partial state and resume/reuse behavior.
7. Export diagnostics; confirm no password, cookie or authorization string is
   present.
8. Uninstall with apt remove qortal-migration-studio; confirm the XDG data
   directory and projects remain, and the app does not delete Qortal Core
   storage.
9. Repeat with gnome-keyring/KWallet available and unavailable; confirm the
   keyring/session-only messaging is accurate.
10. Confirm no Qortal wallet material is requested anywhere in the UI.

## 12. Limitations and blockers

- No live WordPress or Qortal node was contacted; all automated network tests use
  loopback fixtures.
- No Phase 5 publication, remote ownership check or QDN read-back exists.
- No dpkg -i system installation or graphical-session launch was possible in this
  container. Extraction + headless launch is proven; full desktop install is
  unverified.
- No keyring was available in the verification environment.
- The package is unsigned; distribution signing is out of scope.
- The desktop app is single-window and has no auto-update, localization or
  accessibility audit beyond semantic HTML and keyboard-reachable controls.
- Archived projects are read-only in the prototype; history for archived
  projects requires reopening them, which the engine refuses by default.
- The legacy compatibility profile layer is included only as far as needed for
  engine imports. Historical profiles and migration fixtures are not packaged.
- A packaged app's engine loadLegacyConfig dynamic path is not bundled; this
  method is not exposed through the desktop IPC surface.

## 13. Phase 5 integration requirements

Phase 5 must:

1. verify Qortal name ownership and target collisions remotely before offering
   publication;
2. publish only explicit, approved resources; show the current network fee as a
   live quote, not the Phase 3/4 estimate;
3. convert reserved/prepared mappings to remote_verified only after exact QDN
   read-back of service, name, identifier and content hash;
4. keep identifiers stable for modified content and publish indexes/manifests
   last;
5. treat partial/failed publication as inspectable and retry only explicit
   failed resources;
6. never claim deletion from QDN;
7. keep the GUI distinction between reserved, locally prepared and remotely
   verified content;
8. preserve the secure IPC and credential boundaries: no wallet seed, private
   key or wallet password is ever requested by the desktop app.

## 14. Conclusion

Phase 4 delivers a functional, security-reviewed Linux desktop prototype that
prepares migrations locally and packages the real engine without external
runtime dependencies. It fixes the reserved-versus-published lifecycle defect and
adds regression coverage for interruption, reopening and repeated planning. The
remaining unverified areas are explicitly listed above; none of them is claimed
as complete.
