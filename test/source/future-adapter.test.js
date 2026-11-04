import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createEngine } from '../../lib/engine/index.js';
import { normalizeCapabilities, SOURCE_ADAPTER_CONTRACT_VERSION } from '../../lib/source/contract.js';
import { CONTENT_SCHEMA, CONTENT_VERSION, computeContentHash, contentId } from '../../lib/model/content.js';

function fixtureDocument() {
  const document = {
    schema: CONTENT_SCHEMA,
    version: CONTENT_VERSION,
    id: contentId('fixture', 'note', 'note:1'),
    source: { adapter: 'fixture', platform: 'fixture', key: 'note:1', type: 'note', site: 'fixture://site', extra: { fixture: true } },
    content_type: 'note',
    identity: { source_id: '1', slug: 'fixture-note', old_url: null, canonical_url: null, parent_key: null, menu_order: null },
    publication_status: 'publish',
    title: 'Fixture note',
    body: { format: 'html', html: '<p>Fixture body</p>', text: 'Fixture body', excerpt_html: '', excerpt_text: '', summary: 'Fixture body', hash: null },
    dates: { created_at: null, modified_at: null, published_at: null },
    authors: [],
    terms: { categories: [], tags: [] },
    media: { featured: null, images: [], audio: [], video: [], documents: [], embeds: [], attachments: [] },
    links: { internal: [], external: [], external_media: [] },
    unsupported: [],
    warnings: [],
    provenance: { adapter_id: 'fixture', adapter_version: '1.0.0', contract_version: 1, fetched_at: '2026-01-01T00:00:00.000Z', raw_hash: 'sha256:' + '0'.repeat(64) },
    content_hash: null
  };
  document.content_hash = computeContentHash(document);
  return document;
}

class FixtureSession {
  async validate() {
    return {
      ok: true,
      site: { name: 'Fixture', url: 'fixture://site' },
      counts: { notes: 1 },
      unsupported: [],
      warnings: [],
      capabilities: { contentTypes: ['note'] }
    };
  }
  async *listContent() {
    yield { contentType: 'note', raw: { id: 1 } };
  }
  async *listTerms() {}
  async *listAssets() {}
  normalizeContent() { return fixtureDocument(); }
  normalizeTerm() { return fixtureDocument(); }
  normalizeAsset() { return fixtureDocument(); }
  async close() {}
}

function createFixtureAdapter() {
  return {
    id: 'fixture',
    displayName: 'Fixture Source',
    version: '1.0.0',
    contractVersion: SOURCE_ADAPTER_CONTRACT_VERSION,
    getCapabilities() {
      return normalizeCapabilities({
        contentTypes: ['note'],
        terms: [],
        assets: {},
        authentication: ['none'],
        incremental: { new: true, modified: false, deleted: false, cursor: 'id' }
      });
    },
    async createSession() {
      return new FixtureSession();
    }
  };
}

test('a non-WordPress adapter registers and runs without engine changes', async (t) => {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-fixture-adapter-'));
  const engine = createEngine({ dataRoot, sourceAdapters: [createFixtureAdapter()] });
  t.after(async () => {
    await engine.close().catch(() => {});
    await rm(dataRoot, { recursive: true, force: true });
  });
  assert.deepEqual(engine.sourceRegistry.ids(), ['fixture']);
  const project = await engine.projects.create({
    name: 'Fixture Adapter',
    source: { adapter: 'fixture', baseUrl: 'fixture://site' }
  });
  const handle = await engine.projects.open(project.id);
  const result = await handle.source.discover({ progressEvery: 1 });
  assert.equal(result.status, 'completed');
  assert.equal(result.summary.items, 1);
  const index = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(result.paths.batchDir, 'index.json'), 'utf8'));
  assert.equal(index.entries[0].id, 'src_fixture_note-1');
  assert.equal(index.entries[0].contentType, 'note');
  await handle.close();
});
