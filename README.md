# Qortal Migration Studio

Qortal Migration Studio (QMS) is a Linux desktop application for moving a
WordPress site's editorial content to Qortal QDN. It reads a WordPress site,
normalizes the content, downloads and de-duplicates supported media, prepares
deterministic QDN batches, hands them to a separate Qortal Hub publishing app,
and verifies the resulting QDN resources byte-for-byte.

> **Alpha download:** [qortal-migration-studio_0.6.0_amd64.deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.0-alpha.1/qortal-migration-studio_0.6.0_amd64.deb)
> — [release notes](https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.6.0-alpha.1) ·
> [all releases](https://github.com/iffinland/wordpress-to-qortal/releases) ·
> [install guide](docs/migration-studio/INSTALL-LINUX.md)

Qortal Migration Studio is an independent open-source project. It is not
affiliated with, sponsored by, or endorsed by any website you choose to
migrate, or by the Qortal project.

## Alpha status

Version **0.6.0** is the first public alpha. Expect rough edges and read
[docs/migration-studio/alpha/KNOWN-ISSUES.md](docs/migration-studio/alpha/KNOWN-ISSUES.md)
before you rely on it.

Important limitations:

- The Debian package is **unsigned** and built for **amd64** only.
- Only Debian 12 and Debian 13 were installed and launch-tested. Debian-based
  systems such as MX Linux 23 are an intended compatibility target but were not
  executed for this release.
- No live QDN publication was performed during release validation. No
  transaction was signed and no wallet was accessed.
- The user-facing Qortal Hub signed-publication flow is implemented and covered
  by deterministic tests, but it has **not completed full live acceptance**.
  Treat the first real publication as a supervised test.
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
   [qortal-migration-studio_0.6.0_amd64.deb](https://github.com/iffinland/wordpress-to-qortal/releases/download/v0.6.0-alpha.1/qortal-migration-studio_0.6.0_amd64.deb)
   and the release assets `SHA256SUMS`, `sbom.cdx.json` and
   `provenance.intoto.json`.
2. Verify the checksum (see [Security](#security-and-checksums)).
3. Install and launch:

```bash
sudo apt install ./qortal-migration-studio_0.6.0_amd64.deb
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
   destination, import preferences, and plan review.
3. **Approve local preparation.** QMS validates the source, discovers content,
   downloads supported media and writes a plan. Nothing is published.
4. Optionally prepare a Hub handoff and publish it through Qortal Hub, then
   import the receipt and verify the exact QDN resources.

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

The 0.6.0 package is an **unsigned alpha**. There is no owner-approved Debian
signing key in the release environment, so `apt` cannot verify a signature.
Verify the published hash before installing:

```bash
sha256sum qortal-migration-studio_0.6.0_amd64.deb
# Expected for v0.6.0-alpha.1:
# ee5725bc148e2849295a416477c4bf98a1b024bcd94026f69b91ed22172e9ea7
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
- [Release notes — 0.6.0 alpha](docs/migration-studio/alpha/RELEASE-NOTES.md)
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
