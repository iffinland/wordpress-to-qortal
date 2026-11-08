# Release Delivery Checklist

Permanent owner rules, enforced by the release scripts:

1. **Every completed release-facing bug fix must produce a uniquely versioned,
   tested, GitHub-downloadable installable package.** A fix is not complete when
   it only exists in a branch, a local build, or an unpublished artifact.
2. **Every code fix and package release must include all necessary
   documentation updates.** A release is not complete while the release notes,
   workflow, README download links, install guide or user-facing behaviour docs
   still describe the previous version.

These rules are blocking gates, not advice:

- `scripts/release/delivery-gate.mjs --stage=prebuild` runs before any artifact
  build and fails on a reused tag/release, a version-marker mismatch, missing
  release notes or missing required documentation.
- `--stage=prepublish` additionally proves that the installable .deb and both
  Q-App ZIPs exist, match `release/release-manifest.json`, and are covered by
  `release/SHA256SUMS`.
- `scripts/release/release-prepare.mjs` runs both stages and keeps the packaged
  E2E evidence gates blocking.
- `scripts/release/publish-release.mjs` re-runs the prepublish gate immediately
  before `gh release create`, downloads every uploaded asset over HTTPS,
  re-hashes it, syncs README download links, and re-runs the README link gate.
- `release/delivery-complete.json` is written only after all of the above pass.

## Cannot report completion unless all boxes are checked

- [ ] Version is unique: `qms-release.json` version and tag are new; local and
      remote tag checks and GitHub release lookup are empty.
- [ ] `node scripts/qms-release.mjs check` passes for every version marker.
- [ ] Full packaged functional acceptance A–J passed against the actual
      installable artifact, including handoff H.
- [ ] Engine suite, desktop tests, desktop typecheck, CMS tests and the security
      gate passed on the release commit.
- [ ] Debian validation passed against the published .deb SHA-256.
- [ ] The installable package is downloadable from GitHub: each README asset URL
      returns HTTP 200 with the expected filename, size and SHA-256.
- [ ] `SHA256SUMS` lists the .deb and both ZIPs, and the published checksums
      match the staged/tested artifacts.
- [ ] Release notes state the version, source commit, .deb SHA-256, fixed
      defects and the unsigned/private-preview status.
- [ ] Documentation is updated: release notes, RELEASE-WORKFLOW, README download
      links, install/upgrade guide and every behaviour document affected by the
      fix.
- [ ] Evidence is recorded under `docs/migration-studio/evidence/` and
      `release/delivery-complete.json` exists for the published tag.
- [ ] No public claim of completion is made while any item above is unchecked.

## Evidence locations

| Evidence | Path |
| --- | --- |
| Full packaged acceptance | `release/packaged-functional-acceptance.json` and `docs/migration-studio/evidence/` |
| Handoff H | `release/packaged-handoff-e2e.json` |
| Bounded-scan budget | `release/packaged-bounded-scan-e2e.json` |
| Debian validation | `desktop/release/validation.json` |
| Security | `desktop/release/security-report.json` |
| Unique version + docs + artifacts | `release/delivery-gate.json` |
| Public download verification | `release/public-verification.json` |
| Final delivery | `release/delivery-complete.json` |
