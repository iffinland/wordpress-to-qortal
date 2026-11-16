/**
 * Cross-publication plan builder.
 *
 * Turns the owner's optional destination checkboxes into concrete, derived QDN
 * resources that join the SAME `PUBLISH_MULTIPLE_QDN_RESOURCES` batch as the CMS
 * post. Nothing here publishes: the editor shows the complete plan in the
 * existing confirmation dialog, and `publishBatch` performs the single
 * owner-approved write.
 *
 * Safety properties:
 *   - every destination identifier is deterministic from site + post slug, so a
 *     retry overwrites the same coordinate instead of creating a duplicate;
 *   - a destination whose remote document is already byte-identical is marked
 *     `reused` and excluded from the batch (no extra fee);
 *   - the Q-Tube video is referenced, never re-uploaded: the VIDEO attachment is
 *     already part of the batch or already READY;
 *   - an invalid destination aborts before any signature request.
 */

import { readRemoteJson } from '../publish.js';
import { stableStringify } from '../settings.js';
import { stripHtml } from '../text.js';
import { stableToken } from './ids.js';
import {
  buildQTubeResource,
  qtubeMetadataIdentifier,
  QTUBE_PLAYABLE_EXTENSIONS
} from './qtube.js';
import {
  buildSubwireArticle,
  buildSubwireResource,
  fallbackSubwireCover,
  isSubwireRenderableArticle,
  markdownFromHtml,
  subwireArticleByteLength,
  subwireArticleIdentifier,
  SUBWIRE_ARTIFACT_PAYLOAD_CAP_BYTES
} from './subwire.js';
import {
  buildQuitterAnnouncement,
  buildQuitterResource,
  quitterAnnouncementProblem,
  quitterPostIdentifier,
  QUITTER_TEXT_LIMIT
} from './quitter.js';

export const CROSS_PUBLISH_DESTINATIONS = Object.freeze(['qtube', 'subwire', 'quitter']);

export const CROSS_PUBLISH_LABELS = Object.freeze({
  qtube: 'Q-Tube',
  subwire: 'Subwire',
  quitter: 'Quitter'
});

export const EMPTY_CROSS_PUBLISH_SELECTIONS = Object.freeze({
  qtube: false,
  subwire: false,
  quitter: false
});

/**
 * Best-effort deep link to a CMS post inside Qortal Hub.
 *
 * The CMS uses hash routing, so the post route is a fragment after the app
 * coordinate. Hub opens `qortal://APP/<name>/#/posts/<slug>` as the app root
 * with that fragment. A non-default app identifier is passed as the launcher's
 * `?identifier=` query. The generated Quitter text is editable precisely
 * because Hub builds differ in how much of the fragment they preserve.
 */
/**
 * @param {{ deployment?: any, name?: string, slug?: string }} [options]
 */
export function buildSitePostUrl(options = {}) {
  const { deployment = null, name = '', slug = '' } = options;
  const service = deployment && deployment.service === 'WEBSITE' ? 'WEBSITE' : 'APP';
  const siteName = (deployment && deployment.name) || name;
  if (!siteName) throw new Error('The CMS site name is unknown, so a public post link cannot be built.');
  const identifier = deployment && deployment.identifier && deployment.identifier !== 'default'
    ? String(deployment.identifier)
    : '';
  const base = 'qortal://' + service + '/' + encodeURIComponent(siteName) + '/';
  const query = identifier ? '?identifier=' + encodeURIComponent(identifier) : '';
  return base + query + '#/posts/' + encodeURIComponent(String(slug || ''));
}

function defaultReadRemote(service, name, identifier) {
  return readRemoteJson(service, name, identifier);
}

function isIdenticalRemote(remote, document) {
  if (!remote || typeof remote !== 'object') return false;
  try {
    return stableStringify(remote) === stableStringify(document);
  } catch {
    return false;
  }
}

function asText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function excerptFor(draft) {
  const explicit = asText(stripHtml(draft && draft.excerpt ? draft.excerpt : ''));
  if (explicit) return explicit;
  return asText(stripHtml(draft && draft.html ? draft.html : '')).slice(0, 300);
}

async function destinationReused({ service, name, identifier, document, readRemote }) {
  const remote = await readRemote(service, name, identifier);
  return isIdenticalRemote(remote, document);
}

/**
 * Build every selected destination.
 *
 * @param {object} input
 * @param {any} input.draft              editor draft (title, html, excerpt, slug)
 * @param {string} input.name            QDN publishing name
 * @param {string} input.siteId          canonical site id
 * @param {string} input.siteTitle       site title (fallback cover)
 * @param {string} input.publisherName   QDN name written into Subwire/Quitter payloads
 * @param {string} input.postUrl         public CMS post URL for the announcement
 * @param {any} input.video              { service, name, identifier, filename, mime, size }
 * @param {any} input.cover              Subwire cover { name, src, kind }
 * @param {{qtube?: boolean, subwire?: boolean, quitter?: boolean}} input.selections
 * @param {string} [input.quitterText]   owner-edited announcement text
 * @param {number} [input.timestamp]
 * @param {string} [input.accent]
 * @param {Function} [input.readRemote]  injected read for tests
 * @returns {Promise<{entries: any[], resources: any[], warnings: string[], announcement: string}>}
 */
export async function buildCrossPublishPlan(input) {
  const {
    draft,
    name,
    siteId,
    siteTitle = '',
    publisherName = '',
    postUrl = '',
    video = null,
    cover = null,
    selections = EMPTY_CROSS_PUBLISH_SELECTIONS,
    quitterText = '',
    timestamp = Date.now(),
    accent = '#1f2937',
    readRemote = defaultReadRemote
  } = input || {};

  if (!draft || !String(draft.title || '').trim()) throw new Error('A title is required before cross-publishing.');
  const slug = String(draft.slug || '').trim();
  if (!slug) throw new Error('A final slug is required before cross-publishing.');
  const html = String(draft.html || '');
  const now = Number(timestamp) || Date.now();
  const seedBase = String(siteId || '') + '|slug:' + slug;
  const entries = [];
  const resources = [];
  const warnings = [];
  let announcement = '';

  if (selections.qtube) {
    if (!video) {
      throw new Error('Q-Tube publication needs an eligible video attachment (' + QTUBE_PLAYABLE_EXTENSIONS.join(', ') + '). Attach a video to the post or clear the Q-Tube option.');
    }
    const token = await stableToken(seedBase + '|qtube');
    const identifier = qtubeMetadataIdentifier(token);
    const plainDescription = excerptFor(draft);
    const resource = buildQTubeResource({
      title: draft.title,
      plainDescription,
      htmlDescription: html,
      video: { ...video, name: video.name || name, service: 'VIDEO' },
      token
    });
    const reused = await destinationReused({
      service: resource.service, name, identifier: resource.identifier, document: resource.document, readRemote
    });
    entries.push({
      id: 'qtube',
      label: CROSS_PUBLISH_LABELS.qtube,
      service: 'DOCUMENT',
      identifier,
      document: resource.document,
      reused,
      summary: reused
        ? 'Q-Tube metadata is already published with identical content; the video is reused.'
        : 'Q-Tube video metadata references the existing VIDEO resource at ' + video.service + ' / ' + (video.name || name) + ' / ' + video.identifier + '.'
    });
    if (!reused) resources.push(resource);
  }

  if (selections.subwire) {
    const markdown = markdownFromHtml(html);
    if (!markdown) throw new Error('Subwire publication needs a non-empty post body.');
    const token = await stableToken(seedBase + '|subwire');
    const identifier = await subwireArticleIdentifier(token);
    let chosenCover = cover && cover.src ? cover : fallbackSubwireCover({ title: draft.title, siteTitle, accent });
    let article = buildSubwireArticle({
      title: draft.title,
      subtitle: excerptFor(draft),
      markdown,
      cover: chosenCover,
      timestamp: now,
      name: publisherName || name
    });
    let size = subwireArticleByteLength(article);
    if (size > SUBWIRE_ARTIFACT_PAYLOAD_CAP_BYTES && chosenCover.kind !== 'generated') {
      chosenCover = fallbackSubwireCover({ title: draft.title, siteTitle, accent });
      article = buildSubwireArticle({
        title: draft.title,
        subtitle: excerptFor(draft),
        markdown,
        cover: chosenCover,
        timestamp: now,
        name: publisherName || name
      });
      size = subwireArticleByteLength(article);
      warnings.push('The featured image was too large for Subwire discovery, so a generated cover was used.');
    }
    if (size > SUBWIRE_ARTIFACT_PAYLOAD_CAP_BYTES) {
      throw new Error('The Subwire article would be ' + size + ' bytes, above the 4 MiB discovery limit. Shorten the post before cross-publishing.');
    }
    if (!isSubwireRenderableArticle(article)) throw new Error('The generated Subwire article is not valid.');
    const resource = buildSubwireResource({ article, identifier });
    const reused = await destinationReused({
      service: resource.service, name, identifier, document: resource.document, readRemote
    });
    entries.push({
      id: 'subwire',
      label: CROSS_PUBLISH_LABELS.subwire,
      service: 'DOCUMENT',
      identifier,
      document: resource.document,
      reused,
      summary: reused
        ? 'The Subwire article is already published with identical content.'
        : 'Subwire essay with ' + (chosenCover.kind === 'generated' ? 'a generated cover (no featured image was embeddable)' : 'the featured image embedded as a data URL') + '.'
    });
    if (!reused) resources.push(resource);
  }

  if (selections.quitter) {
    const text = String(quitterText || '').trim() || buildQuitterAnnouncement({
      title: draft.title,
      excerpt: excerptFor(draft),
      postUrl,
      limit: QUITTER_TEXT_LIMIT
    });
    const problem = quitterAnnouncementProblem(text, QUITTER_TEXT_LIMIT);
    if (problem) throw new Error(problem);
    announcement = text;
    const token = await stableToken(seedBase + '|quitter');
    const identifier = await quitterPostIdentifier(token);
    const resource = buildQuitterResource({ text, name: publisherName || name, timestamp: now, identifier });
    const reused = await destinationReused({
      service: resource.service, name, identifier, document: resource.document, readRemote
    });
    entries.push({
      id: 'quitter',
      label: CROSS_PUBLISH_LABELS.quitter,
      service: 'DOCUMENT',
      identifier,
      document: resource.document,
      reused,
      summary: reused
        ? 'The Quitter announcement is already published with identical content.'
        : 'One public Quitter post that links to this CMS post (' + text.length + ' characters).'
    });
    if (!reused) resources.push(resource);
  }

  return { entries, resources, warnings, announcement };
}
