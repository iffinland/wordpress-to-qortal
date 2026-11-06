/**
 * Slug rules for CMS-authored and WordPress-imported content.
 *
 * Root cause guarded here: a slug must be derived from the *complete* title,
 * never from the first keystroke. Callers use the pure state machine in
 * slugField.js and only pass a final value to slugify().
 *
 * Normalization contract:
 * - Estonian and other Latin diacritics are transliterated, never dropped:
 *   "Põhja-Tallinn õäöüšž" -> "pohja-tallinn-oaousz".
 * - NFKD decomposition removes combining marks (ä -> a, õ -> o, š -> s, ž -> z).
 * - Characters without a decomposition (ß, æ, ø, ł, đ, ...) use an explicit map.
 * - Everything else outside [a-z0-9] becomes a hyphen separator.
 * - Leading/trailing separators are stripped; runs collapse.
 *
 * Short slugs are NOT invalid by themselves (a post titled "Q" legitimately
 * has slug "q"). Only empty, over-long or structurally invalid slugs are
 * rejected. The repair report flags suspicious one-character slugs without
 * ever renaming published resources automatically.
 */

export const SLUG_MAX_LENGTH = 96;

const TRANSLITERATION = Object.freeze({
  'ß': 'ss',
  'æ': 'ae',
  'Æ': 'ae',
  'œ': 'oe',
  'Œ': 'oe',
  'ø': 'o',
  'Ø': 'o',
  'đ': 'd',
  'Đ': 'd',
  'ð': 'd',
  'Ð': 'd',
  'þ': 'th',
  'Þ': 'th',
  'ł': 'l',
  'Ł': 'l',
  'ı': 'i',
  'ħ': 'h',
  'Ħ': 'h',
  'ŧ': 't',
  'Ŧ': 't',
  'ĸ': 'k',
  'æ': 'ae'
});

export function transliterate(value) {
  let text = String(value == null ? '' : value);
  text = text.replace(/[\u00df\u00e6\u00c6\u0153\u0152\u00f8\u00d8\u0111\u0110\u00f0\u00d0\u00fe\u00de\u0142\u0141\u0131\u0127\u0126\u0167\u0166\u0138]/g, (char) => TRANSLITERATION[char] || char);
  // NFKD handles ä, õ, ö, ü, š, ž, á, ç, ñ, ... by separating the base letter
  // from its combining mark. Remove the combining marks afterwards.
  text = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  return text;
}

/** Generate the canonical slug from a complete title. */
export function slugify(value) {
  const prepared = transliterate(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['\u2019\u2018\u02bc\u0060]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return prepared.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, '');
}

/**
 * Sanitize while the owner types in the slug field. Unlike slugify(), this
 * keeps one trailing hyphen so typing "my-post" is not mangled after "my-".
 * The final value is passed through slugify() before saving/publishing.
 */
export function sanitizeSlugTyping(value) {
  const lowered = transliterate(value).toLowerCase().replace(/\s+/g, '-');
  const cleaned = lowered
    .replace(/&/g, '-and-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '');
  return cleaned.slice(0, SLUG_MAX_LENGTH);
}

/** Normalize a manually entered slug for storage and publication. */
export function finalizeSlug(value) {
  return slugify(value);
}

export function slugProblem(value) {
  const slug = String(value == null ? '' : value);
  if (!slug) return 'A slug is required.';
  if (slug.length > SLUG_MAX_LENGTH) return 'The slug is longer than ' + SLUG_MAX_LENGTH + ' characters.';
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return 'Use lowercase letters, digits and single hyphens only (for example "teine-test-post").';
  }
  return '';
}

export function isValidSlug(value) {
  return slugProblem(value) === '';
}

/** Deterministic duplicate handling: teine-test-post, teine-test-post-2, -3, ... */
export function uniqueSlug(base, taken = new Set(), startAt = 2) {
  const normalized = slugify(base) || 'post';
  const used = taken instanceof Set ? taken : new Set(taken || []);
  if (!used.has(normalized)) return normalized;
  let index = Math.max(2, Number(startAt) || 2);
  let candidate = normalized + '-' + index;
  while (used.has(candidate)) {
    index += 1;
    candidate = normalized + '-' + index;
  }
  return candidate;
}

export function slugSetFromItems(items = [], { exceptIds = [] } = {}) {
  const except = new Set((exceptIds || []).map(String));
  const set = new Set();
  for (const item of items) {
    if (!item) continue;
    if (except.has(String(item.id))) continue;
    if (item.slug) set.add(String(item.slug).toLowerCase());
    if (Array.isArray(item.slugAliases)) {
      for (const alias of item.slugAliases) set.add(String(alias).toLowerCase());
    }
  }
  return set;
}

/**
 * Collision check across imported content, CMS-authored entries, overlay
 * entries and their aliases. A published item may keep its own slug.
 */
export function slugAvailability(dataset, slug, options = {}) {
  const normalized = finalizeSlug(slug);
  const problem = slugProblem(normalized);
  if (problem) return { ok: false, message: problem, suggestion: '' };
  const exceptIds = options.exceptIds || (options.exceptId ? [options.exceptId] : []);
  const items = [
    ...((dataset && dataset.posts) || []),
    ...((dataset && dataset.pages) || [])
  ];
  const taken = slugSetFromItems(items, { exceptIds });
  if (taken.has(normalized)) {
    const suggestion = uniqueSlug(normalized, taken);
    return {
      ok: false,
      message: 'The slug "' + normalized + '" is already used by another post or page (imported or CMS-authored). Suggestion: "' + suggestion + '".',
      suggestion
    };
  }
  return { ok: true, message: '', suggestion: '' };
}

/** Resolve a route slug through canonical slugs and preserved aliases. */
export function resolveBySlug(items, slug) {
  const wanted = String(slug || '').toLowerCase();
  if (!wanted) return null;
  const list = Array.isArray(items) ? items : [];
  return list.find((item) => item && String(item.slug).toLowerCase() === wanted)
    || list.find((item) => item && Array.isArray(item.slugAliases) && item.slugAliases.some((alias) => String(alias).toLowerCase() === wanted))
    || null;
}

/**
 * Safe detection of prematurely generated one-character slugs.
 *
 * Heuristic: a one-character slug that is not the slug of the title is very
 * likely a first-keystroke capture. A genuinely short title ("Q") is not
 * flagged. Detection never renames anything; it only reports.
 */
export function findSlugAnomalies(options = {}) {
  const findings = [];
  const drafts = Array.isArray(options.drafts) ? options.drafts : [];
  const published = Array.isArray(options.published) ? options.published : [];
  const push = (entry, kind, publishedFlag) => {
    const slug = String(entry.slug || '');
    if (!entry || !slug) return;
    if (slug.length !== 1) return;
    const expected = slugify(entry.title || '');
    if (slug === expected) return;
    findings.push({
      id: String(entry.id || ''),
      title: String(entry.title || ''),
      slug,
      expected,
      kind,
      published: publishedFlag,
      reason: 'A one-character slug is not derived from the title. This is the historical first-keystroke bug; it is reported, never renamed automatically.',
      safeAction: publishedFlag
        ? 'Use the advanced slug change workflow (alias required). Published resources are never renamed automatically.'
        : 'Open the draft and use Regenerate slug.'
    });
  };
  for (const draft of drafts) push(draft, draft.sourceKind === 'wordpress-overlay' ? 'draft-overlay' : 'draft', false);
  for (const item of published) {
    push(item, item.edited ? 'published-overlay' : 'published', true);
  }
  return findings;
}

export function mergeAliases(existing, previousSlug, nextSlug) {
  const aliases = new Set((Array.isArray(existing) ? existing : []).map((value) => String(value).toLowerCase()));
  const previous = String(previousSlug || '').toLowerCase();
  const next = String(nextSlug || '').toLowerCase();
  if (previous && previous !== next) aliases.add(previous);
  aliases.delete(next);
  return Array.from(aliases).sort();
}
