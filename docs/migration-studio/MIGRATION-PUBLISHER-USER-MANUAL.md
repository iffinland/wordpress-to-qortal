# Migration Publisher user manual

## Publisher 0.8.0-beta.2

This guide describes Publisher **0.8.0-beta.2**, runtime-accepted from RC.1 on 2026-11-23 and distributed as the independent `publisher-v0.8.0-beta.2` ZIP release. Desktop 0.8.0-beta.2 and the Generic CMS package are unchanged by this Publisher release.

Migration Publisher publishes a QMS handoff in Qortal Hub. Hub handles wallet signing and network fee approval; the Publisher never asks for your seed, private key or wallet password.

## 1. Connect and load your package

Open the Q-App in Qortal Hub. The active account is detected automatically. Hub may ask you to grant account access. **Retry connection** is available if access fails. No manual target-name entry is needed: the loaded package supplies the exact registered name and the account card checks its ownership. If you switch accounts, review the account shown and approve the selection again.

Choose **Choose ZIP**, or drop the Publisher package exported by Qortal Migration Studio onto the package area. **Use an exported folder instead** opens an alternative folder picker. Select the complete folder containing `handoff.json`.

ZIP and folder imports are limited to 512 MB and 12,000 archive entries. Import processing runs in a worker. The package directory is inspected before decompressed buffers are allocated, then payload hashes and dependencies are validated, including any nested CMS site archive. Do not edit an invalid package to force it through; export a new package from QMS.

## 2. Review the items

The resource list scrolls inside its own panel. Each row shows a title or file name, content type, readable size and status. **Details** reveals the QDN identity, file path, hash, dependencies, transaction and full status explanation.

Search titles and files or filter by type and status. Filtering does not change the selection. The list renders up to 50 items per page; use its arrow controls for additional pages. **Select all** applies to the entire package, including items hidden by filters. **Clear** removes the whole selection.

Selecting an item also selects its dependencies. Removing a required item removes its dependent items through the whole chain. Changing the package, selection or replacement permission clears publishing approval.

## 3. Check existing content

**Check QDN content**, or **Recheck pending** when previous uploads remain unresolved, only reads QDN. It never publishes or charges a fee.

- **Ready:** the package is validated; this item can be considered for publication.
- **Verified:** exact bytes were read back and matched the package hash. A stored result is checked again before a new publish operation.
- **Sent to Hub:** an upload/signing request has started. Keep the page open.
- **Awaiting confirmation:** the result is not yet verifiable. Use **Recheck pending**, which does not re-upload.
- **Needs attention:** expand Details for the cause and next action.
- **Declined:** the Hub request was declined.

A node reporting missing or downloading data is not proof that a resource is new. The Publisher waits for an exact check rather than treating that condition as permission to overwrite it.

Enable **Replace existing content** only when you intend to replace different content already published at the package's exact resource identities. Equal file size alone is never a verified match.

## 4. Publish and follow progress

The publication card shows selected size, expected approval groups and a fee estimate. **Refresh fee estimate** reads the network fee when available. Hub shows the authoritative fee before approving a group.

Tick **I approve this selection**, then choose **Approve & publish**. The first click checks existing content and proceeds to new uploads in the same operation when all preconditions pass. The final message states how many items were sent to Hub, how many already matched and how many remain. Generating a receipt alone is not reported as a successful upload.

Publication uses `PUBLISH_MULTIPLE_QDN_RESOURCES` with up to 20 resources in each group. Independent ready resources are grouped together. A dependent resource waits until its prerequisites are verified, so an entire package cannot always share one approval window. The displayed number can decrease when preflight finds matching content already on QDN. Some Hub versions offer session permission to reduce repeated prompts; granting or declining that permission stays under your control.

During work, package, selection and approval controls are locked. Progress identifies checking, uploading or waiting for confirmation. Verification waits longer for larger batches. Pending or uncertain results pause continuation; the Publisher does not resend them on repeated publish attempts. Use the read-only recheck. Reloading is not a way to force another upload.

## 5. Save the receipt and finish in QMS

**Save receipt** exports the JSON for Qortal Migration Studio. The receipt records outcomes and separate submission/verification timestamps. Return to QMS, import it and run QMS's independent exact QDN verification. A Publisher receipt reports its observations; it is not a substitute for independent verification.

**Recent sessions** lists local progress. Load the same ZIP in the same Hub profile to restore it. A different manifest using the same recorded handoff ID is rejected. Nothing uploads automatically when a session is restored.

If local recovery storage is unavailable, keep the page open and save the receipt before leaving. The app shows a persistent warning in that case.

## Validation and runtime acceptance

The owner reported Runtime test passed for RC.1 on 2026-11-23 and authorized publication of the same ZIP. Automated checks cover publication behavior and the built app/import worker with a simulated Qortal bridge. For deployment checks, confirm the account card, first publish click, grouped approvals, pending rechecks and receipt import in your Hub.
