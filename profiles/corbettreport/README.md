# Corbett Report Migration Profile

This is the only migration profile in the repository.

| Qortal name | Role |
| --- | --- |
| `Corbett` | Content publisher, migration source, public author, CMS catalog owner, and SysOp |
| `CorbettReport` | Website/CMS app owner and SysOp |
| `AgoristMarket` | Trusted coauthor |
| `iffi` | Trusted coauthor |

All migration resources use the `cr` prefix. The main catalog is:

```text
DOCUMENT/Corbett/cr-qdn-manifest
```

Build the dedicated apps from the repository root:

```bash
npm run package:migration-qapp
npm run package:cms-qapp
```
