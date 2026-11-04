# Known issues and limitations — 0.6.0 alpha

These are release-gate facts, not a substitute for testing your own site.

## Blocking or unverified release gates

1. **No live QDN publication in release validation.** The alpha validation
   prepares local handoffs and validates them byte-for-byte. No transaction was
   signed and no wallet was accessed.
2. **The user-facing Hub-signed flow is not live-accepted.** Hub approval, fee
   payment and real Publisher execution are implemented but were not executed
   end-to-end in this alpha. Treat the first real publication as a supervised
   test.
3. **The package is unsigned.** There is no owner-approved Debian signing key
   in the release environment. Verify SHA-256, SBOM and provenance. A signed
   build is a future release gate.
4. **MX Linux 23 is not executed.** The package declares Debian 12/13
   dependency alternatives; only Debian 12 and Debian 13 were installed.
5. **Headless launch only.** Installation and launch were verified under Xvfb
   in isolated Debian root filesystems. A full graphical desktop session and a
   real GNOME Keyring unlock prompt were not exercised.
6. **Electron is bundled, not rebuilt.** Reproducibility covers the project’s
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
- Credential remembering depends on a working system keyring and an explicit
  opt-in. Memory-only is the default.

## Packaging and platform notes

- The package recommends gnome-keyring and libsecret-tools. Without them,
  remembered credentials are unavailable; memory-only sessions still work.
- On a headless machine there is no usable display; use a real graphical
  session.
- The Chromium sandbox needs a normal desktop session. Do not run the app as
  root or with `--no-sandbox` in production.
