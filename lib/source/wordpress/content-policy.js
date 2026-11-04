import * as cheerio from 'cheerio';

/**
 * WordPress content-only import policy.
 *
 * QMS migrates content, not WordPress plugin behaviour. This policy removes
 * unsupported interactive functionality before the canonical content hash is
 * computed, while preserving editorial text, links, images and supported
 * media that live inside or around plugin-generated blocks.
 *
 * It is deliberately small: a fixed remove-list, explicit detection for the
 * unsupported feature families QMS supports reporting, and no plugin
 * compatibility framework. Values of removed elements (including short-lived
 * form/session tokens) are never returned, persisted or included in warnings.
 */
export const CONTENT_POLICY_ID = 'qms-wp-content-only@1';
export const CONTENT_POLICY_VERSION = 1;

const REMOVE_SUBTREES = [
  'script', 'noscript', 'style', 'template', 'object', 'embed', 'applet',
  'frame', 'frameset', 'canvas', 'svg', 'math', 'link', 'meta'
];

const FORM_CONTROLS = [
  'input', 'select', 'textarea', 'button', 'datalist', 'output', 'progress',
  'meter', 'optgroup', 'option', 'fieldset', 'legend', 'label'
];

const MEDIA_EMBED_HOSTS = [
  'youtube.com', 'www.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com',
  'player.vimeo.com', 'archive.org', 'www.archive.org', 'soundcloud.com', 'w.soundcloud.com'
];

const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;
const JWT_PATTERN_GLOBAL = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const VOLATILE_ATTRIBUTE = /nonce|csrf|jwt|(^|[-_])token($|[-_])|(^|[-_])signature($|[-_])/i;

const COMMERCE_TOKEN = /(^|[-_])(cart|checkout|payment|paypal|stripe|gumroad|shopify|woocommerce|add_to_cart)([-_]|$)/i;
const AUTH_TOKEN = /(^|[-_])(login|loginform|signup|register|membership|memberful|restrict-content|paid-memberships)([-_]|$)/i;

const SHORTCODE_PATTERN = /\[(contact-form|woocommerce[^\]]*|wpforms[^\]]*|gravityforms?[^\]]*|ninja_form[^\]]*|formidable[^\]]*|give_form[^\]]*|memberful[^\]]*)\]/gi;

function classTokens(node) {
  return new Set(String(node.attr('class') ?? '').split(/\s+/).filter(Boolean));
}

function hasClassToken(tokenSet, pattern) {
  for (const token of tokenSet) {
    if (pattern.test(token)) return true;
  }
  return false;
}

function isJetpackFormMarker(node, tokens, id, action, interactive) {
  if (String(interactive).toLowerCase() === 'jetpack/form') return true;
  if (tokens.has('jetpack-contact-form-container')) return true;
  if (tokens.has('wp-block-jetpack-contact-form')) return true;
  if (id.startsWith('contact-form-') && tokens.has('contact-form')) return true;
  if (tokens.has('contact-form') && (String(action).includes('contact') || String(node.attr('data-test') ?? '') === 'contact-form')) return true;
  return false;
}

function interactiveRegionFor(node, tag) {
  const tokens = classTokens(node);
  const id = String(node.attr('id') ?? '').toLowerCase();
  const action = String(node.attr('action') ?? '').toLowerCase();
  const interactive = String(node.attr('data-wp-interactive') ?? '');
  const isJetpack = isJetpackFormMarker(node, tokens, id, action, interactive);
  if (isJetpack) {
    return { feature: 'contact_form', provider: 'jetpack', element: tag };
  }
  if (COMMERCE_TOKEN.test(id) || hasClassToken(tokens, COMMERCE_TOKEN)) {
    return { feature: 'commerce', provider: tokens.has('woocommerce') ? 'woocommerce' : null, element: tag };
  }
  if (AUTH_TOKEN.test(id) || hasClassToken(tokens, AUTH_TOKEN)) {
    return { feature: 'authentication', provider: null, element: tag };
  }
  if (tag === 'form') {
    return { feature: 'form', provider: null, element: tag };
  }
  return null;
}

function isDataUrl(value) {
  return /^data:/i.test(String(value ?? '').trim());
}

function isMediaHost(url) {
  try {
    const host = new URL(url, 'https://invalid.local').hostname.toLowerCase();
    return MEDIA_EMBED_HOSTS.some((allowed) => host === allowed || host.endsWith('.' + allowed));
  } catch {
    return false;
  }
}

/**
 * Contact/commerce/auth regions are interaction-only plugin blocks. Preserve
 * genuine media found inside them (a plugin gallery embedded in a form is
 * still migrated media) but never preserve plugin chrome, labels or buttons.
 */
function salvageFromInteractiveRegion($, region) {
  const media = [];
  region.find('img[src]').each((_, element) => {
    const node = $(element);
    const src = node.attr('src');
    if (!src || isDataUrl(src)) return;
    media.push($.html(node));
  });
  region.find('video, audio').each((_, element) => {
    const node = $(element);
    const src = node.attr('src') ?? node.find('source[src]').first().attr('src') ?? '';
    if (!src || isDataUrl(src)) return;
    media.push($.html(node));
  });
  return media;
}

/** Generic forms can wrap editorial paragraphs; unwrap them when text exists. */
function salvageFromGenericForm($, region) {
  const clone = region.clone();
  clone.find(REMOVE_SUBTREES.join(',')).remove();
  clone.find(FORM_CONTROLS.join(',')).remove();
  clone.find('*').each((_, element) => {
    const node = $(element);
    for (const name of Object.keys(element.attribs ?? {})) {
      if (isVolatileAttribute(name, node.attr(name)) || name.toLowerCase().startsWith('data-wp-') || name.toLowerCase().startsWith('on')) {
        node.removeAttr(name);
      }
    }
  });
  const text = clone.text().replace(/\s+/g, ' ').trim();
  const hasMedia = clone.find('img[src], video[src], audio[src], video source[src], audio source[src]').length > 0;
  if (text.length < 20 && !hasMedia) return [];
  const html = $.html(clone).trim();
  return html ? [html] : [];
}

function isVolatileAttribute(name, value) {
  const lower = String(name ?? '').toLowerCase();
  if (lower.startsWith('on')) return true;
  if (lower.startsWith('data-wp-')) return true;
  if (VOLATILE_ATTRIBUTE.test(lower)) return true;
  const text = String(value ?? '');
  return JWT_PATTERN.test(text);
}

const VOLATILE_BLOCK_INSTANCE = /^wp-block-[a-z][a-z0-9-]*-\d+$/i;

/**
 * WordPress block renderers can assign per-request instance ids such as
 * wp-block-gallery-1 vs wp-block-gallery-4. They are not editorial content and
 * must not create false modifications. Attachment ids (wp-image-123) and
 * semantic layout classes (columns-3) are preserved.
 */
function stripVolatileBlockInstanceIds($, counts) {
  let changed = false;
  $('[class]').each((_, element) => {
    const node = $(element);
    const tokens = String(node.attr('class') ?? '').split(/\s+/).filter(Boolean);
    const kept = tokens.filter((token) => !VOLATILE_BLOCK_INSTANCE.test(token));
    if (kept.length === tokens.length) return;
    if (kept.length > 0) node.attr('class', kept.join(' '));
    else node.removeAttr('class');
    counts.volatileAttributes += 1;
    changed = true;
  });
  $('[id]').each((_, element) => {
    const node = $(element);
    if (!VOLATILE_BLOCK_INSTANCE.test(String(node.attr('id') ?? ''))) return;
    node.removeAttr('id');
    counts.volatileAttributes += 1;
    changed = true;
  });
  return changed;
}

function removeVolatileAttributes($, counts) {
  let changed = false;
  $('*').each((_, element) => {
    for (const name of Object.keys(element.attribs ?? {})) {
      if (!isVolatileAttribute(name, element.attribs[name])) continue;
      $(element).removeAttr(name);
      counts.volatileAttributes += 1;
      changed = true;
    }
  });
  if (stripVolatileBlockInstanceIds($, counts)) changed = true;
  return changed;
}

function redactTextTokens($, counts) {
  let changed = false;
  $('*').contents().each((_, node) => {
    if (node.type !== 'text') return;
    const text = String(node.data ?? '');
    if (!JWT_PATTERN.test(text)) return;
    node.data = text.replace(JWT_PATTERN_GLOBAL, '[redacted-token]');
    counts.tokens += 1;
    changed = true;
  });
  return changed;
}

function removeShortcodes($, findings, counts) {
  let changed = false;
  $('*').contents().each((_, node) => {
    if (node.type !== 'text') return;
    const text = String(node.data ?? '');
    if (!SHORTCODE_PATTERN.test(text)) return;
    SHORTCODE_PATTERN.lastIndex = 0;
    node.data = text.replace(SHORTCODE_PATTERN, '');
    findings.push({ feature: 'interactive_shortcode', provider: null, element: 'text', action: 'removed' });
    counts.shortcodes += 1;
    changed = true;
  });
  return changed;
}

function featureLabel(feature) {
  switch (feature) {
    case 'contact_form': return 'contact/booking form';
    case 'commerce': return 'commerce or payment functionality';
    case 'authentication': return 'authentication or membership functionality';
    case 'form': return 'form submission functionality';
    case 'embedded_app': return 'embedded application or widget';
    case 'plugin_script': return 'plugin JavaScript';
    case 'interactive_control': return 'interactive control';
    case 'interactive_shortcode': return 'plugin shortcode';
    default: return 'plugin functionality';
  }
}

/**
 * Strip unsupported interactive functionality from rendered WordPress HTML.
 * Returns the policy-clean HTML plus non-sensitive evidence. When nothing is
 * removed the original string is returned byte-identically, which preserves
 * Corbett compatibility for clean historical content.
 */
export function applyContentOnlyPolicy(inputHtml) {
  const source = typeof inputHtml === 'string' ? inputHtml : '';
  const removed = {
    forms: 0,
    commerce: 0,
    authentication: 0,
    controls: 0,
    scripts: 0,
    embeds: 0,
    volatileAttributes: 0,
    tokens: 0,
    shortcodes: 0
  };
  const findings = [];
  if (!source.trim()) {
    return {
      html: source,
      changed: false,
      findings,
      removed,
      policy: CONTENT_POLICY_ID,
      policyVersion: CONTENT_POLICY_VERSION
    };
  }
  let changed = false;
  const sourceTokenCount = (source.match(JWT_PATTERN_GLOBAL) ?? []).length;
  const $ = cheerio.load(source, { decodeEntities: true }, false);
  const selected = new Set();

  $('*').each((_, element) => {
    if (element.type !== 'tag') return;
    const tag = String(element.tagName ?? '').toLowerCase();
    if (tag === 'html' || tag === 'body') return;
    if (selected.has(element)) return;
    const ancestors = $(element).parents().toArray();
    if (ancestors.some((ancestor) => selected.has(ancestor))) return;
    const region = interactiveRegionFor($(element), tag);
    if (!region) return;
    selected.add(element);
    let salvage = [];
    if (region.feature === 'form') {
      salvage = salvageFromGenericForm($, $(element));
    } else {
      salvage = salvageFromInteractiveRegion($, $(element));
    }
    const preservedHtml = salvage.length > 0
      ? '<div class="qms-import-preserved">' + salvage.join('') + '</div>'
      : '';
    if (salvage.length > 0) {
      $(element).after(preservedHtml);
    }
    $(element).remove();
    changed = true;
    if (region.feature === 'contact_form') removed.forms += 1;
    else if (region.feature === 'commerce') removed.commerce += 1;
    else if (region.feature === 'authentication') removed.authentication += 1;
    else removed.forms += 1;
    findings.push({ ...region, action: salvage.length > 0 ? 'removed_interaction_kept_content' : 'removed' });
  });

  // Controls outside a recognised region are still non-functional in a
  // static QDN site; remove them without dropping surrounding editorial text.
  $('input, select, textarea, button, datalist, output, progress, meter').each((_, element) => {
    $(element).remove();
    removed.controls += 1;
    changed = true;
  });
  if (removed.controls > 0) {
    findings.push({ feature: 'interactive_control', provider: null, element: 'control', action: 'removed' });
  }

  $('script, noscript, style, template, object, embed, applet, frame, frameset, canvas, math, link, meta').each((_, element) => {
    const tag = String(element.tagName ?? '').toLowerCase();
    $(element).remove();
    if (tag === 'script') removed.scripts += 1;
    else removed.embeds += 1;
    changed = true;
  });
  if (removed.scripts > 0) {
    findings.push({ feature: 'plugin_script', provider: null, element: 'script', action: 'removed' });
  }
  if (removed.embeds > 0) {
    findings.push({ feature: 'embedded_app', provider: null, element: 'object_or_style', action: 'removed' });
  }

  $('iframe').each((_, element) => {
    const node = $(element);
    const src = String(node.attr('src') ?? '').trim();
    if (isMediaHost(src)) return;
    node.remove();
    removed.embeds += 1;
    changed = true;
    findings.push({ feature: 'embedded_app', provider: null, element: 'iframe', action: 'removed' });
  });

  if ($('svg').length > 0) {
    $('svg').remove();
    changed = true;
  }
  if (redactTextTokens($, removed)) changed = true;
  if (removeVolatileAttributes($, removed)) changed = true;
  if (removeShortcodes($, findings, removed)) changed = true;

  const outputHtml = changed ? $.html() : source;
  removed.tokens = Math.max(0, sourceTokenCount - (outputHtml.match(JWT_PATTERN_GLOBAL) ?? []).length);
  return {
    html: outputHtml,
    changed,
    findings,
    removed,
    policy: CONTENT_POLICY_ID,
    policyVersion: CONTENT_POLICY_VERSION
  };
}

export function contentPolicyWarnings(sourceKey, policy, part = 'body.html') {
  const warnings = [];
  const seen = new Set();
  for (const finding of policy?.findings ?? []) {
    const key = finding.feature + '|' + String(finding.provider ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    warnings.push({
      code: 'UNSUPPORTED_INTERACTIVE_CONTENT',
      message: 'Unsupported ' + featureLabel(finding.feature) + ' was removed from imported content. Review this item manually.',
      details: {
        sourceKey,
        part,
        feature: finding.feature,
        provider: finding.provider ?? null,
        element: finding.element ?? null,
        suggestion: 'Replace this functionality with a Qortal-native service after migration.'
      }
    });
  }
  if ((policy?.removed?.tokens ?? 0) > 0) {
    warnings.push({
      code: 'VOLATILE_TOKEN_REMOVED',
      message: 'A short-lived form or session token was removed before hashing. The token value was not stored.',
      details: { sourceKey, part, removed: policy.removed.tokens }
    });
  }
  if ((policy?.removed?.shortcodes ?? 0) > 0) {
    warnings.push({
      code: 'UNSUPPORTED_SHORTCODE_REMOVED',
      message: 'An interactive plugin shortcode was removed from imported content.',
      details: { sourceKey, part, suggestion: 'Replace this functionality with a Qortal-native service after migration.' }
    });
  }
  return warnings;
}

export function contentPolicyUnsupported(sourceKey, policy, part = 'body.html') {
  const entries = [];
  const seen = new Set();
  for (const finding of policy?.findings ?? []) {
    const key = finding.feature + '|' + String(finding.provider ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      code: 'UNSUPPORTED_INTERACTIVE_CONTENT',
      message: 'Unsupported ' + featureLabel(finding.feature) + ' is not migrated.',
      feature: finding.feature,
      provider: finding.provider ?? null,
      fields: [part],
      review: 'manual'
    });
  }
  return entries;
}

export { featureLabel };
