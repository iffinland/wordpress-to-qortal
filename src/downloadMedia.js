import { createHash } from 'node:crypto';
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
  return path.join('media', folder, `${baseName}${extension}`);
}

function getSha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function downloadFile(url) {
  const response = await fetch(url, {
    headers: {
      Accept: '*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`Media download failed: ${response.status} ${response.statusText}`);
  }

  return Buffer.from(await response.arrayBuffer());
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
  let skipped = 0;

  for (const [url, mediaItem] of entries) {
    if (mediaItem.local_path && mediaItem.sha256) {
      skipped += 1;
      continue;
    }

    try {
      const localPath = createLocalMediaPath(url, mediaItem, downloaded + skipped);
      const absolutePath = path.join(config.outputDir, localPath);
      const data = await downloadFile(url);

      await ensureDir(path.dirname(absolutePath));
      await writeBinaryFile(absolutePath, data);

      mediaMap[url] = {
        ...mediaItem,
        local_path: localPath.replaceAll(path.sep, '/'),
        sha256: getSha256(data),
        bytes: data.length,
        downloaded: true,
        downloaded_at: new Date().toISOString()
      };
      downloaded += 1;
    } catch (error) {
      errors.push(serializeError(error, { url }));
      console.error(`Failed to download media ${url}: ${error.message}`);
    }
  }

  await writeJson(mediaMapPath, mediaMap);
  await writeJson(path.join(logsDir, 'media-download-errors.json'), errors);

  console.log('');
  console.log('Media download complete');
  console.log('');
  console.log(`Media map entries: ${entries.length}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Errors: ${errors.length}`);
  console.log('');
  console.log(`Media directory: ${path.join(config.outputDir, 'media')}`);

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

async function writeBinaryFile(filePath, data) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(filePath, data);
}

main().catch((error) => {
  console.error('');
  console.error('Media download failed');
  console.error(error.message);
  process.exitCode = 1;
});
