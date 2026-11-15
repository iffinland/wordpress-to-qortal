# Qortal Migration Studio 0.8.0 beta.2

<!-- qms-release-version: 0.8.0-beta.2 -->

The public prerelease tag is `v0.8.0-beta.2`. Component versions are independent:

- Generic CMS: `0.8.0-beta.2`
- Qortal Migration Studio Desktop: `0.8.0-beta.1` (unchanged)
- Migration Publisher: `0.8.0-beta.1` (unchanged)

## Generic CMS changes

- BUG-01: featured images are published from bytes captured at file selection, fixing Android Qortal Hub file-access failures.
- BUG-02: CMS-native posts load without a QMS import manifest; the duplicate homepage site title and tagline were removed.
- BUG-03: new native indexes use the canonical site id, legacy `site` placeholders are accepted only for the exact hosted QDN name, foreign identities are rejected, and public routes remain usable during catalog errors.
- BUG-04: non-blocking global catalog/config warning banners no longer occupy public pages; Admin retains diagnostics.
- The unused Adoption interface was removed from Admin Overview. Existing browser-local adoption records and QDN content are untouched.

Desktop and Publisher code and artifacts are unchanged from beta.1. Their beta.1 packages are included in this release for install convenience.

## Downloads

- Generic CMS: `qortal-migration-generic-cms-v0.8.0-beta.2.zip`
- Desktop: `qortal-migration-studio_0.8.0-beta.1_amd64.deb`
- Publisher: `qortal-migration-publisher-v0.8.0-beta.1.zip`

Verify every asset against `SHA256SUMS`. The release is unsigned; no QDN transaction is performed by downloading or packaging these files.
