# Phase 9 — Production Linux release (.deb), release engineering and security review

<!-- qms-release-version: 0.6.0 -->

| Field | Value |
| --- | --- |
| Document | Phase 9 implementation, release and verification evidence |
| Date | 2026-11-04 |
| Status | Release candidate built and fixture-verified; installation verified on two Debian releases; signing and live-network acceptance are documented blockers |
| Scope | Self-contained Debian package, reproducible build, SBOM/provenance/checksums, security review, install matrix, release state |
| Baseline | 5ac535c47d164327daa9ff079e73b0fed32b4f70 (Phase 8 tip) |
| Product | Qortal Migration Studio 0.6.0 (alpha channel) |
| Package | qortal-migration-studio_0.6.0_amd64.deb |

This document describes what Phase 9 actually builds, tests and records. Values
marked **unverified** are not proven here. The artifact is an unsigned alpha
release because no owner-approved Debian signing mechanism was available.

## 1. Outcome

Phase 9 turns the Phase 4 prototype package into a release-engineered Debian
artifact:

- one canonical release version (qms-release.json) synchronized across the
  desktop app, engine, Hub publisher app, generic CMS template and this document;
- a locked engine runtime dependency set (desktop/engine-package/package-lock.json)
  installed with npm ci, not a floating npm install;
- the complete engine, Electron GUI, runtime dependencies and the generic CMS
  template bundled into one package;
- a deterministic .deb builder owned by the project, with normalized ownership,
  permissions, order and timestamps;
- a clean-checkout reproducibility check that rebuilds from git archive and
  compares SHA-256;
- CycloneDX SBOM, in-toto/SLSA-shaped provenance, checksums, artifact metadata
  and a separate release-state record;
- a security gate for dependency vulnerabilities, secret material, development
  paths and unsafe permissions;
- an install and smoke-test matrix on Debian 12 (bookworm) and Debian 13
  (trixie), including uninstall with project-data preservation.

## 2. Package layout

~~~text
/opt/qortal-migration-studio/                 Electron runtime, app.asar, engine
  qortal-migration-studio                     main executable
  resources/app.asar                          renderer + main process
  resources/engine/                           locked engine + templates
    bin/qms-host.js
    lib/
    src/profile.js
    src/utils/
    node_modules/                             cheerio, dotenv and dependencies
    templates/generic-cms/                    built CMS Q-App + config + manifest
    engine-runtime.json                       file hashes for package verification
/usr/bin/qortal-migration-studio -> /opt/qortal-migration-studio/qortal-migration-studio
/usr/share/applications/qortal-migration-studio.desktop
/usr/share/icons/hicolor/<size>/apps/qortal-migration-studio.png
/usr/share/doc/qortal-migration-studio/
~~~

The application does not install anything into the user's home directory.
Project data lives under $XDG_DATA_HOME/qortal-migration-studio
(default ~/.local/share/qortal-migration-studio). Desktop configuration lives
under the XDG config path. Maintainer scripts never remove project data, so
normal upgrades and uninstall preserve it.

## 3. Build and release commands

~~~bash
# Canonical version check / synchronization
node scripts/qms-release.mjs check
node scripts/qms-release.mjs sync

# Full deterministic package build
node scripts/release/build-deb.mjs

# Offline validation, SBOM, provenance, security gate
node scripts/release/validate-artifact.mjs
node scripts/release/security-check.mjs
node scripts/release/generate-sbom.mjs
node scripts/release/generate-provenance.mjs

# Clean-checkout reproducibility (requires network for npm ci)
node scripts/release/repro-check.mjs

# Final consistency gate and release-state separation
node scripts/release/verify-release.mjs --install-evidence=<evidence.json>
~~~

The build refuses a dirty worktree unless --allow-dirty is passed for a local
test build. SOURCE_DATE_EPOCH defaults to the source commit time.

### 3.1 Reproducibility constraints

The package is byte-for-byte reproducible when the following are held constant:

- source commit and tree;
- SOURCE_DATE_EPOCH (commit timestamp by default);
- Node.js, npm, Electron and electron-builder versions from the lockfiles;
- Debian dpkg-deb version and gzip implementation used to create the archive.

Electron's prebuilt runtime is downloaded by the Electron installer and pinned
by the lockfile and its integrity metadata. The project does not rebuild
Chromium. The reproducibility check compares the complete .deb SHA-256, not
only its payload.

Verified result: a clean checkout of commit 8ba3f4b was rebuilt with
SOURCE_DATE_EPOCH=1793794057 and produced a byte-identical
qortal-migration-studio_0.6.0_amd64.deb with SHA-256
6c957543c4c2934f6fcb52634d00b40ab37e5d2b26fb8c2e8f1032f56a32029e.

### 3.2 Signing status

| Item | Status |
| --- | --- |
| Debian package signature | **UNSIGNED** |
| Owner-approved signing key | Not available in this environment |
| Trust requirement | Do not weaken; verify SHA-256 and provenance before installation |
| Remaining requirement | Owner must approve a release key and sign the artifact, SHA256SUMS, SBOM and provenance |

No signing authority was invented. An unsigned alpha artifact is produced and
labelled as such in the filename metadata, RELEASE-STATE.json and release notes.

## 4. Security review and corrections

The review covered renderer isolation, IPC, the local engine host, keyring
handling, SSRF, HTML sanitization, archive extraction, symlinks, cleanup,
dependency vulnerabilities, temporary files, diagnostics, QDN ownership and
supply-chain integrity.

### 4.1 Corrections made in Phase 9

| Area | Before | Correction |
| --- | --- | --- |
| Navigation allow-list | Packaged mode accepted any file:// navigation in the global handler; prefix check accepted sibling directories such as dist-evil | One trusted-navigation function using path containment for both navigation and IPC sender checks |
| CSP | No explicit frame/worker/media policy | Added frame-src, worker-src, child-src and media-src denials |
| Electron fuses | None | RunAsNode retained for the engine; NODE_OPTIONS and CLI inspect disabled; cookies encrypted; app must load from app.asar. Linux Electron 33 does not embed asar integrity metadata, so that fuse is disabled and documented rather than left to break the renderer. |
| Workspace path | Symlink target checked only as text | realpath after creation; refuse symlinks into system paths or the installation |
| Open path | Prefix check before symlink resolution | Resolve both workspace and target, then require containment |
| Diagnostics | Key-name redaction only | Redact URL credentials and credential-like values in both desktop and engine bundles |
| Source URL | Accepted any http(s) prefix | Parse the URL, reject credentials and non-HTTP schemes |
| Media SSRF | Private/loopback blocklist incomplete | Added IETF/documentation/benchmark ranges and hexadecimal IPv4-mapped IPv6 handling |
| Engine dependencies | Floating npm install with caret ranges | Committed engine-package-lock.json, installed with npm ci |
| Release inputs | No provenance or SBOM | CycloneDX SBOM, in-toto/SLSA-shaped provenance, checksums and artifact metadata |
| Package permissions | Not validated | Package gate checks world-writable and unexpected setuid files; chrome-sandbox stays 4755 |

### 4.2 Controls retained

- contextIsolation true, nodeIntegration false, sandbox true, webviewTag false,
  and no generic IPC bridge.
- Every IPC channel is allowlisted and every payload validated in the main
  process, including sender frame and window identity.
- The engine child is spawned with ELECTRON_RUN_AS_NODE=1; no system Node is
  required.
- Credentials are memory-only by default and use secret-tool/libsecret only
  when available and explicitly remembered. No wallet seed, private key or
  wallet password is accepted.
- Diagnostics are metadata-only and refuse credential-like content and content
  bodies.
- The desktop never signs or publishes; Qortal Hub remains the trust boundary.
- Archive/cleanup paths use lstat, realpath and containment checks; Phase 8
  tests prove traversal, absolute-path, protected-state and symlink refusal.

## 5. Verification matrix

| Gate | Command | Result |
| --- | --- | --- |
| Root Node suite | npm test | 415 tests, 415 pass, 0 fail, 0 skip |
| Full regression | npm run test:all | Root 415 + template 19 + desktop 43, all pass |
| Phase 5.2 | npm run test:phase5.2 | 118 pass |
| Phase 7 | npm run test:phase7 | 24 pass |
| Phase 8 | npm run test:phase8 | 23 pass |
| Content policy | node --test test/source/wordpress-content-policy.test.js | 7 pass |
| Corbett compatibility | node --test test/source/corbett-compat.test.js test/phase6/corbett-regression.test.js | 11 pass |
| Generic CMS | npm run cms-template:test | 19 pass / 3 files |
| Desktop typecheck + Vitest | npm --prefix desktop run typecheck && npm test | typecheck clean; 43 tests pass / 12 files |
| Builds | migration, Corbett CMS, generic CMS, desktop, package | all successful |
| Package validation | node scripts/release/validate-artifact.mjs | See section 8 |
| Security gate | node scripts/release/security-check.mjs | See section 8 |
| Reproducibility | node scripts/release/repro-check.mjs | See section 8 |

## 6. Installation and smoke evidence

Environment constraints: this host is Debian 13 without root, Docker, Podman or
a full graphical desktop session. Tests use isolated Debian root filesystems in
user and PID namespaces. This is real dpkg -i, real dependency resolution and a
real X server, but it is **not** a full desktop session. See
INSTALL-VERIFICATION.json for the machine-readable record.

| Distribution | Install method | Runtime evidence | Status |
| --- | --- | --- | --- |
| Debian 13 (trixie) | apt-get install ./qortal-migration-studio_0.6.0_amd64.deb in isolated rootfs | Xvfb + Electron smoke mode, project creation, engine RPC | See evidence |
| Debian 12 (bookworm) | Same | Same | See evidence |
| MX Linux 23 | Not executed | Debian 12 base compatibility documented only | **Unverified** |

MX Linux 23 is Debian 12 based; the package declares Debian 12/13 dependency
alternatives. A supported MX Linux test environment was not available on this
host, so MX Linux installation is not claimed.

## 7. Release artifacts and state

Artifacts are retained outside Git under:

~~~text
/home/iffi/dev-workspace/docs/releases/0.6.0/
  qortal-migration-studio_0.6.0_amd64.deb
  SHA256SUMS
  sbom.cdx.json
  provenance.intoto.json
  build-info.json
  RELEASE-STATE.json
  INSTALL-VERIFICATION.json
  validation.json
  security-report.json
  reproducibility.json
~~~

Release state (RELEASE-STATE.json: version, signing, blockers, artifact
identity) is recorded separately from installation evidence
(INSTALL-VERIFICATION.json). Neither file substitutes for the other.

## 8. Evidence

Evidence values are appended by the release run and copied alongside the
artifact. Summary:

- Root Node suite: 415/415 pass.
- Desktop: 43/43 pass, typecheck clean.
- Phase 5.2: 118/118; Phase 7: 24/24; Phase 8: 23/23.
- Content policy: 7/7; Corbett compatibility: 11/11; generic CMS: 19/19.
- Builds: migration, Corbett CMS, generic CMS and desktop all succeeded.
- Install matrix: Debian 13 (trixie) and Debian 12 (bookworm) both passed the
  real apt/dpkg install, GUI smoke and 17-step engine flow, then removal,
  reinstall and read-back of the preserved project.
- Artifact: qortal-migration-studio_0.6.0_amd64.deb (108,147,012 bytes)
- SHA-256: 6c957543c4c2934f6fcb52634d00b40ab37e5d2b26fb8c2e8f1032f56a32029e
- Source commit: 8ba3f4b3ee8bed8eab9d9b18277713614553868c
- Clean-checkout reproducibility: byte-identical SHA-256
- Security scan: 0 secret findings, 0 forbidden names, 0 production high/critical advisories
- Checksums: also recorded in SHA256SUMS and RELEASE-STATE.json
- SBOM: CycloneDX 1.5, generated from committed lockfiles
- Provenance: in-toto Statement v1 with SLSA v1 predicate shape
- Signing: unsigned alpha

## 9. Known limitations and remaining blockers

1. **Signing is unavailable.** No owner-approved Debian release key or
   mechanism exists in this environment. The artifact is explicitly unsigned.
2. **AC9.7 is not performed.** Live Qortal-network validation requires explicit
   owner authorization for the chosen network. This build performs no QDN
   publication, transaction signing or wallet access.
3. **MX Linux is not executed.** Debian 12 and Debian 13 are the two tested
   Debian-based distributions; MX Linux remains a documented compatibility
   target.
4. **Headless X11, not a full desktop session.** The smoke test starts a real X
   server and the real Electron application, but does not exercise a complete
   desktop environment, real GNOME Keyring unlock prompt or desktop-menu click.
5. **Electron is bundle-level, not rebuilt.** Reproducibility covers the
   project's build output and pinned Electron download, not a Chromium source
   rebuild.

## 10. Phase 10 readiness

The engine remains Electron-free, the desktop remains presentation plus IPC,
templates are bundled with their own manifest, and the release process is
independent of the legacy CLI. A second adapter, Windows shell or additional
locale can be added without rewriting the package contract.
