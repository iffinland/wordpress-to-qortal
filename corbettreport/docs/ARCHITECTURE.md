# Corbett Report CMS Q-App Architecture

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
| `src/cms/` | SysOp and trusted coauthor editorial backend |
| `src/data/` | Repository interfaces, demo adapter and search indexing |
| `src/qdn/` | Qortal bridge calls |
| `src/pages/` | Route-level screens |
| `src/styles/` | Small CSS modules grouped by concern |

## Content Layers

The repository adapter merges content layers before rendering:

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

The Q-App loads the migration catalog and the canonical CMS manifest in parallel.
Either catalog may be temporarily absent during rollout. When the canonical CMS
manifest exists, the Q-App also loads configured trusted operator manifests from:

```text
DOCUMENT/<operator-name>/cms-operator-<site-id>-manifest
```

An operator catalog is merged only when its `canonical_site_name` matches
`CorbettReport`. Published CMS posts override migrated posts with the same slug.
The final public feed is sorted by editorial `published_at`.

## Planned QDN Catalog

```text
Corbett
  cms-manifest
    publisher: Corbett
    resources: canonical website and CMS catalog
  operator manifests
    publishers: Corbett, AgoristMarket, other trusted coauthors
    resources: adopted posts, indexes, images, audio, video and documents
```

The catalog allows operators to publish resources from separate computers under
names they actually own. Once resources and operator manifests are in QDN,
frontend and CMS reads no longer depend on any local computer.

## Name Roles

| Qortal name | Role |
| --- | --- |
| `Corbett` | Current website address, CMS catalog publisher, public editorial identity, SysOp and migration publisher |

QDN publication still requires the signing wallet to own the technical resource
name. Coauthors can prepare and publish resources under names they own. Updating
the canonical catalog under `Corbett` requires the wallet that owns `Corbett`.

For the current deployment, publish the website, migration resources and
canonical CMS catalog under `Corbett`. Other import sources can still be loaded
by name and adopted from the CMS backend after they are added as coauthors.
The public author remains `Corbett` even when the technical QDN publisher is a
trusted coauthor.

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

The follow control adds the site name, the default content name and configured
trusted publisher names to the local `followedNames` list. Media no longer
requires a dedicated technical publisher name; it follows whichever trusted
importer published the batch.
