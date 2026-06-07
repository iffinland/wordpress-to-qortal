# Corbett Report Coauthor Setup Guide

This guide is for preparing Corbett Report migration batches, publishing those
batches through the already published Migration Publisher, and adopting them
into the CMS.

Main roles:

- Migration Publisher already published by the maintainer: `qortal://WEBSITE/Corbett`
- CMS app: `qortal://APP/CorbettReport`
- Default migration import source: `Corbett`
- CMS owner: `CorbettReport`
- Default batch size: `50` posts

## 1. Check Node.js

Open a terminal and run:

```bash
node -v
npm -v
```

Node.js should be version `20` or newer.

If Node.js is missing:

```bash
sudo apt update
sudo apt install nodejs npm
```

Then check again:

```bash
node -v
npm -v
```

## 2. Open The Project Folder

If you received `corbettreport-toolkit-source-v0.1.5.zip`, unzip it first.
Then go to the project folder:

```bash
cd /path/to/wp-to-qortal
```

Install project dependencies once from inside that folder:

```bash
npm install
```

## 3. Add WordPress Login Settings

Create or edit the `.env` file in the project root:

```bash
nano .env
```

Use this template:

```env
WORDPRESS_BASE_URL=https://corbettreport.com
WORDPRESS_AUTH_MODE=session
WORDPRESS_LOGIN_URL=/login/
WORDPRESS_USERNAME=your-wordpress-login-email
WORDPRESS_PASSWORD=your-wordpress-password
WORDPRESS_APP_PASSWORD=

MIGRATION_PROFILE=corbettreport
QORTAL_NAME=Corbett
QORTAL_SITE_NAME=CorbettReport
QORTAL_CONTENT_NAME=Corbett
PUBLIC_AUTHOR_NAME=Corbett
```

Save and close:

- `Ctrl + O`
- `Enter`
- `Ctrl + X`

Never send this `.env` file to anyone.

## 4. Check Batch Status

Run:

```bash
npm run corbettreport:batch:status
```

If the workflow has not been initialized yet, ask the project maintainer before continuing.

## 5. Prepare The Next Batch

Run:

```bash
npm run corbettreport:batch:next
```

The default batch size is `50` historical posts plus any new unseen posts.

At the end, the terminal prints a folder like this:

```text
workspaces/corbettreport-batches/batches/2026-06-07_12-00-00_batch-0008_posts-000116-000165
```

Keep this folder path. You will select this folder in the Migration Publisher.

If download fails or internet is interrupted:

```bash
npm run corbettreport:batch:retry
```

## 6. Optional: Increase Batch Size Later

Start with `50`. If everything works well, increase by about 20 posts:

```bash
CORBETT_BATCH_SIZE=70 npm run corbettreport:batch:next
```

Then later:

```bash
CORBETT_BATCH_SIZE=90 npm run corbettreport:batch:next
```

Do not increase the size while another batch is still waiting for publish and CMS adoption.

## 7. Publish The Batch To QDN

Open Qortal UI and log in with the `Corbett` Qortal name.

The Migration Publisher is already published by the maintainer. You do not need
to publish or update the Migration Publisher app.

Open:

```text
qortal://WEBSITE/Corbett
```

In Migration Publisher:

1. Click `Browse Folder`.
2. Select the batch folder printed by the terminal.
3. Confirm the Qortal name is `Corbett`.
4. Keep `Skip already published` enabled.
5. Publish `CMS JSON`.
6. Publish `Full media`.
7. Confirm Qortal transaction popups when they appear.

Wait until the publisher shows that publishing is complete.

## 8. Open The CMS App

Open Qortal UI and log in with the `CorbettReport` Qortal name.

Open:

```text
qortal://APP/CorbettReport
```

Click:

```text
Author Backend
```

## 9. Load Imported Content

In the backend, open:

```text
Imported
```

For import owner/source enter:

```text
Corbett
```

Click:

```text
Load Imported Content
```

The imported posts should appear in the list.

## 10. Adopt Posts As Drafts

In `Imported`:

1. Show `Not adopted`.
2. Select the posts.
3. Click `Adopt selected`.
4. Wait until the message says the posts were adopted as CMS drafts.

## 11. Publish Draft Posts

Open:

```text
Posts
```

Then:

1. Set status filter to `Draft`.
2. Select the posts.
3. Change status to `Published`.
4. Confirm the Qortal transaction popup.
5. Wait for the success message.

## 12. Verify The Public Site

Open:

```text
qortal://APP/CorbettReport
```

Check:

- the newest posts appear in the correct date order;
- older imported posts appear behind newer posts;
- images and media load;
- article links open inside the Qortal app where possible.

## 13. Mark Batch Completed

Only after QDN publish, CMS adoption, CMS publish, and public site check:

```bash
npm run corbettreport:batch:complete
```

This moves the saved cursor forward. The next batch will continue from the correct place.

## 14. Clean Up Local Batch Files Later

After the batch is confirmed and no retry is needed:

```bash
npm run corbettreport:batch:cleanup
```

This deletes large local batch files but keeps small receipt files.

Do not run cleanup before the public site has been checked.
