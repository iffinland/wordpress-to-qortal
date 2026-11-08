# Contributing to Qortal Migration Studio

Qortal Migration Studio (`main` branch) is the current product. The legacy
Corbett Report CLI, CMS, profiles, manifests and compatibility tests remain in
the repository and are supported for compatibility, but new feature work
targets the desktop app, engine, broker and generic CMS template.

## Before you start

- Read [README.md](README.md) and
  [docs/migration-studio/TESTING.md](docs/migration-studio/TESTING.md).
- Branch from the current remote `main`. Do not branch from historical phase
  branches or the old Corbett-only baseline.
- Development requires Node.js 20 or newer. The packaged desktop app does not.

## Change rules

- Keep changes scoped and add a regression test for every fixed defect.
- Never weaken, skip or delete a failing test to obtain a pass.
- Do not change published QDN identifiers, signing behavior or payload formats
  without an explicit, reviewed migration plan.
- Do not commit secrets, credentials, wallets, broker configuration or
  unredacted content.
- Preserve unrelated working-tree changes; use an isolated worktree when
  another task owns files.

## Verification gate

Run the gates that cover your change. Before a release-facing change, run the
full suite documented in [docs/migration-studio/TESTING.md](docs/migration-studio/TESTING.md).

## Release-facing fixes and package releases

Two permanent rules apply to every release-facing fix and every package release:

1. **A completed release-facing bug fix must produce a uniquely versioned,
   tested, GitHub-downloadable installable package.** A branch commit, a local
   build or an unpublished artifact is not completion.
2. **Every code fix and package release must include all necessary
   documentation updates.** Release notes, the release workflow, README download
   links, install/upgrade instructions and every affected behaviour document
   must describe the shipped version.

These rules are enforced, not advisory. Run the task-completion checklist in
[docs/migration-studio/RELEASE-DELIVERY-CHECKLIST.md](docs/migration-studio/RELEASE-DELIVERY-CHECKLIST.md).
`scripts/release/delivery-gate.mjs` blocks a reused version/tag, missing release
notes or missing documentation; `release-prepare.mjs` and
`publish-release.mjs` run it and keep the packaged A–J + H evidence blocking. Do
not report a release task complete until the unique artifact is publicly
downloadable, its SHA-256 matches, and the documentation is updated.

## Pull requests

- Describe the problem, the change and the verification evidence.
- Link the affected phase document when you change documented behavior.
- Report security issues privately to the maintainer instead of in a public
  issue.
