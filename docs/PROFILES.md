# Migration Profiles

Migration profiles keep site-specific QDN naming outside the universal importer
engine.

## Select A Profile

Set the active profile in the local `.env` file:

```env
MIGRATION_PROFILE=generic
```

The toolkit loads:

```text
profiles/<profile-id>/profile.json
```

An optional private file can override local settings without changing committed
profile defaults:

```text
profiles/<profile-id>/.env
```

Profile `.env` files are excluded from git.

## Included Profiles

| Profile | Prefix | Purpose |
| --- | --- | --- |
| `generic` | `wpq` | Shareable WordPress to Qortal toolkit |

## Profile Fields

```json
{
  "id": "generic",
  "resource_prefix": "wpq",
  "public_author_name": "Site Author",
  "qortal_name": "",
  "qortal_site_name": "",
  "qortal_content_name": "",
  "qortal_media_name": "",
  "qortal_publisher_names": [],
  "qortal_coauthor_names": []
}
```

Environment variables with matching roles override profile defaults for one
computer or import run.

## Q-App Packages

Build the shareable Migration Publisher:

```bash
npm run package:migration-qapp:generic
```

The universal release package includes only the `generic` profile.
