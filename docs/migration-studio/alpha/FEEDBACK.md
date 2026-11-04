# Feedback and bug reports

This is an alpha. Clear reports are more useful than reassurance.

## Where to report

Open an issue at:

https://github.com/iffinland/wordpress-to-qortal/issues

Include:

- QMS version (visible in the app and in every diagnostic bundle);
- distribution and version (for example Debian 13 trixie);
- whether the package was installed with `apt` and whether it launched;
- the exact step that failed and the exact error text;
- whether the failure is reproducible;
- the support-bundle path or contents, if the app produced one.

## What never to include

- WordPress passwords or application passwords.
- Qortal seeds, private keys or wallet passwords.
- Session cookies or authorization headers.
- Full content bodies or private drafts.
- Unredacted QDN receipts containing wallet addresses you do not want public.

QMS redacts credential-like values from diagnostics. Do not undo that by
pasting a secret into an issue.

## What to test first

- Install and launch on a clean Debian 12 or Debian 13 machine.
- Create a project against a public WordPress site.
- Run a small first batch (5–15 items) and review unsupported-content warnings.
- Prepare a handoff without publishing.
- If you choose to publish, use a test Qortal name and a small DOCUMENT-only
  batch first, then verify exact read-back.
- Kill the app during a scan and confirm Recovery resumes without duplicates.

## Priority feedback for the first alpha

1. Installation, launch and first-run wizard clarity.
2. WordPress connection failures on real hosts (REST disabled, WAF, proxies).
3. Content loss or mangling in normalized posts and pages.
4. Media download failures, wrong content types or excessive disk use.
5. Hub handoff usability and whether the Publisher accepts the folder.
6. Receipt import and exact read-back mismatches.
7. Incremental sync false positives, conflicts or confusing withdrawal states.
8. Recovery and cleanup safety.
