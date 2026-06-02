import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { ensureDir, readJson, writeJson } from './utils/files.js';

const MANIFEST_SERVICE = 'DOCUMENT';

function readFlag(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] || '' : '';
}

function readSources(argv) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index].startsWith('--source=')
      ? argv[index].slice('--source='.length)
      : argv[index] === '--source'
        ? argv[index + 1]
        : '';
    if (!value) continue;
    const separator = value.indexOf('=');
    if (separator <= 0 || separator === value.length - 1) {
      throw new Error('Each --source must use QortalName=path/to/qdn-manifest.json.');
    }
    values.push({
      name: value.slice(0, separator).trim(),
      file: value.slice(separator + 1).trim()
    });
    if (argv[index] === '--source') index += 1;
  }
  if (values.length < 2) {
    throw new Error('Provide at least two --source QortalName=manifestPath values.');
  }
  return values;
}

function withPublisher(ref, publisherName) {
  return ref ? { ...ref, name: ref.name || publisherName } : ref;
}

export function mergeManifestSources(sources, canonicalName, contentName, publicAuthorName, coauthorNames) {
  const merged = {
    version: '0.2.0',
    generated_at: new Date().toISOString(),
    profile_id: sources[0].manifest.profile_id || null,
    identifier_prefix: sources[0].manifest.identifier_prefix || null,
    identifiers: sources[0].manifest.identifiers || {},
    qdn_name: canonicalName,
    canonical_site_name: canonicalName,
    qdn_content_name: contentName || null,
    publisher_names: [...new Set(sources.flatMap(({ name, manifest }) => [
      name,
      ...(manifest.publisher_names || [])
    ]))],
    public_author: publicAuthorName,
    coauthor_names: coauthorNames,
    publishers: sources.map(({ name, manifest }) => ({
      name,
      generated_at: manifest.generated_at || null,
      summary: manifest.summary || {}
    })),
    entrypoints: {},
    resources: {
      by_path: {},
      by_identifier: {},
      by_source_url: {}
    },
    linked_only_media: [],
    summary: {
      publishers: sources.length,
      paths: 0,
      identifiers: 0,
      source_urls: 0,
      linked_only_media: 0
    }
  };

  for (const { name, manifest } of sources) {
    for (const [key, ref] of Object.entries(manifest.entrypoints || {})) {
      merged.entrypoints[key] ||= withPublisher(ref, name);
    }
    for (const [resourcePath, ref] of Object.entries(manifest.resources?.by_path || {})) {
      merged.resources.by_path[resourcePath] ||= withPublisher(ref, name);
    }
    for (const [identifier, ref] of Object.entries(manifest.resources?.by_identifier || {})) {
      const namedRef = withPublisher(ref, name);
      merged.resources.by_identifier[`${namedRef.name}:${namedRef.service}:${identifier}`] = namedRef;
    }
    for (const [sourceUrl, ref] of Object.entries(manifest.resources?.by_source_url || {})) {
      // Later sources intentionally override media URLs. Pass the dedicated
      // media publisher after the content publisher.
      merged.resources.by_source_url[sourceUrl] = withPublisher(ref, name);
    }
    merged.linked_only_media.push(...(manifest.linked_only_media || []).map((item) => ({
      ...item,
      publisher_name: name
    })));
  }

  const linkedOnly = new Map();
  for (const item of merged.linked_only_media) {
    if (!merged.resources.by_source_url[item.source_url]) {
      linkedOnly.set(item.source_url, item);
    }
  }
  merged.linked_only_media = [...linkedOnly.values()];
  merged.summary.paths = Object.keys(merged.resources.by_path).length;
  merged.summary.identifiers = Object.keys(merged.resources.by_identifier).length;
  merged.summary.source_urls = Object.keys(merged.resources.by_source_url).length;
  merged.summary.linked_only_media = merged.linked_only_media.length;
  return merged;
}

async function main() {
  const config = loadConfig();
  const argv = process.argv.slice(2);
  const sourceSpecs = readSources(argv);
  const canonicalName = readFlag(argv, '--canonical-name') || config.qortalSiteName || sourceSpecs[0].name;
  const convertedDir = path.join(config.outputDir, 'converted');
  const publishLogDir = path.join(config.outputDir, 'publish-log');
  const outputPath = path.resolve(readFlag(argv, '--output') || path.join(convertedDir, 'merged-qdn-manifest.json'));
  const sources = [];

  for (const source of sourceSpecs) {
    sources.push({
      name: source.name,
      manifest: await readJson(path.resolve(source.file))
    });
  }

  const publicAuthorName = readFlag(argv, '--public-author') || config.publicAuthorName;
  const manifest = mergeManifestSources(
    sources,
    canonicalName,
    config.qortalContentName,
    publicAuthorName,
    config.qortalCoauthorNames
  );
  const plan = {
    version: '0.2.0',
    generated_at: new Date().toISOString(),
    profile_id: config.profileId,
    identifier_prefix: config.resourcePrefix,
    identifiers: config.qdnIdentifiers,
    qdn_name: canonicalName,
    canonical_site_name: canonicalName,
    qdn_content_name: config.qortalContentName || null,
    publisher_names: manifest.publisher_names,
    public_author: publicAuthorName,
    coauthor_names: config.qortalCoauthorNames,
    note: 'Publish this catalog under the canonical Qortal name after all contributor resources are available in QDN.',
    resources: {
      posts: [],
      pages: [],
      media: [],
      indexes: [{
        type: 'index',
        service: MANIFEST_SERVICE,
        identifier: config.qdnIdentifiers.qdn_manifest,
        name: canonicalName,
        local_path: path.relative(config.outputDir, outputPath).replace(/\\/g, '/'),
        published: false
      }]
    },
    linked_only_media: manifest.linked_only_media,
    summary: {
      posts: 0,
      pages: 0,
      indexes: 1,
      media: 0,
      linked_only_media: manifest.linked_only_media.length,
      total_publish_resources: 1
    }
  };

  await ensureDir(convertedDir);
  await ensureDir(publishLogDir);
  await writeJson(outputPath, manifest);
  await writeJson(path.join(publishLogDir, 'catalog-publish-plan.json'), plan);

  console.log('');
  console.log('Merged QDN catalog prepared');
  console.log('');
  console.log(`Canonical Qortal name: ${canonicalName}`);
  console.log(`Publisher manifests: ${sources.length}`);
  console.log(`Mapped paths: ${manifest.summary.paths}`);
  console.log(`Mapped source URLs: ${manifest.summary.source_urls}`);
  console.log(`Merged manifest: ${outputPath}`);
  console.log(`Catalog publish plan: ${path.join(publishLogDir, 'catalog-publish-plan.json')}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error('');
    console.error('QDN manifest merge failed');
    console.error(error.message);
    process.exitCode = 1;
  });
}
