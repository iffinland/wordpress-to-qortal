# Known issues and limitations — 0.8.0 alpha.9

These are release-gate facts, not a substitute for testing your own site. The
0.8.0-alpha.9 release is published as a prerelease with all three artifacts.
Downloading an artifact is not deployment or live validation.

## New in 0.8.0-alpha.9

1. **Fee quote corrected.** Both editing paths write three resources; alpha.8
   displayed a four-resource quote. Hub still shows the final fee before
   signing.
2. **Accept upstream now cleans the search index.** Removing a local edit also
   removes the CMS search entry for that imported item and verifies the write.
   If the cleanup write fails, the editor reports search pending rather than
   full success.
3. **Deep links restored.** `#/admin/editor/<id>` opens the published CMS item
   again.
4. **No live QDN write or signing in this release run.** The 0.8.0-alpha.8
   limitations below still apply, including the need for a supervised first
   overlay edit and CMS redeploy.

## New in 0.8.0-alpha.8

1. **Slug generation is fixed in code and rendered tests, not re-tested on the
   live deployed CMS.** The live site still runs an older bundle until the owner
   redeploys. Typing a title now produces the full slug; the old one-character
   slugs already stored in QDN are reported by the new slug-health panel and are
   never renamed automatically.
2. **Imported WordPress edit overlays are not yet live-published in this run.**
   The overlay publication path is covered by unit tests (revision conflicts,
   source conflicts, aliases, merge and sync preservation) and the content uses
   the existing verified `qms-qdn-content@1` publication path. Do a supervised
   first edit of an imported post in Hub.
3. **Published slug changes rely on in-CMS alias resolution.** Old URL routes
   keep working through `slug_aliases`; a custom template that ignores aliases
   must block slug changes. External QDN identifier links keep working because
   the old content resource is retained.
4. **Conflict detection compares a content fingerprint.** It covers title,
   body HTML, excerpt, modified time and source id. A source change that alters
   only uncaptured metadata (for example a WordPress author display name outside
   the content payload) may not raise a conflict.
5. **Withdrawn imported items keep their local edit orphaned.** The edit is
   preserved and reported; it is not deleted. Review orphan notices before
   relying on those links.
6. **No QDN write, signing or wallet action was performed in this release
   run.** All artifacts are built and tested locally; the owner approves any
   publication in Hub.

## New in 0.8.0-alpha.7

1. **Fee-quote correction only.** The CMS quote now counts content, native
   catalog index and search index (three signatures). Hub still shows the final
   fee before signing. Desktop 0.8.0-alpha.7 and CMS 0.8.0-alpha.5 are rebuilt;
   Publisher is byte-identical 0.8.0-alpha.2.
2. **No new live validation.** The alpha.6 publishing/search limitations below
   still apply.

## New in 0.8.0-alpha.6

1. **Existing sites need a republish to gain full-text search.** The template
   reads `qms-cms-search-index@1` from the manifest entrypoint (imports) and
   from `DOCUMENT/<name>/qms-cms-search-index` (CMS posts). Until a site is
   republished or a CMS post is published, search falls back to titles and
   excerpts and shows an honest notice.
2. **The search index is text only.** It stores normalized plain text or a
   compact excerpt, never media bytes. A very large body is truncated at 20 000
   characters per entry; the opened article always shows the full body.
3. **Index freshness is advisory.** Missing, invalid or newer-schema indexes are
   reported and do not crash search. Freshness is judged from the index
   timestamp with a 30-day threshold.
4. **qortal:// navigation requires Hub.** Outside Hub the click copies the link
   and explains that it must be opened in Hub. Browser protocol handlers are not
   assumed.
5. **Clipboard fallback depends on the embedding context.** `execCommand` is
   used when the async Clipboard API is blocked; if both fail the UI shows an
   explicit error and the URL so it can be copied manually.
6. **No live QDN write was performed in this release run.** The publishing fix
   is covered by unit and rendered-component tests; the owner must publish a
   test post in Hub to confirm the deployed site. Signing, wallet and QDN
   transaction behavior is unchanged.

## New in 0.8.0-alpha.5

1. **Existing projects are migrated, not recreated.** A wizard record with
   numeric `completedSteps` is normalized to canonical ids on first open. The
   migration is idempotent and preserves website settings, dates, plan ids and
   connection metadata. If a project is open in two app instances at once, close
   one before continuing.
2. **The first plan after upgrading may scan the whole site.** The desktop now
   requires a completed discovery batch. A large site (thousands of posts,
   tags and media) can take minutes; progress is shown, and the scan is not a
   publication or a transaction.
3. **Date filters are UTC date-only ranges.** "Published before" means through
   `23:59:59.999Z` of the selected day. WordPress timestamps are normalized as
   UTC; a post near local midnight can appear on the adjacent UTC date.
4. **An empty plan is intentionally not approvable.** Use the explanation to
   adjust the date range or content types. An empty plan never marks the wizard
   complete.
5. **APP and WEBSITE are separate deployments under the same name.** Changing
   the service after preparation creates a second site bundle; it does not
   overwrite the existing deployment. A different project identity derives a
   different identifier.
6. **This release run did not perform a QDN transaction.** Signing, wallet,
   broker and QDN publication were not exercised. The live first-run test was a
   real MX Linux graphical session by the owner, reported separately from the
   automated gates.

## New in 0.8.0-alpha.4

1. **Packaging-only fix for the alpha.3 startup abort.** The alpha.3 .deb
   shipped an engine that imported `fflate` without shipping the package, so
   the app aborted with `QMS_STARTUP_FAILED: Engine host connection closed.`.
   Alpha.4 declares fflate 0.8.3, stages `src/config.js`, resolves the entire
   engine import graph at build time and runs a packaged-engine JSON-RPC
   handshake from the extracted .deb in the release gate.
2. **The gate proves the failure mode.** A negative run hides `fflate` from a
   throwaway extraction and requires `ERR_MODULE_NOT_FOUND`. A package without
   complete runtime dependencies therefore cannot be published.
3. **No host npm workaround exists or is supported.** Users never run
   `npm install`; the .deb contains the locked production node_modules tree.
4. **The engine handshake is not a graphical install test.** The gate starts
   `resources/engine/bin/qms-host.js` with Node/Electron-as-Node on the build
   host. The separate isolated-rootfs test covers apt installation and the
   Electron GUI under Xvfb; a full MX Linux graphical session is still not
   executed in this release run.

## New in 0.8.0-alpha.3


1. **Live Admin regression fixed in the Generic CMS.** Version 0.8.0-alpha.2
   built `VITE_QORTAL_NODE_URL=http://localhost:12391` into release bundles and
   used it as the trusted node for the `/names/<name>` ownership read. On
   Qortal Hub for Android the page is served by a remote node, so the lookup
   targeted the phone's own loopback, failed, and the real owner stayed
   read-only with no Admin entry. 0.8.0-alpha.3 uses the hosting page origin in
   release builds and keeps the env value as a development-only override.
2. **Recovery actions do not expand authorization.** `Connect owner account`
   requests `GET_USER_ACCOUNT` and re-runs the complete check; `Retry
   verification` repeats the same check. Neither can grant owner mode to a
   non-owner. Direct `#/admin` navigation by a non-owner still shows **Access
   denied**.
3. **The desktop package is rebuilt but has no desktop source change.** Its
   version moves to 0.8.0-alpha.3 because the bundled Generic CMS template
   changed. The Publisher source and artifact are unchanged at 0.8.0-alpha.2.
4. **The fix is verified in the built bundle and unit matrix, not yet on a
   physical Android device in this release run.** The previous live failure
   matched the localhost name-record path exactly. Owner verification must still
   be confirmed on the owner's Hub after deploying the new CMS ZIP.

## New in 0.7.0

1. **CMS authoring is tested, not signed live.** Settings, editor and gallery
   publication use real Hub actions and exact read-back, but this release run
   could not sign mainnet transactions. Do a supervised first publish.
2. **The authorization fix changes a documented behavior.** Only the verified
   on-chain owner can open Admin. Non-owners now see Access denied and no admin
   state. Missing name records, a different active account or a transferred
   name all fail closed.
3. **`?name=` is no longer an identity source.** Open the CMS through its
   hosting path (`qortal://APP/<name>/` or `qortal://WEBSITE/<name>/`). Query
   parameters cannot select a catalog or grant ownership.
4. **Android file selection depends on the Hub build.** When the Hub file input
   is unavailable, the media picker says so and existing QDN media can still be
   reused.
5. **TipTap increases the public bundle size.** The editor is in the admin
   path but currently bundled; a future build can code-split owner-only views.
6. **Gallery batches are 10 images per publish, with no lifetime cap.** The
   limit is per batch, not per gallery.

## Blocking or unverified release gates

1. **Live mixed-service QDN publication is still incomplete.** A
   DOCUMENT-only package was published live through the deployed development
   Migration Publisher under `developer iffi`. The catalog manifest
   `DOCUMENT/developer iffi/qms-cms-manifest` read back with the exact expected
   SHA-256. The authorized signing scope cannot publish IMAGE or APP/WEBSITE
   resources, so a full mixed-service acceptance run is blocked rather than
   faked.
2. **The user-facing Hub-signed flow is partially live-accepted.** The deployed
   Publisher executed a real package publication and returned a usable receipt.
   The fee approval and publication used the development authorization path.
   IMAGE and APP/WEBSITE publication through a general owner Hub wallet were not
   executed, so treat the first full site publication as a supervised test.
3. **A general public Publisher deployment is still owner-controlled.** A
   development deployment under `developer iffi` is live and has published a
   real package. A shared public deployment under the owner's registered name
   still needs wallet approval and an application-bundle fee. Downloading the
   ZIP does not deploy it.
4. **The Generic CMS application bundle is not live-published as APP or
   WEBSITE.** Its neutral ZIP is a release asset, and QMS can package a
   configured APP or WEBSITE bundle. Bundle, config and exact member read-back
   are proven against fixtures and a simulated Core API. The CMS rendering itself
   was proven with the live DOCUMENT catalog, but a live APP/WEBSITE deployment
   and multi-file member read-back remain unverified. Downloading the ZIP does
   not deploy it.
5. **The package is unsigned.** There is no owner-approved Debian signing key
   in the release environment. Verify SHA-256, SBOM and provenance. A signed
   build is a future release gate.
6. **MX Linux 23 is not executed.** The package declares Debian 12/13
   dependency alternatives; only Debian 12 and Debian 13 were installed.
7. **Headless launch only.** Installation and launch were verified under Xvfb
   in isolated Debian root filesystems. A full graphical desktop session and a
   real GNOME Keyring unlock prompt were not exercised.
8. **Electron is bundled, not rebuilt.** Reproducibility covers the project’s
   build output and the pinned Electron download, not a Chromium source build.

## Functional limitations

- amd64 only; Windows and macOS are not supported in this alpha.
- One source adapter: WordPress REST. Joomla, Wix and other sources are future
  adapters.
- No comments, users, menus, widgets, custom post types or plugin backends.
- No forms, carts, checkout, memberships or interactive embeds.
- Media types are limited to what the source exposes and QMS can validate.
  Unsupported or unreachable media is reported, not invented.
- No automatic background sync. Every scan and publication is explicit.
- No QDN delete. Source withdrawal is local; published data remains.
- The CMS application-bundle member read-back depends on Core's `filepath` query; the
  Publisher tries the Hub bridge first and falls back to a same-origin node
  read. A Hub build that blocks both paths reports `blocked`, not verified.
- The Generic CMS reads its catalog and authorizes admin only when the hosting
  context carries the exact Qortal name, for example
  `qortal://WEBSITE/developer%20iffi/` or `qortal://APP/developer%20iffi/`.
  Percent-encoded path names and Hub globals are decoded before lookup. Query
  parameters such as `?name=` are ignored and cannot select a catalog or grant
  ownership.
- Redeploying a CMS bundle without its existing `qms-cms-config.json` loses the
  fallback site title, nav, theme and manifest identifier. Preserve that file
  when it exists. Admin is shown only after owner verification; it is never in
  the visitor-visible navigation.
- Qortal Hub does not publish a multi-file APP from its normal form, so the
  Publisher Q-App is deployed by the owner through an APP ZIP flow, not by
  each user.
- Credential remembering depends on a working system keyring and an explicit
  opt-in. Memory-only is the default.

## Packaging and platform notes

- The package recommends gnome-keyring and libsecret-tools. Without them,
  remembered credentials are unavailable; memory-only sessions still work.
- On a headless machine there is no usable display; use a real graphical
  session.
- The Chromium sandbox needs a normal desktop session. Do not run the app as
  root or with `--no-sandbox` in production.
