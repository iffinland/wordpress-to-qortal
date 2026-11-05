# Qortal Migration Studio 0.8.0 alpha

<!-- qms-release-version: 0.8.0-alpha.4 -->

## 0.8.0 alpha.4 — current

This is an unsigned alpha prerelease. It supersedes `v0.8.0-alpha.3` and fixes a
packaging defect that made the installed desktop application abort at startup.

### What was broken in 0.8.0-alpha.3

The .deb installed correctly, but starting the application produced:

~~~text
QMS_STARTUP_FAILED: Engine host connection closed.
~~~

Running the packaged engine directly showed the real cause:

~~~text
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'fflate' imported from
/opt/qortal-migration-studio/resources/engine/lib/engine/publication/index.js
~~~

`desktop/engine-package/package.json` is the locked production dependency set
copied into `/opt/qortal-migration-studio/resources/engine`. It declared only
`cheerio` and `dotenv`. The engine entry imports
`lib/engine/publication/index.js`, which imports `fflate` at module load, so the
host process exited before it could answer the first JSON-RPC request. The
engine also dynamically imports `src/config.js`; that file was not staged, so
`compat.loadLegacyConfig()` would have failed as well.

### What changed

- `fflate` 0.8.3 is a declared and lockfile-pinned engine runtime dependency.
- `src/config.js` is staged into the engine runtime.
- `prepare-engine` now resolves the complete import graph from
  `bin/qms-host.js` against an isolated copy of the staged tree. A missing
  relative module or package fails the build with the importing file and line.
- `release:prepare` extracts the built .deb and performs a real `engine.info`
  JSON-RPC handshake with the packaged engine. It also hides `fflate` in a
  throwaway extraction and asserts that the handshake then fails with
  `ERR_MODULE_NOT_FOUND`, proving the gate detects this class of bug.
- The three-artifact gate refuses to publish without both evidence files matching
  the .deb SHA-256.

No application logic, wallet, signing, broker or QDN behavior changed. Users do
not need Node.js, npm, Git or any post-install command.

### Components

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.4 | `qortal-migration-studio_0.8.0-alpha.4_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.3 | `qortal-migration-generic-cms-v0.8.0-alpha.3.zip` |

The Publisher and Generic CMS sources did not change. Their artifacts are
byte-identical to the previous release; only the desktop package version moves.

### Upgrade an existing installation

~~~bash
sudo apt install ./qortal-migration-studio_0.8.0-alpha.4_amd64.deb
~~~

Then start the application again:

~~~bash
qortal-migration-studio
~~~

Confirm the installed version:

~~~bash
dpkg-query -W -f='${Version}\n' qortal-migration-studio
# expected: 0.8.0~alpha.4
~~~

An installed alpha.3 package may be replaced directly. Projects, media, handoffs
and history under `~/.local/share/qortal-migration-studio` are preserved.

### Verification

The release gate records `desktop/release/engine-clean-install.json` (packaged
engine started from the extracted .deb and answered `engine.info` with
`apiVersion=qms-engine@1`) and `desktop/release/engine-clean-install-negative.json`
(the same test fails when `fflate` is hidden). `release/release-manifest.json`
records both artifacts and their SHA-256 values.

## 0.8.0 alpha.3 — previous

The 0.8.0-alpha.3 release fixed a live Generic CMS owner Admin regression in
Qortal Hub on Android. Its desktop .deb is affected by the engine dependency
defect above; use 0.8.0-alpha.4 instead.

The CMS now reads the on-chain name record from the node that serves the page.
A build-time `http://localhost:12391` default made Android devices query their
own loopback, fail the ownership check and hide Admin from the real owner. The
CMS also adds **Connect owner account** and **Retry verification** recovery
actions. They re-run the complete fail-closed check; they never grant owner mode
themselves.

The component versions in that release were desktop 0.8.0-alpha.3, Publisher
0.8.0-alpha.2 and CMS 0.8.0-alpha.3.

## Registry publication status

The update registry document is regenerated for this release but is intentionally
**not** published by this GitHub release. Publishing it requires a separate
owner-approved QDN transaction. Until that transaction is approved, the
applications report that updates cannot be checked and continue to work normally.
See `docs/migration-studio/UPDATE-REGISTRY.md`.

## Install

### Desktop (Debian 12/13, MX Linux 23)

```bash
sha256sum qortal-migration-studio_0.8.0-alpha.4_amd64.deb
sudo apt install ./qortal-migration-studio_0.8.0-alpha.4_amd64.deb
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
- Engine dependency completeness is verified on the build host from an extracted
  .deb. The gate does not install the .deb into a full graphical MX Linux
  desktop session; the isolated Debian rootfs install test remains separate.

## Verification

All artifacts are covered by `SHA256SUMS`; the SBOM and provenance files record
the shipped components and the source commit. Release publication downloads every
asset without authentication and rechecks its exact size and SHA-256.
