# Qortal Migration Studio 0.8.0 alpha

<!-- qms-release-version: 0.8.0-alpha.3 -->

This is an unsigned alpha prerelease. It supersedes `v0.8.0-alpha.2`. It fixes a
live regression that hid Admin from the real owner when the Generic CMS was
opened in Qortal Hub on Android, and it adds an explicit, fail-closed
**Connect owner account** recovery action.

## Components

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.3 | `qortal-migration-studio_0.8.0-alpha.3_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.3 | `qortal-migration-generic-cms-v0.8.0-alpha.3.zip` |

The GitHub release bundle version is independent of these component versions.
The Publisher source did not change in this release, so its version and artifact
bytes stay at 0.8.0-alpha.2. The desktop package is bumped because it bundles
the Generic CMS template; the CMS template itself is bumped for the fix.

## What changed

### Owner can reach Admin again (live regression)

The previous CMS checked the on-chain name record by calling
`<trusted-node>/names/<name>`. The Vite build injected
`VITE_QORTAL_NODE_URL=http://localhost:12391` as the trusted node default, so
every release build ignored the page origin and asked the device's own
loopback address. On a desktop with a local node that happened to work. In
Qortal Hub on Android there is no node on `localhost:12391`, so the name record
read failed, ownership stayed unverified and Admin disappeared for the real
owner.

The fix makes the hosting node origin authoritative in release builds
(`resolveNodeBase` in `src/lib/qortal.js`). The build-time node URL is now an
optional local-development override only, never a release default. Ownership is
still granted only when the live name record names the exact QDN name with the
active account as owner and the account's name list contains that name.

### Explicit recovery action

- The CMS header and the Admin gate now offer **Connect owner account** when the
  bridge is available but no active account was returned. It calls the supported
  `GET_USER_ACCOUNT` bridge action from a user gesture and then re-runs the full
  verification.
- **Retry verification** is offered when the node or name registry is
  unreachable, and the wording distinguishes that from "name not owned".
- A genuinely different owner still gets **Access denied**, never a bypass.
- If the direct node read fails but the bridge is available, ownership can be
  confirmed from the Hub-connected node's `GET_NAME_DATA` record. The same exact
  name and owner-address equality rules apply.
- Every publish and mutation still revalidates the active account and the name
  record immediately before signing.

### Documentation

The Generic CMS README now explains how ownership verification works and what an
owner should do when Admin is missing after an update.

## Registry publication status

The update registry document is regenerated for this release but is intentionally
**not** published by this GitHub release. Publishing it requires a separate
owner-approved QDN transaction. Until that transaction is approved, the
applications report that updates cannot be checked and continue to work normally.
See `docs/migration-studio/UPDATE-REGISTRY.md`.

## Install

### Desktop (Debian 12/13)

```bash
sha256sum qortal-migration-studio_0.8.0-alpha.3_amd64.deb
sudo apt install ./qortal-migration-studio_0.8.0-alpha.3_amd64.deb
```

Verify the hash against the release assets. The package is unsigned.

### Migration Publisher

Download `qortal-migration-publisher-v0.8.0-alpha.2.zip`, verify its SHA-256,
and republish it as an APP under your own Qortal name. Downloading the ZIP is not
publishing it to QDN. The Publisher artifact is unchanged in this release.

### Generic CMS

Download `qortal-migration-generic-cms-v0.8.0-alpha.3.zip`, verify its SHA-256,
and republish the APP or WEBSITE under the site's existing Qortal name. Preserve
`qms-cms-config.json` and any custom assets; do not overwrite a customized CMS
with the generic ZIP. After deployment, open the site in Qortal Hub and use
**Connect owner account** if Admin is still not shown.

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
