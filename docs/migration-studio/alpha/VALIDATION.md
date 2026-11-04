# Alpha validation evidence

Date: 2026-11-04
Product: Qortal Migration Studio 0.6.0 (alpha, unsigned)
Validation host: Debian 13 (trixie), amd64, Node.js v24.22.2

This page records what was actually exercised for the first public alpha. The
machine-readable report is `alpha-validation.json` in the release asset set.

## Real WordPress source

Source: `https://wordpressfoundation.org` (public, read-only REST API).

`source.validate` reported:

| Type | Count |
| --- | --- |
| Posts | 65 |
| Pages | 30 |
| Categories | 12 |
| Tags | 53 |
| Media | 88 |

Full discovery produced 248 indexed items: 65 posts, 30 pages, 12 categories,
53 tags, 88 media attachments. The normalized content root was
`sha256:c42e8ed99f1a0a7bbfbd75a4f618c2c1e62aad3ea2c4491018283ee781454aa8`.

Content-only normalization checks:

- 192 items contained editorial HTML.
- 192/192 contained no `<form>`.
- 192/192 contained no `<script>`.
- 115 items retained media references.
- 11 items carried structured unsupported-content warnings.

These checks confirm the content-only rule on real posts and pages, not only on
fixtures. They do not prove that every WordPress plugin in existence is handled.

## Planning, media and handoff

- Batch plan: 15 selected resources out of 95 new post/page items; 153 indexed
  items (terms and attachments) were classified unsupported for direct
  publication, as designed.
- Media: 4 assets, 1 001 284 bytes, 0 failures. Every stored asset was re-hashed
  from disk and matched its content address and byte length.
- Handoff: 27 resources in 2 publication batches, 29 files, package validation
  passed, and all 27 payload hashes and sizes matched the manifest.
- Stable identity: a second preparation of the same plan returned the same
  handoff and the same 27 QDN identities.

## Incremental sync

A completed incremental scan reported zero new, modified, conflicting or
withdrawn items, and the delta planner returned "no changes". This proves the
no-change path on the real source; it does not prove a real remote modification
or deletion, which requires changing the source or publishing first.

## Interruption and recovery

The engine host was killed with SIGKILL four seconds into a real full discovery.
After restart:

- `recovery.status` reported one interrupted, resumable `source.discover` run;
- `recovery.resume` completed it and produced one batch;
- no duplicate batch or corrupt state was observed.

The desktop previously dead-ended on a stale project lock after this scenario.
The alpha fixes that: the UI now offers an explicit **Recover project** action
that retries with stale-lock recovery and opens Recovery. A renderer regression
test covers the flow.

## Cleanup safety

The unverified handoff preview reported 4 files / 1 001 284 bytes, all
protected, 0 eligible. A real `cleanup.start` was refused with
`CLEANUP_NOT_ELIGIBLE`, and no file was deleted. Cleanup of verified resources,
quarantine restore and purge are covered by the Phase 8 automated suite.

## History and diagnostics

- 39 durable history entries were present after the flow.
- A history snapshot was written and readable.
- A 38 687-byte support bundle was generated with schema
  `qms-support-bundle@1` and no leaked bearer token or source content URL.

## Live QDN read-back (read-only)

A previously authorized DOCUMENT test resource was fetched read-only from a
live Qortal node:

- Service: `DOCUMENT`
- Name: `developer iffi`
- Identifier: `qms-dev-live-001`
- HTTP 200, `Content-Type: text/plain`
- 23 bytes
- SHA-256 `4a884888e0d9199078cc59ba4e30b0ac8d5bbbc5c162f07b28c0d30e21fca587`
- Core properties size 163 bytes was directory metadata and was ignored.

This proves exact byte and hash read-back against a live node for an existing
resource. **It is not proof of a new mixed IMAGE/DOCUMENT Hub publication.**
No publication, signature or wallet access occurred.

## Boundaries and unverified areas

- No live QDN publication, transaction signing or wallet access.
- No Hub approval, fee payment or real Publisher execution.
- No modification of the WordPress source, so no real modified-item or
  deleted-item delta was exercised end-to-end.
- No mixed IMAGE/DOCUMENT live acceptance.
- No full graphical desktop session or real keyring unlock prompt; installation
  and launch were verified under Xvfb in isolated Debian root filesystems.
- MX Linux 23 was not executed.
