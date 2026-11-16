/**
 * Optional post-to-page assignment document.
 *
 * Resource: DOCUMENT / <name> / qms-cms-sections
 * Schema:   qms-cms-sections@1
 *
 * {
 *   schema, version, revision, site_id, updated_at,
 *   sections: [{ slug: "<page slug>", post_ids: ["<post id>", ...] }],
 *   home_hidden_ids: ["<post id>", ...]
 * }
 *
 * The document is optional. A missing or invalid document is harmless: every
 * published post stays on the home page and no page receives posts. Older CMS
 * versions ignore the resource entirely.
 */

export const SECTIONS_SCHEMA = 'qms-cms-sections@1';
export const SECTIONS_VERSION = 1;
export const SECTIONS_IDENTIFIER = 'qms-cms-sections';

export function emptySections(siteId = 'site') {
  return {
    schema: SECTIONS_SCHEMA,
    version: SECTIONS_VERSION,
    revision: 0,
    site_id: String(siteId || 'site'),
    updated_at: null,
    sections: [],
    home_hidden_ids: []
  };
}

function uniqueStrings(value) {
  const seen = new Set();
  const out = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const text = String(entry == null ? '' : entry);
    if (text && !seen.has(text)) { seen.add(text); out.push(text); }
  }
  return out;
}

/** Never throws. Returns { ok, errors, doc } where doc is always usable. */
export function readSections(payload, siteId = 'site') {
  if (payload == null) return { ok: true, errors: [], doc: emptySections(siteId) };
  if (typeof payload !== 'object' || payload.schema !== SECTIONS_SCHEMA) {
    return { ok: false, errors: ['The sections document has an unsupported schema.'], doc: emptySections(siteId) };
  }
  if (Number(payload.version) > SECTIONS_VERSION) {
    return { ok: false, errors: ['The sections document version is newer than this template.'], doc: emptySections(siteId) };
  }
  if (!Array.isArray(payload.sections)) {
    return { ok: false, errors: ['The sections list must be an array.'], doc: emptySections(siteId) };
  }
  const sections = [];
  for (const entry of payload.sections) {
    if (!entry || typeof entry !== 'object' || !String(entry.slug || '').trim()) continue;
    sections.push({ slug: String(entry.slug), post_ids: uniqueStrings(entry.post_ids) });
  }
  return {
    ok: true,
    errors: [],
    doc: {
      ...emptySections(siteId),
      revision: Math.max(0, Number(payload.revision) || 0),
      site_id: String(payload.site_id || siteId),
      updated_at: payload.updated_at || null,
      sections,
      home_hidden_ids: uniqueStrings(payload.home_hidden_ids)
    }
  };
}

export function assignmentFor(doc, postId) {
  const id = String(postId == null ? '' : postId);
  const current = doc || emptySections();
  return {
    slugs: current.sections.filter((section) => section.post_ids.includes(id)).map((section) => section.slug),
    hideFromHome: current.home_hidden_ids.includes(id)
  };
}

export function sameAssignment(left, right) {
  const a = [...left.slugs].sort().join('\n');
  const b = [...right.slugs].sort().join('\n');
  return a === b && Boolean(left.hideFromHome) === Boolean(right.hideFromHome);
}

/** Build the next document for one post. Newly assigned posts go first. */
export function applyAssignment(doc, assignment, options = {}) {
  const current = doc || emptySections(options.siteId);
  const postId = String(assignment.postId);
  const wanted = uniqueStrings(assignment.slugs);
  const remoteRevision = Number(current.revision) || 0;
  const baseRevision = Math.max(0, Number(options.baseRevision) || 0);
  if (remoteRevision > baseRevision) {
    return { ok: false, conflict: true, message: 'Published sections moved from revision ' + baseRevision + ' to ' + remoteRevision + '. Reload before publishing.', doc: current };
  }
  const sections = current.sections.map((section) => ({ slug: section.slug, post_ids: section.post_ids.filter((id) => id !== postId) }));
  for (const slug of wanted) {
    const existing = sections.find((section) => section.slug === slug);
    if (existing) existing.post_ids.unshift(postId);
    else sections.push({ slug, post_ids: [postId] });
  }
  const hidden = current.home_hidden_ids.filter((id) => id !== postId);
  if (assignment.hideFromHome) hidden.push(postId);
  return {
    ok: true,
    conflict: false,
    message: '',
    doc: {
      ...current,
      schema: SECTIONS_SCHEMA,
      version: SECTIONS_VERSION,
      revision: remoteRevision + 1,
      updated_at: new Date(options.now || Date.now()).toISOString(),
      sections: sections.filter((section) => section.post_ids.length > 0),
      home_hidden_ids: hidden
    }
  };
}

/** Posts for the home page: every published post except hidden ones. */
export function homePostsFilter(posts, doc) {
  const hidden = new Set(doc ? doc.home_hidden_ids : []);
  return hidden.size === 0 ? posts : posts.filter((item) => !hidden.has(String(item.id)));
}

/** Published posts assigned to a page, in the document order. */
export function postsForSection(posts, doc, slug) {
  if (!doc) return [];
  const section = doc.sections.find((entry) => entry.slug === slug);
  if (!section) return [];
  const byId = new Map((posts || []).filter((item) => item.type === 'post' && item.status === 'published').map((item) => [String(item.id), item]));
  return section.post_ids.map((id) => byId.get(id)).filter(Boolean);
}
