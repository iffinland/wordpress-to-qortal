# Supported and unsupported content

QMS copies **content**, not WordPress behaviour. A migrated QDN site is static.

## Supported

- Posts and pages.
- Categories and tags as imported taxonomy resources.
- Editorial text and headings.
- Safe formatting: paragraphs, lists, tables, quotes, emphasis, code.
- Internal and external links.
- Images, including images inside plugin-generated galleries.
- Supported audio and video elements.
- PDFs and other supported attachments linked from editorial content.

## Not migrated

- Contact, booking, survey and submission forms.
- Carts, payments, checkout and donation widgets.
- Plugin-specific JavaScript and backend integrations.
- Authentication, membership and access-restricted workflows.
- Interactive embedded apps and third-party widgets.
- Comments, users, navigation menus, widgets and reusable block definitions.
- Custom post types. They are reported with counts, not migrated.

## Content-only normalization

Unsupported interaction is removed before the content hash is calculated.
Editorial text, links, images and supported media around a plugin block are
kept. An article is never dropped because a plugin generated part of it.

The canonical page contains no form, form control, hidden token, CSRF nonce,
submission URL or plugin script. Volatile gallery instance ids and Jetpack form
tokens are removed so that they cannot create false modifications.

## Warnings

Each affected item gets a structured warning with the source key, the
unsupported feature type, and a suggested manual review. Form values,
credentials and short-lived tokens are never included.

After migration, replace removed functionality manually with a Qortal-native
service or a link to a service you control.

The full reference is [../USER-CONTENT-SUPPORT.md](../USER-CONTENT-SUPPORT.md).
