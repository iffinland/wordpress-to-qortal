# QMS 0.8.0-rc.2 — full packaged acceptance (A–J and H)

Date: 2026-11-08
Artifact under test: `qortal-migration-studio_0.8.0-rc.2_amd64.deb`
Size: 108,536,012 bytes
SHA-256: `47a5920d549b1af95d295509a82fa915275a67bb9e924e228259c4168c935e50`
Built from commit: `d3cf22b00f104f7806f9dd2b508e7f26a3f6610d` (tree `4961111959d01fd81d9c21b7ebcb7bf47a908fd0`)
Host: `vmi3490660` (private build/acceptance VPS)
Driver: packaged Electron over CDP under Xvfb, deterministic WordPress, media and QDN fixtures. The app was extracted from the staged .deb with `dpkg-deb -x`; the extracted `resources/app.asar` SHA-256 (`7a95d9986140f310812448f11eb4fc0d8c26216c2c5d9267be8b57d2fcec275e`) is identical to the built `desktop/release/linux-unpacked` payload.

No control was skipped, mocked or relabelled.

| Control | Result | Recorded evidence |
| --- | --- | --- |
| A. Direct Run quick scan indexes exactly three posts with referenced terms/media, one bounded content page | **PASS** | 3 posts, 2 categories, 2 tags, 1 media dependency, 6 API requests, 1 content page, `perPage 3 / maxPages 1 / maxItems 3`, 0 duplicate index keys |
| B. Confirm quick scan and continue produces a valid three-item plan | **PASS** | plan badge `ready`, Selected 3, Scanned 8, one completed discovery run |
| C. Explicit Full inventory completes on a small fixture | **PASS** | mode `full`, posts 3, pages 2, categories 2, tags 2, media 3 |
| D. Pause then Resume completes without duplicate index entries | **PASS** | 1,200 posts indexed, 0 duplicate keys, one completed discovery run |
| E. Cancel stops the run and preserves the project | **PASS** | `source.discover` run recorded `cancelled`, project preserved, cancelled batch not latest |
| F. Interrupted Full checkpoint does not block an independent Quick scan | **PASS** | interrupted-full banner shown after restart, new quick scan indexes 3 posts, paused full run and `full-scan-state.json` preserved |
| G1. Connection failure visible next to the controls | **PASS** | actionable connection error rendered in the Connect-to-WordPress card |
| G2. Invalid source visible next to the controls | **PASS** | invalid-source error rendered in the Connect-to-WordPress card |
| G3. API timeout visible inside the scan controls | **PASS** | `SOURCE_TIMEOUT` / timed-out message inside `[data-testid=source-scan]` |
| G4. Engine failure visible | **PASS** | engine-host failure rendered in the scan panel after the host was killed |
| H. Plan → media → handoff ZIP → Publisher validation → receipt import → read-only verification | **PASS** | 29-resource handoff, identical ZIP bytes after app restart, receipt import `independentVerificationRequired` (did not claim verification), 29/29 resources `remote verified` after exact read-back |
| I. Enter Plan Review from Import preferences performs exactly one `plan.create` and shows no stale error (BUG-005) | **PASS** | planRuns 1, badge `ready`, Selected 3, no `Another plan.create` or planning-failure text |
| J. NASA-shaped short page fills the requested window from one `per_page=100` request | **PASS** | Posts indexed 3, counts.posts 3, scope `perPage 100 / maxItems 3 / scanned 3 / availableTotal 35600 / underReturned false`, exactly one content request |

## Summary

- Functional controls A, B, C, D, E, F, G1–G4, I, J: **12/12 PASS**, 0 failed.
- Handoff H: **PASS** — 29 resources, 29 remote verified, receipt import alone did not claim success.
- Blocking verifier `scripts/release/verify-functional-acceptance-evidence.mjs`: **PASS** (12 controls, 29 resources, 29 remote verified).

## Evidence files

- `docs/migration-studio/evidence/rc2-acceptance-full.json` — machine-readable per-control record.
- `docs/migration-studio/evidence/rc2-full-functional-raw.json` — raw functional harness output.
- `docs/migration-studio/evidence/rc2-full-handoff-raw.json` — raw handoff harness output.
- `release/packaged-functional-acceptance.json` and `release/packaged-handoff-e2e.json` — blocking-gate inputs.

## Limitations

- H uses a synthetic Publisher receipt and the read-only QDN fixture. It does not sign, submit a QORT transaction, publish to QDN or touch a wallet.
- The fixtures are deterministic and local. They do not prove behaviour against a live NASA-scale site.
- Package is unsigned/private preview; no stable release, beta channel, QDN publish or wallet operation was performed.
