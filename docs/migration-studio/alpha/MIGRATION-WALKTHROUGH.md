# WordPress to Qortal: first migration walkthrough

This walkthrough uses a public WordPress site and never publishes from the
desktop application. Publishing is a separate, explicit Qortal Hub action.

## 1. Prepare the project

Complete the wizard through **Approve local preparation**. You now have a
`qms-plan@1` plan and a local source batch.

## 2. Download media

Open the project and continue to preparation. QMS downloads only media
referenced by the selected batch and stores it by SHA-256:

- identical files are stored once;
- reference counts protect media shared by several articles;
- the same hash is reused across retries;
- a failed download is reported, not silently treated as success.

Check the progress view. A failed or interrupted download is resumable; see
[SYNC-AND-RECOVERY.md](SYNC-AND-RECOVERY.md).

## 3. Prepare the Publisher package

Open **Publishing**, select the plan and resources, and generate the handoff.
QMS writes the exact handoff folder and then exports one portable package:

~~~text
<data-root>/exports/<handoffId>-publisher.zip
~~~

It contains `handoff.json`, every payload with its byte length and SHA-256, and
(if Generic CMS was selected) the CMS application bundle with
`qms-cms-config.json`. The bundle uses APP or WEBSITE as selected; it can share
the same registered name as the Publisher because the service differs. The file list is visible in the Publishing view with the
package SHA-256. QMS validates the package locally before reporting
`handoff_ready`; nothing is signed or published.

## 4. Publish through Qortal Hub

1. Open Qortal Hub → Apps → **Migration Publisher**.
2. Select the exported `.zip` (or the handoff folder) and press
   **Connect Qortal account**.
3. Confirm the active address owns the exact target name.
4. Review resources, dependencies, CMS bundle and existing-resource updates.
   Use **Get live network fee quote** to see the node's current ARBITRARY fee.
5. Tick the explicit approval checkbox and publish.
6. Hub shows the authoritative fee and asks for wallet approval. Approve it.

The Publisher publishes media first, then content, indexes, the manifest and
finally the CMS application bundle (APP or WEBSITE). It stops on pending, ambiguous or failed results and never
resubmits blindly. Hub is the trust boundary. QMS never sees your seed, private
key or wallet password.

## 5. Import publication evidence

After Hub reports completion, save the receipt in the Publisher and import it
in **Publishing**. QMS accepts a receipt only for the matching project and
handoff. A receipt changes the state to `submitted`; it is publisher evidence,
not proof that the remote bytes are correct.

## 6. Verify exact QDN resources

Choose **Run independent QDN verification** in the Publishing view. QMS
requests each DOCUMENT/IMAGE resource with `encoding=base64` and every CMS application-bundle
member with `filepath=...&encoding=base64`, decodes it, and compares the exact
byte length and SHA-256 with the handoff. Only a match becomes
`remote_verified`.

A timeout, HTML error page, truncated response or size mismatch stays
unverified. Retry when the network is healthy. Never treat a green local
package as a remote verification.

## 7. Open the migrated website

When the CMS application-bundle resource is `remote_verified`, **Open published website**
opens the exact QDN URL:

~~~text
<node>/arbitrary/APP/<name>/<identifier>?filepath=index.html
~~~

If the node requires read authentication, open the same URL in your normal
Qortal Home/Hub browser session. The CMS reads the published manifest and
indexes; it never edits or republishes them.

## 8. Clean up safely

Cleanup is available only for verified or explicitly eligible local files. It
is two-phase:

1. files move to a quarantine directory and a receipt is written;
2. purge removes quarantined bytes only after the retention window.

You can restore a quarantine before purge. Shared media referenced by an
unverified item is protected. Published QDN data is never deleted by cleanup.

## 9. Keep the copy current

Open **Sync** and choose **Check for updates**. See
[SYNC-AND-RECOVERY.md](SYNC-AND-RECOVERY.md) for delta batches, conflicts,
withdrawals and adoption.
