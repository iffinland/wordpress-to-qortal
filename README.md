# Qortal Migration Studio

Qortal Migration Studio (QMS) is a Linux desktop application for moving a
WordPress site's editorial content to Qortal QDN. It reads a WordPress site,
normalizes the content, downloads and de-duplicates supported media, prepares
deterministic QDN batches, hands them to a separate Qortal Hub publishing app,
and verifies the resulting QDN resources byte-for-byte.

## Download Qortal Migration Studio 0.8.0 rc.7

Most people need the desktop application. The rc.7 desktop projects each
imported post's verified QDN image into the Generic CMS post index, so its card
image renders consistently on both Home and Posts. The Publisher and Generic
CMS package bytes are unchanged, but all three verified assets are available
from this one release page.

| What you need | Download | What it does |
| --- | --- | --- |
| **Qortal Migration Studio (Linux .deb)** | [qortal-migration-studio_0.8.0-rc.7_amd64.deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/qortal-migration-studio_0.8.0-rc.7_amd64.deb) | The desktop application that reads WordPress, prepares media and handoffs, and verifies published QDN resources. Install this on the Linux machine that prepares migrations. |
| **Migration Publisher (Q-App ZIP)** | [qortal-migration-publisher-v0.8.0-alpha.3.zip](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/qortal-migration-publisher-v0.8.0-alpha.3.zip) | The Qortal Q-App that opens QMS handoff packages, reviews fees, publishes through Qortal Hub and returns a receipt. One shared deployment can serve every user — see below. |
| **Generic CMS (Q-App ZIP)** | [qortal-migration-generic-cms-v0.8.0-alpha.10.zip](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/qortal-migration-generic-cms-v0.8.0-alpha.10.zip) | The neutral website/APP Q-App that renders a published QDN catalog and now supports owner editing of imported and CMS-authored content. It is the site runtime, not the migration tool. |

Verify all three assets with
[SHA256SUMS](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/SHA256SUMS).
Read the [release notes](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/RELEASE-NOTES.md)
or open the [rc.7 prerelease](https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.8.0-rc.7).
Publisher alpha.3 and Generic CMS alpha.10 are included as byte-identical
packages; neither component version changed for this desktop/index fix.

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

The rc.7 desktop passed the focused card-index regression, package checks and
the required packaged release gates. Publisher alpha.3 and CMS alpha.10 are
unchanged component artifacts. The desktop package is **unsigned** and amd64-only;
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

Version **0.8.0 rc.7** is the latest published prerelease. It retains the
cumulative same-site catalog and continuation safeguards, and additionally
includes verified imported-image metadata in the catalog cards used by both
Home and Posts. See
[site continuation and cumulative catalogs](docs/migration-studio/CUMULATIVE-CATALOG.md)
and the [validation evidence](docs/migration-studio/evidence/rc3-catalog-validation.md).

The earlier rc.2 added bounded source
discovery for very large WordPress sites: the wizard defaults to a Quick scan
that reads one bounded content page plus only the taxonomy terms and media the
selected posts reference, so preparing three posts never crawls the whole site;
Full site inventory is an explicit, acknowledged choice, and Pause/Resume/Cancel
plus honest progress counters are available. See
[docs/migration-studio/BOUNDED-SOURCE-SCANS.md](docs/migration-studio/BOUNDED-SOURCE-SCANS.md).
Earlier alphas added optional
featured images to the Generic CMS editor (choose an existing QDN image,
upload a local image, preview, replace or remove it, and see the exact image
that will be published; an explicit choice wins over a preserved WordPress
featured image, then the first suitable body image, then none). It also makes
the slug fix observable and deploy-safe: Admin shows the template version and
warns about stale bundles, and Save draft/Publish refuse an untouched
one-character automatic slug from a longer title. The earlier complete-title
slug generation, manual-edit stop, regeneration, Unicode transliteration,
duplicate detection, published-slug locking and WordPress edit overlay remain.
Featured images persist in the native index, qms-qdn-content@1 media.featured
and the edit overlay and render on cards, lists, detail and search. Gallery
captions/alt text/order, site footer editing and unsaved-change guards are
included. See
[docs/migration-studio/CMS-EDITING-AND-SLUGS.md](docs/migration-studio/CMS-EDITING-AND-SLUGS.md).
The CMS also gains first-class `qortal://` links,
copy-with-badge behaviour for `https://` links, live full-text search over a
versioned `qms-cms-search-index@1`, the **Qortal Migration Studio CMS** footer
attribution, and removal of the hardcoded header branding. Admin remains
owner-only and fails closed, and the owner-published settings, TipTap editor,
galleries and QMS-import compatibility from earlier alphas are unchanged. The
Publisher artifact is unchanged; desktop and CMS are rebuilt. No component is
updated automatically; see [docs/migration-studio/UPDATES.md](docs/migration-studio/UPDATES.md).
The publishing and search behaviour is covered by automated unit and rendered
component tests, but this run did not sign or publish a live QDN transaction.
Read
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
- The Generic CMS only reads its catalog and authorizes admin when it can
  determine the exact Qortal name it is running under. Open it as
  `qortal://WEBSITE/<name>/` or `qortal://APP/<name>/`. Percent-encoded path
  names are decoded before lookup. Visitor query parameters such as `?name=`
  are deliberately ignored for identity; they cannot select a catalog or grant
  ownership. Without a hosting context the CMS falls back to its published
  config, then shows an honest readonly/empty state.
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
   [qortal-migration-studio_0.8.0-rc.7_amd64.deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.8.0-rc.7/qortal-migration-studio_0.8.0-rc.7_amd64.deb)
   and the release assets `SHA256SUMS`, `sbom.cdx.json` and
   `provenance.intoto.json`.
2. Verify the checksum (see [Security](#security-and-checksums)).
3. Install and launch:

```bash
sudo apt install ./qortal-migration-studio_0.8.0-rc.7_amd64.deb
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

`templates/generic-cms/` is a neutral, accessible Qortal Q-App site that renders
a published QDN catalog and provides owner-only authoring. It reads
`qms-cms-manifest@1`, the Phase 5 `qms-qdn-manifest@1` output and the legacy
`cr-qdn-manifest` shape through one read-only adapter.

New in 0.8.0:

- **Independent update checks.** Desktop, Migration Publisher and Generic CMS
  read one shared QDN update registry at startup and on demand. A compact badge
  appears only when that component itself has a newer compatible release;
  unchanged components stay silent. Nothing is downloaded or installed
  automatically, and a missing or malformed registry never blocks normal work.
- **Verified release metadata.** Each component record carries the release tag,
  changelog summary, platforms, verified asset name, size, SHA-256 and manual
  deployment instructions. The registry is published only after owner approval
  of a Publisher handoff.

New in 0.7.0:

- **Owner-only admin.** The confirmed defect where a different signed-in
  account could open `#/admin` is fixed. Authorization requires the active
  account and the live on-chain name record to agree; missing bridge, account,
  name record or node access fails closed. Non-owners see **Access denied** and
  no catalog, adoption queue or editing state. Every publish revalidates
  immediately before signing. Query parameters, localStorage and React state
  cannot grant ownership.
- **Light, dark and system themes**, persisted locally and applied by an inline
  pre-hydration script. The owner's accent survives; contrast is computed.
- **Owner-published site settings** (title, tagline, description, navigation,
  footer text, branding) as `qms-cms-site-settings@1`, with draft, preview,
  explicit destination/fee confirmation, revision-conflict protection and exact
  read-back.
- **TipTap blog editor** with resumable local drafts, sanitized rich text,
  preview, categories/tags, media upload and existing QDN media search.
- **Native galleries** with batches of up to 10 images, captions, responsive
  grids, accessible full-screen viewer, keyboard arrows, Escape and swipe.
- **One public catalog.** CMS-authored posts use `qms-qdn-content@1` plus a
  versioned `qms-cms-native-index` supplement merged with imported QMS content.
  Search, categories and tags include both; a WordPress incremental sync never
  removes CMS posts.
- **Footer attribution** `Qortal. Template v<real version>` links to Qortal Web
  Builders in a new Hub tab through `OPEN_NEW_TAB`.

Admin is hidden from non-owners. Authorized owners get `#/admin` (overview and
import), `#/admin/settings`, `#/admin/editor` and `#/admin/galleries`.

When you redeploy a site that already has a `qms-cms-config.json`, preserve that
file. Published settings and CMS content live in separate DOCUMENT resources, so
they survive template upgrades and do not require rewriting QMS resources.

```bash
cd templates/generic-cms
npm install
npm run typecheck
npm test
npm run build
```

See [templates/generic-cms/README.md](templates/generic-cms/README.md),
[docs/migration-studio/CMS-AUTHORING-SECURITY.md](docs/migration-studio/CMS-AUTHORING-SECURITY.md),
[docs/migration-studio/CMS-SCHEMAS.md](docs/migration-studio/CMS-SCHEMAS.md)
and [docs/migration-studio/PHASE-6-GENERIC-CMS.md](docs/migration-studio/PHASE-6-GENERIC-CMS.md).

## Bounded source scans

Source discovery defaults to **Quick scan — selected batch** in the desktop
wizard. It fetches one bounded content page and only the taxonomy terms and
media records those items reference; it never walks the whole media library or
all history to prepare a small import. **Full site inventory** is an explicit,
confirmed choice and remains resumable at page boundaries.

Pause, resume and cancel are separate controls. Continue never starts an
unbounded scan automatically: it shows the exact mode, item limit, filters and
worst-case page count first. See
[docs/migration-studio/BOUNDED-SOURCE-SCANS.md](docs/migration-studio/BOUNDED-SOURCE-SCANS.md).

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

The 0.7.0 package is an **unsigned alpha**. There is no owner-approved Debian
signing key in the release environment, so `apt` cannot verify a signature.
Verify the published hash before installing:

```bash
sha256sum qortal-migration-studio_0.8.0-rc.2_amd64.deb
# Compare the output with this artifact's line in SHA256SUMS
# from the v0.8.0-alpha.13 release page.
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
- [Release notes — 0.8.0 alpha](docs/migration-studio/RELEASE-0.8.0-ALPHA.md)
- [Checking for updates](docs/migration-studio/UPDATES.md)
- [Update registry architecture and publication](docs/migration-studio/UPDATE-REGISTRY.md)
- [Developer build and release guide](docs/migration-studio/DEVELOPER-BUILD.md)
- [Install, upgrade and uninstall](docs/migration-studio/INSTALL-LINUX.md)
- [First run](docs/migration-studio/alpha/FIRST-RUN-GUIDE.md)
- [Migration walkthrough](docs/migration-studio/alpha/MIGRATION-WALKTHROUGH.md)
- [Sync and recovery](docs/migration-studio/alpha/SYNC-AND-RECOVERY.md)
- [Supported content](docs/migration-studio/USER-CONTENT-SUPPORT.md)
- [Known issues](docs/migration-studio/alpha/KNOWN-ISSUES.md)
- [Troubleshooting: wizard, plan and date filters](docs/migration-studio/TROUBLESHOOTING.md)
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

## Continuing one migration across batches

Use **Continue existing QMS site** (or **Continue this site** on its project card)
for each later batch. **New site/project** creates an independent site even when
it uses the same Qortal name. See the [catalog and continuation guide](docs/migration-studio/CUMULATIVE-CATALOG.md)
for verified revision authority, cumulative indexes, unchanged CMS deployment
reuse and restoring an existing project's workspace.

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
