# Known issues and limitations — 0.7.0 alpha

These are release-gate facts, not a substitute for testing your own site. The
0.7.0 release is published as a prerelease with all three artifacts:
<https://github.com/iffinland/wordpress-to-qortal/releases/tag/v0.7.0-alpha.1>.
Downloading an artifact is not deployment or live validation.

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
