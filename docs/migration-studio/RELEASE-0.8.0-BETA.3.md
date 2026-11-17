# Qortal Migration Studio 0.8.0-beta.3 (unsigned beta)

<!-- qms-release-version: 0.8.0-beta.3 -->

Generic CMS **0.8.0-beta.4** usability release. Desktop and Migration Publisher
remain **0.8.0-beta.1**; their component versions and artifacts are unchanged.

## Generic CMS 0.8.0-beta.4

- Optional **Community chat** navigation item using the documented
  `qortal://use-group/action-join/groupid-127` Hub link with a copyable
  fallback. The owner accepted the function; its UX will be refined later.
- Compact accessible **Back to top** control for phone and desktop.
- Owner-only CMS post deletion with explicit confirmation, stable-identifier
  tombstone, and native index, search index and page-assignment cleanup.
  Historical QDN versions are not physically erased.
- Taxonomy suggestions while editing and owner-side category/tag rename and
  delete for CMS-authored content. Imported WordPress taxonomy is read-only.
- Configured site tagline restored in the compact mobile header.
- New posts default to the configured Public author; saved authors are preserved.

## Verification

- Generic CMS template suite: 42 files, 364 tests passed; typecheck, production
  build and docs verification passed.
- Desktop 0.8.0-beta.1 artifact is reused byte-identically. Its Debian
  validation (60 checks) and packaged engine clean-install and negative
  evidence were regenerated against that exact .deb for this gate.
- The three-artifact gate binds the reused Desktop and Publisher artifacts and
  the new CMS ZIP. No QDN publication or signing is performed by this release.

Known limitation: Community chat opening depends on Qortal Hub's group-link
handling; the current fallback exposes the exact link when the bridge cannot
open it. Its interaction design is scheduled for a later refinement.
