# Developer build and release guide

This document is for people building QMS from source. End users should use the
prebuilt downloads in the top-level [README](../../README.md#download-qortal-migration-studio-061-alpha).

## Requirements

- Linux amd64 (Debian 12/13 tested)
- Node.js 20 or newer and npm
- `dpkg-deb`, `git`, `zip` for packaging
- Enough disk space for Electron packaging (about 2 GB free)

## Install development dependencies

```bash
npm ci
(cd viewer && npm ci)
(cd templates/generic-cms && npm ci)
(cd desktop && npm ci)
```

## Build the three release artifacts

```bash
npm run release:prepare
```

This single command:

1. checks the version markers in `qms-release.json`;
2. builds the Generic CMS root-layout Q-App ZIP;
3. builds, validates and packages the Migration Publisher root-layout Q-App ZIP;
4. builds the Debian package;
5. validates the Debian payload and runs the release security gate;
6. enforces the mandatory three-artifact gate (layout, entry point, relative
   assets, forbidden development content, bundle versions and compatibility
   schemas);
7. writes `release/release-manifest.json` and `release/SHA256SUMS`;
8. generates the CycloneDX SBOM and the in-toto/SLSA provenance statement;
9. verifies release state and checksums.

Preparation always rebuilds both ZIPs and the .deb from a clean checkout to
compare SHA-256 values. Use `-- --skip-repro` only for a local trial run; a
release without reproducibility evidence is not acceptable.

## Engine runtime dependency rule

The .deb ships the engine as plain ESM plus a locked production node_modules
tree under `/opt/qortal-migration-studio/resources/engine`. The engine is not
bundled into one file because it resolves templates and assets relative to its
own directory and must keep native/optional package semantics.

Rules:

1. Every bare package imported anywhere in the runtime graph must be declared
   in `desktop/engine-package/package.json` and pinned in its lockfile.
   `npm run engine:verify` resolves the graph from `bin/qms-host.js` with
   esbuild against an isolated copy of the staged tree. A missing relative
   module or package fails `prepare:engine`, and therefore `release:deb`.
2. Every module the engine reaches outside `lib/` must be staged by
   `desktop/scripts/prepare-engine.mjs`. `compat.loadLegacyConfig()` lazily
   imports `src/config.js`; omitting it is a startup/runtime failure.
3. Never fix a user-facing dependency error by asking the user to run npm.
   The .deb is self-contained by contract.

The 0.8.0-alpha.3 regression is the reference case:
`lib/engine/publication/index.js` imported `fflate`, but engine-package
declared only cheerio and dotenv. The host process died before the first
JSON-RPC response. The regression test
`test/phase9/engine-runtime-deps.test.js` keeps the static graph complete, and
the release gate proves it from the real .deb.

## Clean-install engine gate

`npm run release:prepare` runs, after building and validating the .deb:

~~~bash
node scripts/release/engine-clean-install-test.mjs
# dpkg-deb -x -> spawn resources/engine/bin/qms-host.js -> engine.info
# asserts apiVersion=qms-engine@1 and the packaged version

node scripts/release/engine-clean-install-test.mjs \
  --hide-node-module=fflate --expect-failure
# proves the same test fails with ERR_MODULE_NOT_FOUND when a dependency
# is removed from a throwaway extraction
~~~

Both write evidence files under `desktop/release/`. The three-artifact gate
requires them, checks `status=pass` and requires their `artifactSha256` to
match the .deb being published. A .deb without a successful handshake and a
successful negative run cannot be published.

## Artifacts

| Kind | Path |
| --- | --- |
| Desktop | `desktop/release/qortal-migration-studio_<version>_amd64.deb` |
| Publisher | `release/qortal-migration-publisher-v<version>.zip` |
| Generic CMS | `release/qortal-migration-generic-cms-v<version>.zip` |

ZIPs are root-layout Q-App bundles: `index.html` and `assets/` are at the ZIP
root, with no parent directory. The release gate rejects source maps, fixtures,
tests, source files, package metadata, credentials, hardcoded developer or
Corbett identities, absolute asset paths and version mismatches.

## Publish

Tag the exact verified commit, then run:

```bash
export PATH=/home/iffi/.local/bin:$PATH
npm run release:publish -- --tag=v<version>-<channel>.1
```

The publisher reads the release manifest, uploads all three artifacts plus
`SHA256SUMS`, SBOM, provenance, the manifest and the user documentation. It
refuses to overwrite an existing release and verifies every public download by
hashing it independently.

## Test gates

```bash
npm test                 # root engine, phase and regression tests
npm run test:all         # root + Generic CMS + desktop tests
npm run cms-template:test
npm run cms-template:build
npm run publisher:build && npm run publisher:validate
(cd desktop && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.node.json --noEmit)
```
