# Validation record — 0.6.1 alpha candidate

Date: 2026-11-04. Product: Qortal Migration Studio 0.6.1 (alpha candidate,
unsigned, amd64).

## Automated gates

| Gate | Result |
| --- | --- |
| Root `node --test` suite | 421/421 pass |
| Desktop `tsc` typecheck | pass |
| Desktop Vitest | 44/44 pass |
| Generic CMS Vitest | 20/20 pass |
| Phase 5 publisher/handoff/receipt tests | pass (includes new site, ZIP and E2E tests) |
| Phase 6 manifest/render/sanitize/bundle gates | pass |
| Phase 7 incremental sync | pass |
| Phase 8 recovery/cleanup/history | pass |
| Phase 9 release tests + version check | pass |
| `npm run check` (tests + migration/CMS/Corbett builds) | pass |
| Publisher build + bundle validation | pass, 3 files, 199,458 bytes |
| Publisher ZIP package | `release/qortal-migration-publisher-v0.6.1.zip`, 68,054 bytes |
| Publisher ZIP SHA-256 | `d77da07b73f975d6a51f69c03d1418702d8cd7bb0e5be2400bdaa48dc760c8b2` |
| Debian package | `qortal-migration-studio_0.6.1_amd64.deb`, 108,157,146 bytes |
| Debian package SHA-256 | `8fc9226c16c7b4697c1f1d1b07ece2984a218e39ac348ba0b758ccb850c8c050` |
| Debian source commit | `e926c1147ee5e0f875470c9965fd35d087977765` |

New deterministic tests:

- `test/phase5/site.test.js` — CMS APP bundle, deterministic ZIP, config
  contents, tamper rejection, single-file export, per-member read-back.
- `test/phase5/publisher-qapp.test.js` — browser validator accepts the exported
  ZIP and rejects a tampered CMS bundle.
- `test/phase5/e2e-pipeline.test.js` — WordPress fixture → media download →
  handoff validation → receipt import → simulated Core read-back → CMS dataset
  and media URL rewriting.
- `templates/generic-cms/tests/render.test.tsx` — runtime title, tagline,
  navigation and accent theme render.

## Live network attempt (DOCUMENT-only scope)

The only authorized signing path is the development broker on the signing VPS.

- Request: one 78-byte `text/plain` DOCUMENT, identifier
  `qms-dev-v061-d0d09a048140`, SHA-256
  `f0002a5805f218b743ff1401814ff815cb2607a6ba578936ecc39df7133c5ecd`.
- Broker publication: `pub_8fa33c351daa788567385b9f`.
- Result: `SIGNING_FAILED` / `SIGNING_REJECTED` with
  `WALLET_LOCKED` (HTTP 403). No transaction, signature or QDN resource was
  created; `chargedAtomic` and `reservedAtomic` are 0.
- Meaning: the signing wallet on the operator host is locked. Unlocking it
  requires the operator's password and is outside this agent's authority.

This is a real signing-path check, not a mock. It does not prove mixed-service
or Hub publication.

## Not performed (external authorization blockers)

1. Live IMAGE or APP publication. The broker policy allows only DOCUMENT on the
   exact `developer iffi` name.
2. Qortal Hub wallet approval and the ordinary user's Publisher flow. No Hub
   wallet session exists on this host.
3. Public deployment of the Migration Publisher Q-App. Requires the owner's
   registered name and wallet-approved APP transaction.
4. Public Generic CMS display on a live gateway. Requires an APP publication
   first.

## Evidence boundaries

- Hub response handling is tested against the documented
  `PUBLISH_MULTIPLE_QDN_RESOURCES` contract and simulated responses.
- APP read-back is tested against an HTTP fixture that implements Core's
  `?filepath=...&encoding=base64` responses and against per-member hashes.
- A simulated Core is not a live Qortal network read.
