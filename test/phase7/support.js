import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startPhase3, makePost } from '../../test-support/phase3/helpers.js';
import { startQdnServer } from '../../test-support/phase5/qdnServer.js';
import { createReceipt } from '../../lib/engine/publication/receipts.js';

export const ADDRESS = 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2';

export function makeSyncPost(index, overrides = {}) {
  return makePost(index, overrides);
}

export async function startPhase7(t, {
  posts = null,
  target = 'SyncSite',
  settings = {},
  projectOverrides = {},
  ...rest
} = {}) {
  return startPhase3(t, {
    posts: posts ?? [makeSyncPost(1), makeSyncPost(2), makeSyncPost(3)],
    target,
    settings: {
      ...settings,
      disk: {
        unknownSizePolicy: 'estimate',
        unknownSizeBytes: 1024,
        ...(settings.disk ?? {})
      }
    },
    projectOverrides,
    ...rest
  });
}

export async function fullScan(handle, options = {}) {
  const scan = await handle.sync.check({ mode: 'full', ...options });
  return scan;
}

export async function populateQdn(server, env, handoff) {
  const root = path.join(env.engine.projects.paths(env.project.id).root, handoff.handoffPath);
  const manifest = JSON.parse(await readFile(path.join(root, 'handoff.json'), 'utf8'));
  for (const resource of manifest.resources) {
    const bytes = await readFile(path.join(root, resource.relativePath));
    server.set({
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      bytes,
      contentType: resource.contentType
    });
  }
  return manifest;
}

export function receiptFor(handoff, receiptSuffix = 'a') {
  return createReceipt({
    handoff,
    receiptId: 'rcp_' + String(receiptSuffix).repeat(20).slice(0, 20),
    publisher: {
      accountAddress: ADDRESS,
      name: handoff.target.qdnName,
      appVersion: '0.5.0'
    },
    results: handoff.resources.map((resource) => ({
      resourceId: resource.id,
      service: resource.service,
      name: resource.name,
      identifier: resource.identifier,
      status: 'submitted',
      txSignature: 'sig-' + resource.id
    })),
    createdAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:05:00.000Z'
  });
}

export async function publishAndVerify(t, env, plan, selection) {
  const handoff = await env.handle.publication.prepare({
    planId: plan.planId,
    selection
  });
  const server = await startQdnServer();
  t.after(() => server.close());
  await populateQdn(server, env, handoff);
  const stored = await env.handle.publication.get(handoff.handoffId);
  await env.handle.publication.importReceipt({
    handoffId: handoff.handoffId,
    receipt: receiptFor(stored.handoff)
  });
  const verified = await env.handle.publication.verify({
    handoffId: handoff.handoffId,
    nodeUrl: server.url,
    attempts: 1,
    intervalMs: 0
  });
  return { handoff, server, verified };
}

export function recentIso(offsetMs = -60 * 60 * 1000) {
  return new Date(Date.now() + offsetMs).toISOString();
}
