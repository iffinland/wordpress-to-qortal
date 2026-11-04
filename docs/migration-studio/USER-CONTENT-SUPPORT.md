# What migrates — content-only import guide

Qortal Migration Studio copies **content**. It does not reproduce WordPress
plugin functionality or website behaviour. A migrated QDN site is static: forms,
carts, logins and plugin scripts cannot run there.

## Supported

- Posts, pages, categories and tags.
- Editorial text and headings.
- Safe HTML formatting: paragraphs, lists, tables, quotes, emphasis, code.
- Internal and external links.
- Images, including images inside plugin-generated galleries.
- Supported audio and video elements.
- PDFs and other supported attachments.
- Media linked from editorial content.

## Not migrated

- Contact, booking, survey and submission forms.
- Carts, payments, checkout and donation widgets.
- Plugin-specific JavaScript and backend integrations.
- Authentication, membership and access-restricted workflows.
- Interactive embedded apps and third-party widgets.
- Plugin shortcodes whose output depends on a live WordPress plugin.

## What happens to unsupported functionality

Unsupported interaction is removed **before** the content hash is calculated.
Editorial text, links, images and supported media inside or around a
plugin-generated block are kept; only the non-functional interaction is
removed. A whole article is never dropped merely because a plugin generated part
of it.

Forms are never re-created. If a generic WordPress form wraps editorial
paragraphs, images or links, QMS salvages that inner content as neutral HTML.
The canonical page contains no `<form>`, no text fields, selects, textareas or
buttons, no hidden inputs, no CSRF/nonce fields and no submission URL such as
`admin-post.php`. Payment fields and checkout controls are removed with the same
rule. This is deterministic: unrelated nonce rotation cannot change the hash.

Each affected item gets a structured import warning containing:

- the source item (for example `page:108`),
- the unsupported feature type (for example `contact_form`),
- a suggested manual review,
- **no** form values, credentials or short-lived tokens.

Example warning:

```json
{
  "code": "UNSUPPORTED_INTERACTIVE_CONTENT",
  "message": "Unsupported contact/booking form was removed from imported content. Review this item manually.",
  "details": {
    "sourceKey": "page:108",
    "feature": "contact_form",
    "provider": "jetpack",
    "suggestion": "Replace this functionality with a Qortal-native service after migration."
  }
}
```

After migration, replace the removed functionality manually with a Qortal-native
service or a link to a service the site owner controls. QMS does not create
forms, payment flows, accounts or plugin backends.

## Volatile tokens

Some plugins embed short-lived tokens in rendered HTML. For example, the Jetpack
contact form places a rotating JWT in a hidden input. QMS removes the form and
the token before hashing, never stores the value, and therefore does not report a
false modification when only the token changes. A real editorial change still
changes the content hash.

WordPress can also assign per-request block instance ids such as
`wp-block-gallery-1` or `wp-block-gallery-4` to the same gallery. QMS removes
these instance ids before hashing. Attachment ids (`wp-image-44148`) and
layout classes (`columns-3`) are kept.

## Scoped scans and withdrawals

A full reconciliation only removes local mappings for missing source items when
the scan proves **full-site coverage**. Scoped scans — search, category/tag,
date, status, content-type subset, item limit, or an unknown future filter — are
useful for reviewing a delta but never infer missing-item withdrawal and never
advance the synchronization watermark. A failed, interrupted or truncated scan
also never withdraws.

Withdrawals are local: published QDN data is not deleted or modified.

## Upgrading an existing project

The content-only policy changes the canonical hash for items that previously
contained plugin chrome or volatile tokens. The first scan after upgrading may
therefore report those items as modified once. Their QDN identifiers and
published resource identities stay unchanged.
