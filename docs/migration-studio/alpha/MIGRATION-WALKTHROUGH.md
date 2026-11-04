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

## 3. Prepare the Hub handoff

Open **Publishing**, select the plan and resources, and choose the Hub handoff
action. QMS writes a portable handoff folder under the project’s
`publication/handoffs/` directory. It contains:

- `handoff.json` with the schema, target name, resources, service, identifier,
  byte length and SHA-256;
- one payload file per resource;
- batching metadata for Hub publication.

QMS validates the package locally before reporting `handoff_ready`. It does
not sign or publish.

## 4. Publish through Qortal Hub

1. Open the handoff folder in the file manager (the Publishing view offers the
   workspace path).
2. Use the Migration Publisher Q-App in Qortal Hub.
3. Select the handoff folder and the batches you intend to publish.
4. Review the fee estimate in Hub and approve the transaction.

Hub is the trust boundary. QMS never sees your seed, private key or wallet
password. If you do not want to publish, stop here; the local handoff remains
valid and nothing on Qortal changes.

## 5. Import publication evidence

After Hub reports completion, export or copy the publication receipt produced
by the Publisher and import it in **Publishing**. QMS accepts a receipt only
for the matching project and handoff.

A receipt changes the state to `submitted`. It is publisher evidence, not
proof that the remote bytes are correct.

## 6. Verify exact QDN resources

Choose **Verify** in the Publishing view. QMS requests each resource with
`encoding=base64`, decodes it, and compares the exact byte length and SHA-256
with the handoff. Only a match becomes `remote_verified`.

A timeout, HTML error page, truncated response or size mismatch stays
unverified. Retry when the network is healthy. Never treat a green local
package as a remote verification.

## 7. Clean up safely

Cleanup is available only for verified or explicitly eligible local files. It
is two-phase:

1. files move to a quarantine directory and a receipt is written;
2. purge removes quarantined bytes only after the retention window.

You can restore a quarantine before purge. Shared media referenced by an
unverified item is protected. Published QDN data is never deleted by cleanup.

## 8. Keep the copy current

Open **Sync** and choose **Check for updates**. See
[SYNC-AND-RECOVERY.md](SYNC-AND-RECOVERY.md) for delta batches, conflicts,
withdrawals and adoption.
