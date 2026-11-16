import { readFileBytes } from './mediaBytes.js';
import { sha256Hex } from './qortal.js';
import { hashBlobStreaming } from './sha256Stream.js';
import {
  IN_MEMORY_LIMIT, attachmentIdentifier, safeFileName, titleFromFileName, validateAttachment
} from './attachments.js';

/**
 * Capture a picked file at pick time (Android Hub can revoke the content URI
 * right after the picker returns). Files up to 50 MB are copied into an
 * in-memory Blob; larger audio/video files are probed and hashed in slices
 * while the reference is still valid and then kept as the original File so the
 * whole file is never base64-encoded into memory.
 */
export async function captureAttachment(file, options = {}) {
  const check = validateAttachment(file, options);
  if (!check.ok) return check;
  const filename = safeFileName(file.name);
  const mime = file.type || '';
  let blob;
  let sha256;
  try {
    if (file.size <= IN_MEMORY_LIMIT) {
      const bytes = await readFileBytes(file);
      blob = new Blob([bytes], { type: mime });
      sha256 = await sha256Hex(bytes);
    } else {
      await readFileBytes(file.slice(0, 1));
      sha256 = await hashBlobStreaming(file, options.onProgress);
      blob = file;
    }
  } catch (error) {
    return { ok: false, message: 'The file "' + filename + '" could not be read from this device. Re-select it and try again. ' + (error && error.message ? error.message : '') };
  }
  let poster = null;
  if (check.kind === 'video') poster = await generateVideoPoster(blob).catch(() => null);
  let posterIdentifier = '';
  if (poster) {
    poster.sha256 = await sha256Hex(poster.bytes);
    posterIdentifier = ('qms-cms-media-' + poster.sha256.slice(0, 32)).slice(0, 64);
  }
  return {
    ok: true,
    kind: check.kind,
    service: check.service,
    preview: check.preview,
    filename,
    mime,
    size: file.size,
    sha256,
    identifier: attachmentIdentifier(sha256),
    title: titleFromFileName(filename),
    blob,
    poster,
    posterIdentifier
  };
}

/** Grab a still frame about 1 s in (or 10 % of short clips). Resolves null when the webview cannot decode it. */
export function generateVideoPoster(blob, timeoutMs = 8000) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) { resolve(null); return; }
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      try { video.load(); } catch { /* ignore */ }
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.onerror = () => finish(null);
    video.onloadedmetadata = () => {
      const duration = Number(video.duration);
      video.currentTime = Number.isFinite(duration) && duration > 0 ? (duration > 10 ? 1 : duration * 0.1) : 0;
    };
    video.onseeked = () => {
      try {
        const width = Math.min(640, video.videoWidth || 640);
        const height = Math.round(width * ((video.videoHeight || 360) / (video.videoWidth || 640)));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) { finish(null); return; }
        context.drawImage(video, 0, 0, width, height);
        canvas.toBlob(async (result) => {
          if (!result) { finish(null); return; }
          try {
            finish({ bytes: new Uint8Array(await result.arrayBuffer()), mimeType: 'image/jpeg', filename: 'poster.jpg' });
          } catch { finish(null); }
        }, 'image/jpeg', 0.8);
      } catch { finish(null); }
    };
    video.src = url;
  });
}
