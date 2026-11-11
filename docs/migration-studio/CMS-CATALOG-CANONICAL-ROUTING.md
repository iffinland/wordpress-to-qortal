# Canonical CMS catalog routing

## Scope

This record covers the CMS catalog-loading correction in the rc.6 / alpha.10
candidate. It does not publish, sign, resubmit, delete or alter existing QDN
resources.

## Confirmed cause

Qortal Hub resolves the normal public address `qortal://APP/<name>/` to the
`APP / <name> / default` resource. The prior QMS site bundle used a
project-specific APP identifier. Its generated `qms-cms-config.json` and
manifest were valid, but the canonical `default` APP resource was different
and contained no runtime configuration. The old CMS consequently used its
build-time sample manifest identifiers (`qms-cms-manifest`, then
`cr-qdn-manifest`) and reported a 404.

For an explicit diagnostic selection, the Hub resource identifier is a query
parameter: `qortal://APP/<name>/?identifier=<identifier>`. A slash followed by
the identifier is an in-app path, not the selected APP resource.

## Correction

1. QMS generates the CMS APP/WEBSITE resource at identifier `default`.
2. The bundle still embeds a per-site `qms-cms-config.json` with the exact
   deployment triple, project manifest identifier and site identity.
3. If that config is missing, invalid or bound to a different host, Generic CMS
   clears both manifest identifiers and gives an explicit diagnostic. It cannot
   silently read generic defaults or a mismatched cache.

Content, media, indexes and manifests retain their project-derived identifiers.
The CMS dataset cache remains bound to service, name, deployment identifier,
manifest identifier and site id.

## Telegram.EE read-only evidence

On 2026-11-11, the local synchronized node returned HTTP 200 for:

- `APP / Telegram.EE / qms-nsfefklqwv6wfj4q-app-generic-cms-17c346ae44`
  member `qms-cms-config.json`;
- `DOCUMENT / Telegram.EE / qms-nsfefklqwv6wfj4q-man-site-manifest-d67cb2ae5d`.

The APP member config named that same manifest and its own custom deployment
identifier. The canonical `APP / Telegram.EE / default` member lookup returned
404 for `qms-cms-config.json`, proving the routing mismatch without a QDN
write. The referenced manifest listed two imported content resources.

## Owner retest

1. Install QMS rc.6 and prepare a CMS-only successor from the already verified
   Telegram.EE handoff. It must contain only the previously verified manifest
   dependency and the replacement APP resource at `default`.
2. In Migration Publisher, verify that all 25 existing content resources are
   skipped and that the only possible new transaction is `APP / Telegram.EE /
   default`.
3. Approve that single APP publication in Hub only after reviewing its displayed
   name, service, identifier and byte hash.
4. Open `qortal://APP/Telegram.EE/` with no identifier. Confirm the two posts
   load and the catalog error does not name `qms-cms-manifest` or
   `cr-qdn-manifest`.
5. If the config cannot be read, stop: alpha.10 must show the explicit runtime
   configuration diagnostic rather than any other site's cached posts.
