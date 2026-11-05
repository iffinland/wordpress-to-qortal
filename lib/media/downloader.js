import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { QmsError, ERROR_CODES } from '../engine/errors.js';
import { runtimeDiskCheck } from '../engine/disk.js';
import {
  finalizePart,
  hashFile,
  partPathFor,
  relativeAssetPath
} from './store.js';
import { validateMediaUrl, validateRedirect } from './url-policy.js';

const CHECK_INTERVAL_BYTES = 1024 * 1024;
const HTML_EXTENSIONS = new Set(['.html', '.htm', '.xhtml']);

function parseContentLength(response) {
  const raw = response.headers.get('content-length');
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/i.exec(String(value ?? '').trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3])
  };
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Streaming media downloader.
 *
 * - bounded memory: response bodies are consumed chunk by chunk;
 * - .part files plus bounded Range resume;
 * - SHA-256 is computed from disk and verified before atomic finalization;
 * - per-file and per-run byte caps plus a live disk reserve check;
 * - redirects are validated one at a time; local/private targets are refused.
 *
 * This class performs no state-store writes. The caller persists receipts and
 * reference counts only after a verified result.
 */
export class MediaDownloader {
  constructor({
    fetchImpl = globalThis.fetch,
    clock,
    diskProbe,
    diskLimits,
    mediaSettings,
    baseUrl = null,
    assetsDir,
    tmpDir,
    signal = null,
    onProgress = null
  }) {
    if (typeof fetchImpl !== 'function') {
      throw new QmsError(ERROR_CODES.CONFIG_INVALID, 'A fetch implementation is required for media downloads.');
    }
    this.fetch = fetchImpl;
    this.clock = clock;
    this.diskProbe = diskProbe;
    this.diskLimits = diskLimits;
    this.mediaSettings = mediaSettings;
    this.baseUrl = baseUrl;
    this.assetsDir = assetsDir;
    this.tmpDir = tmpDir;
    this.signal = signal;
    this.onProgress = onProgress;
  }

  _policyOptions(extra = {}) {
    return {
      baseUrl: this.baseUrl,
      allowExternalMedia: this.mediaSettings.allowExternalMedia,
      allowLoopback: this.mediaSettings.allowLoopback,
      ...extra
    };
  }

  _abortController() {
    const controller = new AbortController();
    let timer = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => controller.abort('timeout'), this.mediaSettings.timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    };
    refresh();
    const link = () => controller.abort('cancelled');
    if (this.signal) {
      if (this.signal.aborted) controller.abort('cancelled');
      else this.signal.addEventListener('abort', link, { once: true });
    }
    return {
      signal: controller.signal,
      refresh,
      dispose() {
        if (timer) clearTimeout(timer);
        this.signal?.removeEventListener?.('abort', link);
      }
    };
  }

  canceled() {
    return Boolean(this.signal?.aborted);
  }

  async _fetchWithRedirects(url, { method, headers = {} } = {}) {
    let current = url;
    let redirects = 0;
    const controller = this._abortController();
    try {
      for (;;) {
        controller.refresh();
        const response = await this.fetch(current, {
          method,
          headers,
          redirect: 'manual',
          signal: controller.signal
        });
        if (![301, 302, 303, 307, 308].includes(response.status)) {
          return { response, finalUrl: current, redirects };
        }
        const location = response.headers.get('location');
        if (!location) {
          return {
            error: {
              code: ERROR_CODES.MEDIA_REDIRECT_BLOCKED,
              message: 'Redirect response had no Location header.',
              httpStatus: response.status
            }
          };
        }
        redirects += 1;
        if (redirects > this.mediaSettings.maxRedirects) {
          return {
            error: {
              code: ERROR_CODES.MEDIA_REDIRECT_BLOCKED,
              message: 'Too many media redirects.',
              redirects
            }
          };
        }
        const validated = await validateRedirect(current, location, this._policyOptions());
        if (!validated.ok) {
          return {
            error: {
              code: ERROR_CODES.MEDIA_REDIRECT_BLOCKED,
              message: validated.message,
              policy: validated.policy ?? null,
              redirects
            }
          };
        }
        current = validated.url.toString();
      }
    } catch (error) {
      const aborted = controller.signal.aborted;
      return {
        error: {
          code: aborted
            ? (this.canceled() ? 'CANCELLED' : ERROR_CODES.MEDIA_DOWNLOAD_FAILED)
            : ERROR_CODES.MEDIA_DOWNLOAD_FAILED,
          message: aborted && this.canceled()
            ? 'Media download was cancelled.'
            : aborted
              ? 'Media request timed out.'
              : (error instanceof Error ? error.message : String(error)),
          retryable: !this.canceled(),
          timeout: aborted && !this.canceled()
        }
      };
    } finally {
      controller.dispose();
    }
  }

  /**
   * Safe HEAD estimate. Unknown size is reported explicitly; it is never
   * treated as zero.
   */
  async estimate(url) {
    const validated = await validateMediaUrl(url, this._policyOptions());
    if (!validated.ok) {
      return {
        status: validated.policy === 'linked-only' ? 'skipped_external' : 'blocked',
        url,
        policy: validated.policy ?? null,
        code: validated.code,
        message: validated.message,
        external: Boolean(validated.external)
      };
    }
    const result = await this._fetchWithRedirects(validated.url.toString(), {
      method: 'HEAD',
      headers: { accept: '*/*' }
    });
    if (result.error) {
      if (result.error.code === 'CANCELLED') {
        return { status: 'cancelled', url, code: 'CANCELLED', message: result.error.message };
      }
      if (result.error.code === ERROR_CODES.MEDIA_REDIRECT_BLOCKED || result.error.code === ERROR_CODES.MEDIA_URL_BLOCKED) {
        return {
          status: 'blocked',
          url,
          finalUrl: validated.url.toString(),
          policy: result.error.policy ?? null,
          code: result.error.code,
          message: result.error.message
        };
      }
      return {
        status: 'unknown',
        url,
        finalUrl: validated.url.toString(),
        reason: 'head-failed',
        code: result.error.code,
        message: result.error.message
      };
    }
    const response = result.response;
    if (response.status === 404 || response.status === 410) {
      return {
        status: 'missing',
        url,
        finalUrl: result.finalUrl,
        httpStatus: response.status,
        code: ERROR_CODES.MEDIA_NOT_FOUND,
        message: 'Media resource was not found (' + response.status + ').'
      };
    }
    if (response.status === 405 || response.status === 501) {
      return this._estimateWithRange(url, validated.url.toString(), 'head-unsupported', response.status);
    }
    if (!response.ok) {
      return {
        status: 'unknown',
        url,
        finalUrl: result.finalUrl,
        reason: 'http-error',
        httpStatus: response.status,
        code: response.status >= 500 ? ERROR_CODES.MEDIA_DOWNLOAD_FAILED : ERROR_CODES.MEDIA_NOT_FOUND,
        message: 'HEAD request returned HTTP ' + response.status + '.'
      };
    }
    const contentLength = parseContentLength(response);
    const contentType = response.headers.get('content-type');
    if (contentLength === null) {
      return this._estimateWithRange(url, result.finalUrl, 'no-content-length', response.status, contentType);
    }
    return {
      status: 'known',
      url,
      finalUrl: result.finalUrl,
      bytes: contentLength,
      contentType,
      reason: null,
      redirects: result.redirects
    };
  }

  /**
   * Some servers reject HEAD or omit Content-Length on HEAD. A one-byte ranged
   * GET recovers the total size from Content-Range without downloading the
   * file. The response body is cancelled immediately; a server that ignores the
   * Range header is still not read beyond the headers.
   */
  async _estimateWithRange(url, finalUrl, reason, httpStatus, contentType = null) {
    let fallback;
    try {
      fallback = await this._fetchWithRedirects(finalUrl, {
        method: 'GET',
        headers: { accept: '*/*', range: 'bytes=0-0' }
      });
    } catch {
      fallback = { error: { code: ERROR_CODES.MEDIA_DOWNLOAD_FAILED } };
    }
    const response = fallback.response;
    if (!response) {
      return { status: 'unknown', url, finalUrl, reason: 'head-failed', httpStatus };
    }
    const contentRange = parseContentRange(response.headers.get('content-range'));
    const length = contentRange && Number.isInteger(contentRange.total)
      ? contentRange.total
      : parseContentLength(response);
    try {
      await response.body?.cancel();
    } catch {
      // Best effort: the size is already known or remains explicitly unknown.
    }
    if (length !== null) {
      return {
        status: 'known',
        url,
        finalUrl,
        bytes: length,
        contentType: response.headers.get('content-type') ?? contentType,
        reason: null,
        recoveredFrom: reason,
        httpStatus: response.status
      };
    }
    return { status: 'unknown', url, finalUrl, reason, httpStatus, recoveredFrom: reason };
  }

  async _readPartMetadata(metaPath) {
    try {
      const raw = await readFile(metaPath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  async _writePartMetadata(metaPath, metadata) {
    await writeFile(metaPath, JSON.stringify(metadata, null, 2) + '\n', 'utf8').catch(() => {});
  }

  async _hashExisting(partPath) {
    try {
      return await hashFile(partPath);
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async _prepareResume({ url, partPath, metaPath, expectedBytes }) {
    let partSize = 0;
    const existing = await this._hashExisting(partPath);
    if (existing) partSize = existing.bytes;
    if (partSize === 0) {
      await unlink(metaPath).catch(() => {});
      return { partSize: 0, expectedBytes, restart: false };
    }
    const metadata = await this._readPartMetadata(metaPath);
    if (!metadata || metadata.url !== url) {
      await unlink(partPath).catch(() => {});
      await unlink(metaPath).catch(() => {});
      return { partSize: 0, expectedBytes, restart: true };
    }
    const knownExpected = expectedBytes ?? metadata.expectedBytes ?? null;
    if (knownExpected !== null && partSize > knownExpected) {
      await unlink(partPath).catch(() => {});
      await unlink(metaPath).catch(() => {});
      return { partSize: 0, expectedBytes, restart: true };
    }
    return { partSize, expectedBytes: knownExpected, restart: false };
  }

  async _guardDisk(partPath, pendingBytes) {
    const check = await runtimeDiskCheck({
      probe: this.diskProbe,
      workspacePath: this.tmpDir,
      reserveBytes: this.diskLimits.reserveBytes,
      pendingBytes
    });
    if (!check.ok) {
      return {
        status: 'paused',
        code: check.code,
        message: 'Download paused before the configured disk reserve would be breached.',
        bytesDownloaded: pendingBytes,
        partPath,
        availableBytes: check.availableBytes
      };
    }
    return null;
  }

  /**
   * Download one media URL. The caller is responsible for per-run file/byte
   * accounting; this method enforces the per-file cap and disk reserve.
   */
  async download(url, { expectedBytes = null, maxFileBytes = this.diskLimits.maxFileBytes, maxTotalBytes = null } = {}) {
    if (this.canceled()) {
      return { status: 'cancelled', url, bytesDownloaded: 0, message: 'Media download was cancelled.' };
    }
    const validated = await validateMediaUrl(url, this._policyOptions());
    if (!validated.ok) {
      return {
        status: validated.policy === 'linked-only' ? 'skipped_external' : 'blocked',
        url,
        policy: validated.policy ?? null,
        code: validated.code,
        message: validated.message,
        retryable: false
      };
    }
    const finalUrl = validated.url.toString();
    await mkdir(this.tmpDir, { recursive: true });
    await mkdir(this.assetsDir, { recursive: true });
    if (maxTotalBytes !== null && expectedBytes !== null && expectedBytes > maxTotalBytes) {
      return {
        status: 'paused',
        code: ERROR_CODES.DISK_LIMIT_EXCEEDED,
        message: 'The remaining per-run byte budget is smaller than the planned media file.',
        url: finalUrl,
        bytesDownloaded: 0,
        retryable: true
      };
    }
    const partPath = partPathFor(this.tmpDir, finalUrl);
    const metaPath = partPath + '.json';
    const resume = await this._prepareResume({ url: finalUrl, partPath, metaPath, expectedBytes });
    let partSize = resume.partSize;
    let knownExpected = resume.expectedBytes;
    let attempt = 0;
    let lastFailure = null;

    while (attempt <= this.mediaSettings.maxRetries && !this.canceled()) {
      attempt += 1;
      const headers = { accept: '*/*' };
      if (partSize > 0) headers.range = 'bytes=' + partSize + '-';
      const result = await this._fetchWithRedirects(finalUrl, { method: 'GET', headers });
      if (result.error) {
        if (result.error.code === 'CANCELLED') {
          return { status: 'cancelled', url: finalUrl, bytesDownloaded: partSize, partPath };
        }
        lastFailure = result.error;
        if (!result.error.retryable || attempt > this.mediaSettings.maxRetries) break;
        await sleep(this.mediaSettings.retryDelayMs);
        continue;
      }
      const response = result.response;
      if (response.status === 416 && partSize > 0 && knownExpected !== null && partSize === knownExpected) {
        return this._finalize({ url: finalUrl, partPath, metaPath, expectedBytes: knownExpected });
      }
      if (response.status === 404 || response.status === 410) {
        await unlink(partPath).catch(() => {});
        await unlink(metaPath).catch(() => {});
        return {
          status: 'failed',
          code: ERROR_CODES.MEDIA_NOT_FOUND,
          message: 'Media resource was not found (' + response.status + ').',
          url: finalUrl,
          httpStatus: response.status,
          retryable: false
        };
      }
      if (!response.ok) {
        lastFailure = {
          code: response.status >= 500 ? ERROR_CODES.MEDIA_DOWNLOAD_FAILED : ERROR_CODES.MEDIA_DOWNLOAD_FAILED,
          message: 'Media request returned HTTP ' + response.status + '.',
          retryable: response.status >= 500 || response.status === 429,
          httpStatus: response.status
        };
        if (!lastFailure.retryable || attempt > this.mediaSettings.maxRetries) break;
        await sleep(this.mediaSettings.retryDelayMs);
        continue;
      }

      let append = false;
      if (response.status === 206) {
        const range = parseContentRange(response.headers.get('content-range'));
        if (!range || range.start !== partSize) {
          await unlink(partPath).catch(() => {});
          await unlink(metaPath).catch(() => {});
          return {
            status: 'failed',
            code: ERROR_CODES.MEDIA_PART_CORRUPT,
            message: 'The server returned an invalid partial-content range.',
            url: finalUrl,
            retryable: true
          };
        }
        append = true;
        if (range.total !== null) knownExpected = range.total;
      } else if (response.status === 200) {
        if (partSize > 0) {
          // The server ignored Range: start over rather than corrupting the file.
          await unlink(partPath).catch(() => {});
          partSize = 0;
        }
        const length = parseContentLength(response);
        if (length !== null) knownExpected = length;
      } else {
        lastFailure = {
          code: ERROR_CODES.MEDIA_DOWNLOAD_FAILED,
          message: 'Unexpected media response status ' + response.status + '.',
          retryable: false
        };
        break;
      }

      const contentType = response.headers.get('content-type') ?? '';
      const extension = path.extname(new URL(finalUrl).pathname).toLowerCase();
      if (/^text\/html/i.test(contentType) && !HTML_EXTENSIONS.has(extension)) {
        await unlink(partPath).catch(() => {});
        await unlink(metaPath).catch(() => {});
        return {
          status: 'failed',
          code: ERROR_CODES.MEDIA_UNEXPECTED_CONTENT_TYPE,
          message: 'Media endpoint returned an HTML page instead of a media file.',
          url: finalUrl,
          contentType,
          retryable: false
        };
      }
      if (knownExpected !== null && knownExpected > maxFileBytes) {
        await unlink(partPath).catch(() => {});
        await unlink(metaPath).catch(() => {});
        return {
          status: 'failed',
          code: ERROR_CODES.MEDIA_FILE_TOO_LARGE,
          message: 'Media file exceeds the configured per-file byte cap.',
          url: finalUrl,
          bytes: knownExpected,
          maxFileBytes,
          retryable: false
        };
      }

      if (partSize > 0 && !append) partSize = 0;
      const handle = await open(partPath, append ? 'a' : 'w', 0o600);
      const hash = createHash('sha256');
      if (append && partSize > 0) {
        // Re-hash the existing bytes before appending; hashing state cannot be
        // serialized across runs, so correctness beats a small resume cost.
        await new Promise((resolve, reject) => {
          const read = createReadStream(partPath, { end: partSize - 1 });
          read.on('data', (chunk) => hash.update(chunk));
          read.on('error', reject);
          read.on('end', resolve);
        });
      }
      const diskGuard = await this._guardDisk(partPath, 0);
      if (diskGuard) {
        await handle.close();
        await this._writePartMetadata(metaPath, {
          url: finalUrl,
          expectedBytes: knownExpected,
          bytesDownloaded: partSize,
          updatedAt: this.clock.nowIso(),
          status: diskGuard.code
        });
        return { ...diskGuard, bytesDownloaded: partSize, partPath };
      }

      await this._writePartMetadata(metaPath, {
        url: finalUrl,
        expectedBytes: knownExpected,
        bytesDownloaded: partSize,
        updatedAt: this.clock.nowIso(),
        status: 'downloading'
      });
      let sessionBytes = 0;
      let sinceCheck = 0;
      let failed = null;
      try {
        for await (const chunk of response.body) {
          if (this.canceled()) {
            failed = { code: 'CANCELLED', message: 'Media download was cancelled.', retryable: true };
            break;
          }
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const nextTotal = partSize + sessionBytes + buffer.length;
          if (nextTotal > maxFileBytes) {
            failed = {
              code: ERROR_CODES.MEDIA_FILE_TOO_LARGE,
              message: 'Media file exceeded the configured per-file byte cap during streaming.',
              retryable: false
            };
            break;
          }
          if (maxTotalBytes !== null && nextTotal > maxTotalBytes) {
            failed = {
              code: ERROR_CODES.DISK_LIMIT_EXCEEDED,
              message: 'The download would exceed the remaining per-run byte budget.',
              retryable: true,
              pause: true
            };
            break;
          }
          if ((sinceCheck + buffer.length) >= CHECK_INTERVAL_BYTES) {
            const guard = await this._guardDisk(partPath, buffer.length);
            if (guard) {
              failed = { ...guard, retryable: true, pause: true };
              break;
            }
            sinceCheck = 0;
            await this._writePartMetadata(metaPath, {
              url: finalUrl,
              expectedBytes: knownExpected,
              bytesDownloaded: partSize + sessionBytes,
              updatedAt: this.clock.nowIso(),
              status: 'downloading'
            });
          }
          await handle.write(buffer);
          hash.update(buffer);
          sessionBytes += buffer.length;
          sinceCheck += buffer.length;
          if (this.onProgress) {
            this.onProgress({ url: finalUrl, bytes: partSize + sessionBytes, expectedBytes: knownExpected });
          }
        }
      } catch (error) {
        failed = {
          code: error?.code === 'ENOSPC' ? ERROR_CODES.DISK_FULL : ERROR_CODES.MEDIA_DOWNLOAD_FAILED,
          message: error?.code === 'ENOSPC'
            ? 'The filesystem ran out of space during the download.'
            : 'The media stream was interrupted: ' + (error instanceof Error ? error.message : String(error)),
          retryable: true,
          pause: error?.code === 'ENOSPC'
        };
      } finally {
        await handle.close();
      }

      const totalBytes = partSize + sessionBytes;
      if (failed) {
        await this._writePartMetadata(metaPath, {
          url: finalUrl,
          expectedBytes: knownExpected,
          bytesDownloaded: totalBytes,
          updatedAt: this.clock.nowIso(),
          status: failed.code
        });
        if (failed.code === 'CANCELLED') {
          return { status: 'cancelled', url: finalUrl, bytesDownloaded: totalBytes, partPath };
        }
        if (failed.pause) {
          return {
            status: 'paused',
            code: failed.code,
            message: failed.message,
            url: finalUrl,
            bytesDownloaded: totalBytes,
            partPath,
            retryable: true
          };
        }
        lastFailure = failed;
        if (!failed.retryable || attempt > this.mediaSettings.maxRetries) {
          return {
            status: 'failed',
            code: failed.code,
            message: failed.message,
            url: finalUrl,
            bytesDownloaded: totalBytes,
            partPath,
            retryable: Boolean(failed.retryable)
          };
        }
        partSize = totalBytes;
        await sleep(this.mediaSettings.retryDelayMs);
        continue;
      }

      if (knownExpected !== null && totalBytes !== knownExpected) {
        lastFailure = {
          code: ERROR_CODES.MEDIA_SIZE_MISMATCH,
          message: 'Downloaded byte count does not match the expected size.',
          retryable: true
        };
        await this._writePartMetadata(metaPath, {
          url: finalUrl,
          expectedBytes: knownExpected,
          bytesDownloaded: totalBytes,
          updatedAt: this.clock.nowIso(),
          status: ERROR_CODES.MEDIA_SIZE_MISMATCH
        });
        if (attempt > this.mediaSettings.maxRetries) {
          return {
            status: 'failed',
            code: lastFailure.code,
            message: lastFailure.message,
            url: finalUrl,
            bytesDownloaded: totalBytes,
            partPath,
            retryable: true
          };
        }
        partSize = totalBytes < knownExpected ? totalBytes : 0;
        await sleep(this.mediaSettings.retryDelayMs);
        continue;
      }

      await unlink(metaPath).catch(() => {});
      const finalized = await this._finalize({
        url: finalUrl,
        partPath,
        metaPath,
        expectedBytes: knownExpected,
        mimeType: contentType || null,
        bytesDownloaded: totalBytes
      });
      if (finalized.status === 'failed' && finalized.retryable && attempt <= this.mediaSettings.maxRetries) {
        lastFailure = finalized;
        partSize = 0;
        continue;
      }
      return finalized;
    }

    return {
      status: 'failed',
      code: lastFailure?.code ?? ERROR_CODES.MEDIA_DOWNLOAD_FAILED,
      message: lastFailure?.message ?? 'Media download failed after bounded retries.',
      url: finalUrl,
      bytesDownloaded: partSize,
      partPath,
      retryable: Boolean(lastFailure?.retryable)
    };
  }

  async _finalize({ url, partPath, metaPath, expectedBytes, mimeType = null, bytesDownloaded = null }) {
    try {
      const result = await finalizePart({
        partPath,
        assetsDir: this.assetsDir,
        expectedBytes
      });
      await unlink(metaPath).catch(() => {});
      return {
        status: 'verified',
        url,
        hash: result.hash,
        bytes: result.bytes,
        filePath: result.filePath,
        relativePath: relativeAssetPath(this.assetsDir, result.filePath),
        mimeType,
        reused: result.reused,
        bytesDownloaded: bytesDownloaded ?? result.bytes
      };
    } catch (error) {
      if (error instanceof QmsError) {
        return {
          status: 'failed',
          code: error.code,
          message: error.message,
          url,
          partPath,
          retryable: false,
          details: error.details
        };
      }
      throw error;
    }
  }
}
