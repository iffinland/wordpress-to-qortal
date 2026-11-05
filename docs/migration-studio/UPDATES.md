# Checking for Updates

All three QMS applications can tell you when a newer release exists. They never
install anything automatically and never replace a running site, Publisher or
desktop installation.

## Desktop (Linux)

The header shows the installed version and an **Updates** button. At startup the
app reads the public QMS update registry from a Qortal node and shows a compact
**Update available** badge only when a newer desktop release exists.

Open the badge to see:

- installed and available versions, release channel and date;
- what changed;
- the exact .deb name, size and SHA-256;
- a copyable GitHub release link;
- manual installation instructions.

You may change the Qortal node used for the registry in the update view. HTTPS
is required; HTTP is accepted only for a local node. If the node or registry is
unavailable, startup and migration work continue normally.

## Migration Publisher (Qortal Hub)

The Publisher shows **Publisher update available** only when the Publisher
component itself changed. A new desktop or CMS release does not trigger this
badge.

The update view shows the Publisher version, changelog, compatible deployment
steps and the verified ZIP name, size and SHA-256. Update manually: download the
ZIP in your browser, verify its hash, then republish the Publisher Q-App in
Qortal Hub. Existing handoffs, approvals and receipts keep working.

## Generic CMS (Qortal Hub)

The footer shows the current template version. A compact **Update available**
badge appears when a newer CMS template release exists; **Check for updates** in
the footer opens the same view.

The update view warns when this site already uses a runtime
`qms-cms-config.json` or published settings. In that case do **not** replace a
customized CMS with the generic ZIP. Preserve the site configuration and custom
assets, and republish only the template files.

The running WEBSITE/APP is never replaced automatically.

## When a check cannot complete

You may see "Unable to check for updates" or "Release could not be verified".
These states never block normal use and never show an update badge. Possible
causes: the registry has not been published yet, the node is offline, the
document is malformed, or the release metadata failed validation.

A GitHub release by itself does not announce an update. The registry is
published separately by the owner through an approved QDN transaction.

## Manual fallback

Qortal Hub may block external HTTPS tabs. The update views always display a
read-only release URL and a **Copy link** action. Copy it into your system
browser, download the asset, verify the SHA-256, and deploy it yourself.
