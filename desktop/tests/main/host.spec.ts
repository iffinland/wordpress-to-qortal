import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EngineHost } from '../../src/main/host.js';

const root = path.resolve(__dirname, '../..');
const repo = path.resolve(root, '..');

describe('desktop engine host transport', () => {
  let host: EngineHost | null = null;
  let dataRoot: string | null = null;

  afterEach(async () => {
    if (host) await host.stop().catch(() => {});
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true }).catch(() => {});
    host = null;
    dataRoot = null;
  });

  it('spawns the real engine host over stdio and forwards typed methods', async () => {
    dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-desktop-host-'));
    host = new EngineHost({
      entry: path.join(repo, 'bin/qms-host.js'),
      cwd: repo,
      dataRoot,
      repoRoot: repo
    });
    await host.start();
    const info = await host.request<Record<string, unknown>>('engine.info');
    expect(info.apiVersion).toBe('qms-engine@1');
    expect(Array.isArray(info.adapters)).toBe(true);

    const created = await host.request<Record<string, unknown>>('project.create', {
      name: 'Desktop Host Test',
      source: { adapter: 'wordpress', baseUrl: 'https://example.org' },
      target: { qdnName: 'DesktopHostTest' }
    });
    expect(String(created.siteId)).toMatch(/^site_/);
    const opened = await host.request<Record<string, unknown>>('project.open', { projectId: created.id });
    expect((opened.project as Record<string, unknown>).id).toBe(created.id);

    const target = await host.request<Record<string, unknown>>('identity.validateTarget', { target: { qdnName: 'AnotherName' } });
    expect(target.qdnName).toBe('AnotherName');
    const disk = await host.request<Record<string, unknown>>('disk.check', {
      projectId: created.id,
      knownBytes: 10,
      disk: { reserveBytes: 0, maxBytesPerRun: 0 }
    });
    expect(disk.fits).toBe(true);

    const events: Array<Record<string, unknown>> = [];
    const unsubscribe = host.onEvent((event) => events.push(event));
    await host.request('project.snapshot', { projectId: created.id });
    unsubscribe();
    expect(Array.isArray(events)).toBe(true);
  });

  it('rejects unknown methods', async () => {
    dataRoot = await mkdtemp(path.join(os.tmpdir(), 'qms-desktop-host-'));
    host = new EngineHost({ entry: path.join(repo, 'bin/qms-host.js'), cwd: repo, dataRoot, repoRoot: repo });
    await host.start();
    await expect(host.request('shell.exec', { command: 'id' })).rejects.toMatchObject({ code: 'UNKNOWN_METHOD' });
  });
});

