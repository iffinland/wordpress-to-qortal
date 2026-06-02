# Corbett Report Q-App

Version: `0.1.0`

This directory contains the dedicated Qortal-native Corbett Report application. It is separate from:

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

The public frontend scaffold currently includes:

- a responsive Web2-inspired public layout
- desktop and mobile headers
- hash routes for posts, pages and categories
- an instant header search with highlighted matches
- a documentaries carousel
- an initial Qortal Follow modal
- centralized internal Web2 link routing and external Web2 link copying

## Data Boundary

The public frontend reads content through `src/data/contentRepository.ts`.

The default development mode uses `DemoContentRepository`. Its external Web2 images
are temporary audit fixtures.

The production migration mode reads the merged QDN catalog:

```text
?source=qdn&name=CorbettReport
```

Homepage cards load from QDN indexes. Full post and page JSON is loaded lazily when
the visitor opens a content route. Every QDN reference can carry its own publishing
name, so large audio and video resources can resolve through `CorbettReportMedia`.

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
npm run package:corbettreport-qapp
```
