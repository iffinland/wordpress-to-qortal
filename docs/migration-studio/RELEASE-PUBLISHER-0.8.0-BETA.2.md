# Migration Publisher 0.8.0-beta.2 — modern publishing workspace

Publisher **0.8.0-beta.2** is an independent Q-App ZIP release, runtime-accepted by the owner on 2026-11-23 from RC.1. Desktop **0.8.0-beta.2** remains at `v0.8.0-beta.4`; Generic CMS **0.9.0-beta.2** remains at `cms-v0.9.0-beta.2`. Neither the DEB nor CMS is rebuilt or uploaded.

- Modern responsive workspace with clear buttons, helpful text and an automatic account/owner card.
- Scrollable resource panel with search, filters, 50-row pages and expandable technical details.
- Automatic active-account and package-name ownership detection, rechecked before signing.
- Transitive dependency selection, locked running controls and approval reset when the selection changes.
- Durable pending-upload protection across repeated clicks and restored sessions. Recheck pending only reads QDN; it does not upload or ask for another fee.
- A single approved run checks existing content, waits for preparing QDN resources and continues with new uploads when ready. Results explicitly distinguish submitted, already present and unresolved items.
- Structured partial Hub responses, exact content verification, size-aware confirmation waits and separate receipt timestamps.
- Worker-based ZIP import with metadata limits before decompression and compatibility with existing Desktop exports.

Hub requests group up to 20 independent resources. Dependencies require verified stages; Hub owns session permissions, so one permission window for every package is not promised.

Download `qortal-migration-publisher-v0.8.0-beta.2.zip` and verify its entry in `SHA256SUMS`.

- Size: **85,059 bytes**.
- SHA-256: `49c1f85f5c0fef091b157c0d9cd219056b981a2b4f6fb264e53fb58fef69014d`.
- The release process rejects a build that differs from the runtime-accepted ZIP. Packaging uses fixed ZIP wall-clock timestamps; a regression test checks byte-identical archives in UTC, Helsinki, New York and Tokyo.
- Focused validation: 67 passing publication/import/production-DOM tests, TypeScript/Vite build, bundle inspection and version checks; release checks also cover documentation and component selection.

The downloadable `publisher-release-manifest.json` identifies the exact committed source and the hash-verified unchanged Desktop/CMS downloads. Publication independently downloads and verifies the new ZIP, checksums and manifest. Existing handoff/receipt schema compatibility is retained. No QDN registry resource is signed or published by this release.
