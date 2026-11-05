/**
 * Versioned, owner-published site settings.
 *
 * Resource: DOCUMENT / <QDN name> / qms-cms-site-settings
 * Schema:   qms-cms-site-settings@1
 *
 * The resource is additive: it never replaces the published APP bundle or the
 * QMS catalog. A site upgrades by publishing this resource, and rollback is a
 * previous revision of the same document.
 */

export const SITE_SETTINGS_SCHEMA = 'qms-cms-site-settings@1';
export const SITE_SETTINGS_VERSION = 1;
export const SITE_SETTINGS_IDENTIFIER = 'qms-cms-site-settings';

const PLACEHOLDER_TITLE = 'Qortal Site';
const PLACEHOLDER_TAGLINE = 'Independent publishing on Qortal QDN';
const PLACEHOLDER_FOOTER = 'Qortal QDN publication';
const COLOR_KEYS = ['background', 'surface', 'surfaceAlt', 'text', 'muted', 'accent', 'accentText', 'border', 'danger', 'warning'];
const HEX_OR_CSS = /^(?:#(?:[0-9a-f]{3,8})|(?:rgb|hsl)a?\([^)]*\)|[a-z]+)$/i;

export function defaultSettingsDraft(config) {
  return {
    site: {
      title: config.site.title || '',
      tagline: config.site.tagline || '',
      description: config.site.description || '',
      footerText: config.site.footerText || '',
      publicAuthor: config.site.publicAuthor || ''
    },
    navigation: (config.navigation || []).map((item) => ({ label: item.label, href: item.href })),
    colors: { ...config.theme.colors }
  };
}

function isText(value) {
  return typeof value === 'string';
}

function safeHref(value) {
  const href = String(value || '').trim();
  if (!href) return '';
  if (href.startsWith('#/')) return href;
  try {
    const url = new URL(href);
    if (url.protocol === 'https:' || url.protocol === 'http:') return href;
  } catch {
    // Relative links are not accepted in owner navigation.
  }
  return '';
}

/**
 * Generic placeholders shipped by the template are not owner content. They are
 * replaced by the real QDN name (or removed) so an owner never publishes the
 * template's hardcoded sample text.
 */
export function removeTemplatePlaceholders(site, qdnName = '') {
  const name = String(qdnName || '').trim();
  const next = { ...site };
  if (!next.title || next.title.trim() === PLACEHOLDER_TITLE) next.title = name || 'Published site';
  if (!next.tagline || next.tagline.trim() === PLACEHOLDER_TAGLINE) next.tagline = '';
  if (!next.description || next.description.trim() === 'A neutral, accessible website template for content published on Qortal.') next.description = '';
  if (!next.footerText || next.footerText.trim() === PLACEHOLDER_FOOTER || next.footerText.trim() === 'Published on Qortal. Content is served directly from QDN.') next.footerText = '';
  return next;
}

export function validateSettingsDraft(draft) {
  const errors = [];
  if (!draft || typeof draft !== 'object') return { ok: false, errors: ['Settings must be an object.'] };
  if (!draft.site || typeof draft.site !== 'object') errors.push('site is required.');
  else {
    if (!isText(draft.site.title) || !draft.site.title.trim()) errors.push('Site title is required.');
    if (draft.site.title && draft.site.title.length > 120) errors.push('Site title must be 120 characters or fewer.');
    for (const key of ['tagline', 'description', 'footerText', 'publicAuthor']) {
      if (draft.site[key] != null && !isText(draft.site[key])) errors.push('site.' + key + ' must be text.');
    }
    if (draft.site.tagline && draft.site.tagline.length > 200) errors.push('Tagline must be 200 characters or fewer.');
    if (draft.site.footerText && draft.site.footerText.length > 500) errors.push('Footer text must be 500 characters or fewer.');
  }
  if (!Array.isArray(draft.navigation) || draft.navigation.length === 0) errors.push('Navigation needs at least one item.');
  else {
    if (draft.navigation.length > 12) errors.push('Navigation supports at most 12 items.');
    draft.navigation.forEach((item, index) => {
      if (!item || !isText(item.label) || !item.label.trim()) errors.push('Navigation item ' + (index + 1) + ' needs a label.');
      if (item && item.label && item.label.length > 40) errors.push('Navigation label ' + (index + 1) + ' is too long.');
      if (!item || !safeHref(item.href)) errors.push('Navigation item ' + (index + 1) + ' must link to an internal #/ route or an http(s) URL.');
    });
  }
  if (!draft.colors || typeof draft.colors !== 'object') errors.push('Branding colors are required.');
  else {
    for (const key of ['accent', 'background', 'surface', 'text']) {
      if (!draft.colors[key] || !HEX_OR_CSS.test(String(draft.colors[key]).trim())) errors.push('colors.' + key + ' must be a CSS color.');
    }
    for (const key of Object.keys(draft.colors)) {
      if (COLOR_KEYS.includes(key) && draft.colors[key] && !HEX_OR_CSS.test(String(draft.colors[key]).trim())) {
        errors.push('colors.' + key + ' must be a CSS color.');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function stableStringify(value) {
  const seen = new WeakSet();
  const normalize = (input) => {
    if (input === null || typeof input === 'number' || typeof input === 'boolean' || typeof input === 'string') return input;
    if (input === undefined) return undefined;
    if (typeof input !== 'object') return String(input);
    if (seen.has(input)) throw new Error('Cannot canonicalize a cyclic value.');
    seen.add(input);
    let out;
    if (Array.isArray(input)) out = input.map(normalize).filter((entry) => entry !== undefined);
    else {
      out = {};
      for (const key of Object.keys(input).sort()) {
        const next = normalize(input[key]);
        if (next !== undefined) out[key] = next;
      }
    }
    seen.delete(input);
    return out;
  };
  return JSON.stringify(normalize(value));
}

export async function integrityOf(document) {
  const clone = { ...document };
  delete clone.integrity;
  const bytes = new TextEncoder().encode(stableStringify(clone));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return 'sha256:' + Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildSettingsDocument({ draft, baseRevision = 0, identity, now = Date.now() }) {
  const validation = validateSettingsDraft(draft);
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  const revision = Math.max(0, Number(baseRevision) || 0) + 1;
  const body = {
    schema: SITE_SETTINGS_SCHEMA,
    version: SITE_SETTINGS_VERSION,
    revision,
    previous_revision: Number(baseRevision) || 0,
    updated_at: new Date(now).toISOString(),
    published_by: {
      address: String(identity && identity.address || ''),
      name: String(identity && identity.qdnName || '')
    },
    site: {
      title: draft.site.title.trim(),
      tagline: String(draft.site.tagline || '').trim(),
      description: String(draft.site.description || '').trim(),
      footerText: String(draft.site.footerText || '').trim(),
      publicAuthor: String(draft.site.publicAuthor || '').trim()
    },
    navigation: draft.navigation.map((item) => ({ label: item.label.trim(), href: safeHref(item.href) })),
    theme: {
      colors: Object.fromEntries(Object.entries(draft.colors).filter(([key, value]) => COLOR_KEYS.includes(key) && value))
    }
  };
  return { ...body, integrity: { algorithm: 'sha256', value: await integrityOf(body) } };
}

export function readSettingsDocument(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['Settings payload is not an object.'], settings: null };
  if (payload.schema !== SITE_SETTINGS_SCHEMA) return { ok: false, errors: ['Unsupported settings schema: ' + String(payload.schema || '')], settings: null };
  if (Number(payload.version) > SITE_SETTINGS_VERSION) return { ok: false, errors: ['Settings version is newer than this template.'], settings: null };
  if (!Number.isFinite(Number(payload.revision)) || Number(payload.revision) < 1) return { ok: false, errors: ['Settings revision is invalid.'], settings: null };
  const draft = {
    site: payload.site || {},
    navigation: Array.isArray(payload.navigation) ? payload.navigation : [],
    colors: payload.theme && payload.theme.colors ? payload.theme.colors : {}
  };
  const validation = validateSettingsDraft(draft);
  if (!validation.ok) return { ok: false, errors: validation.errors, settings: null };
  return { ok: true, errors: [], settings: payload };
}

export function mergeSettingsIntoConfig(config, settings, options = {}) {
  if (!settings) return config;
  const site = removeTemplatePlaceholders({
    ...config.site,
    ...settings.site,
    title: settings.site.title || config.site.title,
    tagline: settings.site.tagline != null ? settings.site.tagline : config.site.tagline,
    description: settings.site.description != null ? settings.site.description : config.site.description,
    footerText: settings.site.footerText != null ? settings.site.footerText : config.site.footerText,
    publicAuthor: settings.site.publicAuthor != null ? settings.site.publicAuthor : config.site.publicAuthor
  }, options.qdnName || config.admin.qdnName || '');
  return {
    ...config,
    site,
    navigation: settings.navigation.map((item) => ({ label: item.label, href: item.href })),
    theme: {
      ...config.theme,
      colors: { ...config.theme.colors, ...(settings.theme && settings.theme.colors ? settings.theme.colors : {}) }
    }
  };
}

/**
 * Conflict-aware publication: never silently overwrite a newer settings
 * revision. Returns a clear conflict result the UI can present.
 */
export function detectSettingsConflict(remoteSettings, baseRevision) {
  const remoteRevision = remoteSettings ? Number(remoteSettings.revision) || 0 : 0;
  const base = Math.max(0, Number(baseRevision) || 0);
  if (remoteRevision > base) {
    return {
      conflict: true,
      message: 'Published settings have moved from revision ' + base + ' to ' + remoteRevision + '. Reload the published settings before publishing, or discard your draft.'
    };
  }
  return { conflict: false, message: '' };
}

export function settingsSummary(settings) {
  if (!settings) return { revision: 0, updatedAt: null, title: '', footerText: '' };
  return {
    revision: Number(settings.revision) || 0,
    updatedAt: settings.updated_at || null,
    title: settings.site && settings.site.title || '',
    footerText: settings.site && settings.site.footerText || ''
  };
}

export { PLACEHOLDER_TITLE, PLACEHOLDER_TAGLINE, PLACEHOLDER_FOOTER, COLOR_KEYS };

