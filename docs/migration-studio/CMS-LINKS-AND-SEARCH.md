# CMS links and full-text search

This page documents the link policy, clipboard behaviour and the versioned
search index in the Generic CMS template (templates/generic-cms).

## qortal:// links

A link is accepted only when it matches qortal://<SERVICE>/<name>[/<path>] with
a Qortal QDN service (WEBSITE, APP, DOCUMENT, IMAGE, AUDIO, VIDEO, FILE, GAME,
MULTI) and a non-empty percent-encoded name. The original href is preserved byte
for byte, so qortal://APP/developer%20iffi/ reaches Hub with exactly one
encoding.

- The DOMPurify policy allows the qortal scheme explicitly (ALLOWED_URI_REGEXP);
  every qortal href is then re-validated structurally. Other unknown schemes are
  still stripped.
- javascript:, data:, malformed percent escapes, whitespace/control characters
  and unknown services are rejected.
- Inside Hub, click/Space calls qortalRequest({ action: 'OPEN_NEW_TAB',
  qortalLink }) and does not navigate the iframe.
- Outside Hub the link is copied to the clipboard and a message explains that it
  must be opened in Qortal Hub. window.open and target=_blank are not used.

The editor accepts qortal:// in the Link dialog, and Tiptap's Link extension
lists qortal in its protocols. Internal #/ links remain normal hash routes.

## https:// links

In rendered content (imported posts, CMS posts and pages):

- A click/tap or keyboard activation copies the full URL and prevents
  navigation.
- A small badge appears next to the clicked link for about 2 seconds:
  **Link copied.** Success uses role="status"; failure uses role="alert" and
  shows the URL so it can be copied manually.
- navigator.clipboard.writeText is preferred; a hidden textarea plus
  document.execCommand('copy') is the Hub-compatible fallback.
- Enter works because anchors are native; Space is handled explicitly for
  focused links. Touch uses normal click semantics.
- In-app #/ links, Qortal links and modifier clicks are not intercepted.

## Search index

Schema: qms-cms-search-index@1. Resource:
DOCUMENT/<site name>/qms-cms-search-index.

Example shape:

    {
      "schema": "qms-cms-search-index@1",
      "version": 1,
      "revision": 3,
      "site_id": "site-id",
      "source": "cms",
      "updated_at": "2026-11-06T00:00:00.000Z",
      "entry_count": 1,
      "entries": [
        {
          "id": "draft-...",
          "type": "post",
          "title": "Põhja-Šotimaa reis",
          "slug": "pohja-sotimaa-reis",
          "excerpt": "Short excerpt",
          "text": "Normalized plain text of the body",
          "updated_at": "2026-11-06T00:00:00.000Z",
          "origin": "cms"
        }
      ]
    }

- **CMS publishing** upserts one entry and publishes the document after the
  content and native catalog index are verified. A search failure is reported as
  partial, not success.
- **QMS imports** add a search index resource to the publication payload set;
  qms-qdn-manifest@1.entrypoints.search points at it. The resource contains only
  text (never media bytes) and is generated from the content payload body.
- **Normalization** is NFC + lowercase. Accent folding is used for matching and
  highlight mapping, so "pohja" matches "Põhja" while the original text and
  Estonian characters are preserved.
- **Matching** requires every term and every quoted phrase to occur in title,
  excerpt or body. Ranking prefers title prefix/exact, then title substring,
  excerpt and body. Results are deterministic and tie-broken by date and title.
- **Highlighting** maps folded match offsets back to the original text and
  renders mark elements through React text nodes. Queries are never injected as
  HTML. The opened article is highlighted client-side with a text-node walker.
- **Loading** happens once per page session through the repository; input is
  debounced by 220 ms and stale requests are cancelled. No QDN scan runs per
  keystroke and no media is downloaded for text search.
- **Merging** combines the manifest-provided imported index with the CMS-native
  document. Native entries win for the same type+slug because they are the
  newest version of an edited post. Entries are filtered against published
  catalog items, so drafts never appear in search.
- **Missing/invalid/newer-schema** indexes fall back to title/excerpt search and
  display an honest notice. A stale index (older than 30 days) is labelled.

### Rebuild and migration

Existing sites have no search entrypoint or native search document. They
continue to work with the title/excerpt fallback until either:

1. the owner publishes any post from CMS Admin, which creates/updates
   qms-cms-search-index; or
2. the site is republished from Qortal Migration Studio so the manifest gains
   the imported search entrypoint.

Rerunning either path is safe: publishing recomputes the affected entry, and the
index is deterministic (sorted by title, revision increments). No destructive
migration is required, and unknown newer versions are rejected rather than
overwritten.

### Tests

- templates/generic-cms/tests/search.test.ts - schema, Unicode, phrases,
  snippets, ranking, highlighting, stale/missing index, drafts and mixed origins.
- templates/generic-cms/tests/links.test.tsx - qortal parsing/sanitizing, https
  clipboard + badge lifecycle + failure, keyboard, Hub bridge, footer.
- test/phase6/search-index.test.js - import publication generates the index and
  the manifest entrypoint.
- test/phase5/handoff.test.js - the handoff includes the extra index resource.
