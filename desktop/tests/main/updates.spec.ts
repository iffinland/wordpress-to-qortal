import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopUpdates, validateUpdateNodeUrl } from '../../src/main/updates.js';
import { registryFixture } from '../../../test/update/support/registry-fixture.js';

const NOW = Date.parse('2026-11-05T06:00:00.000Z');

function registry() {
  return registryFixture({ versions: { desktop: '0.9.0-alpha.1' } });
}

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('desktop update service', () => {
  it('reports a newer verified desktop release and records it in the cache', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'qms-desktop-updates-'));
    try {
      const service = new DesktopUpdates({
        appVersion: '0.8.0-alpha.1',
        userDataDir: dir,
        nodeUrl: 'http://localhost:12391',
        now: () => NOW,
        fetchImpl: vi.fn(async () => response(registry())) as unknown as typeof fetch
      });
      const state = await service.start();
      expect(state.status).toBe('update_available');
      expect(state.showBadge).toBe(true);
      expect(state.artifact?.format).toBe('deb');
      expect(state.artifact?.sha256).toHaveLength(64);
      const cache = JSON.parse(await readFile(path.join(dir, 'update-cache.json'), 'utf8'));
      expect(cache.schema).toBe('qms-desktop-update-cache@1');
      expect(cache.document.schema).toBe('qms-update-registry@1');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not block startup when the node is offline and no cache exists', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'qms-desktop-updates-'));
    try {
      const service = new DesktopUpdates({
        appVersion: '0.8.0-alpha.1',
        userDataDir: dir,
        nodeUrl: 'http://localhost:12391',
        now: () => NOW,
        fetchImpl: vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch
      });
      const state = await service.start();
      expect(state.status).toBe('unable_to_check');
      expect(state.showBadge).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('uses a fresh cache without hitting the network', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'qms-desktop-updates-'));
    try {
      const fetchImpl = vi.fn(async () => response(registry())) as unknown as typeof fetch;
      const first = new DesktopUpdates({ appVersion: '0.8.0-alpha.1', userDataDir: dir, nodeUrl: 'http://localhost:12391', now: () => NOW, fetchImpl });
      await first.start();
      const offline = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
      const second = new DesktopUpdates({ appVersion: '0.8.0-alpha.1', userDataDir: dir, nodeUrl: 'http://localhost:12391', now: () => NOW + 60_000, fetchImpl: offline });
      const state = await second.start();
      expect(state.status).toBe('update_available');
      expect(state.stale).toBe(false);
      expect(offline).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('falls back to a stale cache without a badge after a failed refresh', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'qms-desktop-updates-'));
    try {
      const first = new DesktopUpdates({ appVersion: '0.8.0-alpha.1', userDataDir: dir, nodeUrl: 'http://localhost:12391', now: () => NOW, fetchImpl: vi.fn(async () => response(registry())) as unknown as typeof fetch });
      await first.start();
      const second = new DesktopUpdates({
        appVersion: '0.8.0-alpha.1',
        userDataDir: dir,
        nodeUrl: 'http://localhost:12391',
        now: () => NOW + 40 * 60 * 1000,
        fetchImpl: vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch
      });
      const state = await second.start();
      expect(state.status).toBe('update_available');
      expect(state.stale).toBe(true);
      expect(state.showBadge).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('accepts HTTPS nodes and HTTP only for loopback', () => {
    expect(validateUpdateNodeUrl('https://node.example:12391')).toBe('https://node.example:12391');
    expect(validateUpdateNodeUrl('http://127.0.0.1:12391')).toBe('http://127.0.0.1:12391');
    expect(validateUpdateNodeUrl('http://localhost:12391/')).toBe('http://localhost:12391');
    expect(() => validateUpdateNodeUrl('http://node.example:12391')).toThrow(/HTTPS/);
    expect(() => validateUpdateNodeUrl('https://user:pass@node.example')).toThrow(/credentials/);
    expect(() => validateUpdateNodeUrl('file:///tmp/x')).toThrow(/HTTPS/);
  });
});
