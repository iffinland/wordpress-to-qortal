# Quick Start

This is the short version. For a click-by-click walkthrough, open `docs/ZORIN_LINUX_SETUP.md`.

## 1. Install Node.js 20 or newer

On Zorin OS / Ubuntu, open a terminal:

```bash
sudo apt update
sudo apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version
```

`node --version` must show `v20` or a newer major version.

## 2. Open the project folder

If you downloaded a ZIP, extract it first. Then open a terminal in the extracted folder:

```bash
cd ~/wordpress-to-qortal
```

The folder is correct when it contains `README.md`, `package.json`, and `scripts`.

## 3. Run setup

```bash
bash scripts/setup-linux.sh
```

This installs the project dependencies and creates `.env` on the first run.

## 4. Enter the WordPress login

```bash
nano .env
```

Set these values:

```env
WORDPRESS_BASE_URL=https://corbettreport.com
WORDPRESS_AUTH_MODE=session
WORDPRESS_LOGIN_URL=/login/
WORDPRESS_USERNAME=your-wordpress-username-or-email
WORDPRESS_PASSWORD=your-wordpress-password
WORDPRESS_APP_PASSWORD=

MIGRATION_PROFILE=corbettreport
QORTAL_NAME=Corbett
QORTAL_SITE_NAME=Corbett
QORTAL_CONTENT_NAME=Corbett
PUBLIC_AUTHOR_NAME=Corbett
QORTAL_NODE_URL=http://localhost:12391
```

Save with `Ctrl + O`, press `Enter`, then close with `Ctrl + X`.

Never share `.env`.

## 5. Check the setup

Start Qortal Hub and log in with the account that owns the `Corbett` name. Then run:

```bash
npm run doctor
npm run inspect
```

## 6. Record the existing QDN catalog once

```bash
npm run batch:init -- --from-qdn
```

This protects the existing Corbett Report archive. Do it only once.

## 7. Prepare a small first batch

```bash
CORBETT_BATCH_SIZE=10 CORBETT_RECENT_LIMIT=10 npm run batch:next
```

The terminal prints a folder such as:

```text
workspaces/corbettreport-batches/batches/2026-10-26_14-30-00_batch-0001_posts-000001-000010
```

Keep that folder path.

## 8. Publish the batch

In Qortal UI, open:

```text
qortal://WEBSITE/Corbett
```

1. Click `Browse Folder`.
2. Select the batch folder printed by the terminal.
3. Confirm the Qortal name is `Corbett`.
4. Keep `Skip already published` enabled.
5. Publish `CMS JSON`.
6. Publish `Full media`.

If the connection is slow, publish `Images`, `Documents`, `Audio`, and `Video` separately instead of `Full media`.

## 9. Adopt the posts in the CMS

Open:

```text
qortal://WEBSITE/CorbettReport
```

Open `Author Backend`, then `Imported`.

Use:

```text
Import source: Corbett
Manifest: cr-qdn-manifest
```

1. Click `Load Imported Content`.
2. Select the new posts.
3. Click `Adopt selected`.
4. Open `Posts`, filter to `Draft`, select the adopted posts, and publish them.
5. Open the public site and check that the posts appear in the correct order.

## 10. Finish the batch

Only after publishing and checking the public site:

```bash
npm run batch:complete
```

Then remove the large local files from that completed batch when you no longer need a retry:

```bash
npm run batch:cleanup
```

The next batch is prepared with `npm run batch:next`.

## 11. Check for later updates (desktop)

After the first migration, open the project in the Qortal Migration Studio desktop app and choose **Check for updates**.

1. Review the explicit counts: new, modified, unchanged, withdrawn and conflicting.
2. If the scan failed or is incomplete, do not treat it as “no changes”. Resume it or fix the source connection and scan again.
3. Resolve any conflicts. An externally changed QDN resource is not overwritten until you choose **Authorize source overwrite**.
4. Review the delta plan and fee estimate. Only changed resources are included.
5. Continue to **Publishing**, generate the handoff, publish through the existing Hub workflow, import the receipt and verify exact read-back.

A source deletion becomes a local withdrawal. It hides the item from the visible catalog and never deletes or modifies published QDN data.

There is no scheduled background sync. Every scan and publication is an explicit operator action.

## 12. Recover, clean up and inspect history

Open the project and choose **Recovery** (header or project card).

1. **Interrupted operations**: if the app or machine stopped during a run, the
   operation is listed with its last durable checkpoint. Choose **Resume** to
   continue idempotently, or **Dismiss** to abandon it. Nothing is retried
   silently.
2. **Ambiguous publications**: a submission with an unknown result is never
   sent again. Enter a read-only Qortal node URL and choose
   **Reconcile read-back**; only an exact bytes/hash match becomes verified.
3. **Cleanup**: choose **Preview cleanup** first. Only remotely verified media
   and its handoff payload copies are eligible; shared or unverified media is
   protected. **Quarantine eligible files** is reversible for the retention
   period (default 14 days). Use **Restore** inside that window. **Purge** is a
   separate irreversible action and reports the measured freed bytes.
4. **History**: the timeline shows publication evidence, transaction
   signatures, content hashes and cleanup/recovery records. Export a sealed
   snapshot at any time.
5. **Support bundle**: export a metadata-only diagnostics file. Credentials,
   cookies, wallet material and content bodies are excluded; the export is
   refused if a secret check fails.

