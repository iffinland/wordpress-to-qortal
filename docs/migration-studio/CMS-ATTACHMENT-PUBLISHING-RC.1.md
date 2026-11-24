# CMS attachment publication — 0.9.0-beta.4 RC.1

Owner runtime acceptance passed for RC.1 on 2026-11-24. The accepted ZIP is published as CMS 0.9.0-beta.4 without changes to its contents.

## Findings and corrections

The reported missing-video message could occur immediately after selecting a valid file: Q-Tube rewrote the HTML attachment identifier before the editor looked up the captured Blob. The lookup then used a different key. The common preparation module now resolves source bytes first and rewrites presentation references only after preparation.

The audit also found that local draft JSON retained attachment metadata but not the files; a remote video's replacement poster was lost without a local video capture; repeated nodes could cause duplicate/mismatched Q-Tube resources; a retry could generate a different publication timestamp; and READY alone could incorrectly reuse or verify the older video at fixed Q-Tube coordinates.

`attachmentStore.js` persists Blobs/posters with owner/deployment isolation in IndexedDB. `attachmentPublication.js` prepares and validates the file plan before approval, supports remote reuse or verified source download when moving to Q-Tube, and produces one resource per coordinate. `AttachmentTools.tsx` persists captures, retains independent poster edits and avoids inserting a late picker result into a destroyed editor. `EditorPage.tsx` uses the prepared snapshot, stable retry timestamp and draft-specific rich-text editor. `crossPublish/plan.js` deduplicates video sources and builds bodies with final references. `fileVerification.js` and `publish.js` verify fixed-coordinate video size/SHA-256 through a stream.

No new transaction API or automatic QDN writes are introduced. Existing owner revalidation, one combined Hub request, partial-result reporting and ambiguous retry protection remain in place. Disk storage failure falls back to a clearly labelled current-session capture. Clearing browser storage or moving devices still requires the original unpublished file.

## Validation matrix

- Fresh video, audio, PDF/text, archive and office-document attachments.
- Video with Q-Tube off/on, multiple distinct videos and repeated attachment nodes.
- New native post, editing native content, and editing imported content through the overlay.
- Cancel/reopen confirmation and unconfirmed attempt/retry with unchanged timestamp/hash.
- Close/reopen binary draft storage; account/deployment isolation; cleanup; unavailable storage.
- Existing QDN video with no local file, replacement poster only, and existing source copied to Q-Tube.
- Missing/revoked/mismatched files, missing posters and foreign publisher metadata block before signing. Cold QDN resources request building and show a loading diagnostic instead of claiming the local file was lost.
- Fixed video coordinates containing old bytes: publish replacement, verify streamed bytes, reuse the identical result on retry.
- Shared featured-image/poster bytes are included once; conflicting payloads at the same coordinate are refused before signing. Existing batch decline, partial failure and pending-publication tests remain part of the CMS suite.

Automated tests use simulated transports; no transactions are signed and no public QDN data is modified. Large-file policy limits remain the existing Hub/Core limits. Actual near-limit multi-GB transfers and native Hub picker/storage behaviour require device runtime validation.

## Runtime checks

1. Update the separately deployed CMS ZIP under the same name/identifier. Do not reimport content.
2. Create a post, attach the reported MP4, wait for the attachment notice and publish with Q-Tube disabled.
3. Try another post/video with Q-Tube enabled; inspect the resource list, then approve once.
4. Save an unpublished draft with an attachment, leave/reopen it, and test a full CMS reload before publishing. Use the same browser/device and wait for saved-file confirmation.
5. Edit a native/imported post, add a file and change the video's poster. Confirm the public result.
6. Cancel confirmation once; check the same file remains. On a declined/unconfirmed/partial attempt, retain the draft and retry after checking Hub rather than creating a new post.

Publisher and Desktop DEB are unchanged. Owner runtime approval authorizes main integration and the independent CMS 0.9.0-beta.4 release. Publisher and Desktop downloads remain unchanged.


Validation result (2026-11-24): 481 CMS tests passed across 50 files; TypeScript, production build, version-marker and Q-App ZIP inspection passed. `git diff --check` passed. No real Hub transactions or near-limit multi-GB transfers were performed. Those checks preceded runtime acceptance. Finalization reuses the accepted ZIP, updates release metadata/documentation and verifies the published download without repeating tests. The unchanged DEB and Publisher are not rebuilt.
