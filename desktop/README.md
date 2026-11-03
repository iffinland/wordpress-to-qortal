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

## Debian package

~~~bash
npm run dist:deb
~~~

This builds the renderer and main process, stages the engine and its runtime
dependencies into `engine-runtime/`, and writes
`release/qortal-migration-studio-<version>-amd64.deb`.

The generated package is not committed. Verify it with:

~~~bash
npm run verify:package
dpkg-deb -I release/qortal-migration-studio-0.4.0-amd64.deb
~~~

## Security defaults

- contextIsolation true, nodeIntegration false, sandbox true;
- fixed preload API only;
- strict IPC validation and trusted sender checks;
- no plaintext credential fallback;
- no wallet seed/private key/wallet password fields;
- diagnostics redact secrets and content bodies.

See `../docs/migration-studio/PHASE-4-DESKTOP-GUI.md`.
