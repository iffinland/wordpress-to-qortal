# Desktop acceptance fixes (0.8.0-alpha.11)

This release follows the first real MX Linux acceptance test of the installed
`.deb`. It fixes the two blockers found there (a persisted-value error on an
existing project and a blank window after "Generate handoff package"), the
media dependency explosion, and the requested planning/configuration UX work.
No project data needs to be deleted. Nothing in this release publishes, signs,
moves funds or changes a Qortal node.

## Blank window after "Generate handoff package" (BUG-002)

Symptom: clicking **Generate handoff package** made the whole renderer go
blank (only the dark window background), with no error and no way back.

Root cause: the handoff was generated successfully. The renderer then fetched
the prepared handoff and rendered its resource table. Prepared resources carry
their local state in `state` (`handoff_ready`); the table read
`resource.status`, which was absent, and called `status.replace(...)` on
`undefined`. React 18 unmounts the entire tree on an uncaught render error,
and the app had no error boundary, so the window became empty.

What changed:

- Resources tolerate either field: `status ?? state ?? 'handoff_ready'`.
- The engine now writes both `status` and `state` on prepared resources.
- A top-level error boundary keeps a visible recovery screen with **Reload
  interface** and technical details instead of an empty window.
- `window.error` and `unhandledrejection` are recorded in
  `<workspace>/logs/renderer-errors.log` (redacted). A crashed renderer
  process is logged and reloaded automatically (bounded retries).
- Handoff preparation emits real progress phases with real counts; the button
  shows "Preparing handoff…", the current phase and elapsed seconds.
- If preparation fails after writing files, the handoff list is reloaded so a
  completed artifact is still visible and exportable. Preparation is
  idempotent: the same plan and selection returns the existing handoff instead
  of duplicating QDN identities.

If this happens again, export diagnostics from History & diagnostics; the
renderer error entry is included.

## "persisted value type is not allowed." when reopening a project (BUG-001)

Symptom: opening the existing project and stepping through the wizard showed
**persisted value type is not allowed.**, which disappeared only after a
successful scan.

Root cause: the wizard autosave built `preferences.discovery` as
`effectiveScan ?? undefined`. On an existing project there is no discovery
result in the current session, so the key was `undefined`. IPC structured
clone preserves that key, and the main-process validator rejected undefined
instead of applying JSON semantics. The save failed, so the wizard could not
advance until a scan produced a value.

What changed:

- The validator now mirrors JSON: undefined object members are omitted and
  undefined array entries become null. Only values JSON cannot represent
  (bigint, function, symbol) are rejected, with the type in the message.
- The wizard omits the discovery key when there is no cached scan.
- `migrateWizardForLoad` is now wizard schema version 3. It normalizes legacy
  numeric step indexes and stringified preference scalars (`"5"`,
  `"false"`) in place, drops a null/blank cached discovery record, and
  preserves every other key, mapping, checkpoint, plan, downloaded asset and
  history entry. Migration is idempotent.

The project must not be deleted or recreated to recover.

## Media dependency over-collection (AUDIT-001)

WordPress returns every media-library item whose `post` parent is the article,
even when the rendered article never uses it. QMS treated every attachment as
a required dependency, so one gallery-heavy post pulled in hundreds of files
and a 5-post batch exceeded `maxFilesPerRun` (500), producing
`DISK_LIMIT_EXCEEDED`. The same plan with batch size 1 needed 19 files.

Policy now:

- Required: the featured image, images/audio/video/documents linked or embedded
  in the rendered body, and attachments the body actually references (URL,
  upload path, file stem including `-WxH`/`-scaled` variants, `wp-image-<id>`,
  `attachment_<id>` or `attachment_id=<id>`).
- Not required: other media-library attachments. They stay in the source index
  and in `source.wordpress.attachment_policy` as provenance metadata. A
  `MEDIA_UNREFERENCED_ATTACHMENTS_SKIPPED` warning reports the count.
- Opt-in: Advanced settings → "Also download media-library attachments the post
  never references" (engine: `media.includeUnreferencedAttachments`). The file
  cap still applies, so this remains an explicit, visible choice.

Fixture result (one post with 3 displayed images and 600 attached library
items, five posts, `maxFilesPerRun=500`): before, the required set exceeded
the cap (601+ files, plan blocked); after, the plan is ready with exactly the 3
referenced images and 600 attachments reported as skipped. Required media is
never silently dropped.

## Planning progress and batch size (UX-001, UX-002)

- Progress bars never invent a denominator. With no known total they are
  indeterminate and show the real completed count; a percentage appears only
  when the engine reports a total.
- Plan review shows the current engine phase (`index`, `classify`,
  `select`, `media_estimate`) with real counts.
- "Batch size" is now **Items prepared per batch**, with an explanation that it
  does not limit site size or Qortal capacity.
- Preferences show **Discovered on the site**, **Scanned into the local index**
  and **Selected for this batch** as separate numbers.

## Simpler configuration (UX-003)

Authentication modes are labelled by intent: Public REST API (no login),
Application password (recommended) and WordPress login session (legacy), with
short guidance on where to create an application password. Disk, media and
recovery knobs moved into an **Advanced** section with safe defaults; unknown
size policy, per-file/per-run caps, concurrency, external media and reserved
recovery items stay available there.

## Global text size (UX-004)

A **Text size** selector in the header offers 90/100/115/130/150%. It scales
the root font size, so cards, grids and tables reflow together, is persisted in
the desktop profile and restored before the first paint. It is a native
keyboard-accessible select.

## Qortal node configuration (UX-005)

Receipt verification no longer assumes `http://127.0.0.1:12391`. In
Publishing you can enter any http(s) node (for example an SSH-forwarded
`http://127.0.0.1:24991` or `:24992`), **Test connection**, **Save as
preferred node**, and select among saved nodes. The test calls only the public
read-only `/blocks/last` endpoint and shows status, latency and block height.

The desktop app never enables, exposes or modifies a node's private API and
never touches SSH tunnels. WordPress preparation, scanning, planning, media
download and handoff generation work fully offline without a node; only
optional QDN read-back needs one.

## Unsupported content types (UX-006)

The generic "unsupported content type" warning now lists what was skipped and
why, for example "Skipped unrelated WordPress content: 12 media-library
attachment(s), 3 reusable block(s). The planner supports posts and pages only;
no supported post or page content was dropped." Counts are per type in the
warning details.

## Verification

- Desktop: typecheck plus Vitest suites, including new regression tests for
  BUG-001 (legacy persisted state), BUG-002 (real resource shape without
  `status`), the error boundary, node connectivity, text size and honest
  progress.
- Engine: full root test suite plus an attachment-heavy fixture that reproduces
  601+ required media before the policy and 3 after it.
- Packaged app: a real Electron run from the built package opens a seeded
  project, generates a handoff through the UI, exports the Publisher ZIP,
  verifies manifest/hashes, restarts and reopens the handoff. The recorded run
  (0.8.0-alpha.11) verified 10/10 resources, passed the released Publisher
  handoff validator, and reproduced the identical ZIP SHA-256 after restart
  (no renderer exceptions).
- Release: `qortal-migration-studio_0.8.0-alpha.11_amd64.deb`,
  108,520,072 bytes, SHA-256
  `29b2a1e45c16c3a040803de4449c71a06062d62c7d0c998d0b57c6ac42e95b9e`;
  reproducible from a clean `git archive` build.
