# Generic CMS user manual

Generic CMS is the public QDN site runtime plus an owner-only admin area. It is not a QMS import wizard and it does not deploy itself. Visitors are read-only. Owner controls appear only after the connected Qortal account is verified as the on-chain owner of the hosted QDN name.

## 1. Public pages, navigation, and search

The header brand returns to **Home**. On narrow screens (720 px and below) the navigation is behind a hamburger **menu** button in a compact header (Escape closes it and returns focus to the button; it also closes when you open a page). Posts and Search are always in the menu. Configured navigation links open their public routes: posts, archive, search, pages, categories, tags, or gallery. **Gallery** is added when published galleries exist. **Admin** is hidden from visitors and appears only for a verified owner.

The theme control (inside the menu on phones) changes light, dark, or system appearance. There is no owner/read-only badge. When ownership can be checked, a non-owner can use **Connect owner account** to ask Hub for identity/ownership verification, or **Retry verification** when the lookup must be repeated. A public site does not prove ownership.

Use public cards/titles to open posts and pages. Category, tag, and archive links filter listings. On search, type terms in the search box; quote a phrase to search that phrase. Use pagination where offered, post previous/next links when available, and the gallery's image previous/next controls. **Check for updates** only checks for a verified newer CMS release; it does not download or install anything.

## 2. Enter owner administration

Open **Admin** (the #/admin route). During lookup, the app shows **Checking QDN name ownership...**. If it cannot verify, it stays read-only: use **Connect owner account** or **Retry verification** and correct the Hub/name condition.

A verified owner sees five tabs in three groups: **Site** (**Overview**, **Site settings**), **Content** (**Posts**, **Pages**) and **Media** (**Galleries**). **Posts** lists and creates posts; **Pages** lists and creates pages. The admin code loads only when you open Admin, so public visitors never download the editor. Publication actions revalidate owner identity immediately before Hub signing.

## 3. Overview and catalog

**Access** shows evidence fields: **QDN name**, **Account**, **Name record**, and **Verification**. Read them before making an owner change.

**Catalog** shows catalog state, source, generation time, counts for posts/pages/CMS-authored items/categories/tags, and **Refresh catalog**. Refresh reads the published catalog again. If it says no published catalog exists, publish the site through QMS and Migration Publisher first.

## 4. Site settings

Open **Site settings** and use these **Identity** controls:

| Control | Meaning |
| --- | --- |
| **Site title** | Public name, up to 120 characters. |
| **Tagline** | Public subtitle, up to 200 characters. |
| **Description** | Longer public description. |
| **Footer text (separate from the Qortal attribution)** | Optional footer copy, up to 500 characters. |
| **Public author name** | Public author metadata. |

Under **Navigation**, each item has a **Label** (up to 40 characters) and a **Target** picker (Home, Posts, Archive, Search, Gallery, Admin or any existing page such as Files; choose **Custom link…** for any other link). Reorder items with **Move up** / **Move down** or by dragging the handle; the order is saved in the settings document. **Remove** deletes an item while at least one remains; **Add navigation item** adds an item up to the visible limit of 12. **Branding colors** exposes the actual color-key text fields used for the saved theme; light mode derives an accessible palette while preserving the accent.

**Save local draft** stores settings only in the browser. **Revert to published** abandons that working draft. **Preview draft** and **Stop preview** start/end local preview. **Publish settings…** opens the **Confirm settings publication** window (a modal dialog, a full-width sheet on narrow phone screens): inspect the destination, revision, fee and signer, then choose **Confirm publish** to request owner publication, or **Cancel** / **Escape**. The same window then shows the progress and the result (**Published and verified**, **Publication unconfirmed**, **Not published** including a revision conflict); use **Close** to dismiss it. Focus returns to **Publish settings…**. Drafts/previews are never public.

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
| Body toolbar | **H2**, **H3**, **Bold**, **Italic**, **Bullets**, **Numbers**, **Quote**, **Color** (a palette of nine theme-aware text colors plus **Reset color**; the colors adapt to light and dark mode), **Link**, **Image**, **Attach file**, **Undo**, and **Redo** format or change the rich-text body. **Link** requests a target; **Image** opens media selection. |

For published content, **Change slug (advanced)…** opens an explicit safeguard. Tick its confirmation checkbox, click **Unlock slug field**, then type the new slug. **Cancel** keeps it locked; **Cancel slug change** abandons the change. Use **Regenerate slug** when offered. A title change does not change a published slug.

The **Featured image** panel displays the current choice. Click **Choose a featured image** to open its picker. Choose a device file, **Use automatic featured image**, or **Publish without a featured image**. **Automatic choice** explains its candidate. Under **Choose an existing QDN image**, type caption/title in **Search**, click **Search QDN**, then choose an existing image.

Use **Save draft**, **Preview** / **Close preview**, and **← All posts** for local work. Leaving changed content asks **Save draft and leave**, **Discard changes**, or **Stay**. If the source changed, choose **Keep my edits** or **Accept upstream** after review. **Publish post…** opens the **Confirm post publication** window, a modal dialog (a full-width sheet on narrow phone screens). It lists the title, final slug, content resource, index, featured image, fee and signer. The window lists every resource that will be published (featured image, content, index or overlay, search index, and the page assignments when changed) and the total fee. **One Qortal Hub approval** covers all of them; Hub then publishes them one after another (not atomically) and each is verified afterwards, so a failure can leave some resources published (**Published, one step pending**). If Hub does not support the combined request, the CMS falls back to one approval per resource; it never falls back after a decline, a partial result or an unconfirmed result. Use **Confirm publish** to request owner publication, or **Cancel** / **Escape** to leave without publishing; focus returns to **Publish post…**. After you confirm, the same window shows the whole publication: the progress (**Publishing…**, waiting for Qortal Hub approval; keep it open and note that **Escape** does nothing while a signature request is in flight), then the result: **Published and verified**, **Published, one step pending**, **Publication unconfirmed** (never resent automatically; verify, then use **Publish post…** again to re-check) or **Not published**. Use **Close** to dismiss the result; it also stays visible next to the buttons. A draft is never published.

### Optional cross-publication to Q-Tube, Subwire and Quitter

Below the featured-image panel, **Also publish to other Qortal apps** offers three independent, unchecked-by-default destinations. Normal CMS publishing is unchanged when none is selected. Each selected destination adds its own QDN resource to the same **Confirm post publication** window, the same single Qortal Hub approval and the same fee quote; the window lists every destination resource identifier and the complete fee before you confirm.

| Destination | Requirement | What is published |
| --- | --- | --- |
| **Q-Tube** | A video attachment in MP4, M4V, WebM or OGV (Q-Tube rejects MKV and HEVC). The option stays disabled otherwise. | One DOCUMENT metadata resource at `qtube_vid_<token>_metadata` with `tag1: qtube_vid_`. It references the existing VIDEO attachment, so the video bytes are never uploaded twice. |
| **Subwire** | A non-empty post body. | One DOCUMENT essay. The sanitized body is converted to Markdown (headings, paragraphs, lists, links, images, quotes and code); colour-only spans are flattened, and audio, video and file attachments are dropped because Subwire has no equivalent. A link back to the CMS post is appended. The featured image is embedded as the cover; if none can be embedded (for example an unreachable QDN image), a small generated cover keeps the article compatible. The article is kept below Subwire's 5 MiB discovery limit (4 MiB enforced). |
| **Quitter** | Announcement text within 280 characters. | One public DOCUMENT post containing `text`, `timestamp` and `name`. The announcement is prefilled with `New publication: <title>` and the public post link, and you can edit it. It is created only on the first publish and never repeated on edits. |

Destination identifiers are deterministic from the site and the CMS post id, so a retry after an unconfirmed or failed result targets the same coordinates and cannot create a duplicate publication. The CMS also stores an optional `qms-cms-crosspost` DOCUMENT with the destination identifiers and timestamps; a missing or invalid record is harmless. A destination whose published content is already byte-identical is shown as already published and is excluded from the batch and the fee. After publication the dialog lists a separate result for the CMS post and for each destination (published and verified, not published, declined, unconfirmed — never resent, or not sent). A failed optional destination never hides a verified CMS publication: the CMS post is saved as published and the window reports **Published, one step pending**. Live Q-Tube/Subwire/Quitter behaviour must be confirmed in a real Qortal Hub session; the bundled tests cover the request shapes and failure states, not a live ecosystem publish.

Posts can be shown on user-created pages: in the post editor, **Show on page(s)** lists the existing pages (for example Files); tick one or more. **Hide from home** removes the post from the home page's Latest posts (it stays in Posts, Archive and Search). Each page shows its own content followed by its assigned posts, paginated. Imported WordPress posts can be assigned too. The assignments are saved in the optional `qms-cms-sections` document and the publish confirmation lists it as an extra resource.

**Attach file** adds downloads, audio and video to a post. Allowed: text (txt, md, pdf), audio (mp3, m4a, aac, ogg, opus, wav, flac), video (mp4, m4v, webm, mov, ogv, mkv), archives (zip, 7z, rar, tar, gz, tgz, bz2, xz) and documents (doc, docx, xls, xlsx, odt, ods, ppt, pptx, csv, json, rtf). Web-executable files (html, htm, svg, js, mjs and similar) are refused; attach a zip instead. Limits are checked before any signing: audio and video up to 2000 MB (the Qortal Hub per-file limit), everything else up to 50 MB; when your Hub uses the public gateway node, 500 MB per file. The file is read when you pick it (important on Android, where the picker can revoke access). Under **Attachments** below the editor you can set a **Display title** for audio and video and, for video, upload an optional poster image; without one a frame about one second into the video is used, or a neutral placeholder if the device cannot decode it. Each attachment (and each poster) is its own QDN resource (AUDIO, VIDEO, FILE or IMAGE) named by its SHA-256 and reused when it is already published; they are part of the same single Hub confirmation as the post, and the confirmation window lists every resource and the total fee. Large files are sent to Hub by file reference, not base64.

When a post is viewed, attachments become: an inline **audio player** with the title (nothing loads until you press play); a **video card** showing the poster, which starts native playback in place when tapped; **archives and documents** as an icon, title and **Download** link (files are always downloaded, never opened inline); and **text files** (txt, md, pdf) with a **Preview** button. The preview opens a full-width sheet on phones (Escape or **Close** returns focus to the button; page scrolling is locked while it is open). txt is shown as plain text, md as safely rendered Markdown, and only the first 256 KB of large files is shown with **Download full file** for the rest. PDF text is extracted on demand (first 30 pages); scanned or unreadable PDFs show a clear message and the download button. The editor's **Preview** shows attachments, but they only play after the post is published.

## 6. Media and galleries

Publishing a gallery (**Publish gallery…**) opens **Confirm gallery publication**, which lists every new image resource and the gallery catalog with the total fee; one Hub approval publishes them all, with the same per-resource verification and partial-failure behavior as posts. Site settings are also published through the combined request.

The **Media** dialog provides **Upload from this device** with a file picker and **Publish** for selected files. **Existing QDN media** has **Search** (caption/title) and **Search QDN**, then a selectable result. **Close** exits without further selection.

In **Galleries**, **New gallery** begins a gallery and **Edit / add batch** opens one. Set **Gallery title**, **Slug** (or **Regenerate slug**), and **Description**. Existing images have **Caption**, **Alt text**, **Move up**, **Move down**, and **Remove**. Under **Add a batch of local images**, select multiple files up to the shown maximum, set each **Caption**, or **Remove** it before publishing. Under **Reuse existing QDN media**, click **Add** beside a result.

Use **Publish gallery…** only after reviewing the gallery and then confirm the owner flow in Hub. **← All galleries** returns without publishing. A gallery becomes public only through this explicit confirmed owner publication.

