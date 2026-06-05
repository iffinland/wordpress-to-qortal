# Corbett Report Migration Profile

This profile contains the Corbett Report migration defaults.

| Qortal name | Role |
| --- | --- |
| `Corbett` | Current website owner, CMS catalog, migration publisher, public author and SysOp |

The Corbett Report CMS build uses `Corbett` as the only built-in owner and
SysOp. Coauthors are not hard coded. The owner adds or removes them from the CMS
Settings view using a Qortal name or wallet address.

Trusted coauthors can also adopt WordPress migration batches and upload media.
Raw migration resources are currently published under `Corbett`. Trusted
coauthors can load migration manifests from other Qortal names and adopt those
posts under their own operator catalog after the owner adds them to the CMS.

Build the dedicated Migration Publisher:

```bash
npm run package:migration-qapp:corbettreport
```
