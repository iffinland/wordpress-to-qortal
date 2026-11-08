# QMS Update Registry and Independent Update Checks

This document defines the shared QDN update registry, the independent version
model, the release handoff, and the update behavior of the three QMS
applications.

## QDN identity

| Field | Value |
| --- | --- |
| Service | `DOCUMENT` |
| Name | `developer iffi` |
| Identifier | `qms-update-registry` |
| Schema | `qms-update-registry@1` |
| Resource | `DOCUMENT/developer iffi/qms-update-registry` |

The registry is public, read-only data. It contains no keys, credentials,
wallet data or Qortal ownership claim. Applications pin the service, name,
identifier and schema before trusting any field.

Read-only node URL used by tooling:

```
http://100.116.185.83:12391/arbitrary/DOCUMENT/developer%20iffi/qms-update-registry
```

## Independent version model

| Version | Source | Meaning |
| --- | --- | --- |
| Bundle version | `qms-release.json` `version` + `releaseTag` | GitHub release identity and release notes |
| Desktop version | `desktop/package.json`, engine package, `ENGINE_VERSION` | Installed desktop app / bundled engine |
| Publisher version | `viewer/package.json` (build-time `__PUBLISHER_VERSION__`) | Migration Publisher Q-App |
| CMS version | `templates/generic-cms/package.json` (build-time `__CMS_TEMPLATE_VERSION__`) | Generic CMS template |

A component version carries its channel as a SemVer prerelease:
`0.8.0-alpha.2`, `0.8.0-beta.1`, `0.8.0-rc.1` or `0.8.0` (stable).
`npm run version:check` verifies each marker against its own component, not a
single global value. `npm run version:sync` writes component versions from
`qms-release.json`.

To change one component without moving the others:

```bash
node scripts/qms-release.mjs set-component --component=cms --version=0.8.1-alpha.1
node scripts/qms-release.mjs set-bundle --version=0.9.0-alpha.1
```

The three-artifact release gate still requires a .deb, a Publisher ZIP and a CMS
ZIP in every GitHub release. An unchanged component keeps its existing version,
artifact name, SHA-256 and registry record. Rebuilding it produces the same
bytes; if its bytes differ without a version bump, `release:registry` fails.

## Registry schema

```json
{
  "schema": "qms-update-registry@1",
  "registry": {
    "service": "DOCUMENT",
    "name": "developer iffi",
    "identifier": "qms-update-registry"
  },
  "product": "Qortal Migration Studio",
  "generatedAt": "2026-11-05T05:25:00.000Z",
  "sequence": 1,
  "components": {
    "desktop": {
      "id": "desktop",
      "displayName": "Qortal Migration Studio (Desktop)",
      "version": "0.8.0-alpha.2",
      "channel": "alpha",
      "releaseTag": "v0.8.0-alpha.2",
      "releaseDate": "2026-11-05T05:25:00.000Z",
      "releaseUrl": "https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.8.0-alpha.2",
      "changelog": { "summary": "…", "url": "https://github.com/…" },
      "supportedPlatforms": ["linux-x64"],
      "minimumDependencies": {},
      "install": { "kind": "debian-package", "instructions": "…" },
      "artifacts": [
        {
          "platform": "linux-x64",
          "format": "deb",
          "name": "qortal-migration-studio_0.8.0-alpha.2_amd64.deb",
          "bytes": 123456789,
          "sha256": "64 lowercase hex characters",
          "url": "https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-alpha.5/…"
        }
      ]
    },
    "publisher": { "…": "same shape, platform qortal-hub, format zip" },
    "cms": { "…": "same shape, platform qortal-hub, format zip" }
  }
}
```

Rules enforced by `lib/update/registry.js`:

- exact `registry` identity and exact `qms-update-registry@1` schema;
- exactly the `desktop`, `publisher` and `cms` components;
- component `version` is SemVer and `channel` matches its prerelease;
- `releaseTag` is a real tag; artifact URLs must be
  `https://github.com/iffinland/wordpress-to-qortal/releases/download/<tag>/<name>`;
- artifact name, format, positive size and lowercase SHA-256 are validated;
- one artifact per platform per component;
- summary and install instructions are bounded, unknown fields are rejected;
- `sequence` is a positive integer and must increase on a changed registry.

Schema migration is explicit. `qms-update-registry@0` (single-global-version
draft) is migrated to `@1`; a newer unknown schema is rejected and treated as
unverified, never guessed.

## Update decision

`assessUpdate()` returns one of:

| State | Meaning | Badge |
| --- | --- | --- |
| `up_to_date` | Installed version is equal or newer | no |
| `update_available` | Newer compatible version with a verified artifact | yes |
| `incompatible` | Newer version but lower channel or unmet dependency | no |
| `unverified` | Missing/invalid component, artifact or registry | no |
| `unable_to_check` | Network/registry unavailable and no usable cache | no |
| `checking` | Request in progress | no |

SemVer comparison is numeric and prerelease-aware:
`alpha < beta < rc < stable`, `alpha.2 < alpha.10`, and build metadata is
ignored. A stable installation is never offered a prerelease; a beta
installation is never offered an alpha release. An installed version newer than
the registry is reported `up_to_date`, never as a downgrade.

Checks are bounded: 8–10 second timeout, at most two retries, 15–30 minute
in-memory cache, and manual refresh. No background polling. Cached data older
than the freshness window never shows a badge and is explained as cached.

## Release pipeline

After `npm run release:publish -- --tag=v0.8.0-alpha.2` succeeds:

```bash
npm run release:registry -- --tag=v0.8.0-alpha.2 \
  --node-url=http://100.116.185.83:12391
```

The command:

1. reads the gate-approved `release/release-manifest.json` and refuses an
   incomplete release;
2. downloads every artifact from its public GitHub URL and verifies exact byte
   length and SHA-256;
3. reads the currently published registry (or accepts
   `--registry-file=<path>` for an offline preflight);
4. validates the current document; a malformed existing resource is never
   overwritten without `--replace-invalid`;
5. changes only components whose version increased, keeps unchanged component
   records byte-identical, rejects downgrades and same-version hash changes;
6. canonicalizes the document, writes `release/qms-update-registry.json` and
   `release/registry-diff.json`;
7. if nothing changed or the published bytes already match, writes
   `release/registry-publication.json` with `changeRequired: false` and creates
   no handoff;
8. otherwise reads the ARBITRARY unit fee, builds a single-resource
   Publisher-compatible handoff, validates it with the engine's handoff
   validator, and writes
   `release/qms-update-registry-handoff.zip` plus
   `release/registry-publication.json`.

Idempotency is byte-based: rerunning the same release commit produces the same
canonical registry, the same handoff IDs and the same ZIP hash. A repeated
submission is therefore detectable and produces no new handoff once the node
serves the same bytes.

A git push never advertises an update. Only a successfully published GitHub
release with verified assets can enter the generated registry, and the registry
itself only becomes visible after the owner approves its QDN publication.

## Owner publication procedure

The automation never signs, publishes or stores keys. The handoff is imported
and approved manually:

1. Download `release/qms-update-registry-handoff.zip`; verify the SHA-256 in
   `release/registry-publication.json`.
2. Open Qortal Hub and the Migration Publisher Q-App.
3. Select the handoff ZIP. Confirm target name `developer iffi`, one resource:
   `DOCUMENT/developer iffi/qms-update-registry`.
4. Review the payload SHA-256 and the fee shown by Hub. The report records the
   read-only unit fee (currently 0.01 QORT per ARBITRARY resource) and the
   collision status. Hub's approval dialog is authoritative for the final fee.
5. Approve with the owner account that controls `developer iffi`.
6. Wait for the Publisher receipt and exact read-back, then verify:

```bash
npm run release:registry:verify -- --node-url=http://100.116.185.83:12391
```

The verification compares the published bytes with
`release/qms-update-registry.json` and writes
`release/registry-verification.json`. A submitted transaction alone is not a
success; only exact bytes count.

If publication is uncertain, do not resubmit blindly. Read the resource again;
if it is absent, re-import the same handoff (identical payload hash). If the
node serves different bytes, stop and investigate before replacing anything.

## Hub compatibility and manual update path

- Q-Apps read the registry with `FETCH_QDN_RESOURCE` through the supported
  `qortalRequest` bridge. Development builds fall back to the same-origin
  `/arbitrary/...` path; Q-Apps never depend on navigating to external HTTPS.
- Opening a Qortal QDN page uses `OPEN_NEW_TAB` with a `qortalLink`.
- Qortal Hub may block an external HTTPS release page in a sandboxed Q-App.
  Every update view therefore shows the full release URL in a read-only field
  and a Copy link action that also works without the Clipboard API.
- Q-Apps cannot install a Q-App ZIP or a Debian package. The reliable manual
  path is: copy/open the release URL in the system browser, download the asset,
  verify SHA-256, then publish the Q-App ZIP in Hub or install the .deb on the
  desktop. The running WEBSITE/APP is never auto-replaced.
- Android and desktop Hub both support the same bridge; the copy-and-paste
  fallback is the common denominator when a file picker or external tab is
  restricted.

## CMS customization warning

The Generic CMS template is shared by many sites. A runtime
`qms-cms-config.json` and any owner-authored settings/assets are site data, not
template files. The CMS update view detects a runtime config or published
settings and warns explicitly: do not overwrite a customized CMS with the
generic ZIP. Republish template files only, preserving site configuration and
custom assets.

## Current pending publication (2026-11-08)

- Resource: `DOCUMENT/developer iffi/qms-update-registry`
- Remote status: HTTP 200, sequence 2 already published (existing SHA-256
  `3a1ef98174d6b55fedcbe47cd079593c7422dd732ccdb0ffac6814c4c32dfe44`).
- Next document: sequence 3, generated from release `v0.8.0-alpha.10`.
- Components: desktop 0.8.0-alpha.10, CMS 0.8.0-alpha.8, Publisher
  0.8.0-alpha.2 (unchanged; the registry keeps its original verified URL).
- Handoff ZIP: `release/qms-update-registry-handoff.zip` (not committed),
  2,663 bytes, SHA-256
  `421678ab2955c381b63a588102e8b84db1d7469a29d7b78481a1e0c0b6fcadf9`.
- Payload: `release/registry-handoff/payload/document/qms-update-registry.json`,
  4,748 bytes, SHA-256
  `e10bf453aa773d48b3e8dd032aaa45a0cd3e0e23788a4be11b87640a0edbdc4d`.
- One DOCUMENT resource; estimated fee 0.01 QORT at the read-only node unit fee.
- Status: **awaiting owner approval in Qortal Hub**. Nothing was signed or
  published by the agent.

## Failure handling

| Failure | Behavior |
| --- | --- |
| Registry 404 | `unable_to_check`; no badge; apps work normally |
| Malformed JSON/schema | `unverified`; no badge; diagnostic reason shown |
| Invalid hash/URL/identity | validation fails; no update is offered |
| Network timeout | bounded retries then `unable_to_check` |
| Offline startup | cached fresh result may be used; stale result has no badge |
| Unpublished release | not in the registry and never advertised |
| Same version, different bytes | release pipeline fails, no handoff |
| Lower version in registry | release pipeline fails; apps report up to date |
| Duplicate handoff submission | identical payload detected; no new handoff |
| Uncertain QDN publication | read back exact bytes; never assume success |
