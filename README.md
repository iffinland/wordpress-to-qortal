# WordPress to Qortal Toolkit

Current version: `0.1.5`

This repository contains a WordPress migration toolkit and a separate Qortal-native CMS.

Start here:

```text
TESTER_GUIDE.md
QUICKSTART.md
```

The Corbett Report implementation is now operated as a production migration
project. Its primary runbook is:

```text
docs/CORBETT_BATCH_WORKFLOW.md
```

Each completed batch includes unseen live posts and the next historical group,
allowing the Qortal site to stay current while the archive migration continues.

## Components

### Local WordPress Importer

The Node.js importer:

- reads WordPress REST API content
- stores raw JSON locally
- converts posts, pages, categories, and tags
- extracts media and links from HTML
- downloads selected media files
- creates QDN identifiers, indexes, URL maps, and manifests
- validates the local migration dataset

### Migration Publisher Q-App

The Migration Publisher is a small Qortal `APP` or `WEBSITE` ZIP.

It does not contain imported media. Inside Qortal UI, the user selects the local `wp-qortal-import` folder and publishes selected resources through Qortal's `qortalRequest` bridge.

Publisher modes:

- `Demo`
- `CMS JSON`
- `Images`
- `Documents`
- `Audio`
- `Video`
- `Selected media`
- `Full media`

The publisher supports checkboxes, grouped multi-resource confirmations, local publish history, and QDN existence checks.

### Qortal CMS Q-App

The Qortal CMS is the long-term authoring interface. It supports:

- public visitor frontend
- SysOp and coauthor backend
- per-site stable IDs
- editable site title and tagline
- rich text post creation and editing
- QDN drafts and published posts
- category and tag suggestions
- local media uploads
- imported WordPress post adoption
- attachment previews
- QDN and Q-Tube video embeds
- lazy-loaded video players
- comments, likes, shares, QDN URI copying, and QORT tips

## Local Import Workflow

```bash
npm install
cp .env.example .env
npm run inspect
npm run prepare-import
npm run validate:media
npm run prepare-publish
```

Generated data is written to:

```text
wp-qortal-import/
```

Keep `.env` and `wp-qortal-import` private unless the imported content may be shared.

The default shareable configuration uses:

```env
MIGRATION_PROFILE=generic
```

Site-specific defaults live in `profiles/<profile-id>/profile.json`. See
`docs/PROFILES.md`.

## Release Commands

Build the small Migration Publisher Q-App:

```bash
npm run package:migration-qapp
```

This is an alias for:

```bash
npm run package:migration-qapp:generic
```

Build the CMS Q-App:

```bash
npm run package:cms-qapp
```

Build the complete tester bundle:

```bash
npm run package:tester-bundle
```

The tester bundle contains:

- local importer ZIP
- Migration Publisher Q-App ZIP
- Qortal CMS Q-App ZIP
- tester documentation

It excludes:

- `node_modules`
- `.env`
- imported WordPress data
- local Qortal API keys

## Documentation

```text
TESTER_GUIDE.md
QUICKSTART.md
docs/QDN_RESOURCE_STRATEGY.md
docs/PROFILES.md
docs/CORBETT_BATCH_WORKFLOW.md
qortal-cms/README.md
```
