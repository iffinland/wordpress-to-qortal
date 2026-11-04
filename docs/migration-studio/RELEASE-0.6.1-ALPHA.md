# Qortal Migration Studio 0.6.1 alpha — publisher integration

<!-- qms-release-version: 0.6.1 -->

| Field | Value |
| --- | --- |
| Product | Qortal Migration Studio |
| Version | 0.6.1 |
| Channel | alpha |
| Tag target | v0.6.1-alpha.1 |
| Signing | unsigned |
| Architecture | amd64 |

## Delivered

- Standalone **Migration Publisher Q-App** build (`viewer/dist-publisher`) with
  no profile, preview engine or hardcoded identity. Validated root-layout ZIP at
  `release/qortal-migration-publisher-v0.6.1.zip` (SHA-256
  `6a6ec8f17abf21a4ea14a054acb95a9d1b164975380da7c8a2411afa2e1fcedd`).
- **Single-file Publisher package**: the desktop exports one
  `<handoffId>-publisher.zip`; the Publisher accepts that ZIP or the folder.
- **Generic CMS as an application bundle**: a project that selects the default Generic
  CMS packages the already-built CMS with a generated
  `qms-cms-config.json`. The Publisher submits it as a multi-file APP or WEBSITE resource
  after the manifest and verifies every member through
  `?filepath=...&encoding=base64`.
- **Desktop integration**: wizard CMS/tagline/accent settings, ZIP export,
  receipt import, independent exact read-back for DOCUMENT/IMAGE/APP/WEBSITE, and an
  “Open published website” action after exact verification.
- **Live fee quote** in the Publisher using the node's
  `/transactions/unitfee?txType=ARBITRARY`, clearly separate from Hub's
  authoritative approval.
- Deterministic end-to-end tests from WordPress fixtures through handoff,
  receipt, simulated QDN read-back, CMS catalog loading and media URL rewriting.

## Acceptance status

| Gate | Result |
| --- | --- |
| Root test suite | 423/423 pass |
| Phase 5 / 5.1 / 5.2 | pass |
| Phase 6 CMS tests and build | pass, 20/20 template tests |
| Phase 7 / 8 / 9 | pass |
| Publisher build + bundle validation | pass |
| Desktop typecheck + tests | pass, 44/44 |
| Real .deb packaging | `qortal-migration-studio_0.6.1_amd64.deb`, 108,157,438 bytes, SHA-256 `525a9f1a7ed097e6c41a45b871aa649212e54d1ed21a13282c3b4793ab3f62b9` |
| Live mixed-service Hub publication | **NOT PERFORMED — external authorization blocker** |
| Publisher Q-App public deployment | **NOT PERFORMED — owner wallet/QDN approval required** |

The mixed-service live gate is blocked because the only authorized signing
infrastructure is the development broker, which allows `DOCUMENT` only on
`developer iffi`. It cannot be used for IMAGE or APP publication. No claim of a
complete live workflow is made.

## Known limitations

- The generic CMS application bundle is verified against a local exact-read-back simulator and
  the real Core API contract; it has not been published live.
- Qortal Hub's `FETCH_QDN_RESOURCE` filepath support varies by build. The
  Publisher falls back to a same-origin node read for APP members.
- The Publisher Q-App is a build artifact, not a public service address, until
  the owner deploys it.
