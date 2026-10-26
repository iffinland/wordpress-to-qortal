# Zorin OS Setup: The Corbett Report Migration

This guide is written for Zorin OS. Ubuntu and most other Linux desktops use the same commands.

You will use the terminal for a few commands. Copy each command exactly and press `Enter`.

## What you need

- A Linux computer with at least 20 GB of free disk space. More is better for video.
- The WordPress login for `https://corbettreport.com`.
- Qortal Hub installed and fully synchronized.
- A Qortal account that owns the `Corbett` name.
- The `CorbettReport` name for opening the CMS. You do not need to log in with it to publish migration content.

## Part 1: Install Node.js

1. Open the application menu and start `Terminal`.
2. Run these commands one at a time:

```bash
sudo apt update
sudo apt install -y curl
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

The terminal may ask for your Linux password. It will not show the password while you type. Press `Enter` when finished.

3. Check the versions:

```bash
node --version
npm --version
```

`node --version` must show `v20`, `v22`, or a newer major version. If it shows an older version, install Node.js 20 again with the commands above.

## Part 2: Put the project on your computer

1. Download the repository ZIP or receive the release ZIP.
2. Open your `Downloads` folder.
3. Right-click the ZIP and choose `Extract Here`.
4. Move the extracted folder to your home folder and name it `wordpress-to-qortal`.

The correct folder contains these items:

```text
README.md
QUICKSTART.md
package.json
scripts/
src/
docs/
```

If those items are inside another folder, go one level deeper.

## Part 3: Open a terminal in the project folder

The easiest method is to open the project folder, right-click an empty area, and choose `Open in Terminal`.

Or run:

```bash
cd ~/wordpress-to-qortal
```

Check that you are in the right place:

```bash
ls
```

You should see `README.md` and `package.json`.

## Part 4: Run the setup script

```bash
bash scripts/setup-linux.sh
```

The script installs the project dependencies and creates a private `.env` file on the first run.

## Part 5: Enter the WordPress login

Open the settings file:

```bash
nano .env
```

Use these values as a guide:

```env
WORDPRESS_BASE_URL=https://corbettreport.com
WORDPRESS_AUTH_MODE=session
WORDPRESS_LOGIN_URL=/login/
WORDPRESS_USERNAME=your-wordpress-username-or-email
WORDPRESS_PASSWORD=your-wordpress-password
WORDPRESS_APP_PASSWORD=

MIGRATION_PROFILE=corbettreport
OUTPUT_DIR=./wp-qortal-import

QORTAL_NAME=Corbett
QORTAL_SITE_NAME=Corbett
QORTAL_CONTENT_NAME=Corbett
QORTAL_MEDIA_NAME=
QORTAL_PUBLISHER_NAMES=Corbett
QORTAL_COAUTHOR_NAMES=AgoristMarket,iffi
PUBLIC_AUTHOR_NAME=Corbett
QORTAL_NODE_URL=http://localhost:12391
```

Do not change the Qortal names to `CorbettReport` for content. The existing archive, CMS manifest, and `cr-qdn-manifest` are stored under `Corbett`.

Save and close `nano`:

1. Press `Ctrl + O`
2. Press `Enter`
3. Press `Ctrl + X`

Never send `.env` to anyone. It contains the WordPress password.

## Part 6: Start Qortal Hub

1. Open Qortal Hub.
2. Log in with the account that owns `Corbett`.
3. Wait until the node is fully synchronized.
4. Leave Qortal Hub open while you run the checks and prepare a batch.

The migration importer reads the existing QDN catalog through the local Qortal Core API at `http://localhost:12391`.

## Part 7: Check the setup

Run:

```bash
npm run doctor
```

Expected result:

```text
PASS  Node.js
PASS  .env
PASS  WordPress URL
PASS  WordPress login
PASS  Content Qortal name
PASS  Qortal node
PASS  QDN cr-qdn-manifest
```

Warnings are acceptable when Qortal Hub is still downloading the large website resource. Failures must be fixed before continuing.

Next, check WordPress:

```bash
npm run inspect
```

The final lines should say `Inspection complete`. If WordPress rejects the login, fix `WORDPRESS_USERNAME` and `WORDPRESS_PASSWORD` in `.env`.

## Part 8: Record the existing QDN catalog

Run this once:

```bash
npm run batch:init -- --from-qdn
```

This downloads the current manifest and indexes into:

```text
workspaces/corbettreport-batches/baseline-qdn/
```

It does not change QDN. It prevents a new batch from replacing the older archive with a smaller catalog.

Check the result:

```bash
npm run batch:status
```

The output should show a baseline with the existing post count. The exact count depends on the current QDN state.

## Part 9: Prepare a small first batch

Start small:

```bash
CORBETT_BATCH_SIZE=10 CORBETT_RECENT_LIMIT=10 npm run batch:next
```

This downloads up to 10 older posts and up to 10 newer posts, plus their media. The first run can take a long time because media files may be large.

If the internet connection drops, run:

```bash
npm run batch:retry
```

The retry skips files that were already downloaded.

At the end, the terminal prints a folder like this:

```text
workspaces/corbettreport-batches/batches/2026-10-26_14-30-00_batch-0001_posts-000001-000010
```

Select exactly that folder in the next part, not the project folder and not `wp-qortal-import`.

## Part 10: Publish to QDN

1. Open Qortal UI.
2. Log in with the `Corbett` account.
3. Open:

```text
qortal://WEBSITE/Corbett
```

4. Click `Browse Folder`.
5. Select the batch folder printed by the terminal.
6. Confirm the default Qortal name is `Corbett`.
7. Keep `Skip already published` enabled.
8. Click `CMS JSON`.
9. Confirm the Qortal transaction popup and wait for it to finish.
10. Click `Full media`.
11. Confirm the transaction popups and wait.

For a slow connection, publish `Images`, `Documents`, `Audio`, and `Video` separately instead of `Full media`.

Do not close Qortal UI while a transaction popup is waiting for confirmation.

## Part 11: Adopt the imported posts in the CMS

1. In Qortal UI, open:

```text
qortal://WEBSITE/CorbettReport
```

2. Open `Author Backend`.
3. Open `Imported`.
4. Use:

```text
Import source: Corbett
Manifest: cr-qdn-manifest
```

5. Click `Load Imported Content`.
6. Select the new posts.
7. Click `Adopt selected`.
8. Open `Posts` and filter to `Draft`.
9. Select the adopted posts and publish them.
10. Open the public site and check the post order, titles, text, images, and video links.

## Part 12: Finish and clean up

Only after the public site is checked:

```bash
npm run batch:complete
```

This advances the saved position. The next `npm run batch:next` continues from the correct point.

After a batch is complete and no retry is needed:

```bash
npm run batch:cleanup
```

Cleanup deletes the large local media files from that batch but keeps small audit files. QDN content is not deleted.

## Troubleshooting

### `node: command not found`

Node.js is not installed. Repeat Part 1 and reopen the terminal.

### `npm: command not found`

Install Node.js 20 LTS from Part 1. `npm` is installed together with Node.js.

### `Missing required environment variable: WORDPRESS_BASE_URL`

You are not in the project folder, or `.env` has not been created. Run:

```bash
cd ~/wordpress-to-qortal
ls -la .env
```

### WordPress returns `401` or `403`

Check the WordPress username and password in `.env`. If the site uses an application password instead of the normal login, set:

```env
WORDPRESS_AUTH_MODE=application_password
WORDPRESS_USERNAME=your-wordpress-username
WORDPRESS_APP_PASSWORD=your-application-password
WORDPRESS_PASSWORD=
```

### Qortal node is not reachable

Open Qortal Hub, log in, wait for synchronization, and run `npm run doctor` again. Confirm `QORTAL_NODE_URL=http://localhost:12391` in `.env`.

### `Could not read cr-qdn-manifest`

The local Qortal node has not downloaded the catalog yet. Wait until Qortal Hub is synchronized and the website resource is available, then run:

```bash
npm run batch:init -- --from-qdn
```

### The Migration Publisher says another Qortal name is required

The content resources belong to `Corbett`. Log in with the account that owns `Corbett`, not `CorbettReport`.

### A download fails or an image returns an HTML page

The toolkit keeps that item as an external link instead of publishing a broken file. Continue the batch and inspect the public post later. To retry the whole batch:

```bash
npm run batch:retry
```

### The batch is stuck at `prepared`

A prepared batch must be published and adopted before the next batch is created. Finish Parts 10 and 11, then run:

```bash
npm run batch:complete
```

## Safety reminders

- Keep `.env` private.
- Do not upload the project folder or a batch folder as a Qortal app.
- Do not run `batch:complete` before checking the public site.
- Do not delete QDN resources unless you intend to remove published content.
- Keep an external backup of important media until the migration is verified.
