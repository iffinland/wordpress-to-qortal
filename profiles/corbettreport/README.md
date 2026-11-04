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

## Migration Studio compatibility

Qortal Migration Studio Phase 2 uses this profile as a read-only compatibility
record. It preserves the `cr` prefix and every `cr-*` QDN identifier, and its
golden tests compare the adapter's legacy view against the real Corbett
converter output. The profile file itself, the existing CLI commands, batch
state and QDN identifiers are unchanged.
