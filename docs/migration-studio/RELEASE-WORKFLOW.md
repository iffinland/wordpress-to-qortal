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

## Permanent delivery rules (enforced)

1. **Every completed release-facing bug fix must produce a uniquely versioned,
   tested, GitHub-downloadable installable package.** A fix is not complete on a
   branch, in a local build, or in an unpublished artifact.
2. **Every code fix and package release must include all necessary
   documentation updates** release notes, this workflow, README download links,
   install/upgrade guidance and every affected behaviour document.

Both rules are blocking, not advisory:

- `scripts/release/delivery-gate.mjs --stage=prebuild` runs before any artifact
  build. It fails when the version/tag/release already exists, a version marker
  disagrees, the release notes file is missing or unversioned, or required
  documentation is missing.
- `--stage=prepublish` additionally fails unless the `.deb` and both Q-App ZIPs
  exist for this exact version, match `release/release-manifest.json` and are
  covered by `release/SHA256SUMS`.
- `scripts/release/release-prepare.mjs` runs both stages and keeps the packaged
  A–J + H evidence gates blocking. A verified artifact may be reused with
  `--reuse-deb=<path>`; validation, engine, security and packaged gates still
  run against it.
- `scripts/release/publish-release.mjs` re-runs the prepublish gate immediately
  before publishing, downloads every public asset over HTTPS and re-hashes it,
  syncs the README download links and re-runs the README link gate.
- `release/delivery-complete.json` is written only after those checks pass.
- The task-completion checklist is
  [RELEASE-DELIVERY-CHECKLIST.md](RELEASE-DELIVERY-CHECKLIST.md); a release task
  must not be reported complete while any item is unchecked.

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

The gate also requires packaged-engine evidence. Before an artifact can be
published, `release:prepare` must extract the .deb, start the packaged engine
and obtain a valid `engine.info` JSON-RPC response, and must prove that the
same test fails when `fflate` is hidden from the extraction. Never bypass these
steps or publish a .deb by hand.

The wizard vertical test is separate from the handshake:

```bash
npm run release:engine-wizard -- --artifact=desktop/release/qortal-migration-studio_<version>_amd64.deb
```

It extracts the same .deb and drives `project.create` → `source.discover` →
`plan.create` over the packaged stdio JSON-RPC host, including a five-post
preview and an empty date range that must explain its exclusions. Evidence is
written to `desktop/release/engine-wizard-flow.json`.

## Independent component versions

Since 0.8.0, the GitHub release bundle and the three shipped components have
separate versions in `qms-release.json` (`qms-release@2`):

- bundle: `version` and `releaseTag` (GitHub release identity);
- `desktop`: desktop, engine package and `ENGINE_VERSION`;
- `publisher`: Migration Publisher Q-App;
- `cms`: Generic CMS template.

Component versions include their channel as a prerelease (`0.8.0-alpha.2`).
A release may change one component and keep the other versions unchanged. Use
`node scripts/qms-release.mjs set-component --component=<id> --version=<v>`
before releasing; `npm run version:check` verifies every marker. Never bump an
unchanged component just because a new GitHub release is created: the update
registry uses component versions to decide whether users see a notification.

## Mandatory three-artifact release gate

Every alpha or stable release must ship exactly these production artifacts:

1. `qortal-migration-studio_<version>_amd64.deb` — desktop application;
2. `qortal-migration-publisher-v<version>.zip` — root-layout Migration Publisher Q-App;
3. `qortal-migration-generic-cms-v<version>.zip` — root-layout Generic CMS Q-App.

Release preparation is a single command:

```bash
npm run release:prepare -- --tag=v<version>-alpha.<n>
```

The tag argument selects the immutable prerelease tag. `releaseTag()` defaults
to `alpha.1`, so any later alpha iteration must pass its tag explicitly — for
example `npm run release:prepare -- --tag=v0.6.1-alpha.2` followed by
`npm run release:publish -- --tag=v0.6.1-alpha.2`. The manifest records that
exact tag, and the publisher refuses to touch an existing release.

It **fails the release** when any required artifact is missing, a ZIP is invalid
or not root-layout, the three artifacts disagree on version or compatibility
schemas, the Debian validation or security gate fails, provenance or SBOM cannot
be generated, or `SHA256SUMS` omits any required artifact. Preparation always
proves that both ZIPs rebuild byte-identically and that the .deb rebuilds from a
clean checkout (`-- --skip-repro` exists only for local trials). When Publisher or CMS code changes, the next release rebuilds
the corresponding ZIP from that commit; old assets are never reused.

The gate writes `release/release-manifest.json`, which is the only input to
publishing. Manual asset selection is not supported.

## Documentation gate
Every release updates the beginner-facing documents together: top-level
`README.md`, `QUICKSTART.md`, `CHANGELOG.md`, `INSTALL-LINUX.md`, `FIRST-RUN-GUIDE.md`,
`MIGRATION-WALKTHROUGH.md`, `PUBLISHER-QAPP-DEPLOYMENT.md`, the Generic CMS
README, release workflow, release notes and known issues. Beginner instructions
must require no development tools and no manual compilation; source-build steps
belong under a clearly marked **For developers / Build from source** heading.
The docs must state that downloading a ZIP is not publishing it to QDN and that
the Generic CMS may be published as an APP or a WEBSITE where supported.

Document these operational behaviours whenever they change:

- the Publisher's editable **Target Qortal name** field, handoff prefill,
  single-owned-name preselection and multi-name picker;
- the Generic CMS **Admin** entry in the default navigation, its rendering
  before catalog gating and its runtime injection for an existing
  `qms-cms-config.json`;
- the requirement to open the CMS under its exact Qortal name
  (`qortal://WEBSITE/<name>/` or `?name=<encoded name>`), including the
  percent-decoding of names from Hub globals and the URL before lookup;
- the redeploy rule: preserve an existing `qms-cms-config.json` in the new
  bundle.

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
8. Run `npm run release:registry` and hand the generated ZIP to the owner for
   QDN approval. The release is not update-advertising until that approval and
   the exact read-back succeed.
8. Do not attach secrets, broker configuration, wallets, private credentials or internal operational files.

## Publish

```bash
export PATH=/home/iffi/.local/bin:$PATH
cd /home/iffi/dev-workspace/docs/releases/<version>

cd /home/iffi/dev-workspace/projects/wordpress-to-qortal
npm run release:prepare -- --tag=v0.6.1-alpha.2   # optional if already prepared
npm run release:publish -- --tag=v0.6.1-alpha.2
```

If a release for the tag already exists, the publisher stops. Inspect it with
`gh release view <tag> --json assets` and reconcile only by uploading missing
assets or editing notes. Never delete and recreate a published release, never
silently replace an existing asset, and never overwrite an unrelated stable
release.

## Update-registry handoff

A successful GitHub release does **not** advertise an update by itself. After
`release:publish`, generate and review the registry handoff:

```bash
npm run release:registry -- --tag=v<version> \
  --node-url=http://100.116.185.83:12391
```

The step verifies all public assets (exact size and SHA-256), validates the
currently published `DOCUMENT/developer iffi/qms-update-registry`, changes only
components whose version increased, and writes
`release/qms-update-registry.json`, `release/registry-diff.json` and
`release/registry-publication.json`. If a registry change is needed it also
writes `release/qms-update-registry-handoff.zip`; if nothing changed it creates
no handoff. The owner imports that ZIP in the Migration Publisher and approves
the QDN publication in Hub. Do not publish the registry automatically and do not
assume the Publisher/broker is authorized.

After owner approval, verify exact read-back:

```bash
npm run release:registry:verify -- --node-url=http://100.116.185.83:12391
```

See `docs/migration-studio/UPDATE-REGISTRY.md` for the schema, fee, collision
handling and manual fallback. A rerun is idempotent: identical bytes produce no
new handoff.

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

## README download links (mandatory gate)

The three prominent download links on the repository homepage (`README.md`) must always
point at the newest published release and its exact assets. A release is not delivered while
the homepage still advertises an older alpha.

- `npm run release:readme-links` validates that the desktop `.deb`, Publisher ZIP and Generic
  CMS ZIP links resolve to the newest non-draft release, that each asset exists and is
  `uploaded`, and that the release's own `SHA256SUMS` lists the advertised component files.
- `scripts/release/publish-release.mjs` runs the gate after public download verification and
  fails the release when `README.md` is outdated.
- When a component does not change, its ZIP keeps its own version in the filename while the
  link tag follows the newest release (for example `v0.8.0-alpha.12/qortal-migration-generic-cms-v0.8.0-alpha.8.zip`).
  Never mix a tag with an asset that does not exist in that tag.

## Artifact provenance vs. main HEAD

An installable artifact binds to its **exact product source**, not to the tip of the branch. The
three-artifact gate therefore compares the product-source digest of the artifact's recorded
`sourceCommit` with the product-source digest of `HEAD` (`PRODUCT_SOURCE_PATHS`: `bin`, `desktop`,
`lib`, `src`, `templates`, `package.json`, `package-lock.json`).

- Product source changed since the build → the gate fails and the artifact must be rebuilt.
- Only documentation, evidence, test or release-tooling commits came after the build → the digests
  match, the gate passes, and the existing artifact stays the release artifact.
- `provenance.intoto.json` and `desktop/release/artifact.json` keep recording the exact build
  commit, so the shipped bytes always remain traceable to one product source.

Never rebuild an already accepted artifact merely because a later documentation or release-metadata
commit moved `HEAD`. Never publish an artifact whose product source no longer matches `HEAD`.

## Validation cost rule (blocking)

Proven functional evidence stays valid until something that can invalidate it changes.

- Packaged A–J + H acceptance, once passed against a specific artifact SHA-256, remains valid while
  the product payload and runtime behaviour are unchanged. Do not rerun the expensive matrix because
  documentation, evidence, release metadata, README links or reproducibility tooling changed.
- Rerun only the directly affected gates for documentation-only or release-tooling-only changes
  (for example the artifact gate, README link gate and download verification).
- Rerun the affected functional controls when a change touches product code or packaging content;
  rerun the full matrix when the runtime, engine, wizard or packaged payload changes.
- Byte-level reproducibility mismatches must first be reduced to a cheap deterministic comparison
  (extracted payload file hashes, Debian control metadata, archive metadata). If the installed
  payload and control data are functionally identical, record the build as non-byte-reproducible in
  `docs/migration-studio/evidence/` and keep the tested artifact. Do not rebuild and do not bump a
  release to make packaging timestamps match.

## Packaged bounded-scan acceptance (blocking gate)

BUG-003 showed that a GUI Quick scan could be executed as a full inventory. The
release therefore requires the packaged Electron acceptance suite:

```
npm run release:packaged-bounded-scan   # writes release/packaged-bounded-scan-e2e.json
npm run release:verify-packaged-scan    # blocking; release:prepare runs it too
```

The gate fails unless the evidence records `status: pass` with the three stages
`boundedScan`, `pause` and `resume`, exactly one content page, a request budget
under 12, a paused operation and no re-fetch on resume. An OOM kill or a missing
evidence file is a failure, never a pass.

## Packaged functional acceptance (blocking gate)

BUG-004 showed that every Quick scan and Full inventory could fail at the IPC
boundary even though the renderer, handlers and engine were individually
correct. Renderer unit tests mock the preload bridge, so this class of defect is
only visible in the packaged app. The release therefore also requires the
packaged functional acceptance evidence:

```
npm run release:packaged-functional -- \
  --app=desktop/release/linux-unpacked \
  --rootfs=<rootfs> \
  --work=/tmp/qms-packaged-functional \
  --out=release/packaged-functional-acceptance.json
npm run release:packaged-e2e -- \
  --app=desktop/release/linux-unpacked \
  --rootfs=<rootfs> \
  --work=/tmp/qms-packaged-handoff \
  --out=release/packaged-handoff-e2e.json
npm run release:verify-functional   # blocking; release:prepare runs it too
```

The first evidence file must record `status: pass` for controls A–J:

- A direct Run quick scan indexes exactly three posts with referenced terms/media;
- B Confirm quick scan and continue produces a ready three-item plan;
- C explicit Full inventory completes on a small fixture;
- D Pause → Resume completes without duplicate index keys;
- E Cancel stops the run and preserves the project;
- F an interrupted Full checkpoint does not block an independent Quick scan;
- G connection failure, invalid source, API timeout and engine failure are visible
  next to the controls that failed;
- I entering Plan Review from Import preferences performs exactly one
  `plan.create`, renders a ready plan and shows no stale planning error
  (BUG-005);
- J a NASA-shaped short-page source still fills a requested three-item window
  from one `per_page=100` content request.

`npm run release:verify-functional` lists A, B, C, D, E, F, G1–G4, I and J as
required controls; a missing or non-PASS control blocks the release.

The second evidence file must record `status: pass` for the handoff flow and a
`receiptVerify` stage with every resource `remote_verified` only after independent
read-back. Receipt import alone is never accepted as proof. Missing evidence, a
failed control, a missing receipt stage, or a pass produced by skipping a stage
blocks the release.
