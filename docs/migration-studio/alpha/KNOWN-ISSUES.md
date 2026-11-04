# Known issues and limitations — 0.6.1 alpha candidate

These are release-gate facts, not a substitute for testing your own site.

## Blocking or unverified release gates

1. **No live mixed-service QDN publication in release validation.** The
   authorized development signing broker is restricted to the exact name
   `developer iffi`, DOCUMENT resources and a `qms-dev-` prefix. It cannot
   publish IMAGE or APP resources, so a live mixed-service acceptance run is
   blocked rather than faked.
2. **The user-facing Hub-signed flow is not live-accepted.** Hub approval, fee
   payment and real Publisher execution are implemented and simulated against
   the documented Hub/Core contract, but were not executed end-to-end with a
   real Hub wallet in this alpha. Treat the first real publication as a
   supervised test.
3. **The Migration Publisher Q-App is not publicly deployed.** The validated
   build artifact exists; public deployment needs the owner's registered name
   and wallet approval. Until then, users cannot launch it from Qortal Hub.
4. **The Generic CMS APP is not live-published.** Its bundle, config and
   exact member read-back are proven against fixtures and a simulated Core API,
   not a public QDN deployment.
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
- The CMS APP member read-back depends on Core's `filepath` query; the
  Publisher tries the Hub bridge first and falls back to a same-origin node
  read. A Hub build that blocks both paths reports `blocked`, not verified.
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
