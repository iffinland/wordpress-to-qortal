/**
 * Q-Tube publication contract (interoperability adapter).
 *
 * No Q-Tube module is imported and this CMS has no runtime dependency on the
 * Q-Tube application. Verified against `Qortal/q-tube` main @ 68c3ea7:
 *
 *   - `src/constants/Identifiers.ts`: QTUBE_VIDEO_BASE = 'qtube_vid_'.
 *   - `src/components/Publish/PublishVideo/useVideoPublishingWorkflow.tsx`:
 *     the video metadata DOCUMENT is published at `<identifier>_metadata` with
 *     `tag1: 'qtube_vid_'` and `filename: 'video_metadata.json'`. When an
 *     existing video reference is chosen, Q-Tube publishes ONLY the metadata;
 *     the VIDEO bytes are reused at the referenced coordinate.
 *   - `src/utils/checkStructure.ts`: the discovery gate requires non-empty
 *     `title`, valid `videoReference` (name/identifier/service) and `filename`.
 *   - Q-Tube rejects MKV and HEVC uploads at selection time, so an MKV or HEVC
 *     attachment is not advertised as eligible here. MP4/M4V/WebM/OGV are the
 *     containers the Q-Tube player expects.
 *
 * The advertised video reference points at the CMS attachment resource that is
 * already part of the same confirmed batch (or already READY on QDN), so the
 * video bytes are never uploaded twice.
 */

export const QTUBE_VIDEO_IDENTIFIER_BASE = 'qtube_vid_';
export const QTUBE_METADATA_IDENTIFIER_SUFFIX = '_metadata';
export const QTUBE_CORE_TITLE_MAX = 50;
export const QTUBE_CATEGORY_OTHER_ID = 99;

/** Containers Q-Tube can play and does not reject at selection time. */
export const QTUBE_PLAYABLE_EXTENSIONS = Object.freeze(['mp4', 'm4v', 'webm', 'ogv']);

const IDENTIFIER_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function extensionOfName(name) {
  const match = /\.([a-z0-9]{1,10})$/i.exec(String(name || ''));
  return match ? match[1].toLowerCase() : '';
}

export function isQTubePlayableExtension(filename) {
  return QTUBE_PLAYABLE_EXTENSIONS.includes(extensionOfName(filename));
}

/**
 * An attachment is eligible for Q-Tube when it is a VIDEO resource the Q-Tube
 * player can stream: a playable container, a valid QDN identifier and a known
 * positive size.
 */
export function isQTubeEligibleVideo(meta) {
  if (!meta || typeof meta !== 'object') return false;
  if (meta.kind !== 'video' || meta.service !== 'VIDEO') return false;
  if (!IDENTIFIER_RE.test(String(meta.identifier || ''))) return false;
  if (!String(meta.name || '')) return false;
  if (!isQTubePlayableExtension(meta.filename)) return false;
  return Number(meta.size) > 0;
}

/** First eligible video attachment in document order, or null. */
export function selectQTubeVideo(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  return list.find(isQTubeEligibleVideo) || null;
}

/** Deterministic metadata identifier for one CMS post. */
export function qtubeMetadataIdentifier(token) {
  return QTUBE_VIDEO_IDENTIFIER_BASE + token + QTUBE_METADATA_IDENTIFIER_SUFFIX;
}

/** Q-Tube's `commentsId` shape (verified: the base already ends with '_'). */
export function qtubeCommentsId(code) {
  return QTUBE_VIDEO_IDENTIFIER_BASE + '_cm_' + code;
}

/** Q-Tube's Core metadata description marker used by its category filter. */
export function qtubeCoreMetadataDescription({ categoryId, subcategoryId = '', code, description }) {
  const marker = '**category:' + categoryId + ';subcategory:' + subcategoryId + ';code:' + code + '**';
  return marker + String(description || '').trim().slice(0, 150);
}

/**
 * Build the Q-Tube `VideoMetadata` payload field-for-field as Q-Tube writes it.
 *
 * `videoImage` stays null: the CMS does not extract a frame, and Q-Tube accepts
 * metadata without one. `duration` is optional in Q-Tube's validator, but is
 * always emitted as a non-negative number to keep the object shape stable.
 */
export function buildQTubeMetadata({ title, description = '', htmlDescription = '', video, token, durationSeconds = 0 }) {
  if (!video || !IDENTIFIER_RE.test(String(video.identifier || ''))) {
    throw new Error('A published VIDEO resource is required for Q-Tube metadata.');
  }
  const code = String(token).slice(0, 5);
  return {
    title: String(title || '').trim(),
    version: 1,
    fullDescription: String(description || '').trim(),
    htmlDescription: String(htmlDescription || '').trim() || String(description || '').trim(),
    videoImage: null,
    videoReference: {
      name: video.name,
      identifier: video.identifier,
      service: video.service || 'VIDEO'
    },
    extracts: [],
    commentsId: qtubeCommentsId(code),
    category: String(QTUBE_CATEGORY_OTHER_ID),
    subcategory: '',
    code,
    videoType: video.mime || 'video/mp4',
    filename: video.filename || (video.identifier + '.' + (extensionOfName(video.filename) || 'mp4')),
    fileSize: Number(video.size) || 0,
    duration: Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) >= 0 ? Number(durationSeconds) : 0
  };
}

/** Q-Tube's discovery-time validity gate, mirrored for a fail-closed self-check. */
export function isValidQTubeMetadata(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof value.title !== 'string' || !value.title.trim()) return false;
  if (typeof value.filename !== 'string' || !value.filename.trim()) return false;
  const ref = value.videoReference;
  if (!ref || typeof ref !== 'object') return false;
  if (!ref.name || !ref.identifier || !ref.service) return false;
  if (value.duration !== undefined && value.duration !== null) {
    if (typeof value.duration !== 'number' || Number.isNaN(value.duration) || value.duration < 0) return false;
  }
  return true;
}

/** Batch resource entry for the Q-Tube metadata DOCUMENT. */
export function buildQTubeResource({ title, plainDescription, htmlDescription, video, token }) {
  const document = buildQTubeMetadata({ title, description: plainDescription, htmlDescription, video, token });
  if (!isValidQTubeMetadata(document)) throw new Error('The generated Q-Tube metadata is not valid.');
  return {
    stage: 'qtube',
    service: 'DOCUMENT',
    identifier: qtubeMetadataIdentifier(token),
    document,
    title: String(title || '').slice(0, QTUBE_CORE_TITLE_MAX),
    description: qtubeCoreMetadataDescription({
      categoryId: QTUBE_CATEGORY_OTHER_ID,
      code: String(token).slice(0, 5),
      description: plainDescription
    }),
    tag1: QTUBE_VIDEO_IDENTIFIER_BASE
  };
}
