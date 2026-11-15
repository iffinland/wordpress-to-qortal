# AGENTS.md — QMS repository instructions

This repository is the canonical source for Qortal Migration Studio (QMS):
Desktop, Migration Publisher and the Generic CMS template.

## Canonical scope

- Desktop: `desktop/`, engine in `lib/engine/`.
- Migration Publisher: `viewer/` (Q-App).
- Generic CMS: `templates/generic-cms/` (independent Vite/React package).
- Release tooling: `scripts/release/`, descriptors in `qms-release.json`.
- Active documentation: `README.md`, `QUICKSTART.md`, `CHANGELOG.md`, `docs/migration-studio/`.
- `corbettreport/` and the legacy CLI are historical; do not treat them as the active product unless the task explicitly targets them.

## Versioning

- Components are versioned independently: `desktop`, `publisher`, `cms`.
- A bundle release does not force unchanged components to a new version.
- Use `node scripts/qms-release.mjs show|check|sync|set-component|set-bundle`; never hand-edit one version marker in isolation.
- Release identity is `qms-release.json` (`version`, `releaseTag`, `releaseNotes`).

## Git and remote verification

- Work on a branch; never force-push.
- Fetch and verify `origin/main` before integration.
- After pushing, read back `git ls-remote origin refs/heads/main` and confirm the SHA.
- Preserve owner changes and unrelated work.

## Build, test and packaging

- Follow `docs/migration-studio/RELEASE-WORKFLOW.md` and `RELEASE-DELIVERY-CHECKLIST.md`.
- Run focused tests for the changed component; do not substitute a build for functional verification.
- Reuse byte-identical unchanged artifacts where the release workflow permits it.
- Mandatory gates: `release:gate`, `release:verify`, `release:readme-links` and the docs consistency check.
- Never weaken or bypass a failing gate.

## Documentation synchronization

- A release is incomplete until `CHANGELOG.md`, `README.md`, `QUICKSTART.md`, release notes and active install docs agree on the current component versions and release tag.
- `npm run docs:verify` enforces active-instruction consistency. Historical examples must be explicitly labeled historical.
- Update the Generic CMS user manual when its UI changes.

## GitHub releases

- Releases must be GitHub-downloadable and hash-verifiable.
- Do not overwrite existing releases, tags or assets.
- Verify public URLs, sizes and SHA-256 after upload.

## QDN update registry

- Existing identity: `DOCUMENT / developer iffi / qms-update-registry`, schema `qms-update-registry@1`.
- Never invent a second registry. Read the published registry before generating the next sequence.
- Generated handoffs are owner-approval artifacts only. Never publish to QDN, sign transactions or modify Qortal settings.
- Advertise only versions backed by verified GitHub release artifacts.

## Owner approval and completion

- Irreversible actions, QDN writes and releases require explicit task authorization.
- Report completion only after the remote SHA, artifacts, checksums and focused checks are verified.
- Final evidence must include changed files, commands/tests run, remote SHA and any unresolved blocker.
