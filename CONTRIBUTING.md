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

## Pull requests

- Describe the problem, the change and the verification evidence.
- Link the affected phase document when you change documented behavior.
- Report security issues privately to the maintainer instead of in a public
  issue.
