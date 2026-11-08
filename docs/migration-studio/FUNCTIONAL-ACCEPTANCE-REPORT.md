# Functional Acceptance Report — Qortal Migration Studio 0.8.0

Date: 2026-11-08
Branch: `chore/e2e-harness-final` (worktree `qms-bounded-discovery`)
Base commit: `d9bdbe0d06d048d2dea5681a35cd1b89b684a2af`
Audited build: private `0.8.0-rc.1` (installed owner build)
Accepted build: fixed source from this branch, packaged as `linux-unpacked` and a new
`.deb` (see the final section).

Method: the packaged Electron app was driven over CDP under Xvfb against deterministic
WordPress fixtures. Assertions read recorded run checkpoints, source index files, plan
statistics, handoff manifests and verification evidence; they do not infer success from a
click or a rendered label alone.

Evidence directory: `docs/migration-studio/evidence/`.

## Result summary

| Control | Method | 0.8.0-rc.1 (before fix) | Fixed build | Evidence |
| --- | --- | --- | --- | --- |
| A. Direct **Run quick scan**, limit 3 | Packaged UI; 3 published posts; assert run state, index keys, dependency counts | **FAIL** — `SOURCE_SCAN_MODE_REQUIRED`, no run, no index | **PASS** — 3 posts, 2 categories, 2 tags, 1 media dependency, 6 API requests, 1 content page, perPage/maxItems 3 | `evidence/packaged-functional-acceptance.json` (controls.A), `evidence/rc1-quick-scan-failure.json` |
| B. **Confirm quick scan and continue** | Packaged UI; confirmation panel → plan review; assert ready plan and selected count | **FAIL** (same root cause; plan never reached) | **PASS** — ready plan, Selected: 3, Scanned: 8 | `evidence/packaged-functional-acceptance.json` (controls.B) |
| C. **Full inventory** on a small fixture | Packaged UI; explicit radio + acknowledgement; assert full mode and counts | **FAIL** (same root cause) | **PASS** — full mode, posts 3, pages 2, media 3 | `evidence/packaged-functional-acceptance.json` (controls.C) |
| D. **Pause → Resume** | Packaged UI; full scan on 1,200-post fixture; pause, resume, assert unique index keys | Not run (scan could not start) | **PASS** — 1,200 posts indexed, 0 duplicate keys | `evidence/packaged-functional-acceptance.json` (controls.D) |
| E. **Cancel** | Packaged UI; full scan, cancel; assert cancelled run and preserved project | Not run (scan could not start) | **PASS** — cancelled discovery run, project preserved, cancelled batch not latest | `evidence/packaged-functional-acceptance.json` (controls.E) |
| F. Restart with interrupted Full checkpoint, then new Quick scan | Packaged UI; reach a content checkpoint, pause, restart the app, run an independent Quick scan | Not run (scan could not start) | **PASS** — banner “Interrupted scan found (full, checkpoint content_page 100/1200)”; new quick run indexes 3 posts; paused full run and checkpoint preserved | `evidence/packaged-functional-acceptance.json` (controls.F) |
| G1. Connection failure | Packaged UI; closed port; assert error next to the connection controls | Not run | **PASS** — `SOURCE_NETWORK_ERROR`, “Could not reach the WordPress site.” inside the step 2 card | `evidence/packaged-functional-acceptance.json` (controls.G1) |
| G2. Invalid source | Packaged UI; HTML-only server | Not run | **PASS** — `SOURCE_INVALID_RESPONSE`, “WordPress returned a non-JSON response.” inside step 2 | `evidence/packaged-functional-acceptance.json` (controls.G2) |
| G3. API timeout | Packaged UI; 1.2 s source timeout with hanging posts endpoint | Not run | **PASS** — `SOURCE_TIMEOUT`, error rendered inside `[data-testid=source-scan]` next to the controls | `evidence/packaged-functional-acceptance.json` (controls.G3) |
| G4. Engine failure | Packaged UI; kill the engine host, then run a scan | Not run | **PASS** — “Source scan failed: Engine host is not running.” rendered in the scan panel | `evidence/packaged-functional-acceptance.json` (controls.G4) |
| H. Plan → media → handoff ZIP → Publisher validation → receipt import → read-only verification | Packaged UI + deterministic media/QDN fixtures; no live signing, no QDN writes | Not run | **PASS** — 29-resource handoff, identical ZIP bytes after recovery, receipt import alone did not claim verification, all resources promoted only after exact read-back | `evidence/packaged-handoff-e2e.json` |

No FAILED control was relabelled as PASS. The rc.1 failures are recorded above as
failures against that build; the PASS column is the fixed build.

Reproduction scope on rc.1: A was driven end-to-end against the packaged rc.1 build.
B, C, D, E and F share the same dropped IPC payload and the same pre-request engine
guard, so they are marked as failing for that build from the identical code path,
not as separate rc.1 runs. The fixed build was driven end-to-end for every control.

### Recorded acceptance details

- **A**: latest batch `bat_kjwhzisk3krcvfxe`, mode `quick`, scope
  `perPage 3 / maxPages 1 / maxItems 3`, counts posts 3, categories 2, tags 2,
  media 1, `apiRequests 6`, `pagesFetched 4`, 0 duplicate index keys.
- **B**: plan review badge `ready`, Selected 3, Scanned 8.
- **C**: latest mode `full`, counts posts 3, pages 2, categories 2, tags 2, media 3.
- **D**: latest mode `full`, counts posts 1200, categories 60, tags 12, media 600,
  0 duplicate index keys after Pause → Resume.
- **E**: a `source.discover` run recorded as `cancelled`; project still exists;
  the cancelled batch is not `latest`.
- **F**: banner
  “Interrupted scan found (full, checkpoint content_page 100/1200)”;
  new quick run indexes 3 posts; the paused Full run remains `paused` and its
  `full-scan-state.json` is preserved.
- **G1**: `SOURCE_NETWORK_ERROR` — “Could not reach the WordPress site.”
- **G2**: `SOURCE_INVALID_RESPONSE` — “WordPress returned a non-JSON response.”
- **G3**: `SOURCE_TIMEOUT` — “WordPress request timed out after 1200 ms.”
  rendered inside `[data-testid=source-scan]`.
- **G4**: “Engine host is not running.” rendered in the scan panel.
- **H**: handoff has 29 resources; ZIP rebuild after restart is byte-identical
  (same SHA-256); receipt import is `independentVerificationRequired`, does not
  claim read-back; after exact read-back 29/29 resources show `remote verified`.

## Root cause of the owner's Quick Scan failure

`desktop/src/shared/validation.ts`, case `IPC.sourceDiscover` (lines 450–460 at
`d9bdbe0`), returned a narrowed payload containing only `projectId`, `adapterId`, `auth`,
`source`, `contentTypes`, `query`, `perPage` and `maxItems`. It silently dropped:

- `mode` (the renderer sent `'quick'` or `'full'`),
- `selection` (the renderer sent `{ perPage: 3, maxPages: 1, maxItems: 3 }`),
- `includeTerms` and `includeAssets`.

`desktop/src/main/ipc.ts` forwarded these fields correctly, but
`validateIpcPayload` runs first and removed them. The engine then received
`mode: undefined` and its fail-closed guard
(`lib/engine/source.js:345-366`) threw `SOURCE_SCAN_MODE_REQUIRED` **before**
`runs.start`, before adapter session creation, before any WordPress request and before
any checkpoint.

Observable consequences on the installed rc.1:

- Quick scan and Full inventory both failed immediately;
- no `source.discover` run was created;
- `artifacts/source/` did not exist (empty `artifacts` directory);
- the error was rendered at the top of the wizard, above a long step 4, so the owner saw
  only a brief state change while looking at the scan controls.

`test/source/bounded-discovery.test.js` passed because it calls the engine directly.
`desktop/tests/renderer/wizard.spec.tsx` passed because it mocks `window.qms`. The missing
layer was the shared IPC allowlist between them; no test covered the actual
`source.discover` IPC payload.

## Fixes

1. `desktop/src/shared/validation.ts`
   - preserve and validate `mode` (`quick|full`); an absent mode stays absent so the engine
     remains fail-closed;
   - preserve a bounded `selection` (`include/postIds/ids`, `slug/slugs`, `perPage`,
     `maxPages`, `maxItems`, `contentTypes`) with integer/array bounds;
   - preserve `includeTerms`, `includeAssets` and `progressEvery`.
2. `desktop/src/renderer/components/Wizard.tsx`
   - add `scanError` and render it inside the `source-scan` card, in addition to the
     wizard-level alert;
   - include the engine error code in the message and clear it on a completed scan.
3. Tests
   - `desktop/tests/validation.spec.ts`: BUG-004 regression on the exact discover payload
     and on invalid mode/selection values;
   - `desktop/tests/renderer/wizard.spec.tsx`: regression that a failed scan is visible
     inside the source-scan card;
   - `scripts/release/packaged-handoff-e2e.mjs`: the seed discovery now passes
     `mode: 'full'` (the fail-closed guard made the old call invalid);
   - new `scripts/release/packaged-functional-acceptance.mjs` (A–G);
   - new `scripts/release/verify-functional-acceptance-evidence.mjs`, wired into
     `release:prepare` and documented in `RELEASE-WORKFLOW.md`.
4. Packaging
   - the fixed `.deb` is rebuilt from this branch (see below).

## Audited controls with defects

| Control / path | Defect found | Status |
| --- | --- | --- |
| Wizard step 4 → **Run quick scan** | IPC allowlist dropped `mode`/`selection`; engine rejected every scan | Fixed; A PASS |
| Wizard step 4 → **Confirm quick scan and continue** | Same payload, so the plan could never be reached | Fixed; B PASS |
| Wizard step 4 → **Run full inventory** | Same payload, so Full inventory could not start | Fixed; C PASS |
| Wizard step 4 → error visibility | Failure only above the stepper, not next to the controls | Fixed; G3/G4 assert locality |
| Packaged handoff E2E seed | Called `source.discover({perPage:100})` without the now-required mode, so the H gate crashed before launching the app | Fixed; H PASS |
| Release gate | Only the bounded-scan evidence was blocking; renderer-mocked tests could not catch an IPC allowlist defect | Functional A–H evidence is now a blocking gate |

## Remaining limitations

- H uses a synthetic Publisher receipt and the read-only QDN fixture. It does not sign,
  submit a QORT transaction, publish to QDN or touch a wallet.
- The acceptance fixture is deterministic and local; it does not prove behaviour against
  a live NASA-scale site. The bounded request budget and the full-inventory counts are
  asserted on fixtures designed for those paths.
- D and F pause at the first safe boundary; the tests assert index uniqueness and
  checkpoint preservation, not every possible interleaving of pause with an in-flight
  HTTP request.
- Sync, cleanup, diagnostics and update controls were audited statically and have
  renderer/engine tests, but were not all re-driven in this packaged acceptance run
  (the task's A–H scope is the essential migration workflow).

## Mandatory validations

Run on the build VPS with Node v24.22.2 after the code changes. The engine suite was
run from `test/**/*.test.js`; desktop and CMS suites were run with their normal npm
scripts; the security gate wrote `qms-security-report@1` with verdict `pass`.

| Gate | Result |
| --- | --- |
| Engine suite (Node 24) | **PASS** — 499 tests, 499 pass, 0 fail (Node v24.22.2; 161 s) |
| Desktop typecheck | **PASS** — both `tsconfig.json` and `tsconfig.node.json`, 0 errors |
| Desktop tests | **PASS** — 20 files, 84 tests, 84 pass (includes the two BUG-004 regressions) |
| CMS tests | **PASS** — 21 files, 203 tests, 203 pass |
| Security gate | **PASS** — verdict pass; 0 high/critical production vulnerabilities; 0 secret findings; 0 forbidden filenames |
| Packaged functional A–G evidence verifier | **PASS** — 10 controls, all PASS |
| Packaged handoff H evidence verifier | **PASS** — 29 resources, 29 remote verified |
| `.deb` build | pending (see the final artifact section) |
