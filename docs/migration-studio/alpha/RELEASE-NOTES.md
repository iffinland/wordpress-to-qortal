# Qortal Migration Studio 0.6.0 — first public alpha

<!-- alpha-release-version: 0.6.0 -->

## 0.6.1 alpha candidate

0.6.1 adds the standalone Migration Publisher Q-App, one-file Publisher
packages and Generic CMS APP deployment. See
[../RELEASE-0.6.1-ALPHA.md](../RELEASE-0.6.1-ALPHA.md). It is not a published
release: the mixed-service live acceptance gate and the public Publisher
Q-App deployment are outstanding owner-authorized actions. The 0.6.0 download
below remains the latest public build.

Qortal Migration Studio (QMS) is a Linux desktop application that prepares a
WordPress site for publication on Qortal QDN. It reads a public WordPress site,
normalizes editorial content, downloads and deduplicates supported media,
creates safe batches with disk and fee estimates, prepares a Qortal Hub
handoff, imports publication evidence, verifies exact QDN resources, and keeps
the copy synchronized over time.

This is the **first public alpha**. It is an unsigned, amd64 Debian package for
Debian 12 and Debian 13 based systems.

## What is in this alpha

- A guided five-step desktop wizard: Source CMS, WordPress connection, Qortal
  destination, import preferences, plan and review.
- Independent migration projects with crash-safe local state.
- Real WordPress REST discovery of posts, pages, categories and tags.
- Content-only normalization: unsupported forms, checkout widgets, plugin
  scripts and volatile tokens are removed before hashing.
- Media download into a SHA-256 content-addressed store with deduplication and
  reference counts.
- Deterministic batches with disk reserve, per-run byte and file limits, and
  unknown-size policy.
- Portable Qortal Hub handoff folders with stable QDN identities.
- Publication receipt import and exact Base64 QDN read-back verification.
- Incremental scans, delta plans, conflicts, adoption, local-only withdrawals
  and tombstones.
- Crash recovery, two-phase cleanup with quarantine/restore, durable history
  and redacted support bundles.
- A generic Qortal CMS template with owner gating, sanitization, route states
  and an accessible Q-App build.
- Corbett Report compatibility profiles and regression coverage.

## Fixes in this alpha

- After an unclean shutdown, the desktop now detects a stale project lock and
  offers an explicit **Recover project** action. Before this fix the project
  could not be opened, so the Recovery view was unreachable exactly when it was
  needed.
- The alpha validator adds a repeatable real-WordPress, interruption and
  handoff-integrity check, and a read-only live QDN exact-readback check.
- Release documentation now has a single user-facing entry point for install,
  first run, migration, sync, known issues and feedback.

## What is verified in this alpha

The release candidate was validated against the real public read-only
WordPress REST API at `https://wordpressfoundation.org`:

- source validation, full discovery, tag/category and post/page imports;
- normalized content is free of forms and scripts, with media retained;
- batch planning and real media downloads with hash and size verification;
- local Hub handoff generation with manifest and payload hash checks;
- stable QDN identifiers across two independent preparations;
- incremental sync with no false changes, conflicts or withdrawals;
- interruption during discovery followed by recovery and a completed batch;
- safe refusal to clean up an unverified handoff;
- history export and a redacted support bundle.

The package itself was installed with a real `apt-get install` and launched
with the real Electron application on isolated Debian 12 and Debian 13 root
filesystems. Project data survived removal and reinstall.

## What is not verified

- **No live QDN publication was performed by this release validation.** No
  transaction was signed and no wallet was accessed.
- The user-facing **Qortal Hub signed publication path is implemented but not
  accepted live** in this alpha. The handoff format, receipt import and exact
  read-back code are covered by deterministic tests; a real Hub approval and
  fee transaction were not executed.
- The artifact is **unsigned**. Verify the published SHA-256, SBOM and
  provenance before installing. Do not trust a mirror that does not match.
- MX Linux 23 is a compatibility target and was not executed. Only Debian 12
  and Debian 13 were installed.
- Headless X11 (Xvfb) was used for launch tests, not a complete graphical
  desktop session with a real keyring unlock prompt.
- Phase 10 features are not part of this alpha.

## Install

~~~bash
sha256sum qortal-migration-studio_0.6.0_amd64.deb
sudo apt install ./qortal-migration-studio_0.6.0_amd64.deb
qortal-migration-studio
~~~

Read [../INSTALL-LINUX.md](../INSTALL-LINUX.md) before installing.

## Publication status is not one thing

QMS keeps these states distinct:

| State | Meaning |
| --- | --- |
| `planned` | A local batch plan exists. Nothing has been sent anywhere. |
| `prepared` / `handoff_ready` | A local Hub handoff folder exists and its payload hashes were verified locally. |
| `submitted` | A Hub receipt says the resources were submitted. This is publisher evidence, not remote verification. |
| `remote_verified` | QMS fetched the exact bytes from the QDN API and the byte length and SHA-256 matched. |
| `conflict` / `withdrawn` | The source changed or a source item disappeared locally. Withdrawal never deletes published QDN data. |

Never describe a local handoff or a receipt as a verified publication.

## Feedback

Read [FEEDBACK.md](FEEDBACK.md). Include the QMS version, the support-bundle
path or contents, and the exact step that failed. Never attach WordPress
passwords, application passwords, Qortal seeds, private keys, wallet passwords
or full content bodies.
