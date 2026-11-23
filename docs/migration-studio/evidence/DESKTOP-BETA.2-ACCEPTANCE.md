# Desktop 0.8.0-beta.2 — accepted runtime test

On 2026-11-23 the owner reported **Runtime test passed** and authorized committing and pushing the tested work to main, documentation updates and necessary GitHub operations.

## Accepted artifact

- File: `qortal-migration-studio_0.8.0-beta.2_amd64.deb`
- Bytes: 129085056
- SHA-256: `8ebbb0e443e8b51a885ba8345b32d03d0e8129f6450a584bffa6081153a0eae4`
- Original source base: `9a26317f6eb55ec50cd6d77981228c88e2a25b5c`
- Exact working-product-source digest: `8c2808ed7452d889d317fb978f089064fc4b2c7a82bea6cb1620b2f666d75486`
- Original build: uncommitted trial, unsigned, amd64. The original metadata is retained unchanged in `desktop-beta.2-artifact.json`.

The source and artifact were recovered from the exact saved beta.2 versions and their SHA-256 values checked. Documentation changes during integration do not change the accepted application payload.

## Automated acceptance

- Engine/source/media/planning/publication/recovery/guided/docs: 315 tests passed.
- Desktop: 94 tests passed; TypeScript check passed.
- Packaged Guided mode: 20 controls passed using real renderer, preload, main and engine.
- Packaged Advanced tools: 12 controls passed, including pause/resume, cancel, restart and visible failure paths.
- Packaged bounded scan: one content page and six requests against a fixture with 36,000 posts and 250,000 media items; pause/resume passed without re-reading completed content pages.
- Packaged handoff: 30 resources hash-verified; byte-identical ZIP recreated after restart; receipt import alone was not treated as proof.
- DEB validation: 60 controls passed. Bundled-runtime handshake, missing-dependency negative control and wizard vertical test passed.
- Debian 12/13 and Ubuntu 22.04/24.04: each passed 15 installation/removal/reinstallation checks and 17 engine flows, on amd64 in isolated X11 environments.
- Production dependency audit: zero known vulnerabilities at validation time. Packaged secret scan passed. Six moderate development-tool findings remained, with no high or critical development findings.

See `desktop-beta.2-validation.json` for artifact-bound original evidence. Normal launcher keeps the Electron sandbox; restricted CI used `--no-sandbox` only in its harness. Full graphical login/keyring and Wayland are not covered by the isolated matrix. The owner's runtime acceptance is recorded as reported, without inventing the tester's distribution or individual live-QDN results.

## Publication state

Source integration is approved. The installable GitHub asset is not yet published; public links intentionally remain on the existing release. The original trial does not satisfy the clean-commit public release gate by itself. No failing gate is bypassed and no QDN registry transaction is authorized or sent.
