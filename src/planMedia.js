import path from 'node:path';
import { loadConfig } from './config.js';
import { ensureDir, readJson, writeJson } from './utils/files.js';

const CONCURRENCY = 6;

function isSameSiteUrl(url, baseUrl) {
  try {
    const sourceHost = new URL(url).hostname.replace(/^www\./, '');
    const siteHost = new URL(baseUrl).hostname.replace(/^www\./, '');
    return sourceHost === siteHost;
  } catch {
    return false;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return 'unknown';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
}

async function inspectUrl([url, item], config) {
  const included =
    config.downloadMediaTypes.has(item.type || 'file') &&
    (config.downloadExternalMedia || isSameSiteUrl(url, config.wordpressBaseUrl));

  if (!included) {
    return { url, type: item.type, included: false, bytes: null, status: 'skipped' };
  }

  try {
    const response = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const rawSize = response.headers.get('content-length');
    return {
      url,
      type: item.type,
      included: true,
      bytes: rawSize ? Number(rawSize) : null,
      content_type: response.headers.get('content-type'),
      status: response.ok ? 'ready' : `http-${response.status}`
    };
  } catch (error) {
    return {
      url,
      type: item.type,
      included: true,
      bytes: null,
      status: 'error',
      error: error.message
    };
  }
}

async function mapWithConcurrency(entries, mapper) {
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(entries[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, () => worker()));
  return results;
}

async function main() {
  const config = loadConfig();
  const mediaMapPath = path.join(config.outputDir, 'converted', 'media-map.json');
  const logsDir = path.join(config.outputDir, 'logs');
  const mediaMap = await readJson(mediaMapPath);
  const results = await mapWithConcurrency(Object.entries(mediaMap), (entry) => inspectUrl(entry, config));

  const included = results.filter((result) => result.included);
  const withKnownSize = included.filter((result) => Number.isFinite(result.bytes));
  const totalBytes = withKnownSize.reduce((total, result) => total + result.bytes, 0);
  const byType = {};

  for (const result of included) {
    if (!byType[result.type]) {
      byType[result.type] = { files: 0, known_bytes: 0, unknown_sizes: 0 };
    }

    byType[result.type].files += 1;
    if (Number.isFinite(result.bytes)) {
      byType[result.type].known_bytes += result.bytes;
    } else {
      byType[result.type].unknown_sizes += 1;
    }
  }

  await ensureDir(logsDir);
  await writeJson(path.join(logsDir, 'media-plan.json'), {
    planned_at: new Date().toISOString(),
    entries: results,
    summary: {
      included_files: included.length,
      known_size_files: withKnownSize.length,
      total_known_bytes: totalBytes,
      by_type: byType
    }
  });

  console.log('');
  console.log('Media download plan complete');
  console.log('');
  console.log(`Included files: ${included.length}`);
  console.log(`Known total size: ${formatBytes(totalBytes)} (${withKnownSize.length} sized files)`);

  for (const [type, summary] of Object.entries(byType)) {
    console.log(
      `${type}: ${summary.files} files, ${formatBytes(summary.known_bytes)}` +
        (summary.unknown_sizes ? `, ${summary.unknown_sizes} unknown size` : '')
    );
  }

  console.log('');
  console.log(`Plan log: ${path.join(logsDir, 'media-plan.json')}`);
}

main().catch((error) => {
  console.error('');
  console.error('Media planning failed');
  console.error(error.message);
  process.exitCode = 1;
});
