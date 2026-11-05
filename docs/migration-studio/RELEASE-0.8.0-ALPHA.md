# Qortal Migration Studio 0.8.0 alpha

<!-- qms-release-version: 0.8.0-alpha.2 -->

This is an unsigned alpha prerelease. It supersedes `v0.8.0-alpha.1`, whose
Debian asset name was normalized by GitHub (`~` became `.`); do not use that
first tag for installation or registry metadata. It adds independent update notifications
for all three QMS applications, backed by one shared QDN update registry.

## Components

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.2 | `qortal-migration-studio_0.8.0-alpha.2_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.2 | `qortal-migration-generic-cms-v0.8.0-alpha.2.zip` |

The GitHub release bundle version is independent of these component versions.
A later release that changes only one component keeps the other component
versions and their published registry records unchanged, so no update badge is
shown for unchanged components.

## What changed

- A versioned public update registry document is published as
  `DOCUMENT/developer iffi/qms-update-registry` with schema
  `qms-update-registry@1`. It contains independent desktop, Publisher and CMS
  records with version, channel, release tag, changelog summary, verified
  artifacts, sizes, SHA-256 values, platforms and install instructions.
- Desktop shows its installed version and checks the registry at startup and on
  demand. It can show the available desktop release, Debian download metadata,
  SHA-256 and manual install steps. It never downloads or executes an installer.
- Migration Publisher shows an update badge only when its own component version
  changed, with a Publisher-specific changelog and deployment steps. Existing
  handoff validation, ownership checks, approval gates and read-back receipts
  are unchanged.
- Generic CMS shows its template version at startup and a compact update badge
  when a newer template release exists. The update view warns against replacing
  a customized CMS with the generic ZIP and never replaces the running
  WEBSITE/APP.
- Update checks are bounded and cached. Missing, malformed, stale or unverified
  registry data never blocks normal app operation and never shows an update
  badge.
- The release pipeline verifies public assets, diffs the registry, and prepares
  a Publisher-compatible handoff only when a registry change is required. The
  owner approves the actual QDN publication in Qortal Hub.

## Registry publication status

The update registry is intentionally **not** published by this GitHub release.
Publishing it requires a separate owner-approved QDN transaction. Until that
transaction is approved, the applications report that updates cannot be checked
and continue to work normally. See `docs/migration-studio/UPDATE-REGISTRY.md`.

## Install

### Desktop (Debian 12/13)

```bash
sha256sum qortal-migration-studio_0.8.0-alpha.2_amd64.deb
sudo apt install ./qortal-migration-studio_0.8.0-alpha.2_amd64.deb
```

Verify the hash against the release assets. The package is unsigned.

### Migration Publisher

Download `qortal-migration-publisher-v0.8.0-alpha.2.zip`, verify its SHA-256,
and republish it as an APP under your own Qortal name. Downloading the ZIP is not
publishing it to QDN.

### Generic CMS

Download `qortal-migration-generic-cms-v0.8.0-alpha.2.zip`, verify its SHA-256,
and republish the APP or WEBSITE under the site's existing Qortal name. Preserve
`qms-cms-config.json` and any custom assets; do not overwrite a customized CMS
with the generic ZIP.

## Known limitations

- The desktop package is unsigned.
- No automatic updater is provided for any component. Every update is a manual,
  owner-approved deployment.
- Qortal Hub may block external HTTPS tabs. The update views always show a
  copyable release URL as the fallback.
- The registry is published only after the owner approves the Publisher handoff.
  A GitHub release alone never advertises an update.

## Verification

All artifacts are covered by `SHA256SUMS`; the SBOM and provenance files record
the shipped components and the source commit. Release publication downloads every
asset without authentication and rechecks its exact size and SHA-256.
