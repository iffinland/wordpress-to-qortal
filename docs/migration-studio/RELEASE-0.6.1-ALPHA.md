# Qortal Migration Studio 0.6.1 alpha — publisher integration

<!-- qms-release-version: 0.6.1 -->

| Field | Value |
| --- | --- |
| Product | Qortal Migration Studio |
| Version | 0.6.1 |
| Channel | alpha |
| Tag target | v0.6.1-alpha.2 |
| Publisher UI version | 0.6.1-alpha.2 |
| Signing | unsigned |
| Architecture | amd64 |
| Release status | published GitHub prerelease |
| Release URL | https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.6.1-alpha.2 |

## Downloads

- [Qortal Migration Studio 0.6.1 .deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.2/qortal-migration-studio_0.6.1_amd64.deb)
- [Migration Publisher Q-App ZIP](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.2/qortal-migration-publisher-v0.6.1.zip)
- [Generic CMS Q-App ZIP](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.2/qortal-migration-generic-cms-v0.6.1.zip)

The beginner path needs no development tools. Downloading a ZIP is not
deployment: the Publisher and Generic CMS become live QDN applications only
after an owner publishes them with wallet approval. The Generic CMS can be
published as either an APP or a WEBSITE where the verified package and current
application flow support that service.

## Delivered

- Standalone **Migration Publisher Q-App** build (`viewer/dist-publisher`) with
  no profile, preview engine or hardcoded identity. Validated root-layout ZIP
  `qortal-migration-publisher-v0.6.1.zip`.
- Standalone **Generic CMS Q-App** build (`templates/generic-cms/dist`) as a
  root-layout ZIP `qortal-migration-generic-cms-v0.6.1.zip`, using a neutral
  configuration with no hardcoded user QDN name.
- **Mandatory three-artifact release gate**: `npm run release:prepare` builds
  and validates the .deb and both Q-App ZIPs, writes
  `release/release-manifest.json` and `release/SHA256SUMS`, and fails if any
  artifact is missing, invalid, version-incompatible or omitted from checksums.
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
- **Publisher target-name fix**: no premature "target name required" warning;
  editable field prefilled from the handoff, single-owned-name preselection and
  a picker for multiple names. A loaded package stays bound to its handoff name.
- **Generic CMS Admin reachability**: Admin in the default navigation, rendering
  before catalog gating with explicit preconditions, plus runtime injection for
  an already published `qms-cms-config.json`.
- **Live DOCUMENT publication proof**: a package published through the deployed
  development Migration Publisher; `DOCUMENT/developer iffi/qms-cms-manifest`
  read back with the exact expected SHA-256; CMS content rendered only under the
  correct Qortal name.

## Acceptance status

| Gate | Result |
| --- | --- |
| Root test suite | 431/431 pass (includes 8 three-artifact gate tests) |
| Phase 5 / 5.1 / 5.2 | pass |
| Phase 6 CMS tests and build | pass, 20/20 template tests |
| Phase 7 / 8 / 9 | pass |
| Publisher build + bundle validation | pass |
| Desktop typecheck + tests | pass, 44/44 |
| Three-artifact gate | pass: .deb + Publisher ZIP + Generic CMS ZIP, root layout, versions, SHA256SUMS |
| Real .deb packaging | `qortal-migration-studio_0.6.1_amd64.deb`; size and SHA-256 are recorded in this release's `SHA256SUMS` and `release-manifest.json` |
| Live DOCUMENT publication | **PASS** — deployed development Publisher; catalog manifest exact SHA-256 read-back |
| Generic CMS live rendering | **PASS for the DOCUMENT catalog** — renders only under the correct Qortal name |
| Live mixed-service Hub publication | **NOT PERFORMED — IMAGE/APP authorization blocker** |
| General public Publisher deployment | **NOT PERFORMED — owner wallet/QDN approval required** |

The DOCUMENT proof used the authorized development scope: the deployed
Publisher under `developer iffi` published the package, and
`DOCUMENT/developer iffi/qms-cms-manifest` read back with the exact expected
SHA-256. The same scope cannot publish IMAGE or APP/WEBSITE resources, so the
full mixed-service flow and a general public Publisher deployment remain
unverified. No claim of a complete live workflow is made.

## Known limitations

- The generic CMS application bundle is verified against a local exact-read-back
  simulator and the real Core API contract; it has not been published live as
  APP or WEBSITE. Its catalog rendering was proven live with DOCUMENT resources.
- The CMS must be opened with its exact Qortal name in the URL
  (`qortal://WEBSITE/developer%20iffi/` or `?name=developer%20iffi`).
- Qortal Hub's `FETCH_QDN_RESOURCE` filepath support varies by build. The
  Publisher falls back to a same-origin node read for APP members.
- The Publisher Q-App has a live development deployment. A general shared
  public deployment remains an owner wallet/QDN action.
- Redeploying a CMS bundle without its existing `qms-cms-config.json` loses the
  site-specific configuration. Preserve that file.
