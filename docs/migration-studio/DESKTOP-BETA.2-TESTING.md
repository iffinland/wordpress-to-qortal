# QMS Desktop 0.8.0-beta.2 — user and acceptance guide

Artifact: `qortal-migration-studio_0.8.0-beta.2_amd64.deb`.

This guide covers the owner-runtime-accepted Desktop **0.8.0-beta.2**, published in GitHub bundle **v0.8.0-beta.4**. Publisher remains **0.8.0-beta.1** and Generic CMS **0.9.0-beta.1**. Verify the downloaded DEB against that release's SHA256SUMS. The public package is built from clean committed source; the earlier unpublished trial has its own historical checksum and evidence.

## Installation

The target computer needs no Node, npm, Git or compiler. This package is for
**amd64 / x86-64** computers. Other CPU architectures need their own build.
Install the downloaded DEB with your distribution's graphical package manager,
or, from its directory:

```bash
sudo apt install ./qortal-migration-studio_0.8.0-beta.2_amd64.deb
```

The package declares both the older and t64 dependency names where appropriate.
The compatibility targets are Debian 12/13, Ubuntu 22.04/24.04 and distributions
based on equivalent package sets (including MX Linux and Linux Mint). DEB is a
package format, not a guarantee that every historical or modified distribution
is compatible. Check the accompanying test evidence for environments actually
executed. Normal launching retains Electron sandboxing; no `--no-sandbox`
launcher is installed. Automated GUI tests in restricted namespaces use that
flag and an isolated single-instance test switch only in their harness.

## First use

1. Open **Qortal Migration Studio** from your application menu.
2. Choose **Add a website**, enter the WordPress website address and connect.
   Public content normally needs no login. For protected access, open the login
   section and provide a WordPress application password.
3. Start with **Try a few recent items**. You can also choose a UTC date range
   or explicitly select the whole archive. Select posts and/or pages.
4. Enter the Qortal name you control and review the website title. The short
   description is optional. Hub checks wallet ownership when you publish.
5. Choose **Check selected content**, review notices and preview article text.
   Loading sample pictures is optional and limited to three pictures of at
   most 2 MB each. Remote HTML does not execute in the desktop.
6. Choose **Prepare for Qortal**. QMS checks the plan, downloads and verifies
   files, creates the handoff and exports its ZIP automatically.
7. Open **Migration Publisher** in Qortal Hub and choose that ZIP. Approve the
   resource set and actual fee in Hub. QMS itself holds no wallet keys and
   never signs or submits a QDN transaction.
8. Export the Publisher confirmation JSON and choose it in QMS. QMS imports it
   and independently reads back the resources. A receipt alone is not proof.
   If propagation is incomplete, check again later without republishing.
9. After a verified group, QMS automatically prepares the next group if the
   selection contains more content. Each publication still requires Hub
   approval. Already verified content is reused.

## Pause, recovery and existing projects

Use **Pause safely** before closing. Completed files and durable checkpoints
are kept. After an unexpected shutdown, reopen the site and choose **Recover
and continue**, then continue the saved work. A paused verification is checked
again, not submitted again. Passwords saved only for the session must be entered
again after restart.

Existing projects keep their site IDs, namespaces, catalogs and verified
resources. The guided view detects existing plans and publication packages.
Older ambiguous or stale handoffs remain available through **Advanced tools**
for reconciliation. Do not create a new independent project just to add posts
to an existing site.

## Backup and another computer

Under **Settings & help**, choose **Save project backup** while work is paused.
The backup includes project identities, journals, source content, media,
handoffs and workflow checkpoints. WordPress credentials remain in the system
password store and are not part of the project archive.

On the other computer, use **Restore project backup** and open the restored
site. File hashes and site identity are checked before the project becomes
visible. An existing project is never overwritten: select another workspace if
the same project already exists. Keep a backup before any beta upgrade.

## Advanced tools and connection settings

**Advanced tools** retains the detailed wizard, publishing, sync, history,
conflict review and verified cleanup views. **Guided mode** returns to the new
workflow. Do not start a second preparation for the same site while a guided
operation is running.

In **Settings & help**, set your Qortal Core API address, including the port.
SSH tunnels such as `http://127.0.0.1:24991` are supported. Test and save the
connection. Opening a different workspace preserves saved node configuration.
Changing workspaces does not move or delete the original project data.

## What this migration copies

QMS migrates supported posts/pages and referenced media. WordPress plugins,
shopping carts, comments, user accounts and interactive form behavior are not
recreated. The original website is unchanged. Full content selection reads pages
of content and only their referenced dependencies; it does not enumerate the
entire unrelated media library. A 50,000-item discovery safety limit is explicit;
use smaller date ranges for larger archives. The reading preview is not an exact
WordPress theme reproduction.

## Requested acceptance testing

Try one public website with 1–5 posts first; inspect images and links in the
published website. Test a date range, posts plus pages, a larger archive, pause
and resume, app restart, and checking new/changed content. Test one media-heavy
post if relevant. Save a backup, restore it into a different workspace and
confirm that the same site identity and already verified resources are retained.
Report the Linux distribution/version, the visible error and the operation that
triggered it. Export diagnostics through Advanced tools if needed; do not send
wallet material or passwords.

Owner runtime testing passed on 2026-11-23. The accepted source was integrated into main and authorized for public beta publication. Original trial metadata remains in the acceptance evidence; public release metadata and checksums identify the clean-source package.
