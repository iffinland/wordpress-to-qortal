# Qortal Migration Studio

Qortal Migration Studio (QMS) is a Linux desktop application for moving a
WordPress site's editorial content to Qortal QDN. It reads a WordPress site,
normalizes the content, downloads and de-duplicates supported media, prepares
deterministic QDN batches, hands them to a separate Qortal Hub publishing app,
and verifies the resulting QDN resources byte-for-byte.

## Download Qortal Migration Studio 0.6.1 alpha.2

The release ships three files. Most people need the desktop application; the
two Q-App ZIPs are for publishing and for the public website runtime.

| What you need | Download | What it does |
| --- | --- | --- |
| **Qortal Migration Studio (Linux .deb)** | [qortal-migration-studio_0.6.1_amd64.deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.1/qortal-migration-studio_0.6.1_amd64.deb) | The desktop application that reads WordPress, prepares media and handoffs, and verifies published QDN resources. Install this on the Linux machine that prepares migrations. |
| **Migration Publisher (Q-App ZIP)** | [qortal-migration-publisher-v0.6.1.zip](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.1/qortal-migration-publisher-v0.6.1.zip) | The Qortal Q-App that opens QMS handoff packages, reviews fees, publishes through Qortal Hub and returns a receipt. One shared deployment can serve every user — see below. |
| **Generic CMS (Q-App ZIP)** | [qortal-migration-generic-cms-v0.6.1.zip](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.1/qortal-migration-generic-cms-v0.6.1.zip) | The neutral website/APP Q-App that renders a published QDN catalog. It is the site runtime, not the migration tool. |

Also download [SHA256SUMS](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.1/SHA256SUMS),
[sbom.cdx.json](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.1/sbom.cdx.json)
and [provenance.intoto.json](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.1/provenance.intoto.json)
to verify the files. Release page:
<https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.6.1-alpha.1>.

**Who needs what**

- **One migration operator** needs the Linux .deb package. It includes the
  publishing handoff builder and the Generic CMS template that the Publisher
  packages per site.
- **A Qortal community or service operator** can deploy the **Migration
  Publisher** once as a shared public Q-App under one registered name. Every
  user can then send their QMS handoff ZIP to that same Publisher instead of
  installing or publishing their own copy. If you prefer, each user can deploy
  a private Publisher instance from the same ZIP.
- **Every migrated site** needs the **Generic CMS** bundle. QMS builds the
  site-specific bundle and configuration, so end users normally do not deploy
  this ZIP by hand; it is published as part of the site's APP/WEBSITE resource.
  Download it separately only when you want to inspect or run the neutral site
  template yourself.

All three artifacts come from the same tagged commit and pass the mandatory
three-artifact release gate. The desktop package is **unsigned** and amd64-only;
see [Alpha status](#alpha-status) and
[docs/migration-studio/INSTALL-LINUX.md](docs/migration-studio/INSTALL-LINUX.md).

**Downloading a ZIP is not deploying it.** The Publisher and Generic CMS ZIPs
are packages. Nothing appears on QDN until an owner publishes them with wallet
approval through the supported Qortal flow. The Generic CMS can be published as
either an **APP** or a **WEBSITE** where the verified package and current
application flow support that service; APP and WEBSITE are distinct QDN
services and may share one registered Qortal name.

Qortal Migration Studio is an independent open-source project. It is not
affiliated with, sponsored by, or endorsed by any website you choose to
migrate, or by the Qortal project.

## Alpha status

Version **0.6.1 alpha.2** is the latest published alpha. It adds the
standalone Migration Publisher Q-App, single-file Publisher packages and
Generic CMS APP deployment, and fixes the Publisher target-name gate and
Generic CMS Admin reachability. A live DOCUMENT publication through the
deployed Migration Publisher completed: the package published, the catalog
manifest read back with the exact expected SHA-256, and the CMS rendered its
content when opened under the correct Qortal name. General APP/WEBSITE and
IMAGE acceptance is still outstanding. Read
[docs/migration-studio/alpha/KNOWN-ISSUES.md](docs/migration-studio/alpha/KNOWN-ISSUES.md)
before you rely on any build.

Important limitations:

- The Debian package is **unsigned** and built for **amd64** only.
- Only Debian 12 and Debian 13 were installed and launch-tested. Debian-based
  systems such as MX Linux 23 are an intended compatibility target but were not
  executed for this release.
- Live acceptance is **partial**. A DOCUMENT-only package published through
  the deployed development Migration Publisher and its catalog manifest read
  back with the exact expected SHA-256. That run did not publish IMAGE or
  APP/WEBSITE resources, so the full mixed-service flow is still not
  live-accepted. Treat the first APP/WEBSITE publication as a supervised test.
- The generic Migration Publisher Q-App is built and validated as a deployable
  artifact, and a development deployment under the name `developer iffi` has
  published a real package. A general shared public deployment still needs the
  owner's registered name and wallet approval. See
  [PUBLISHER-QAPP-DEPLOYMENT.md](docs/migration-studio/PUBLISHER-QAPP-DEPLOYMENT.md).
- The Generic CMS only reads its catalog when it can determine the exact Qortal
  name it is running under. Open it as `qortal://WEBSITE/<name>/` or add
  `?name=<encoded name>` to the URL. Percent-encoded names are decoded before
  lookup, so `developer%20iffi` and `developer iffi` resolve to the same name.
  Without the name it shows its empty or unverified state rather than guessing.
- Launch verification used a headless X server (Xvfb), not a complete graphical
  session with a real keyring unlock prompt.
- One source adapter exists (WordPress REST). Windows and macOS are not
  supported in this alpha.

## Supported Linux platforms

| Platform | Status |
| --- | --- |
| Debian 13 (trixie) | Verified: install and launch |
| Debian 12 (bookworm) | Verified: install and launch |
| MX Linux 23 (Debian 12 base) | Intended compatibility target, unverified |
| Other Debian-based distributions with equivalent packages | Best effort, unverified |

The package is amd64 only. The target machine does not need Node.js, npm, Git,
or any development tools.

## Download, install and launch

1. Download
   [qortal-migration-studio_0.6.1_amd64.deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.1-alpha.1/qortal-migration-studio_0.6.1_amd64.deb)
   and the release assets `SHA256SUMS`, `sbom.cdx.json` and
   `provenance.intoto.json`.
2. Verify the checksum (see [Security](#security-and-checksums)).
3. Install and launch:

```bash
sudo apt install ./qortal-migration-studio_0.6.1_amd64.deb
qortal-migration-studio
```

You can also start **Qortal Migration Studio** from the desktop application
menu. The full procedure, upgrade, uninstall and troubleshooting steps are in
[docs/migration-studio/INSTALL-LINUX.md](docs/migration-studio/INSTALL-LINUX.md).

Project data lives in `$XDG_DATA_HOME/qortal-migration-studio` (default
`~/.local/share/qortal-migration-studio`), outside `/opt`. Upgrading or
uninstalling the package does not delete projects, media, handoffs or history.

## First run

1. Start the application and choose **New project**.
2. Work through the five-step wizard: source CMS, WordPress connection, Qortal
   destination, import preferences, and plan review. Select **Generic CMS** to
   publish a configured website with the content.
3. **Approve local preparation.** QMS validates the source, discovers content,
   downloads supported media and writes a plan. Nothing is published.
4. Prepare a Publisher package: QMS exports one `.zip` containing the exact
   handoff and (optionally) the CMS APP bundle.
5. In Qortal Hub open **Migration Publisher** and select the ZIP. The
   **Target Qortal name** field is prefilled from the handoff and stays
   editable. When the connected account owns exactly one name it is
   preselected; when it owns several, choose the exact name from the picker.
   A package remains bound to the name recorded in its handoff. Verify account
   and name ownership, review resources and the live fee quote, then approve.
6. Import the Publisher receipt, run independent exact QDN verification and
   open the published website once the APP is verified.

The step-by-step version is
[docs/migration-studio/alpha/FIRST-RUN-GUIDE.md](docs/migration-studio/alpha/FIRST-RUN-GUIDE.md),
and a full migration example is
[docs/migration-studio/alpha/MIGRATION-WALKTHROUGH.md](docs/migration-studio/alpha/MIGRATION-WALKTHROUGH.md).

## WordPress source requirements

- A WordPress site whose REST API is reachable over HTTPS at
  `/wp-json/wp/v2/`. Some security plugins disable or restrict the REST API;
  QMS reports a validation failure instead of guessing.
- Public editorial content: posts, pages, categories, tags and the media they
  reference. Public sites need no credentials.
- For protected content, use a WordPress **application password** with the
  least privileges that can read the content. Credentials are memory-only by
  default; optional remembering uses the system keyring and requires an
  explicit opt-in. There is no plaintext credential fallback.
- The site must be reachable from the machine running QMS. Local development
  hosts are supported the same way.

## Qortal account, name and publishing requirements

- A Qortal account with a registered name that owns (or will own) the target
  QDN resources.
- **Qortal Hub** installed on the same machine or a machine that can access the
  handoff folder, and enough QORT to pay publication fees.
- The separate **Migration Publisher Q-App** in Qortal Hub, which performs the
  signed publication.
- QMS never asks for your seed, private key or wallet password. Qortal Hub is
  the trust boundary; it shows the fee estimate and performs the approval.

## What QMS does and does not do

QMS prepares and verifies. It does **not** publish to QDN by itself, and it
never signs a transaction or touches a wallet.

| Step | Performed by |
| --- | --- |
| Read WordPress, normalize content, download and de-duplicate media | QMS |
| Build deterministic QDN batches and resource payloads | QMS |
| Write a portable Hub handoff folder | QMS |
| Sign and broadcast QDN publication | Qortal Hub + Migration Publisher Q-App (separate) |
| Import receipt, verify exact QDN bytes | QMS (read-only) |

The development-only autonomous publishing infrastructure used during QMS
development is not an end-user feature and is not part of the desktop
application.

## Major features

- Guided five-step desktop wizard for source, destination, preferences and plan
  review, with crash-safe local state.
- WordPress REST discovery of posts, pages, categories and tags.
- Content-only normalization: unsupported forms, carts, login widgets, plugin
  scripts and volatile tokens are removed before hashing.
- SHA-256 content-addressed media store with de-duplication and reference
  counts.
- Deterministic batches with disk reserve, per-run byte/file limits and an
  unknown-size policy.
- Portable Hub handoffs with stable QDN identities and local validation.
- Publication receipt import and exact Base64 QDN read-back verification.
- Incremental synchronization with delta plans, conflict evidence and audited
  resolutions.
- Crash recovery, two-phase cleanup with quarantine/restore, durable history
  and redacted support bundles.
- A generic Qortal CMS template for displaying a published QDN catalog.
- Legacy compatibility profiles, manifests and regression tests for the
  original Corbett Report workflow.

## Generic CMS template

`templates/generic-cms/` is a neutral, accessible Qortal Q-App site template
that renders a published QDN catalog. It supports a configurable title,
tagline, navigation, colors and typography, and routes for home, posts, post,
page, category, tag, archive, search and admin/import. It reads
`qms-cms-manifest@1`, the Phase 5 `qms-qdn-manifest@1` output, and the legacy
`cr-qdn-manifest` shape through one read-only adapter.

The template is a starting point for your own site, not a hosted service. It
does not publish or sign; its admin route only stages imported items in a local
adoption queue and requires the signed-in account to own the configured QDN
name.

**Admin** is part of the default navigation and renders before any catalog
gating, so a missing manifest is explained instead of hiding the entry. The
page states its two preconditions explicitly: a published `qms-cms-manifest`
with its indexes under this site's exact QDN name, and a signed-in account that
owns that name. Runtime navigation also injects **Admin** for an already
published `qms-cms-config.json` that predates this change. When you redeploy a
site that already has a `qms-cms-config.json`, preserve that file in the new
bundle; replacing the bundle without it drops the site-specific title,
navigation, theme and manifest identifier.

```bash
cd templates/generic-cms
npm install
npm test
npm run build
```

See [templates/generic-cms/README.md](templates/generic-cms/README.md) and
[docs/migration-studio/PHASE-6-GENERIC-CMS.md](docs/migration-studio/PHASE-6-GENERIC-CMS.md).

## Incremental sync, recovery and cleanup

- **Sync**: manual only. Choose **Check for updates**, review explicit delta
  counts and conflicts, then prepare a delta plan and continue through the
  Hub handoff. There is no scheduled background sync.
- **Conflicts**: external QDN changes and source changes are persisted with
  evidence and require an audited resolution. QMS never silently overwrites
  external resources.
- **Recovery**: interrupted operations are resumable from durable checkpoints;
  ambiguous publications are reconciled by exact read-back, never by automatic
  retry.
- **Cleanup**: two-phase. Preview eligible and protected files, quarantine them
  with a sealed receipt, restore during the retention window (default 14 days),
  or purge as a separate irreversible action.
- **History and support**: a hash-chained audit ledger survives media cleanup,
  and diagnostic bundles are metadata-only with credentials, cookies, wallet
  material and content bodies redacted.

See
[docs/migration-studio/alpha/SYNC-AND-RECOVERY.md](docs/migration-studio/alpha/SYNC-AND-RECOVERY.md),
[docs/migration-studio/PHASE-7-INCREMENTAL-SYNC.md](docs/migration-studio/PHASE-7-INCREMENTAL-SYNC.md)
and
[docs/migration-studio/PHASE-8-RECOVERY-CLEANUP-HISTORY.md](docs/migration-studio/PHASE-8-RECOVERY-CLEANUP-HISTORY.md).

## Supported and unsupported content

**Supported:** editorial posts and pages, categories, tags, links, and
supported images and media referenced by that content.

**Removed or unsupported:** comments, users, menus, widgets, custom post types,
plugin backends, forms, carts, checkout, memberships, logins, interactive
embeds and embedded third-party apps. Unreachable or invalid media is reported,
never invented.

Review
[docs/migration-studio/USER-CONTENT-SUPPORT.md](docs/migration-studio/USER-CONTENT-SUPPORT.md)
and
[docs/migration-studio/alpha/SUPPORTED-CONTENT.md](docs/migration-studio/alpha/SUPPORTED-CONTENT.md)
before migrating a site with heavy plugin functionality.

## Security and checksums

The 0.6.1 package is an **unsigned alpha**. There is no owner-approved Debian
signing key in the release environment, so `apt` cannot verify a signature.
Verify the published hash before installing:

```bash
sha256sum qortal-migration-studio_0.6.1_amd64.deb
# Compare the output with this artifact's line in SHA256SUMS
# from the v0.6.1-alpha.1 release page.
sha256sum -c SHA256SUMS
```

Also inspect `sbom.cdx.json` and `provenance.intoto.json`. Do not install an
artifact from a mirror whose hash does not match. A signed build is a future
release gate.

QMS requests no wallet material. WordPress credentials are memory-only unless
you explicitly opt into keyring storage. Diagnostics and support bundles are
redacted. See
[docs/migration-studio/alpha/KNOWN-ISSUES.md](docs/migration-studio/alpha/KNOWN-ISSUES.md)
for the full security posture.

## Documentation

- [Alpha documentation index](docs/migration-studio/alpha/README.md)
- [Release notes — 0.6.1 alpha](docs/migration-studio/RELEASE-0.6.1-ALPHA.md)
- [Developer build and release guide](docs/migration-studio/DEVELOPER-BUILD.md)
- [Install, upgrade and uninstall](docs/migration-studio/INSTALL-LINUX.md)
- [First run](docs/migration-studio/alpha/FIRST-RUN-GUIDE.md)
- [Migration walkthrough](docs/migration-studio/alpha/MIGRATION-WALKTHROUGH.md)
- [Sync and recovery](docs/migration-studio/alpha/SYNC-AND-RECOVERY.md)
- [Supported content](docs/migration-studio/USER-CONTENT-SUPPORT.md)
- [Known issues](docs/migration-studio/alpha/KNOWN-ISSUES.md)
- [Product requirements](docs/migration-studio/PRODUCT-REQUIREMENTS.md)
- [Architecture](docs/migration-studio/ARCHITECTURE.md)
- [Release workflow](docs/migration-studio/RELEASE-WORKFLOW.md)

Implementation phase documents for the engine, source adapters, planning,
desktop app, QDN publishing, generic CMS, incremental sync, recovery and
production release live in
[docs/migration-studio/](docs/migration-studio/).

## Legacy Corbett Report workflow

The original command-line toolkit and Corbett Report CMS compatibility remain
in the repository and stay supported for compatibility. They are not the
beginner path for the desktop alpha. Profiles, manifests, QDN identifiers and
compatibility tests are unchanged.

Start with
[docs/legacy/CORBETT-REPORT-MIGRATION.md](docs/legacy/CORBETT-REPORT-MIGRATION.md)
for the preserved original instructions, commands and published identifiers.

## Bug reports and feedback

Read
[docs/migration-studio/alpha/FEEDBACK.md](docs/migration-studio/alpha/FEEDBACK.md)
first. Report bugs through
[GitHub Issues](https://github.com/iffinland/wordpress-to-qortal/issues).

Never include WordPress passwords or application passwords, Qortal seeds,
private keys, wallet passwords, broker credentials, or unredacted content in
an issue. Attach a redacted QMS support bundle instead of raw logs.

## For developers / Build from source

End-user instructions are above and require no development tools. Building from
source, packaging the three release artifacts and publishing a release are
documented separately in
[docs/migration-studio/DEVELOPER-BUILD.md](docs/migration-studio/DEVELOPER-BUILD.md).
The short version is `npm run release:prepare` followed by
`npm run release:publish -- --tag=<tag>`.

## Contributing

Contributions are welcome through pull requests against `main`.

- Development requires Node.js 20 or newer.
- Run the relevant test and build gate before opening a pull request; see
  [docs/migration-studio/TESTING.md](docs/migration-studio/TESTING.md).
- Keep changes scoped, add regression tests for fixes, and do not weaken tests.
- Do not change published QDN identifiers or payload formats without an
  explicit migration plan.
- Report security issues privately to the maintainers rather than in a public
  issue.
