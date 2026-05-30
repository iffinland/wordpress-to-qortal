# Roadmap

This repository contains the WordPress importer, the Migration Publisher Q-App, and a separate Qortal CMS project directory. The importer is only needed for migration; the CMS is the long-term authoring and publishing interface.

## Importer Scope

The importer is responsible for:

- reading WordPress data through the REST API
- supporting WordPress Application Password authentication
- saving raw WordPress JSON locally
- converting posts, pages, categories, tags, and media metadata into Qortal-oriented JSON
- building `media-map.json`
- building `url-map.json`
- downloading source media files locally when requested
- validating the output before QDN publishing work begins

## Current Workflow

```bash
npm run inspect
npm run dump
npm run convert
npm run download-media
npm run validate
```

For a single full import run:

```bash
npm run prepare-import
```

## Later Importer Phases

- Add WordPress WXR/XML import support.
- Add optional content link rewriting using `url-map.json`.
- Keep improving QDN publish preparation logs.
- Keep browser-based QDN publishing in the Migration Publisher until direct node publishing is ready.

## Current Migration Publisher

The small Migration Publisher Q-App:

- reads the local `wp-qortal-import` folder through a browser folder picker
- publishes selected resources through Qortal UI
- supports grouped multi-resource confirmations
- separates JSON, images, documents, audio, and video
- supports manual media selection
- skips QDN resources that already exist

## Separate CMS/Q-App Scope

The CMS is a separate TypeScript Qortal Q-App.

It should be responsible for:

- reading QDN-published post/page index resources
- rendering posts and pages
- SysOp and coauthor post creation
- rich text editing
- media selection and upload
- category and tag management
- QDN publish/update flows
- imported WordPress content adoption
- public reader frontend
- comments, likes, shares, and QORT tips

The CMS should reuse proven Qortal patterns from existing projects, especially:

- Qortal request wrapper
- QDN resource readiness/status handling
- owner-only controls
- modal-based publish/edit flows
- rich text editor patterns
