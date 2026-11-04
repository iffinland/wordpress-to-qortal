# Release Workflow

Operational instructions for publishing Qortal Migration Studio releases from the OpenClaw
development environment. Applies to alpha prereleases and, later, stable releases.

## Canonical baseline

Since the 0.6.0 alpha integration, **`main` is the canonical current development baseline** for
Qortal Migration Studio. Branch new work from the current remote `main`, not from the older
Corbett Report baseline or from historical phase branches. The legacy Corbett CLI, CMS, profiles,
manifests and compatibility tests remain on `main` for compatibility, but new product work targets
the QMS desktop app, engine, broker and generic CMS template.

Published tags are immutable. Never move, rewrite or delete a released tag such as
`v0.6.0-alpha.1`.

## Preconditions

- Verified source commit on a clean branch that contains the current remote `main`
  (never publish from a dirty tree).
- Release evidence directory prepared under `/home/iffi/dev-workspace/docs/releases/<version>/`.
- Artifact built from the verified commit; checksum, SBOM, provenance and validation reports present.

## GitHub authentication (persistent)

GitHub CLI is installed at `/home/iffi/.local/bin/gh` (official release tarball; no root required).

Authenticate once per token lifetime with the device flow:

```bash
GH_BROWSER=/bin/true /home/iffi/.local/bin/gh auth login \
  --hostname github.com --git-protocol ssh --scopes repo --web
```

- `gh` prints a one-time code and `https://github.com/login/device`; the operator authorizes from
  their own device.
- Answer **Skip** to the SSH key upload prompt — existing SSH keys are preserved and must not be
  modified by release automation.
- Credentials are stored by `gh` in `~/.config/gh/hosts.yml` (mode `0600`). Never copy that file,
  print its contents, or pass tokens through chat, logs or reports.
- Do not request passwords, personal access tokens or recovery codes from the operator.
- Verify with `gh auth status`; expected scopes: `repo`, `gist`, `read:org`.
- If the token expires, repeat the device flow. No other credential store is involved.

## Mandatory three-artifact release gate

Every alpha or stable release must ship exactly these production artifacts:

1. `qortal-migration-studio_<version>_amd64.deb` — desktop application;
2. `qortal-migration-publisher-v<version>.zip` — root-layout Migration Publisher Q-App;
3. `qortal-migration-generic-cms-v<version>.zip` — root-layout Generic CMS Q-App.

Release preparation is a single command:

```bash
npm run release:prepare
```

It **fails the release** when any required artifact is missing, a ZIP is invalid
or not root-layout, the three artifacts disagree on version or compatibility
schemas, the Debian validation or security gate fails, provenance or SBOM cannot
be generated, or `SHA256SUMS` omits any required artifact. Add `-- --repro` to
prove that both ZIPs rebuild byte-identically and that the .deb rebuilds from a
clean checkout. When Publisher or CMS code changes, the next release rebuilds
the corresponding ZIP from that commit; old assets are never reused.

The gate writes `release/release-manifest.json`, which is the only input to
publishing. Manual asset selection is not supported.

## Release checklist

1. Verify the tag points at the intended source commit:
   `git ls-remote origin refs/tags/<tag> 'refs/tags/<tag>^{}'`
2. Verify the artifact checksum matches the approved value:
   `sha256sum qortal-migration-studio_<version>_amd64.deb`
3. Confirm `SHA256SUMS` validates (`sha256sum -c SHA256SUMS`).
4. Compose user-facing notes: what it does, requirements, install, first run, publication status
   vocabulary, known limitations, documentation links, provenance block.
5. State the signing status explicitly. An unsigned package must never be described as signed.
6. Publish as a prerelease for alpha builds (`--prerelease`), never as a stable release.
7. Attach the three artifacts, `SHA256SUMS`, `RELEASE-NOTES.md`, the release
   manifest, install and user guides, `KNOWN-ISSUES.md`, `sbom.cdx.json` and
   `provenance.intoto.json`. Always use `npm run release:publish`, which derives
   this list from the manifest and uploads all three artifacts automatically.
8. Do not attach secrets, broker configuration, wallets, private credentials or internal operational files.

## Publish

```bash
export PATH=/home/iffi/.local/bin:$PATH
cd /home/iffi/dev-workspace/docs/releases/<version>

cd /home/iffi/dev-workspace/projects/wordpress-to-qortal
npm run release:prepare -- --tag=<tag>   # optional here if already prepared
npm run release:publish -- --tag=<tag>
```

If a release for the tag already exists, the publisher stops. Inspect it with
`gh release view <tag> --json assets` and reconcile only by uploading missing
assets or editing notes. Never delete and recreate a published release, never
silently replace an existing asset, and never overwrite an unrelated stable
release.

## Post-publication verification

```bash
gh release view <tag> --json tagName,isPrerelease,isDraft,assets

# independent downloads, no auth; every checksum must match the approved artifact
curl -sSL -o /tmp/pub.deb \
  "https://github.com/iffinland/wordpress-to-qortal/releases/download/<tag>/qortal-migration-studio_<version>_amd64.deb"
sha256sum /tmp/pub.deb

# repeat the same independent download and hash for the two Q-App ZIPs:
#   qortal-migration-publisher-v<version>.zip
#   qortal-migration-generic-cms-v<version>.zip
# The automated publisher (npm run release:publish) performs all three checks
# and writes release/public-verification.json.
```

Record: release URL, direct asset URL, version, size, SHA-256, prerelease flag, and the list of
verified documentation URLs. A release is only "published" when the public download returns the
approved checksum.

## Notes on future releases

- Keep version, build metadata, release notes and binary provenance in agreement.
- Reproducible build check must compare against the exact published artifact.
- Tag and branch rules are unchanged: no force-push, no history rewrite, no branch-protection
  bypass. Release publication never requires merging into `main`; release commits are merged through
  a reviewed pull request with explicit owner authorization.
- After a release, verify `git status` is clean in every worktree used and record the exact
  published commit SHA.
