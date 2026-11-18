# Generic CMS 0.8.0-beta.5 handoff

<!-- qms-release-version: 0.8.0-beta.5 -->

Component-only Generic CMS release. Desktop and Migration Publisher remain
**0.8.0-beta.1**. The QMS bundle tag remains **v0.8.0-beta.3**.

## Fixes

- Restored real-time publishing progress lines.
- Subwire backlink is ordinary text followed by the full visible CMS URL; it no
  longer uses a `?identifier=` query that Subwire re-encoded as `%23`.
- CMS article links detect APP/WEBSITE dynamically and keep the trailing slash.
- Large VIDEO verification waits for READY/DOWNLOADED, verifies exact SHA-256,
  and reports a still-propagating resource as partial/pending rather than
  ambiguous. Pending writes are never resent automatically.
- Includes the accepted Android attachment persistence, configurable community
  chat group, owner-only update location, compact taxonomy suggestions and
  mobile tagline fixes.

No GitHub release or QDN publication is part of this handoff.
