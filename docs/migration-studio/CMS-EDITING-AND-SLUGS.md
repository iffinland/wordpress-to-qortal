# CMS editing, imported content and slug integrity

Applies to the Generic CMS template (`templates/generic-cms`) shipped as the
Generic CMS Q-App, including sites whose catalog was produced by
Qortal Migration Studio.

## 1. What can be edited

Owner mode exposes a real Edit action for every item in the catalog:

| Content | Edited where | Published as |
| --- | --- | --- |
| CMS-authored post/page | Posts -> CMS-authored -> Edit | versioned update of `qms-cms-native-index` + `qms-qdn-content@1` |
| WordPress-imported post/page | Posts -> Imported WordPress -> Edit | new `qms-cms-edit-overlay` entry + CMS-owned `qms-qdn-content@1` |
| Local draft | Posts -> Local drafts | browser storage only until published |
| Gallery | Galleries -> Edit / add batch | versioned update of `qms-cms-galleries` |
| Site identity/footer | Site settings | versioned update of `qms-cms-site-settings` |

Editable fields: title, slug, rich-text body, excerpt, categories, tags,
author, content type for new items; gallery title, description, per-image
caption and alt text, image order and membership.

Every editor view offers **Save draft**, **Preview**, **Publish** and
**Cancel/Back**, with an unsaved-changes guard. A locally saved draft is
labelled **not published** in the UI and in storage (`publicationState: draft`
or `modified-unpublished`).

## 2. Slug bug: root cause

Observed live: typing the title `Teine test post` produced the slug `t`.

Pre-fix code in `templates/generic-cms/src/pages/admin/EditorPage.tsx`,
lines 243-244 at baseline `af64269`:

```tsx
<label>Title<input value={draft.title} onChange={(event) => persist({ ...draft,
  title: event.target.value, slug: draft.slug || slugify(event.target.value) })} /></label>
<label>Slug<input value={draft.slug} onChange={(event) => persist({ ...draft,
  slug: slugify(event.target.value) })} /></label>
```

Cause: a one-time latch in the change handler, not an effect-ordering
problem.

1. The first keystroke sets the title to `T`. The slug is still empty, so
   `draft.slug || slugify("T")` evaluates to `t`.
2. Every later keystroke sees `draft.slug === "t"`, which is truthy, so the
   fallback never runs again. The slug stays `t` for the complete title.

The same latch existed in `GalleryAdmin.tsx`
(`slug: editing.slug || slugify(event.target.value)`). The slug input also
called `slugify()` on every keystroke, so typing a hyphen or space was
destructive (`my-` became `my` and the next letter was appended without the
separator).

Fix: a pure reducer (`src/lib/slugField.js`) regenerates from the complete
current title on every change while the slug is untouched, marks the slug
manual on the first manual edit, and locks published items. The slug input uses
`sanitizeSlugTyping()`, which keeps one trailing hyphen while typing and
normalizes only on save/publish.

Regression tests: `tests/slug.test.ts` and `tests/editor.test.tsx` cover
character-by-character typing, pasted titles, Estonian titles, manual edits,
duplicates, the published lock and the advanced change flow.


## 2a. Stale deployment check (why the live site still showed t)

The root-cause fix above is only effective when the deployed CMS bundle
actually contains it. A live-site audit on 2026-11-08 found a mixed state:

| Signal | Live WEBSITE developer iffi | Current release build |
| --- | --- | --- |
| Script asset | assets/index-boCGirRd.js | assets/index-DO0Igp7n.js (0.8.0-alpha.7 baseline) |
| Build marker | 0.8.0-alpha.5 | 0.8.0-alpha.7 baseline |
| Slug reducer | absent | src/lib/slugField.js |
| Old handler present | yes: slug: o.slug || dt(Q.target.value) | no |
| Imported WP editing | remain read-only | full edit overlay |

The live bundle contains the exact one-time latch, so the behaviour was not a
display-only issue: the first keystroke was stored in the draft and then
published as the native-index slug and content identifier. The live catalog
contained one such published item (t for Teine postitus), while none of the
five imported posts had a truncated slug.

Three robustness changes make a wrong deployment visible and harmless in the new
build:

1. The Admin toolbar and footer show the exact template version. Admin also
   states that an older version means a stale Q-App/WEBSITE bundle.
2. Save draft and Publish refuse an untouched one-character automatic slug
   derived from a longer title. The editor shows the historical truncation
   warning and a Regenerate slug action in place.
3. Published slugs remain locked, so an existing t item can still be edited
   without its identity changing silently; fixing it requires the explicit
   advanced slug action (alias + preserved old resource).

Troubleshooting: if the live site does not show the current template version,
the deployed bundle is stale. Republish the verified Generic CMS ZIP (APP or
WEBSITE) under the existing Qortal name; do not change qms-cms-config.json.

## 3. Slug rules

- Generated from the complete title: `Teine test post` -> `teine-test-post`.
- Continues updating while the owner has not touched the slug.
- The first manual slug edit sets `slugTouched`; later title edits never
  overwrite it.
- **Regenerate slug** explicitly rebuilds from the current title.
- The final slug is shown before publish, in the preview and in the
  confirmation dialog.
- A published item starts with a locked slug. Editing its title never changes
  the slug.
- Empty or structurally invalid slugs are rejected
  (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, max 96 characters).
- One-character slugs are valid. The repair report flags suspicious ones but
  never assumes short means broken.

### Unicode and Estonian normalization

Deterministic and implemented in `src/lib/slug.js`:

1. Explicit transliteration for characters that do not decompose:
   `ss` for sharp s, `ae`, `oe`, `o`, `d`, `th`, `l`, `i`, `h`, `t`, `k`.
2. NFKD decomposition and removal of combining marks:
   `a-umlaut -> a`, `o-tilde -> o`, `o-umlaut -> o`, `u-umlaut -> u`,
   `s-caron -> s`, `z-caron -> z`, plus acute/cedilla/tilde accents.
3. Lowercase, `&` -> ` and `, drop apostrophes, every other run of
   non-`[a-z0-9]` becomes one hyphen, trim hyphens.

Examples asserted in tests:

| Title | Slug |
| --- | --- |
| `Teine test post` | `teine-test-post` |
| `Pohja-Tallinn oaousz` (Estonian letters) | `pohja-tallinn-oaousz` |
| `Szoaou` (letters with carons and umlauts) | `szoaou` |
| `Cafe deja vu` (accented) | `cafe-deja-vu` |
| `Strasse & Groesse` (sharp s) | `strasse-and-grosse` |

Cyrillic and other scripts without a Latin transliteration produce an empty
slug and are rejected with a validation message; they are never silently
published as an empty or one-character slug.

### Uniqueness

Collision checks cover imported posts, CMS-authored entries, local-edit overlay
entries, pages and preserved aliases. Auto-generated duplicate titles receive a
deterministic suffix: `teine-test-post`, `teine-test-post-2`,
`teine-test-post-3`. Manual duplicates are rejected with a suggested free slug.

### Changing a published slug

Title edits do not change a published slug. A slug change is an explicit
advanced action:

1. The owner opens **Change slug (advanced)...** and confirms the consequences.
2. The old slug is written to `slug_aliases`; the catalog resolves the alias
   to the same item, so in-CMS links keep working.
3. The old `qms-qdn-content@1` resource is kept. It is never overwritten or
   deleted. The new slug uses a new content identifier.
4. The CMS search document removes the old slug entry and adds the new one.
5. External links that use the QDN content identifier keep working because
   that resource still exists. External links that use the website route slug
   resolve through the alias.

If a deployment cannot support aliases (for example a custom template that
ignores `slug_aliases`), the safe behaviour is to block the change; the shared
template never silently replaces or deletes published resources.

## 4. Imported WordPress content and sync conflicts

Imported content is never edited in place. An owner edit creates:

- `DOCUMENT / <name> / qms-cms-edit-overlay` (`qms-cms-edit-overlay@1`) with
  an entry keyed by the imported item id;
- a CMS-owned `qms-qdn-content@1` resource with
  `source.adapter = "wordpress-overlay"` and the original source metadata.

The overlay entry keeps `source_item_id`, `source_type`, `source_slug`,
`source_adapter`, the WordPress `source_id`, the original URL, the original QDN
content reference in the content payload, the current slug and aliases.

### Ownership and conflict model

- The imported catalog, indexes and content resources remain authoritative for
  the WordPress source and are never modified by the CMS.
- `base_source_hash` records the upstream fingerprint on which the edit was
  based (`title + html + excerpt + modified_at + source id`).
- **Unchanged source:** the overlay applies silently; an incremental sync or a
  full catalog rebuild cannot erase the edit.
- **Changed source:** the admin editor shows both titles/excerpts and offers:
  - **Keep my edits** - rebase `base_source_hash` to the new upstream
    fingerprint; the local edit stays published.
  - **Accept upstream** - remove the overlay entry; the imported content is
    shown again. The removed overlay content resource is kept (not deleted).
- Publishing an overlay edit while the conflict is open is blocked until the
  owner resolves it.
- If the imported item disappears (withdrawal), the overlay entry is preserved
  and reported as orphaned; nothing is silently deleted.

The overlay uses the same `qms-qdn-content@1` format as every other post, so
there is no second incompatible post format. Search entries for edited
imported items are written to the CMS search index under the imported item id.

## 5. Publication states

`draft`, `modified-unpublished`, `pending-approval`, `pending-confirmation`,
`published`, `partial` (search index pending), `ambiguous` (outcome unknown,
never auto-resent), `failed`. A local draft is always labelled as not
published.

All QDN writes go through owner revalidation, fee quoting, revision collision
checks and exact byte-for-byte read-back. The editor never reports success from
a submitted transaction alone.

## 6. Repair of one-character slugs

Posts -> **Slug health and repair** reports:

- local drafts whose one-character slug does not match the title;
- published CMS-authored or overlaid items with the same signature.

The report is detection-only. Drafts can be opened and regenerated. Published
items require the advanced slug workflow. Nothing is renamed automatically and
publication history is not rewritten. Imported items are repaired through an
overlay, so the imported resource and its metadata stay intact.

Run the audit any time with `npm run cms:slug-audit` (read-only; it never
authenticates, signs or writes). It reads the live manifest, imported indexes,
native index and edit overlay and prints counts plus findings.

Live audit (2026-11-08, read-only, DOCUMENT / developer iffi): 5 imported
posts, 0 with one-character or truncated slugs; 2 CMS-authored native posts,
1 with the historical t slug. The affected item is Teine postitus (/t),
published by the stale 0.8.0-alpha.5 bundle. It is reported, not renamed. The
other native post (/testpostitamine) is unaffected.

## 7. Featured images

The post/page editor has an optional featured-image field. It supports:

- choosing an existing QDN image from the catalog, a gallery, or a QDN search;
- uploading a local image, previewed before publication;
- replacing or removing the current choice;
- seeing exactly which image will be used before publishing.

The exact helper text shown in the editor is:

> Featured image is optional. If you don’t choose one, the first suitable image
> in your post will be used automatically. If your post has no images, it will
> be published without a featured image.

### Resolution order

1. An explicit owner selection.
2. A preserved WordPress featured image (until the owner selects, replaces or
   removes it).
3. The first suitable image in the post body.
4. No featured image.

Automatic selection is deterministic: images are considered in document order
and the same body always selects the same image. Tracking pixels, spacer/blank
pixels, icons, SVG placeholders, video thumbnails, data:/blob: URLs and broken
or non-resolvable references are skipped. A body image that resolves to a known
QDN media reference is stored as a QDN reference; an external body image is
stored as an external URL fallback.

### Publication and metadata

- The native index entry carries featured_image, featured_image_url,
  featured_image_alt and featured_image_source.
- The qms-qdn-content@1 payload carries the same image under media.featured
  with role "featured".
- WordPress-imported edits carry the fields in the versioned edit-overlay
  entry; imported resources are never modified.
- A local image is published first through the owner-guarded media plan
  (content-addressed identifier, collision check, fee and exact read-back),
  then the post is published. The confirmation dialog quotes four resources
  when a new image joins the three document writes.
- An already published image with identical bytes is reused instead of
  re-uploaded.

The rendered image is used on home cards, post lists, the post detail page and
search results. Posts with no featured image render normally without one.

### WordPress compatibility

An imported explicit WordPress featured image is preserved. If the imported
item has no featured image, the first suitable body image is used. Imported
resources and their original metadata are never rewritten.
