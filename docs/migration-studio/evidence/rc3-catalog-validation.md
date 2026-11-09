# rc.3 bounded catalog validation

Source base: origin/main c4f1e2093fca97d904f934c9aeb8eea322f6ff33.

Command: `node --test test/phase7/catalog-contract.test.js test/phase3/identity.test.js test/phase5/*.test.js test/phase6/engine-boundary.test.js test/phase6/manifest.test.js test/phase6/search-index.test.js test/phase7/*.test.js`

ℹ tests 92
ℹ suites 0
ℹ pass 92
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 17051.312879

Desktop: typecheck passed; affected dashboard, publishing and sync suites: 14 tests passed in 3 files. `git diff --check` passed. No full/checkpoint/reproducibility suite run.

Independent bounded code review performed. Confirmed findings fixed and regressed: stale/pre-upgrade handoff reuse/export, latest APP config selection, pending-revision authority, partial-media evidence, handoff-specific revision cache, historical receipts, explicit target migration and safe pre-submission decline versus blocked submitted writes.

The 8 catalog-contract tests use the real engine, durable project state, exact base64 HTTP read-back and production CMS repository; A15 + B15 + modified A3, native content, overlay, no unchanged republish, continuation/adoption/reopen, separate project, withdrawal and legacy compatibility are covered.

Real owner-runtime identity/namespace relationship remains unknown: the specific 122-resource owner workspace and live CMS config/manifest/index are absent from fetched branches. No live QDN write, wallet signing or QORT spending. GitHub API access is currently blocked by outbound proxy 403 for api.github.com. Release publication and public download verification are not established by this report.

## Built package evidence

- Artifact: `qortal-migration-studio_0.8.0-rc.3_amd64.deb` (unsigned amd64).
- Build source commit: `548d91f5530bbbe29ed6cbb1df0490ed40caf477`.
- Byte size: **108539962**.
- SHA-256: `47eecd4ffe2e30423e780c94fd60e8661ed6a5d7a318dcd254006a35387503a2`.
- Existing artifact validator: **60 checks passed**.
- Extracted engine clean-install JSON-RPC handshake: passed, `qms-engine@1`, version `0.8.0-rc.3`.
- Bounded catalog contract rerun against the actual engine extracted from this .deb,
  under its bundled Electron Node **20.18.3**: **8 tests passed, 0 failed/skipped**.
  `QMS_CATALOG_ENGINE_ROOT` selects that extracted engine through the existing fixture's
  optional engine factory; the production engine is not mocked.
- Product source and CMS/Publisher bytes were not changed after the accepted build.
  Final test/evidence commits do not require rebuilding the package.
- Packaging normalized directory/control-script modes for the cloud shell's restrictive
  umask; the desktop and engine were staged once and reused for final Debian assembly.
- No reusable QMS SKILL.md files exist in this checkout; no unrelated cloud setup skill was changed.

GitHub prerelease/tag creation, public asset download verification and the README
primary download update remain pending the blocked GitHub API destination. Existing
README download links continue to refer to the actually published rc.2 artifacts.
