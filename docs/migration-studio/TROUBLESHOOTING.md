# Troubleshooting — 0.8.0 alpha.5

This page covers the defects fixed in 0.8.0-alpha.5 and the errors users are most
likely to see while preparing a migration. QMS never publishes, signs or spends
QORT during these steps.

## A red banner says `wizard.completedSteps[0] must be a string`

Affected versions: 0.8.0-alpha.4 and older.

Older builds saved wizard progress as numeric indexes (`1..5`), while the
desktop input validation expected strings. Every wizard save failed, so the
banner appeared on all five steps.

0.8.0-alpha.5 accepts the old shape and migrates it once:

| Old index | Canonical step id |
| --- | --- |
| 1 | `source` |
| 2 | `connection` |
| 3 | `destination` |
| 4 | `preferences` |
| 5 | `plan` |

The migration deduplicates, sorts, preserves every preference, website setting
and plan id, and writes `wizardVersion: 2`. It is idempotent. Do **not** delete
the project or the workspace; open the project in alpha.5 and the record is
repaired on load.

If the banner persists on alpha.5, export a support bundle from the dashboard
and include the exact project id. Do not edit `project.json` by hand.

## Plan status is failed and approval says "The plan did not become ready"

Read the error line above the button. Alpha.5 shows the engine code and message.

### `SOURCE_DISCOVERY_REQUIRED`

The project has no completed source discovery batch. In alpha.4 the wizard only
tested the WordPress connection; it did not index content. Alpha.5 scans
automatically on Continue or on plan preview, and step 4 has a **Scan WordPress
content** button.

A large site can take minutes. Progress is streamed from the engine. A partial
(`truncated`) scan is never treated as proof that content disappeared; rescan
before trusting an empty result.

### `DISK_SPACE_INSUFFICIENT`

The projected download plus the configured reserve exceeds free space. Lower
**Minimum free disk** or free space, then refresh the preview. The default
reserve is 10 GiB. This is a local check, not a QDN error.

### `CONFIG_INVALID`

Check the report: it names the invalid setting. A per-file limit cannot exceed a
non-zero per-run limit. The estimate policy requires a positive per-file size.

### The plan completes but Selected is 0

The plan is valid but empty. Approval is disabled on purpose, because an empty
plan must not mark the wizard complete. The warning lists the applied UTC range
and the exclusion counts. See the next section.

## Date filters, UTC and inclusive end dates

The published-date fields are date-only UTC filters:

- **Published after** = `00:00:00.000Z` of the selected day, inclusive.
- **Published before** = `23:59:59.999Z` of the selected day, inclusive.

Alpha.4 stored the end date at midnight, which silently excluded the whole final
day. Alpha.5 migrates a legacy midnight end date to the end of that day and
displays the applied range under the fields.

WordPress dates are normalized to UTC. A post published late in the local
evening can fall on the next UTC date. If a known post is missing, widen the
range by one day on each side before assuming a discovery failure.

## Unsupported capabilities show as `[object Object]`

Affected versions: 0.8.0-alpha.4 and older. The connection report's
`unsupported` field is an array of objects. Alpha.5 renders each entry as a
name, description and count, and audits renderer error paths so an object is
never passed through `String()`. If you still see it, capture the screen and
the support bundle; it is a UI regression.

## APP vs WEBSITE and existing deployments

- APP and WEBSITE are **separate QDN deployments**, even under the same
  registered Qortal name. They use different identifiers.
- The wizard never silently changes the chosen service. It warns when the
  service differs from the project's stored value.
- Switching service after preparation creates a second site bundle. It does not
  modify or migrate the first one.
- QMS never overwrites a different QDN identifier. A resource is updated only
  when this project republishes the exact service, name and identifier shown in
  the handoff table.
- Publishing happens in Qortal Hub. Downloading a ZIP, generating a handoff or
  importing a receipt does not publish anything.

Before preparing a handoff, read the service and identifier columns in the
Publishing view. If the owner's live site is WEBSITE `developer iffi` and the
project is set to APP, the APP deployment is a separate site; it will not
replace the WEBSITE one.

## Existing projects after upgrading

Open the project normally. On first load alpha.5 repairs the wizard record and
saves version 2. Project data, media, handoffs and history remain under:

```text
~/.local/share/qortal-migration-studio
```

Close other app instances before opening the same project. If a stale lock is
detected, use the dashboard's explicit **Recover project** action; do not remove
the lock file manually.

## Collecting a support bundle

Use the dashboard's support-bundle action. It contains metadata, run summaries
and redacted logs; it does not contain WordPress passwords, application
passwords, Qortal seeds, private keys or wallet passwords. Never attach those to
an issue.
