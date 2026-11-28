import { createHash } from 'node:crypto';
import { websiteSettings } from './publication/site.js';
import { normalizeNodeUrl } from './publication/remote.js';
import { QmsError, ERROR_CODES } from './errors.js';

async function localReview(handle) {
  const project = handle.project;
  const website = websiteSettings(project);
  const target = { name: project.target.qdnName, service: website.service, identifier: 'default', cms: website.cms, siteId: project.identity.siteId };
  const projects = await handle._service.list({ includeArchived: true });
  const conflicts = [];
  if (website.cms === 'generic-cms') for (const entry of projects) {
    if (entry.id === project.id || entry.targetQdnName !== target.name) continue;
    const other = (await handle._service.get(entry.id)).project;
    const settings = websiteSettings(other);
    if (settings.cms === 'generic-cms' && settings.service === website.service) conflicts.push({ id: entry.id, name: entry.name, siteId: entry.siteId });
  }
  conflicts.sort((a, b) => a.id.localeCompare(b.id));
  const signature = createHash('sha256').update(JSON.stringify({ target, conflicts })).digest('hex');
  return { target, conflicts, signature };
}
export async function reviewDestination(handle, { nodeUrl = null } = {}) {
  const review = await localReview(handle);
  let remote = { status: 'unknown', message: 'The existing Qortal website could not be checked. Confirm the address in Hub before publishing.' };
  if (review.target.cms !== 'generic-cms') remote = { status: 'content-only', message: 'This package does not replace the website application.' };
  else if (nodeUrl) {
    try {
      const base = normalizeNodeUrl(nodeUrl);
      const response = await (handle.fetchImpl ?? globalThis.fetch)(base + '/arbitrary/' + review.target.service + '/' + encodeURIComponent(review.target.name) + '/default?filepath=qms-cms-config.json', { signal: AbortSignal.timeout(7000) });
      if (response.ok) {
        const reader = response.body.getReader(); let bytes = 0; const chunks = [];
        try { while (true) { const next = await reader.read(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 100000) throw new Error('Configuration response too large.'); chunks.push(Buffer.from(next.value)); } }
        finally { await reader.cancel().catch(() => {}); }
        const config = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        remote = config.site?.id === review.target.siteId
          ? { status: 'same-site', message: 'The current website belongs to this project.' }
          : { status: 'different-site', message: 'This address contains another website. Publishing this package replaces its application and switches its visible catalog.' };
      }
      // 404/building/unavailable does not prove that a QDN address is unoccupied.
    } catch { /* An offline node must never be presented as a free destination. */ }
  }
  const result = { ...review, remote, needsConfirmation: review.conflicts.length > 0 || ['unknown', 'different-site'].includes(remote.status) };
  // Approval is bound to the exact local destination, conflicts and observed remote result.
  result.token = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  await handle.update({ settings: { destinationReview: result } });
  return result;
}
export async function approveDestination(handle, token) {
  const saved = handle.project.settings.destinationReview;
  const current = await localReview(handle);
  if (!saved || saved.token !== token || saved.signature !== current.signature) throw new QmsError(ERROR_CODES.INVALID_ARGUMENT, 'The destination changed. Review it again before confirming.');
  await handle.update({ settings: { destinationApproval: { signature: current.signature, reviewedToken: token, at: handle.clock.nowIso() } } });
  return { approved: true };
}
export async function assertDestinationSafe(handle) {
  const review = await localReview(handle);
  if (review.conflicts.length && handle.project.settings.destinationApproval?.signature !== review.signature) throw new QmsError(ERROR_CODES.PUBLICATION_BLOCKED, 'Another local project uses this website address. Open Project settings and review the publishing destination before preparing a replacement.', { details: { conflicts: review.conflicts, target: review.target } });
}
