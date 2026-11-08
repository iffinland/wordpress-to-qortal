# Bounded source scans, pause/resume and large-site recovery

This document covers QMS source discovery for very large WordPress sites. It
explains why the previous flow could crawl an entire site before preparing a
small import, and the bounded scan contract that replaces it.

## Why the old flow was unbounded

Discovery used to run three unconditional full enumerations:

1. every category and tag,
2. every media-library attachment,
3. every post and page.

The wizard's **Continue** button also ran that discovery automatically when no
completed scan existed. A restart turned the interrupted run into
`interrupted`, but Continue still saw no completed scan and started the same
full crawl again. The engine checkpoint at `terms_done` was resumable in name
only; its resume action did not carry a batch or page cursor, so a resume could
repeat the work.

For a site with ~35,600 posts, ~250,279 media records and ~2,094 taxonomy
terms, that meant thousands of REST pages before the owner could prepare three
posts.

## Scan modes

Discovery now requires an explicit mode.

### Quick scan — selected batch (recommended default)

```js
{
  mode: 'quick',
  contentTypes: ['post'],
  perPage: 100,
  selection: { perPage: 100, maxPages: 1, maxItems: 3 }
}
```

The desktop wizard always requests a full 100-item page and keeps only
`maxItems` items. Some WordPress APIs return fewer rows than `per_page`
(NASA returns 1 row for `per_page=3` and 45 for `per_page=100` while
`X-WP-Total` reports 35,600). A tiny page size would therefore index fewer
items than the owner asked for. Requesting a full page keeps the one-request
contract and still fills the requested window.

A quick scan:

- fetches one bounded content window (default one REST page, at most 100
  items; `maxPages` is capped at 20 for explicit multi-page windows),
- pushes `include=`/`slug=` and configured `after`/`before`/`categories`/
  `tags` filters to the WordPress API,
- requests only the taxonomy terms referenced by those items
  (`categories?include=...`, `tags?include=...`),
- requests only featured media and media referenced by the editorial HTML
  (`media?include=...`), never the rest of the media library,
- never calls site-wide counts or enumerates custom post types,
- writes only the selected content plus its referenced term/media dependency
  records.

A three-post quick scan normally needs about six requests:

| Request | Purpose |
| --- | --- |
| `GET /wp-json/` | REST contract |
| `GET /wp-json/wp/v2/types` | capabilities |
| `GET /wp-json/wp/v2/posts?per_page=3&_fields=...` | selected content |
| `GET /wp-json/wp/v2/categories?include=...` | referenced categories |
| `GET /wp-json/wp/v2/tags?include=...` | referenced tags |
| `GET /wp-json/wp/v2/media?include=...` | featured/embedded media |

The exact upper bound is:

```
content pages: maxPages * contentTypes
term pages:    ceil(referencedCategories / 100) + ceil(referencedTags / 100)
media pages:   ceil(referencedMediaIds / 100)
```

If a window contains no referenced term or media, those requests are skipped.

### Full site inventory (explicit)

```js
{ mode: 'full', perPage: 100 }
```

This is the old exhaustive inventory, now an explicit operator choice. It is
resumable at terms, assets and content page boundaries. The UI shows the
worst-case page count from the validated site counts and requires a separate
confirmation checkbox before it can start.

The engine API keeps `mode: 'full'` as its default for backward compatibility;
the desktop UI defaults to Quick scan and never selects Full inventory
implicitly.

## REST efficiency

- `per_page` is capped at 100.
- `_fields` trims content, term and media payloads.
- `include` and `slug` keep known selections server-side.
- Page iteration is page-based, not offset-based, so later batches continue
  without rescanning indexed content.
- One featured-media include query is issued per content page instead of one
  request per post.
- Request timeouts are 15 s by default; retries are bounded and use backoff.
  Cancellation aborts in-flight requests.

## Short pages and source under-return

A source may return fewer usable rows than `per_page` even though
`X-WP-Total` advertises more matching items. QMS never pads, invents or
silently drops items:

- the quick scan keeps the rows the source returned (up to `maxItems`);
- the scan scope records `requested`, `scanned`, `availableTotal`,
  `underReturned` and `shortfall`;
- a `SOURCE_UNDER_RETURNED` warning is written to the report and
  `latest.json`;
- the UI states the source short page with requested/scanned/available
  counts, so "Posts indexed" cannot be mistaken for a local counting bug.

With the wizard's full-page request, a NASA-style proportional short page
(`per_page=100` -> 45 rows) still fills a three-item window in one request.

## Scope vs available content

Every completed batch report and `latest.json` record both:

- `counts`: what this batch actually indexed (posts, pages, referenced
  categories/tags, media dependencies), and
- `scope`: mode, filters, requested limit, pages fetched, worst-case pages,
  referenced terms, media dependencies, API requests, bytes transferred, and
  `totalAvailable` reported by the source's `X-WP-Total` header for the
  selection.

No percentage is invented from an unknown total. Progress uses real counters
and lets the UI show an indeterminate state when `totalAvailable` is unknown.

## Pause, resume and cancel

- **Pause** aborts the current request at a safe boundary, persists the
  checkpoint, and leaves the run in `paused`. Completed pages, referenced
  terms, media records and written documents stay on disk.
- **Resume** re-drives the same batch from its durable state file. Quick scans
  cache the bounded content window and skip completed pages; full scans record
  per-type page cursors and skip completed term/asset/content pages. The batch
  writer resumes its append-only index and skips already-written source keys,
  so a resume never duplicates index entries.
- **Cancel** ends the operation and keeps the project, previous completed
  batches, checkpoints and verified assets. A cancelled batch is never the
  latest pointer.
- Only one run of a given kind may be active per project. A second overlapping
  discovery is refused with `OPERATION_ALREADY_RUNNING`.

Checkpoint stages:

| Mode | Stages |
| --- | --- |
| quick | `connect`, `content_page`, `content_fetched`, `terms_page`, `terms_done`, `media_page`, `media_done`, `content_write` |
| full | `connect`, `terms_page`, `terms_done`, `assets_page`, `assets_done`, `content_page` |

## Restart and ledger reconciliation

On project open:

- persisted `running` runs become `interrupted`;
- every checkpoint file still marked `running` is reconciled against the run
  ledger: terminal runs get a terminal checkpoint and lose `resumable`;
  paused/interrupted runs keep a valid resumable checkpoint; orphaned
  checkpoints are marked interrupted rather than looking active;
- submitted publication resources without evidence become `ambiguous` and are
  never resubmitted automatically.

The wizard shows an interrupted-scan banner with the checkpoint step and asks
the owner whether to resume or start a new bounded scan. Continue never
launches a long scan on its own.

Legacy checkpoints that predate durable scan state (no batch id and a step
beyond `connect`) are rejected as `RECOVERY_NOT_RESUMABLE`. Start a quick scan
or explicitly choose a new full inventory; QMS does not silently repeat a
huge crawl.

## Large-site guidance

- For a small import, keep Quick scan and index only the window you need
  (default 100 newest items). Plan in small batches from that window.
- Before a larger run, use the validated counts to understand the full
  inventory cost. For the NASA-scale example, full inventory needs roughly
  `ceil(35,600/100) + ceil(2,094/100) + ceil(250,279/100)` ≈ 2,892 pages.
  Quick scan for three posts needs about six requests.
- Use `after`/`before` date filters or taxonomy filters to narrow a full scan.
- Pause is safe during long inventories. Resume from the same checkpoint after
  a restart; do not start a second scan while one is paused unless you intend
  to abandon it.
- Limit memory/CPU/network by keeping one discovery run active and using the
  built-in per-page caps.

## Tests

- `test/source/bounded-discovery.test.js` uses a synthetic 36,000-post,
  250,000-media, 2,053-category, 50-tag fixture. It asserts a three-post quick
  scan issues one content page, only referenced term/media includes, and no
  more than ten requests; it also covers explicit full inventory, pause across
  restart and resume, stale-checkpoint reconciliation, single-flight, and
  cancel (no latest pointer, project kept, no resumable candidate). Two
  additional tests use a short-page fixture: a source returning 15 of 100 rows
  still fills a three-item window from one `per_page=100` request, and a
  source returning only 1 of 100 rows is recorded as `underReturned` with
  `SOURCE_UNDER_RETURNED` instead of looking like local loss.
- `scripts/release/packaged-bounded-scan-e2e.mjs` drives the packaged Electron
  app in an isolated rootfs over CDP against the same NASA-shaped fixture:
  Continue produces zero content requests, the confirmed quick scan stays
  inside the budget with include-only taxonomy/media lookups, and a paused run
  survives an app restart and resumes without re-fetching the content page.
- Desktop `wizard.spec.tsx` covers Continue without discovery, explicit quick
  confirmation, full-inventory acknowledgement, interrupted-scan resume, and
  active pause/cancel controls.
