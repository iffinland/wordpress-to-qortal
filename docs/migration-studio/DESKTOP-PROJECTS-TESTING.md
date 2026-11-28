# QMS Desktop 0.8.0-beta.5 - accepted owner trial

This is an **unpublished**, unsigned Linux amd64 Desktop test build:
`qortal-migration-studio_0.8.0-beta.5_amd64.deb`.
Owner runtime acceptance passed on 2026-11-28; source integration and exact-byte
GitHub promotion are authorized. This describes the original unpublished trial. Public download links
continue to refer to Desktop 0.8.0-beta.2. Migration Publisher and Generic CMS
source code and versions are unchanged. This DEB embeds the repository's unchanged
Generic CMS 0.9.0-beta.4 template; updating Desktop does not deploy it to QDN.

## Simple login restored in beta.5

Beta.4 incorrectly required a browser sign-in merely because the page referenced
a CAPTCHA plugin. Beta.5 removes that local blocker and restores the beta.2
normal form flow: select Website account, enter your username and normal password,
then choose Connect and continue (or Test connection in settings). QMS sends the
ordinary WordPress login form and lets the server decide whether it is accepted.
No extra window is opened automatically. Hidden form fields, session cookies,
same-origin redirect protection and WordPress REST nonce support are retained.

All connection forms now offer three explicit methods: public content, normal website
account, and a separately generated WordPress application password. A normal account
password is never sent as an application password. Successful access method selection
is retained without passwords or cookies in the project document. Failed attempts do
not replace a working in-memory/keyring login.

Normal WordPress session login now follows same-origin redirects, retains cookies and
obtains the WordPress REST nonce. Without that nonce WordPress can treat a signed-in
visitor as anonymous. Cross-origin form actions and redirects cannot receive source
credentials. A plugin reference alone never prevents trying an ordinary login.
If the server actually requires a challenge, QMS respects the rejection and does
not solve or bypass it, or repeatedly submit the password.

The optional **Trouble signing in?** section is collapsed by default. Use it only
if the normal connection fails and the website actually needs another check.
Choose **Open WordPress login window**. Sign in directly on the website, choose **Back to QMS after
signing in** from the window menu, and click **Use signed-in session** in QMS. Keep
the login window open until QMS checks the session. The window has an isolated
memory-only browser partition, no Node integration/preload/QMS API, and no wallet
access. The browser session stays in memory and is never written to project files
or the system password store. Close QMS to discard it. If a server refuses the
account's REST access, QMS reports failure; a browser login cannot grant missing
membership/account permissions. Ordinary password logins may optionally use the
system keyring when available.

**Projects / Home** is visible at the top left in every project view. It returns to
the project center, keeps saved setup choices and leaves active preparation running
with a clear notice. Reopen the project to check progress or pause it. The header
shows the actual Desktop version; close the previous QMS process before installing
and starting this package so an already running beta.2 window is not reused.

Previous submitted/ambiguous packages are shown as needing a check, not a new upload.
**Check previous publication** selects the exact blocking handoff and performs
read-only byte verification. It does not export, resubmit, sign or spend QORT.
Keep your original retained package and receipt; import the receipt if available.

Read-only inspection on 2026-11-27 confirmed that the current Corbett Report REST root
returns HTTP 401 for anonymous requests and its /login/ form includes hCaptcha.
No owner credentials were used and no live member login was attempted. The owner's
actual account/CAPTCHA/REST permission test remains pending.

WordPress references: https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/
and https://developer.wordpress.org/reference/functions/wp_ajax_rest_nonce/ .

## Install and keep your current work

Save a project backup in the current app first. Existing project data lives outside
the installation directory and is preserved by upgrade/uninstall.

```bash
sudo apt install ./qortal-migration-studio_0.8.0-beta.5_amd64.deb
qortal-migration-studio
```

This is a local test package, not a signed/public release. Verify the supplied
SHA256SUMS. Debian 12/13 and MX Linux remain targets; the exact machine and runtime
coverage is listed in the accompanying validation notes. Native Hub signing and
actual network publication require the owner's own runtime test.

## Project center

- **Active projects** opens your saved work. Each project keeps its immutable site
  identity and cumulative catalog. Cards show saved activity and publication counts.
- **Archive** keeps local data and lets you **Restore to active projects**.
- **Remove from this computer** first moves the local project to **Deleted projects**.
  It is recoverable there with the same identity and history. It frees no disk space
  until **Permanently delete…**, which requires typing the exact project name.
  No project-management action deletes published QDN resources.
- **Restore project backup** verifies the archive. Archived backups become active.
  If that project ID already exists, your current copy is kept; choose another
  workspace to restore the backup without replacing it. A matching name alone never
  reconstructs a missing project identity.

## Continue the same site

Open its original project. **Bring new and changed content** compares WordPress
against saved identities; the first complete check can read supported posts and
pages, later checks start at the last successfully covered checkpoint with overlap.
The content-type selection controls what is prepared; complete source coverage is
kept separate from that publication choice. Missing items are never automatically
withdrawn by this guided check. Use **Add older articles** for a bounded date range.
A repeated recent sample is not a cursor through your whole archive.

Review articles, notices and required files. **Check publishing address**, review
any existing-project collision or unavailable-node warning, and confirm the address.
Then **Prepare for Qortal** downloads/verifies media and creates the ZIP. Start with
a sample or bounded dates. Full archive is explicit and bounded at 50,000 items;
updates can inspect a full supported source archive on their first check. The engine
refuses incomplete inventories rather than calling them complete.

Use **Pause safely**, **Continue saved work**, or **Cancel this operation**.
Cancellation keeps completed local files and previous publications. Each large
selection is split into groups. After independently verifying one group, click
Continue when ready for the next; it no longer starts downloading another group
without your action.

Publish the ZIP with the existing Migration Publisher in Hub, approve fees there,
export its confirmation JSON, and select it in QMS. Independent byte verification
is required before QMS calls the package published. Partial/unknown publication is
checked again; it is never blindly resubmitted. **Open website** uses the actual
verified APP/WEBSITE service.

## Independent projects and publishing addresses

You may create another project with a different local label from the same WordPress
website. QMS offers the original project first; check **Create an independent project
with its own catalog** if you mean a separate site.

Separate projects have separate content identities but a Qortal name has one public
APP/default and one WEBSITE/default. A second project at the same name/service may
replace the application and switch its catalog. Destination review shows local
matches and attempts a read-only check of the configured node. An unavailable or
unrecognized remote response is shown as unknown, never as an empty address.
Choose another name/service, content-only output, continue the original project, or
explicitly confirm the intended replacement. Hub still controls actual publication.

## Settings and a wrong name in an unsubmitted package

**Project settings** separates the local project label, website title/description,
WordPress username/application password, Qortal publishing name and website service.
Local rename does not change identities. Website changes are included in a later
package; local Save does not modify QDN. Changing an established publishing name uses
an explicit migration preview. Old verification stays with the original destination;
a new destination requires new preparation/publication. Source URLs with imported
identities cannot silently be reassigned to another WordPress website.

Finish or reconcile a pending package before changing website settings. If you have
**never submitted that package in Hub**, expand the corresponding section below the
ready package, explicitly confirm that fact and **Set aside unsubmitted package**.
The original package/history stays retained, its export is blocked, and you may
correct the destination and prepare a fresh package. A package with recorded
submission/verification evidence cannot use this route. If uncertain, check QDN first.

## Recovery, conflicts and disk space

**Project tools** keeps technical details inside the same project. **Changes & conflicts**
shows WordPress/QDN differences and decisions. **Recovery & storage** resumes safe
checkpoints, reconciles unknown submissions and previews file cleanup. File cleanup
is different from removing a project: quarantine has its own restore window; purge
is separate. **History** and **Publication details** preserve the detailed evidence.
Required new media is prepared before a technical-view handoff too.

WordPress login can be re-entered and tested in Project settings. Passwords remain
session-only unless remembering in the available system password store is chosen.
No wallet seed, private key or wallet password is requested by QMS.

## Validation and owner follow-up

Automated acceptance uses the packaged Electron app, real preload/IPC/engine, local
WordPress and read-only QDN fixtures. It exercises initial import, old date-range
content, modified content, exact ZIP/receipt verification, cumulative identities,
rename/archive/trash restoration and the independent-project collision flow.
No QORT is spent. Source-level regression tests cover multi-day update gaps,
reserved items, backup relocation, target correction, stale-plan rejection and safe
lifecycle paths. The handoff protocol and Publisher/CMS source remain unchanged.

The owner should now check the installed DEB on MX Linux with a backed-up copy of an
existing Guided/Advanced project and the existing Publisher in Hub. Owner
acceptance passed on 2026-11-28; see evidence/DESKTOP-BETA.5-ACCEPTANCE.json. Retain the matching
base-commit/source patch and artifact checksum for the unpublished trial.
