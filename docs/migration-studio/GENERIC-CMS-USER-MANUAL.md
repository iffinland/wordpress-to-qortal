# Generic CMS user manual

Generic CMS is the public QDN site runtime plus an owner-only admin area. It is not a QMS import wizard and it does not deploy itself. Visitors are read-only. Owner controls appear only after the connected Qortal account is verified as the on-chain owner of the hosted QDN name.

## 1. Public pages, navigation, and search

The header brand returns to **Home**. Configured navigation links open their public routes: posts, archive, search, pages, categories, tags, or gallery. **Gallery** is added when published galleries exist. **Admin** is hidden from visitors and appears only for a verified owner.

The theme control changes light, dark, or system appearance. The status badge says **Read-only**, **Checking access**, or **Owner mode**. A non-owner can use **Connect owner account** to ask Hub for identity/ownership verification, or **Retry verification** when the lookup must be repeated. A public site does not prove ownership.

Use public cards/titles to open posts and pages. Category, tag, and archive links filter listings. On search, type terms in **Search the site**; quote a phrase to search that phrase. Use pagination where offered, post previous/next links when available, and the gallery's image previous/next controls. **Check for updates** only checks for a verified newer CMS release; it does not download or install anything.

## 2. Enter owner administration

Open **Admin** (the #/admin route). During lookup, the app shows **Checking QDN name ownership...**. If it cannot verify, it stays read-only: use **Connect owner account** or **Retry verification** and correct the Hub/name condition.

A verified owner sees four tabs: **Overview and import**, **Site settings**, **Posts**, and **Galleries**. Publication actions revalidate owner identity immediately before Hub signing.

## 3. Overview, catalog, and Adoption

**Access** shows evidence fields: **QDN name**, **Account**, **Name record**, and **Verification**. Read them before making an owner change.

**Catalog** shows catalog state, source, generation time, counts for posts/pages/CMS-authored items/categories/tags, and **Refresh catalog**. Refresh reads the published catalog again. If it says no published catalog exists, publish the site through QMS and Migration Publisher first.

### Adoption: exact scope and procedure

**Adoption** stages selected published catalog items in a local browser queue. It is not a WordPress import, content editing, QDN publication, Generic CMS deployment, or a catalog change. It requires:

1. A readable, published catalog (not loading/error).
2. The verified on-chain owner of the hosted name.
3. One or more selected catalog post/page rows.

In **Import and adoption**, each **Catalog items** row has a checkbox, title, and type/slug (and /CMS for native CMS content). Tick the desired rows and click **Adopt selected (N)**. The status message confirms the local queue. **Adopted items** lists each reference with title/type/slug/source. Click **Remove** to remove it from this local queue.

Adoption neither signs nor modifies QDN resources. Removing an adopted record does not delete, withdraw, edit, or unpublish remote content. The queue is browser-local to this site identity. This distinction is intentional: use editing/publishing controls described below to change content, and QMS/Publisher to deploy a CMS.

## 4. Site settings

Open **Site settings** and use these **Identity** controls:

| Control | Meaning |
| --- | --- |
| **Site title** | Public name, up to 120 characters. |
| **Tagline** | Public subtitle, up to 200 characters. |
| **Description** | Longer public description. |
| **Footer text (separate from the Qortal attribution)** | Optional footer copy, up to 500 characters. |
| **Public author name** | Public author metadata. |

Under **Navigation**, each item has **Label** (up to 40 characters) and **Link** (for example #/posts). **Remove** deletes an item while at least one remains; **Add navigation item** adds an item up to the visible limit of 12. **Branding colors** exposes the actual color-key text fields used for the saved theme; light mode derives an accessible palette while preserving the accent.

**Save local draft** stores settings only in the browser. **Revert to published** abandons that working draft. **Preview draft** and **Stop preview** start/end local preview. **Publish settings…** opens confirmation: inspect it, then choose **Confirm publish** to request owner publication or **Cancel**. Drafts/previews are never public.

## 5. Posts and pages

Open **Posts**. **New post** begins CMS-authored post content; **New page** begins CMS-authored page content. Lists for **Local drafts**, **CMS-authored posts and pages**, and **Imported WordPress posts and pages** expose **Edit**. Imported editing does not claim to re-import WordPress content. **Slug health and repair** presents flagged slugs and applicable repair action.

In the editor use each visible control:

| Control | What it does |
| --- | --- |
| **Title** | Public title, up to 200 characters. |
| **Slug** | URL component; new content can regenerate it, published slugs are protected. |
| **Excerpt** | Listing summary. |
| **Categories (comma separated)** / **Tags (comma separated)** | Comma-delimited public terms. |
| **Author** | Public author metadata. |
| **Content type** | Post/page where the editor offers the selection. |
| Body toolbar | **H2**, **H3**, **Bold**, **Italic**, **Bullets**, **Numbers**, **Quote**, **Link**, **Image**, **Undo**, and **Redo** format or change the rich-text body. **Link** requests a target; **Image** opens media selection. |

For published content, **Change slug (advanced)…** opens an explicit safeguard. Tick its confirmation checkbox, click **Unlock slug field**, then type the new slug. **Cancel** keeps it locked; **Cancel slug change** abandons the change. Use **Regenerate slug** when offered. A title change does not change a published slug.

The **Featured image** panel displays the current choice. Click **Choose a featured image** to open its picker. Choose a device file, **Use automatic featured image**, or **Publish without a featured image**. **Automatic choice** explains its candidate. Under **Choose an existing QDN image**, type caption/title in **Search**, click **Search QDN**, then choose an existing image.

Use **Save draft**, **Preview** / **Close preview**, and **← All posts** for local work. Leaving changed content asks **Save draft and leave**, **Discard changes**, or **Stay**. If the source changed, choose **Keep my edits** or **Accept upstream** after review. **Publish post…** opens **Confirm post publication**; use **Confirm publish** to request owner publication or **Cancel**. A draft is never published.

## 6. Media and galleries

The **Media** dialog provides **Upload from this device** with a file picker and **Publish** for selected files. **Existing QDN media** has **Search** (caption/title) and **Search QDN**, then a selectable result. **Close** exits without further selection.

In **Galleries**, **New gallery** begins a gallery and **Edit / add batch** opens one. Set **Gallery title**, **Slug** (or **Regenerate slug**), and **Description**. Existing images have **Caption**, **Alt text**, **Move up**, **Move down**, and **Remove**. Under **Add a batch of local images**, select multiple files up to the shown maximum, set each **Caption**, or **Remove** it before publishing. Under **Reuse existing QDN media**, click **Add** beside a result.

Use **Publish gallery…** only after reviewing the gallery and then confirm the owner flow in Hub. **← All galleries** returns without publishing. A gallery becomes public only through this explicit confirmed owner publication.

