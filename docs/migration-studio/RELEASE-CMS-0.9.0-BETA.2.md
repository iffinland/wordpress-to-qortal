# Generic CMS 0.9.0-beta.2 — post quick actions

CMS **0.9.0-beta.2** is an independent Q-App release. Desktop **0.8.0-beta.2** and Publisher **0.8.0-beta.1** remain byte-identical at `v0.8.0-beta.4`; no new DEB is built or uploaded.

- Add Like, Share and Comments controls to posts in all eight templates.
- Likes are public QDN DOCUMENT resources, counted once per registered name and post.
- Share copies the full Qortal post URL, including non-default deployment identifiers.
- Load comments on demand, ten summaries at a time; publish plain-text comments and edit your own.
- Keep cancelled drafts and reuse the same comment identifier when retrying in the current page session. Escape comment HTML and isolate different deployments/posts.

The owner reported Runtime test passed on 2026-11-23 for quick-actions rc.1. Automated validation includes TypeScript, 439 CMS tests (including all eight template integrations), Vite build and root-layout ZIP inspection. Publication rechecks versions, strict documentation, clean source, checksum coverage and independently downloaded public ZIP bytes.

Download `qortal-migration-generic-cms-v0.9.0-beta.2.zip` from this release and verify `SHA256SUMS`. Keep the site's `qms-cms-config.json` and deployment identity through the established update flow. A generic ZIP alone is not a site-specific configuration backup. The unchanged Desktop still contains its original embedded CMS; this release updates the separately deployed CMS.

Likes/comments require a registered Qortal name and Hub confirmation, including any applicable fee. Submission is not independent QDN read-back proof; other readers see resources after propagation. No wallet keys are held by CMS and no QDN registry publication is performed by this release.
