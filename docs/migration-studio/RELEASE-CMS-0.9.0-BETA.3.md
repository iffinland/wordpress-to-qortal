# Generic CMS 0.9.0-beta.3 — independent content connection

CMS **0.9.0-beta.3** is the runtime-accepted RC.2 ZIP, renamed for public download with identical bytes. Desktop **0.8.0-beta.2** and Publisher **0.8.0-beta.2** remain unchanged; no DEB or Publisher is built or uploaded.

- Install the CMS separately before or after importing content under the same Qortal name.
- Discover the imported catalog in APP or WEBSITE without a project-specific configuration file. Explicit `mode=ALL` search prevents later settings documents from hiding imports.
- Connect one verified catalog automatically, or let the verified owner choose between projects in Admin → Content connection.
- Keep CMS-authored posts alongside imports, including posts created before the first import. Edit imported text and featured images through the existing separate overlay.
- Reuse the documented content-binding interface in bespoke frontends while retaining their visual defaults.

The owner confirmed RC.2 runtime passed and the imported post appeared correctly on 2026-11-23. Before acceptance, 454 CMS tests, TypeScript, production build and ZIP validation passed. Read-only checks also loaded the reported owner's real QDN catalog and verified the post's exact content hash. Publication performs lightweight metadata, runtime-approved ZIP hash, documentation and public-download checks; the full test suite is not repeated.

Download `qortal-migration-generic-cms-v0.9.0-beta.3.zip` and verify `SHA256SUMS`.

Runtime-approved SHA-256: `c217c548c63d98b175d084ae2292de30bd4f9ab4d83594c86e8bcb0b987d6e31`.

Update the CMS under the existing Qortal name and deployment identifier; reimporting is unnecessary. If needed, open Admin → Content connection → Refresh connection. Preserve custom configuration when replacing a bespoke frontend. APP and WEBSITE share the selected catalog when name and deployment identifier match.

Discovery does not publish transactions. An explicit owner selection among multiple catalogs publishes one public connection document with Hub approval and any applicable fee. The existing native index and edit overlay remain name-scoped. No QDN update-registry publication is included.
