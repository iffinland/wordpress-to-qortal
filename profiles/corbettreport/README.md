# Corbett Report Migration Profile

This profile contains the Corbett Report migration defaults.

| Qortal name | Role |
| --- | --- |
| `CorbettReport` | Website address and future CMS catalog |
| `Corbett` | Essential archive content publisher and public author |
| `CorbettReportMedia` | Audio and video publisher |
| `iffi` | CMS coauthor |
| `AgoristMarket` | CMS coauthor |

The Corbett Report CMS build uses this profile to seed its canonical catalog,
public author, and initial coauthor names. Coauthor posts are signed under the
coauthor name and enter the SysOp submission queue before they are added to the
canonical site index.

Trusted coauthors can also adopt WordPress migration batches and upload media.
Those operator resources remain signed by the actual publisher name, such as
`AgoristMarket`, because QDN writes cannot be signed under another wallet's
registered name. The Corbett Report CMS loads trusted operator manifests and
merges their resources into the canonical view automatically. Operator control
resources use site-specific `cms-operator-<site-id>-*` identifiers.

Build the dedicated Migration Publisher:

```bash
npm run package:migration-qapp:corbettreport
```
