# Corbett Report Q-App Architecture

## Goals

- Reproduce the public Corbett Report experience closely on desktop and mobile.
- Preserve migrated WordPress archives while new Qortal-native content is published in parallel.
- Keep public rendering, membership and editorial workflows independently maintainable.
- Allow content resources from more than one QDN publishing name.

## Directory Boundaries

| Directory | Responsibility |
| --- | --- |
| `src/app/` | Application composition and hash routing |
| `src/components/content/` | Reusable archive and article UI |
| `src/components/layout/` | Public layout and navigation |
| `src/components/search/` | Instant search UI |
| `src/components/follow/` | Qortal hosting support controls |
| `src/data/` | Repository interfaces, demo adapter and search indexing |
| `src/qdn/` | Qortal bridge calls |
| `src/pages/` | Route-level screens |
| `src/styles/` | Small CSS modules grouped by concern |

## Planned Content Layers

The final repository adapter will merge content layers before rendering:

1. Immutable WordPress migration archive.
2. CMS posts and pages created after the Qortal site launch.
3. CMS overrides for migrated posts that need edits.

The merged result must be ordered by editorial `published_at`, never by migration or QDN publication time.

The public Q-App supports the migration catalog loader through:

```text
?source=qdn&name=CorbettReport
```

Homepage cards load from QDN indexes. Full post and page JSON is loaded only when
the visitor opens that route.

## Planned QDN Catalog

```text
cr-site-catalog
  core_manifest
    publisher: CorbettReport
    resources: app, posts, pages, indexes, images, documents
  media_manifest
    publisher: CorbettReportMedia
    resources: audio, video
```

The catalog allows operators to publish resources from separate computers. Once
resources and the approved catalog are in QDN, frontend and CMS reads no longer
depend on any local computer.

## Name Roles

| Qortal name | Role |
| --- | --- |
| `CorbettReport` | Canonical website address and CMS catalog publisher |
| `Corbett` | Public editorial identity, future owner identity and essential content publisher |
| `CorbettReportMedia` | Dedicated audio and video publisher |
| `iffi` | Coauthor only |
| `AgoristMarket` | Coauthor only |

QDN publication still requires the signing wallet to own the technical resource
name. Coauthors can prepare and publish resources under names they own. Updating
the canonical catalog under `CorbettReport` requires the wallet that owns
`CorbettReport`.

For production, publish the website and CMS catalog under `CorbettReport`.
Publish posts, pages, indexes, images and documents under `Corbett`. This keeps
the archive attached to the editorial identity that can later be transferred to
the Web2 owner. `iffi` and `AgoristMarket` remain CMS coauthors without becoming
public QDN content dependencies.

## Internal Link Rule

Internal Corbett Report Web2 links become Q-App hash routes:

```text
https://corbettreport.com/nwnw623/
  -> #/posts/nwnw623

https://corbettreport.com/category/podcasts/
  -> #/category/podcasts
```

External Web2 links keep the click-to-copy behavior. The first scaffold implementation centralizes this behavior in `src/components/content/ContentHtml.tsx`.

## Follow Boundary

Qortal Core follows registered names through its local `followedNames` list. It does not currently filter followed resources by service.

The planned split publishing names allow:

- Essential follow: `CorbettReport` and `Corbett`
- Full archive follow: `CorbettReport`, `Corbett` and `CorbettReportMedia`

`CorbettReportMedia` must be registered in Qortal before the full archive option
is used. The full archive control adds both registered names to the local
`followedNames` list.
