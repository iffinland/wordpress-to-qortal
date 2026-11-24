# Generic CMS 0.9.0-beta.4 — attachment publishing fixes

CMS **0.9.0-beta.4** is the owner runtime-accepted RC.1 ZIP renamed for public download, with identical bytes. Desktop **0.8.0-beta.2** and Publisher **0.8.0-beta.2** remain unchanged; neither package is rebuilt or uploaded.

- Fix the false missing-video error when publishing an attachment to Q-Tube.
- Save owner/deployment-scoped attachment files and posters in browser IndexedDB, and recover them with local drafts.
- Prepare attachments before approval; support remote-file reuse, independent poster changes and multiple videos without duplicate resources.
- Keep files and the original timestamp after cancelled, partial or unconfirmed attempts.
- Verify fixed-coordinate Q-Tube video replacements using streamed size/SHA-256 checks; an older READY video cannot confirm a new upload.
- Deduplicate shared featured-image/poster resources and distinguish loading QDN files from missing local captures.

Owner runtime test passed on 2026-11-24. The earlier candidate validation passed 481 CMS tests, TypeScript, build and ZIP inspection. No tests are repeated during release finalization. Publication verifies the accepted hash and public download.

Download `qortal-migration-generic-cms-v0.9.0-beta.4.zip` and verify `SHA256SUMS`.

Accepted SHA-256: `5cb47155cda6ef43b4a95ba2f03969cd786dc2d9a2851aec0ac95ef10d6922ed`.

Update only the CMS under the existing Qortal name/identifier; no reimport is required. Binary draft recovery requires the same browser/device and available browser storage. Storage failure shows a session-only warning. Fixed-coordinate video verification reads the video back and can use extra time/bandwidth. A separately selected local featured image still needs reselection after reopening; missing bytes now block publication instead of silently dropping the image.

See the Generic CMS user manual and CMS-ATTACHMENT-PUBLISHING-RC.1.md for the complete workflow and candidate evidence. No QDN registry publication is performed.
