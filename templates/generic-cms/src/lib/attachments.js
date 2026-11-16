/**
 * Attachment policy: allowlist, denylist, size limits, QDN service per type and
 * the strict metadata contract used by the editor node, the sanitizer and the
 * viewer. Nothing here touches the network.
 *
 * Limits (verified against Qortal-Hub src/constants/constants.ts and
 * qortal/get.ts, and Core ArbitraryDataFile.MAX_FILE_SIZE):
 *   - Hub MAX_SIZE_PUBLISH      = 2000 MiB per file (Core allows 2 GiB)
 *   - Hub MAX_SIZE_PUBLIC_NODE  = 500 MiB per file when the Hub uses the public
 *                                 gateway node (ext-node.qortal.link)
 * The owner asked for 2 GB audio/video and 50 MB for everything else; audio and
 * video are therefore capped at the lower Hub limit (2000 MiB).
 */

export const MIB = 1024 * 1024;
export const MAX_AV_BYTES = 2000 * MIB;
export const MAX_OTHER_BYTES = 50 * MIB;
export const MAX_PUBLIC_NODE_BYTES = 500 * MIB;
export const PUBLIC_GATEWAY_HOST = 'ext-node.qortal.link';
export const IN_MEMORY_LIMIT = 50 * MIB;
export const ATTACHMENT_ID_PREFIX = 'qms-cms-att-';

const AUDIO = ['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'wav', 'flac', 'weba'];
const VIDEO = ['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv'];
const TEXT = ['txt', 'md', 'markdown', 'pdf'];
const ARCHIVE = ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz'];
const DOCUMENT = ['doc', 'docx', 'xls', 'xlsx', 'odt', 'ods', 'ppt', 'pptx', 'csv', 'json', 'rtf'];

const DENY_EXT = new Set([
  'html', 'htm', 'xhtml', 'xht', 'shtml', 'svg', 'svgz', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'css', 'wasm', 'php', 'jsp', 'asp', 'aspx', 'swf', 'hta', 'xml', 'exe', 'bat', 'cmd', 'sh',
  'ps1', 'msi', 'apk', 'jar', 'vbs', 'scr', 'com'
]);
const DENY_MIME = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|(application|text)\/(x-)?javascript|application\/ecmascript|text\/css|application\/wasm|application\/x-msdownload|application\/x-sh)\b/i;

export function extensionOf(name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

export function titleFromFileName(name) {
  const base = String(name || '').replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  return base.trim().slice(0, 120) || 'Attachment';
}

export function safeFileName(name) {
  const base = String(name || '').replace(/^.*[\\/]/, '');
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*\\/]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return clean || 'file';
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * MIB) return (value / (1024 * MIB)).toFixed(2) + ' GB';
  if (value >= MIB) return (value / MIB).toFixed(1) + ' MB';
  if (value >= 1024) return Math.round(value / 1024) + ' KB';
  return value + ' B';
}

export function isPublicGatewayUrl(url) {
  return String(url || '').toLowerCase().includes(PUBLIC_GATEWAY_HOST);
}

/** Classify a picked file. Never trusts the MIME type alone. */
export function classifyFile(name, mime = '') {
  const ext = extensionOf(name);
  if (!ext) return { ok: false, message: 'This file has no extension, so its type cannot be verified. Rename it and try again.' };
  if (DENY_EXT.has(ext) || DENY_MIME.test(String(mime || ''))) {
    return { ok: false, message: 'Web-executable files (html, svg, js and similar) cannot be attached because they could run code. Attach a zip archive instead.' };
  }
  if (AUDIO.includes(ext)) return { ok: true, kind: 'audio', service: 'AUDIO', ext, preview: null };
  if (VIDEO.includes(ext)) return { ok: true, kind: 'video', service: 'VIDEO', ext, preview: null };
  if (TEXT.includes(ext)) return { ok: true, kind: 'text', service: 'FILE', ext, preview: ext === 'pdf' ? null : (ext === 'txt' ? 'txt' : 'md') };
  if (ARCHIVE.includes(ext)) return { ok: true, kind: 'archive', service: 'FILE', ext, preview: null };
  if (DOCUMENT.includes(ext)) return { ok: true, kind: 'document', service: 'FILE', ext, preview: null };
  return { ok: false, message: 'The file type .' + ext + ' is not supported. Allowed: text (txt, md, pdf), audio, video, archives (zip, 7z, rar, tar, gz, tgz, bz2, xz) and documents (doc, docx, xls, xlsx, odt, csv, json).' };
}

export function sizeLimitFor(kind, options = {}) {
  const base = kind === 'audio' || kind === 'video' ? MAX_AV_BYTES : MAX_OTHER_BYTES;
  return options.publicNode ? Math.min(base, MAX_PUBLIC_NODE_BYTES) : base;
}

/** Full pre-signing validation. Returns { ok, kind, service, limit } or { ok:false, message }. */
export function validateAttachment(file, options = {}) {
  if (!file || !file.name) return { ok: false, message: 'No file was selected.' };
  const type = classifyFile(file.name, file.type);
  if (!type.ok) return type;
  const size = Number(file.size) || 0;
  if (size <= 0) return { ok: false, message: 'The file "' + safeFileName(file.name) + '" is empty.' };
  const limit = sizeLimitFor(type.kind, options);
  if (size > limit) {
    const av = type.kind === 'audio' || type.kind === 'video';
    return {
      ok: false,
      message: 'The file "' + safeFileName(file.name) + '" is ' + formatBytes(size) + '. '
        + (options.publicNode && limit === MAX_PUBLIC_NODE_BYTES
          ? 'The public node accepts at most 500 MB per file.'
          : av ? 'Audio and video can be at most 2000 MB (the Qortal Hub limit).' : 'Other files can be at most 50 MB.')
    };
  }
  return { ...type, limit, size };
}

export function attachmentIdentifier(sha256) {
  const clean = String(sha256 || '').replace(/^sha256:/, '').toLowerCase();
  if (!/^[a-f0-9]{32,64}$/.test(clean)) throw new Error('An exact SHA-256 hash is required for an attachment identifier.');
  return (ATTACHMENT_ID_PREFIX + clean.slice(0, 32)).slice(0, 64);
}

const KINDS = new Set(['audio', 'video', 'text', 'archive', 'document']);
const SERVICES = new Set(['AUDIO', 'VIDEO', 'FILE']);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NAME_RE = /^[A-Za-z0-9 _.\-]{1,40}$/;

function cleanText(value, max) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f<>]+/g, ' ').trim().slice(0, max);
}

/**
 * Validate attachment metadata (from data attributes or editor attrs).
 * Returns a normalised object, or null when anything is invalid. Titles and
 * file names are plain text only; they are never interpreted as HTML.
 */
export function normalizeAttachmentMeta(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = String(raw.kind || '');
  const service = String(raw.service || '');
  const identifier = String(raw.identifier || '');
  const name = String(raw.name || '');
  if (!KINDS.has(kind) || !SERVICES.has(service) || !ID_RE.test(identifier) || !NAME_RE.test(name)) return null;
  if ((kind === 'audio') !== (service === 'AUDIO') || (kind === 'video') !== (service === 'VIDEO')) return null;
  const poster = String(raw.poster || '');
  if (poster && !ID_RE.test(poster)) return null;
  const size = Number(raw.size);
  const filename = safeFileName(raw.filename);
  const ext = extensionOf(filename);
  if (DENY_EXT.has(ext)) return null;
  return {
    kind, service, identifier, name,
    filename,
    title: cleanText(raw.title, 120) || titleFromFileName(filename),
    mime: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(String(raw.mime || '')) ? String(raw.mime).toLowerCase() : '',
    size: Number.isSafeInteger(size) && size >= 0 ? size : 0,
    sha256: /^[a-f0-9]{64}$/i.test(String(raw.sha256 || '')) ? String(raw.sha256).toLowerCase() : '',
    poster,
    preview: kind === 'text' ? (ext === 'txt' ? 'txt' : (ext === 'md' || ext === 'markdown') ? 'md' : null) : null
  };
}

export const ATTACHMENT_DATA_ATTRIBUTES = [
  'data-qms-attachment', 'data-kind', 'data-service', 'data-name', 'data-identifier',
  'data-filename', 'data-title', 'data-mime', 'data-size', 'data-sha256', 'data-poster'
];

export function metaFromElement(element) {
  const get = (name) => element.getAttribute('data-' + name) || '';
  return normalizeAttachmentMeta({
    kind: get('kind'), service: get('service'), name: get('name'), identifier: get('identifier'),
    filename: get('filename'), title: get('title'), mime: get('mime'), size: get('size'),
    sha256: get('sha256'), poster: get('poster')
  });
}

export function attributesFromMeta(meta) {
  const attrs = {
    'data-qms-attachment': '1', 'data-kind': meta.kind, 'data-service': meta.service,
    'data-name': meta.name, 'data-identifier': meta.identifier, 'data-filename': meta.filename,
    'data-title': meta.title
  };
  if (meta.mime) attrs['data-mime'] = meta.mime;
  if (meta.size) attrs['data-size'] = String(meta.size);
  if (meta.sha256) attrs['data-sha256'] = meta.sha256;
  if (meta.poster) attrs['data-poster'] = meta.poster;
  return attrs;
}

/** Collect attachment metadata from an HTML string (editor draft or sanitized content). */
export function attachmentsInHtml(html, windowLike) {
  const Parser = (windowLike || (typeof window !== 'undefined' ? window : null));
  if (!Parser || !Parser.DOMParser) return [];
  const doc = new Parser.DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
  return Array.from(doc.body.querySelectorAll('div[data-qms-attachment]')).map(metaFromElement).filter(Boolean);
}
