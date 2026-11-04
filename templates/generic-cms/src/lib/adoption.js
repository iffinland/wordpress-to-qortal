import { canMutate, requireOwner } from './ownership.js';

export const ADOPTION_QUEUE_SCHEMA = 'qms-cms-adoption-queue@1';

export function adoptionKey(siteId, item) {
  return String(siteId || 'site') + ':' + String(item && item.id ? item.id : '');
}

export function createAdoptionRecord(item, siteId, now = Date.now()) {
  return {
    key: adoptionKey(siteId, item),
    siteId: String(siteId || 'site'),
    itemId: String(item.id || ''),
    type: item.type,
    slug: String(item.slug || ''),
    title: String(item.title || ''),
    contentRef: item.contentRef || null,
    sourceId: item.legacy && Number.isFinite(Number(item.legacy.sourceId)) ? Number(item.legacy.sourceId) : null,
    oldUrl: (item.legacy && item.legacy.oldUrl) || null,
    adoptedAt: new Date(now).toISOString()
  };
}

export function applyAdoption(queue, options = {}) {
  const current = Array.isArray(queue) ? queue.filter(Boolean) : [];
  const guard = requireOwner(options.identity, 'import or adoption actions');
  if (!guard.ok) {
    return { ok: false, error: guard.error, message: guard.message, queue: current, adopted: [] };
  }
  const siteId = options.siteId || 'site';
  const now = options.now == null ? Date.now() : options.now;
  const records = (options.items || [])
    .filter((item) => item && (item.type === 'post' || item.type === 'page'))
    .map((item) => createAdoptionRecord(item, siteId, now));
  const byKey = new Map(current.map((record) => [record.key, record]));
  for (const record of records) byKey.set(record.key, record);
  return { ok: true, error: null, message: '', queue: Array.from(byKey.values()), adopted: records };
}

export function removeAdoption(queue, key, identity) {
  const guard = requireOwner(identity, 'adoption changes');
  const current = Array.isArray(queue) ? queue : [];
  if (!guard.ok) return { ok: false, error: guard.error, message: guard.message, queue: current };
  return { ok: true, error: null, message: '', queue: current.filter((record) => record.key !== key) };
}

export function readAdoptionQueue(storage, siteId) {
  if (!storage) return [];
  try {
    const raw = storage.getItem('qms-cms-adoption:' + String(siteId || 'site'));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return parsed && parsed.schema === ADOPTION_QUEUE_SCHEMA && Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

export function writeAdoptionQueue(storage, siteId, records) {
  if (!storage) return false;
  try {
    storage.setItem('qms-cms-adoption:' + String(siteId || 'site'), JSON.stringify({
      schema: ADOPTION_QUEUE_SCHEMA,
      siteId: String(siteId || 'site'),
      records: Array.isArray(records) ? records : []
    }));
    return true;
  } catch {
    return false;
  }
}
