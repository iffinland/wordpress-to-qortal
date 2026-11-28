# Qortal Migration Studio Desktop 0.8.0-beta.5

Owner runtime acceptance passed on 2026-11-28. This independent Desktop beta
promotes the exact tested Linux amd64 DEB, without rebuilding or rerunning the
expensive functional tests. Publisher 0.8.0-beta.2 and CMS 0.9.0-beta.4 are unchanged.

- Continue existing projects through guided new/changed/older content workflows.
- Rename projects, edit connection/destination settings, archive/reactivate,
  remove locally and restore from Deleted projects or a verified backup.
- Create independent projects from the same WordPress source, with clear Qortal
  destination collision review and retained content identities.
- Return to project selection with the persistent top-left Projects / Home button.
- Restore normal username/password WordPress login: merely finding a CAPTCHA
  plugin reference no longer blocks the login before the server checks it.
  Optional website sign-in remains inside collapsed Troubleshooting help.
- Preserve redirect/cookie/REST nonce handling and exact read-only checks for
  previous pending or ambiguous publications. Do not blindly resubmit old packages.

Close the old QMS before installing. Existing local projects are preserved.

```bash
sudo apt install ./qortal-migration-studio_0.8.0-beta.5_amd64.deb
```

The package is unsigned, Linux amd64, Debian/MX/Ubuntu target. The original trial
build was made from uncommitted source; its original metadata is retained as-is.
Publication requires the committed product-source fingerprint to match that exact
trial and the uploaded/downloaded bytes to match the runtime-accepted checksum.
The promotion manifest records the integrated source commit. This is not a claim
that the original trial was a clean or reproducible CI build.

Artifact: `qortal-migration-studio_0.8.0-beta.5_amd64.deb` (129094048 bytes).

SHA-256: `09fb3e389e8dbb69a1a7274cc7faa4a7ee46f384ea590b6c80b9ca76176a1eb6`.

Prior automated evidence: 110 Desktop tests, 304 engine/source/guided/publication
tests, 60 DEB validation checks, packaged normal-password and optional browser
flows, clean engine startup and security scan. Owner runtime test subsequently
passed. No additional long test suite or build is run for promotion.
