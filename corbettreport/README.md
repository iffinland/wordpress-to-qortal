# Corbett Report CMS Q-App

Version: `0.1.5`

This directory contains the dedicated Qortal-native Corbett Report public website
and editorial CMS application. It is separate from:

- the WordPress migration toolkit in the repository root
- the migration publisher in `viewer/`
- the generic CMS prototype in `qortal-cms/`

## Application Areas

The application reserves three independently evolvable areas:

| Route | Area | Audience |
| --- | --- | --- |
| `#/` | Public frontend | All visitors |
| `#/member` | Member dashboard | Qortal members |
| `#/admin` | Editorial backend | SysOp and coauthors |

The unified application currently includes:

- a responsive Web2-inspired public layout
- desktop and mobile headers
- hash routes for posts, pages and categories
- an instant header search with highlighted matches
- a documentaries carousel
- an initial Qortal Follow modal
- centralized internal Web2 link routing and external Web2 link copying
- the SysOp and trusted coauthor editorial backend at `#/admin`

## Data Boundary

The public frontend reads content through `src/data/contentRepository.ts`.
The editorial backend lives in `src/cms/` and publishes the canonical
`cms-manifest` resources used by the public frontend.

The default development mode uses `DemoContentRepository`. Its external Web2 images
are temporary audit fixtures.

The production QDN mode reads and merges the available public catalogs:

```text
?source=qdn&name=CorbettReport
```

The immutable WordPress archive starts at `DOCUMENT/CorbettReport/cr-qdn-manifest`.
New Qortal-native content starts at `DOCUMENT/CorbettReport/cms-manifest`. Trusted
operator catalogs published under configured coauthor names are included only when
their `canonical_site_name` matches `Corbett`.

Homepage cards load from QDN indexes and are merged by slug. A published CMS item
overrides its migrated archive version. Full post and page JSON is loaded lazily
when the visitor opens a content route. Every QDN reference can carry its own
publishing name, so migrated media can resolve through the importer that
published the batch, such as `Corbett` or `AgoristMarket`.

## Development

From the repository root:

```bash
npm run corbettreport:dev
```

Open:

```text
http://localhost:5190/
```

## Build

```bash
npm run corbettreport:build
npm run package:cms-qapp:corbettreport
```

The production ZIP is:

```text
release/qortal-cms-app-corbettreport-v0.1.5.zip
```
