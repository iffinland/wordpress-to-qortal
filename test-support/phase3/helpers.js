import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../lib/engine/index.js';
import { fixedDiskProbe } from '../../lib/engine/disk.js';
import { GIB } from '../../lib/engine/config.js';
import { startWordpressFixtureServer, createFixtureData } from '../wordpress/fixtureServer.js';
import { startMediaServer } from '../media/server.js';

export function makePost(index, overrides = {}) {
  const day = String((index % 27) + 1).padStart(2, '0');
  const month = String(((index + 2) % 12) + 1).padStart(2, '0');
  return {
    id: 1000 + index,
    slug: 'synthetic-post-' + index,
    title: 'Synthetic post ' + index,
    content: '<p>Synthetic body ' + index + '</p>',
    excerpt: '<p>Synthetic excerpt ' + index + '</p>',
    date: '2024-' + month + '-' + day + 'T0' + (index % 9) + ':00:00',
    date_gmt: '2024-' + month + '-' + day + 'T0' + (index % 9) + ':00:00',
    modified: '2024-' + month + '-' + day + 'T0' + (index % 9) + ':30:00',
    modified_gmt: '2024-' + month + '-' + day + 'T0' + (index % 9) + ':30:00',
    status: 'publish',
    author: 7,
    featured_media: 0,
    categories: [],
    tags: [],
    ...overrides
  };
}

export function dataWithPosts(posts, base = null) {
  const data = base ? structuredClone(base) : createFixtureData();
  data.posts = posts;
  data.pages = [];
  data.media = [];
  data.categories = [];
  data.tags = [];
  return data;
}

export async function startPhase3(t, {
  posts = null,
  data = null,
  dataFactory = null,
  target = 'SyntheticSite',
  settings = {},
  projectOverrides = {},
  diskProbe = fixedDiskProbe(10 * GIB),
  mediaServer = false,
  mediaOptions = {},
  wpOptions = {},
  engineFactory = createEngine
} = {}) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-phase3-'));
  const media = mediaServer ? await startMediaServer(mediaOptions) : null;
  const fixtureData = data ?? (dataFactory
    ? dataFactory({ mediaUrl: media?.url ?? null })
    : dataWithPosts((posts ?? Array.from({ length: 12 }, (_, index) => makePost(index)))));
  const wp = await startWordpressFixtureServer({ data: fixtureData, ...wpOptions });
  const engine = engineFactory({ dataRoot, diskProbe });
  const project = await engine.projects.create({
    name: 'Synthetic Project',
    source: { adapter: 'wordpress', baseUrl: wp.url },
    target: { qdnName: target },
    settings: {
      disk: { reserveBytes: 0, maxBytesPerRun: 0, ...(settings.disk ?? {}) },
      media: { allowLoopback: true, maxRetries: 0, retryDelayMs: 0, ...(settings.media ?? {}) },
      planning: { ...(settings.planning ?? {}) },
      ...(settings.extra ?? {})
    },
    ...projectOverrides
  });
  const handle = await engine.projects.open(project.id);
  t.after(async () => {
    await handle.close().catch(() => {});
    await engine.close().catch(() => {});
    await wp.close().catch(() => {});
    if (media) await media.close().catch(() => {});
    await rm(dataRoot, { recursive: true, force: true });
  });
  return { dataRoot, engine, wp, media, project, handle, data: fixtureData };
}
