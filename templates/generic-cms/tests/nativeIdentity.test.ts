import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadNativeIndex } from '../src/lib/authoring.js';
import { emptyNativeIndex } from '../src/lib/nativeCatalog.js';

afterEach(() => { vi.unstubAllGlobals(); });

describe('native index initialization identity', () => {
  it('uses the canonical site id when no native index exists yet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })));
    const result = await loadNativeIndex('QortalMigrationStudio', 'QortalMigrationStudio');
    expect(result.ok).toBe(true);
    expect(result.index.site_id).toBe('QortalMigrationStudio');
  });

  it('preserves a legitimately published legacy site placeholder', async () => {
    const legacy = emptyNativeIndex('site');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => legacy })));
    const result = await loadNativeIndex('QortalMigrationStudio', 'QortalMigrationStudio');
    expect(result.ok).toBe(true);
    expect(result.index.site_id).toBe('site');
  });
});
