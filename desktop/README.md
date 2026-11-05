# Qortal Migration Studio — desktop app

Electron + React + TypeScript shell for the Qortal Migration Studio engine.
This package is independent from the legacy root toolkit.

## Development

~~~bash
npm install
npm run build
npm start
~~~

The app needs the repository's `bin/qms-host.js` and `lib/` when running from
source. The packaged app bundles them under `resources/engine`.

## Tests

~~~bash
npm run typecheck
npm test
~~~

## Update checks

The app shows its installed version in the header and checks the shared QDN
update registry at startup and on demand. A badge appears only for a newer
desktop release. The update view shows the verified .deb name, size, SHA-256,
release link and manual installation steps. It never downloads or executes an
installer and never blocks startup when the registry is offline. The update
source (Qortal node URL) is configurable; HTTPS is required except for a
loopback node.

## Debian package

~~~bash
npm run dist:deb
~~~

This builds the renderer and main process, stages the engine and its runtime
dependencies into `engine-runtime/`, and writes
`release/qortal-migration-studio_<version>_amd64.deb`.

The engine runtime is a locked node_modules tree, not a single bundle, because
the engine resolves templates and other assets relative to its own directory.
Every package reached from `bin/qms-host.js` must be declared and pinned in
`engine-package/package.json`; `prepare:engine` resolves the complete import
graph against an isolated copy of `engine-runtime/` and fails on any unresolved
import. Missing a runtime package (the 0.8.0-alpha.3 `fflate` defect) produces a
broken .deb even though the app installs.

Before publishing, prove the packaged engine from the real .deb:

~~~bash
node ../scripts/release/engine-clean-install-test.mjs
node ../scripts/release/engine-clean-install-test.mjs --hide-node-module=fflate --expect-failure
~~~

The first command extracts the .deb and performs an `engine.info` JSON-RPC
handshake with the packaged host. The second hides `fflate` from a throwaway
extraction and requires `ERR_MODULE_NOT_FOUND`, proving the gate detects an
incomplete runtime. `release:prepare` runs both and the three-artifact gate
requires their evidence files.

The generated package is not committed. Verify it with:

~~~bash
npm run verify:package
dpkg-deb -I release/qortal-migration-studio_<version>_amd64.deb
~~~

## Publishing (Phase 5)

The desktop prepares a portable handoff folder and never signs or publishes.
Open Qortal Hub, run the Migration Publisher Q-App, select the handoff folder,
approve the resource set and fee, then export the receipt. Import the receipt in
the desktop Publishing screen and run independent read-only QDN verification
with a node that permits arbitrary reads.

Only exact base64 read-back with matching byte length and SHA-256 marks a
resource remote_verified. A receipt is Publisher-reported evidence, not proof.

See `../docs/migration-studio/PHASE-5-QDN-PUBLISHING.md`.

## Security defaults

- contextIsolation true, nodeIntegration false, sandbox true;
- fixed preload API only;
- strict IPC validation and trusted sender checks;
- no plaintext credential fallback;
- no wallet seed/private key/wallet password fields;
- diagnostics redact secrets and content bodies.

See `../docs/migration-studio/PHASE-4-DESKTOP-GUI.md`.
