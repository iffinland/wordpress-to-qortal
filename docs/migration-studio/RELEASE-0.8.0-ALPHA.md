# Qortal Migration Studio 0.8.0 alpha

<!-- qms-release-version: 0.8.0-alpha.5 -->

## 0.8.0 alpha.5 — current

This is an unsigned alpha prerelease. It supersedes `v0.8.0-alpha.4` and fixes
two blocking defects found in the first real graphical test on MX Linux, plus
the date-filter, capability-rendering and destination-safety defects that
surfaced with them.

### What was broken

1. **Wizard state validation blocked every save.** The renderer persisted
   `completedSteps` as numeric indexes, while desktop IPC validation required
   strings. The wizard showed a permanent red banner:
   `wizard.completedSteps[0] must be a string.`
2. **The wizard never ran source discovery.** It tested the WordPress
   connection, then called `plan.create` against an empty index. Planning failed
   with `SOURCE_DISCOVERY_REQUIRED` and the UI reduced it to "The plan did not
   become ready".
3. **Date filters could silently exclude everything.** The `before` date was
   serialized as the start of the selected day, so the whole final day was
   outside the range. Nothing explained an empty result.
4. **Unsupported capabilities rendered as `[object Object]`.** The connection
   report's `unsupported` array was iterated as an object.
5. **Empty plans could be approved**, advancing the wizard with zero selected
   items.

### What changed

- **Canonical step ids with a real migration.** `completedSteps` now stores
  `source | connection | destination | preferences | plan`. Existing numeric
  arrays (and mixed arrays) are mapped on load, deduplicated, sorted and saved
  once as `wizardVersion: 2`. The migration is idempotent and preserves every
  setting. Existing projects do not need to be deleted or recreated.
- **The wizard discovers the source.** Step 4 has an explicit scan action and
  Continue/Plan preview runs discovery automatically when no completed batch
  exists. Progress is streamed from engine events.
- **Plan failures are visible.** The UI shows the engine error code, message and
  technical details, and disables approval when no ready, non-empty plan exists.
- **Empty plans explain themselves.** The engine records per-filter exclusion
  counts and the UI shows the applied range plus how many items were excluded
  by content type, missing dates or the lower/upper published bound.
- **Date ranges are inclusive and explicit.** `before` is stored as
  `23:59:59.999Z`; the applied range is displayed in UTC. Legacy midnight end
  dates are migrated once to the end of that day.
- **Media sizes recover from HEAD-unsupported servers.** When HEAD is rejected
  or omits `Content-Length`, media estimation sends a one-byte ranged GET and
  reads the total from `Content-Range`. Unknown sizes remain explicitly
  unknown; they are never treated as zero.
- **Capabilities are readable.** Unsupported features render as names,
  descriptions and counts; no renderer path stringifies a capability object.
- **APP vs WEBSITE safety.** The destination step explains that APP and WEBSITE
  are separate deployments under one name, that switching service creates a
  second deployment, and that QMS never overwrites a different identifier. The
  Publishing view repeats the warning before preparing a handoff.
- **Packaged-engine vertical proof.** `release:engine-wizard` extracts the
  built .deb and drives `project.create → source.discover → plan.create` over
  the same stdio JSON-RPC surface the desktop uses.

No signing, wallet, broker or QDN transaction behavior changed. Nothing is
published to QDN by this release.

### Components

| Component | Version | Artifact |
| --- | --- | --- |
| Desktop (Linux amd64) | 0.8.0-alpha.5 | `qortal-migration-studio_0.8.0-alpha.5_amd64.deb` |
| Migration Publisher (Q-App) | 0.8.0-alpha.2 | `qortal-migration-publisher-v0.8.0-alpha.2.zip` |
| Generic CMS (Q-App) | 0.8.0-alpha.3 | `qortal-migration-generic-cms-v0.8.0-alpha.3.zip` |

The Publisher and Generic CMS sources did not change. Their artifacts are
byte-identical to the previous release; only the desktop package version moves.

### Upgrade an existing installation

~~~bash
sudo apt install ./qortal-migration-studio_0.8.0-alpha.5_amd64.deb
~~~

Open the existing project normally. QMS migrates the wizard record on load; do
not delete the project or its workspace. Projects, media, handoffs and history
under `~/.local/share/qortal-migration-studio` are preserved.

Confirm the installed version:

~~~bash
dpkg-query -W -f='${Version}\n' qortal-migration-studio
# expected: 0.8.0~alpha.5
~~~

## 0.8.0 alpha.4 — previous

The 0.8.0-alpha.3 release fixed a live Generic CMS owner Admin regression in
Qortal Hub on Android. Its desktop .deb is affected by the engine dependency
defect above; use 0.8.0-alpha.5 instead.

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
sha256sum qortal-migration-studio_0.8.0-alpha.5_amd64.deb
sudo apt install ./qortal-migration-studio_0.8.0-alpha.5_amd64.deb
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
