import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { ensureDir, readJson, writeJson } from './utils/files.js';
import { safeFileName } from './convert.js';

const MEDIA_DIRS = {
  image: 'images',
  audio: 'audio',
  video: 'video',
  document: 'documents',
  file: 'files'
};

function readPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const DOWNLOAD_CONCURRENCY = readPositiveInteger(process.env.MEDIA_DOWNLOAD_CONCURRENCY, 2);
const DOWNLOAD_ATTEMPTS = readPositiveInteger(process.env.MEDIA_DOWNLOAD_ATTEMPTS, 3);
const RETRY_DELAY_MS = readPositiveInteger(process.env.MEDIA_DOWNLOAD_RETRY_DELAY_MS, 3000);

function serializeError(error, context = {}) {
  return {
    ...context,
    name: error.name,
    message: error.message
  };
}

function getExtensionFromUrl(url) {
  try {
    const parsed = new URL(url);
    const extension = path.extname(parsed.pathname);
    return extension || '';
  } catch {
    return path.extname(url) || '';
  }
}

function getBaseNameFromUrl(url, fallback) {
  try {
    const parsed = new URL(url);
    const rawName = path.basename(parsed.pathname, path.extname(parsed.pathname));
    return safeFileName(rawName, fallback);
  } catch {
    return safeFileName(path.basename(url, path.extname(url)), fallback);
  }
}

function createLocalMediaPath(url, mediaItem, index) {
  const type = mediaItem.type || 'file';
  const folder = MEDIA_DIRS[type] || MEDIA_DIRS.file;
  const extension = getExtensionFromUrl(url);
  const baseName = getBaseNameFromUrl(url, `media-${index + 1}`);
  const uniqueSuffix = mediaItem.source_id || createHash('sha256').update(url).digest('hex').slice(0, 10);
  return path.join('media', folder, `${baseName}-${uniqueSuffix}${extension}`);
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60000),
    headers: {
      Accept: '*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${response.statusText}`);
  }

  if (/text\/html|application\/xhtml\+xml/i.test(response.headers.get('content-type') || '')) {
    await response.body?.cancel();
    throw new Error('Media URL returned an HTML page instead of a media file.');
  }

  if (!response.body) {
    throw new Error('Media download returned an empty response body.');
  }

  const tempPath = `${outputPath}.part`;
  const hash = createHash('sha256');
  let bytes = 0;
  const hashTransform = new Transform({
    transform(chunk, encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback(null, chunk);
    }
  });

  await rm(tempPath, { force: true });
  await pipeline(Readable.fromWeb(response.body), hashTransform, createWriteStream(tempPath));
  await rename(tempPath, outputPath);

  return {
    sha256: hash.digest('hex'),
    bytes
  };
}

async function downloadFileWithRetry(url, outputPath) {
  let lastError;

  for (let attempt = 1; attempt <= DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      return await downloadFile(url, outputPath);
    } catch (error) {
      lastError = error;
      if (attempt === DOWNLOAD_ATTEMPTS) break;
      console.warn(
        `Download attempt ${attempt}/${DOWNLOAD_ATTEMPTS} failed for ${url}: ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }

  throw lastError;
}

async function main() {
  const config = loadConfig();
  const shouldDownload = config.downloadMedia || process.argv.includes('--force');
  const errors = [];
  const mediaMapPath = path.join(config.outputDir, 'converted', 'media-map.json');
  const logsDir = path.join(config.outputDir, 'logs');

  await ensureDir(logsDir);

  if (!shouldDownload) {
    console.log('');
    console.log('Media download skipped');
    console.log('');
    console.log('Set DOWNLOAD_MEDIA=true in .env or run npm run download-media -- --force.');
    return;
  }

  let mediaMap = {};

  try {
    mediaMap = await readJson(mediaMapPath);
  } catch (error) {
    errors.push(serializeError(error, { file: mediaMapPath }));
    await writeJson(path.join(logsDir, 'media-download-errors.json'), errors);
    throw new Error(`Could not read media map: ${mediaMapPath}`);
  }

  const entries = Object.entries(mediaMap);
  let downloaded = 0;
  let recovered = 0;
  let skipped = 0;
  let cursor = 0;
  let checkpoint = Promise.resolve();

  async function checkpointMediaMap() {
    checkpoint = checkpoint.then(() => writeJson(mediaMapPath, mediaMap));
    await checkpoint;
  }

  async function processEntry([url, mediaItem]) {
    if (!config.downloadMediaTypes.has(mediaItem.type || 'file')) {
      skipped += 1;
      return;
    }

    if (!config.downloadExternalMedia && !isSameSiteUrl(url, config.wordpressBaseUrl)) {
      skipped += 1;
      return;
    }

    if (mediaItem.local_path && mediaItem.sha256) {
      skipped += 1;
      return;
    }

    try {
      const localPath = createLocalMediaPath(url, mediaItem, downloaded + skipped);
      const absolutePath = path.join(config.outputDir, localPath);
      await ensureDir(path.dirname(absolutePath));
      const existing = await inspectExistingFile(absolutePath);
      const fileInfo = existing || (await downloadFileWithRetry(url, absolutePath));

      mediaMap[url] = {
        ...mediaItem,
        local_path: localPath.replaceAll(path.sep, '/'),
        sha256: fileInfo.sha256,
        bytes: fileInfo.bytes,
        downloaded: true,
        downloaded_at: new Date().toISOString()
      };

      if (existing) {
        recovered += 1;
      } else {
        downloaded += 1;
      }

      await checkpointMediaMap();
      console.log(`${existing ? 'Recovered' : 'Downloaded'}: ${localPath}`);
    } catch (error) {
      errors.push(serializeError(error, { url }));
      console.error(`Failed to download media ${url}: ${error.message}`);
    }
  }

  async function worker() {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      await processEntry(entries[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(DOWNLOAD_CONCURRENCY, entries.length) }, () => worker())
  );
  await checkpointMediaMap();
  await writeJson(path.join(logsDir, 'media-download-errors.json'), errors);

  console.log('');
  console.log('Media download complete');
  console.log('');
  console.log(`Media map entries: ${entries.length}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Recovered existing files: ${recovered}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors.length}`);
  console.log('');
  console.log(`Media directory: ${path.join(config.outputDir, 'media')}`);

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

function isSameSiteUrl(url, baseUrl) {
  try {
    const sourceHost = new URL(url).hostname.replace(/^www\./, '');
    const siteHost = new URL(baseUrl).hostname.replace(/^www\./, '');
    return sourceHost === siteHost;
  } catch {
    return false;
  }
}

async function inspectExistingFile(filePath) {
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile() || fileStats.size === 0) {
      return null;
    }

    const hash = createHash('sha256');
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk);
    }

    return {
      bytes: fileStats.size,
      sha256: hash.digest('hex')
    };
  } catch {
    return null;
  }
}

main().catch((error) => {
  console.error('');
  console.error('Media download failed');
  console.error(error.message);
  process.exitCode = 1;
});
