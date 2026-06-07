# Corbett Report Migration Profile

This profile contains the Corbett Report migration defaults.

| Qortal name | Role |
| --- | --- |
| `CorbettReport` | CMS app owner, canonical CMS catalog and SysOp |
| `Corbett` | Migration Publisher owner, default import source, public author and SysOp |
| `AgoristMarket` | Trusted coauthor |
| `iffi` | Trusted coauthor |

The Corbett Report CMS build is published as `APP/CorbettReport`. It uses
`Corbett` as the default WordPress migration import source, so existing QDN
migration batches published through `WEBSITE/Corbett` remain usable.

Trusted coauthors can also adopt WordPress migration batches and upload media.
Raw migration resources are currently published under `Corbett`. Trusted
coauthors can load migration manifests from other Qortal names and adopt those
posts into the `CorbettReport` CMS catalog.

Build the dedicated Migration Publisher:

```bash
npm run package:migration-qapp:corbettreport
```
