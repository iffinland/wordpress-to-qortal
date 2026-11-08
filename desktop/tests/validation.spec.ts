import { describe, expect, it } from 'vitest';
import { IPC } from '../src/shared/channels.js';
import { IpcValidationError, sanitizePersisted, validateIpcPayload } from '../src/shared/validation.js';

describe('IPC validation', () => {
  it('accepts a narrow project creation payload and strips unknown fields', () => {
    const result = validateIpcPayload(IPC.projectCreate, {
      name: 'My project',
      source: { adapter: 'wordpress', baseUrl: 'https://example.org', command: 'id' },
      target: { qdnName: 'ValidName', siteName: 'Title' },
      settings: { planning: { batchSize: 15 } },
      extra: 'ignored'
    });
    expect(result.name).toBe('My project');
    expect((result.source as Record<string, unknown>).command).toBeUndefined();
    expect((result.settings as Record<string, unknown>).desktopWizard).toBeUndefined();
  });

  it('accepts exact Qortal display names with spaces and Unicode, and enforces UTF-8 byte bounds', () => {
    const result = validateIpcPayload(IPC.projectCreate, {
      name: 'x',
      source: {},
      target: { qdnName: 'developer iffi' }
    });
    expect((result.target as Record<string, unknown>).qdnName).toBe('developer iffi');

    const unicode = validateIpcPayload(IPC.projectCreate, {
      name: 'x',
      source: {},
      target: { qdnName: 'Café 日本語' }
    });
    expect((unicode.target as Record<string, unknown>).qdnName).toBe('Café 日本語');

    for (const qdnName of [' developer iffi', 'developer iffi ', 'developer  iffi', 'developer\tiffi', 'developer\u0001iffi']) {
      expect(() => validateIpcPayload(IPC.projectCreate, { name: 'x', source: {}, target: { qdnName } })).toThrow(/target\.qdnName/);
    }
    expect(() => validateIpcPayload(IPC.projectCreate, {
      name: 'x', source: {}, target: { qdnName: 'é'.repeat(21) }
    })).toThrow(/UTF-8 bytes/);
    expect(validateIpcPayload(IPC.projectCreate, {
      name: 'x', source: {}, target: { qdnName: 'é'.repeat(20) }
    })).toMatchObject({ target: { qdnName: 'é'.repeat(20) } });
  });

  it('rejects relative workspace paths and non-http source URLs', () => {
    expect(() => validateIpcPayload(IPC.setDataRoot, { path: 'relative/dir' })).toThrow(IpcValidationError);
    expect(() => validateIpcPayload(IPC.projectCreate, {
      name: 'x',
      source: { baseUrl: 'file:///etc/passwd' },
      target: {}
    })).toThrow(/http/);
  });

  it('rejects unknown channels instead of exposing a generic bridge', () => {
    expect(() => validateIpcPayload('shell.exec', { command: 'id' })).toThrow(/Unknown IPC channel/);
    expect(() => validateIpcPayload('qms:generic:invoke', {})).toThrow(/Unknown IPC channel/);
  });

  it('strips secrets from persisted wizard state', () => {
    const clean = sanitizePersisted({
      step: 2,
      appPassword: 'secret-value',
      nested: { authorization: 'Basic abc', cookie: 'sid=1', siteName: 'Public title' }
    }) as Record<string, unknown>;
    expect(JSON.stringify(clean)).not.toContain('secret-value');
    expect(JSON.stringify(clean)).not.toContain('Basic abc');
    expect(JSON.stringify(clean)).not.toContain('sid=1');
    expect(JSON.stringify(clean)).toContain('Public title');
  });

  it('bounds plan options and rejects invalid enum values', () => {
    expect(() => validateIpcPayload(IPC.planCreate, { projectId: 'prj_abcd', batchSize: 0 })).toThrow(/batchSize/);
    expect(() => validateIpcPayload(IPC.planCreate, { projectId: 'prj_abcd', disk: { unknownSizePolicy: 'guess' } })).toThrow(/unknownSizePolicy/);
    expect(() => validateIpcPayload(IPC.mediaDownload, { projectId: 'prj_abcd', planId: '../../etc' })).toThrow(/planId/);
  });

  it('preserves the explicit scan mode and bounded selection on source.discover (BUG-004 regression)', () => {
    // The renderer sends mode/selection, the main-process handler forwards them,
    // and the engine refuses a missing mode (SOURCE_SCAN_MODE_REQUIRED). The IPC
    // allowlist used to drop both fields, so every Quick scan and Full inventory
    // failed instantly with no content request and no indexed post.
    const result = validateIpcPayload(IPC.sourceDiscover, {
      projectId: 'prj_abcd',
      adapterId: 'wordpress',
      contentTypes: ['post'],
      perPage: 3,
      mode: 'quick',
      selection: { perPage: 3, maxPages: 1, maxItems: 3 },
      includeTerms: true,
      includeAssets: true
    });
    expect(result).toMatchObject({
      projectId: 'prj_abcd',
      adapterId: 'wordpress',
      contentTypes: ['post'],
      perPage: 3,
      mode: 'quick',
      selection: { perPage: 3, maxPages: 1, maxItems: 3 },
      includeTerms: true,
      includeAssets: true
    });
    // An absent mode must stay absent so the engine fails closed; an unknown mode
    // must be rejected at the boundary instead of reaching the engine.
    expect(validateIpcPayload(IPC.sourceDiscover, { projectId: 'prj_abcd' }).mode).toBeUndefined();
    expect(() => validateIpcPayload(IPC.sourceDiscover, { projectId: 'prj_abcd', mode: 'forever' })).toThrow(/mode/);
    expect(() => validateIpcPayload(IPC.sourceDiscover, { projectId: 'prj_abcd', mode: 'quick', selection: { maxItems: 0 } })).toThrow(/selection\.maxItems/);
  });

  it('bounds publication handoff, selection, receipt and node URL inputs', () => {
    expect(validateIpcPayload(IPC.publicationPrepare, {
      projectId: 'prj_abcd',
      planId: 'plan_abcdefgh',
      selection: ['post:1'],
      feePerResource: 0.01
    })).toMatchObject({ projectId: 'prj_abcd', planId: 'plan_abcdefgh', selection: ['post:1'] });
    expect(() => validateIpcPayload(IPC.publicationGet, { projectId: 'prj_abcd', handoffId: '../escape' })).toThrow(/handoffId/);
    expect(() => validateIpcPayload(IPC.publicationVerify, {
      projectId: 'prj_abcd', handoffId: 'hof_abcdefgh12345678', nodeUrl: 'file:///etc/passwd'
    })).toThrow(/http/);
    expect(() => validateIpcPayload(IPC.publicationVerify, {
      projectId: 'prj_abcd', handoffId: 'hof_abcdefgh12345678', nodeUrl: 'http://user:pass@localhost:12391'
    })).toThrow(/credentials/);
    expect(() => validateIpcPayload(IPC.publicationImportReceipt, {
      projectId: 'prj_abcd', handoffId: 'hof_abcdefgh12345678', receipt: 'not-an-object'
    })).toThrow(/receipt/);
    expect(validateIpcPayload(IPC.publicationResources, { projectId: 'prj_abcd' })).toEqual({ projectId: 'prj_abcd', handoffId: null });
  });

  it('saves a legacy project whose cached discovery is absent (BUG-001 regression)', () => {
    // Mirrors the owner's AstuAeda project after reopening: legacy numeric
    // completedSteps, stringified preference scalars, node settings and no
    // discovery object for this session. Before the fix the wizard autosave
    // threw "persisted value type is not allowed." for the undefined
    // preferences.discovery member, so steps 1-4 could not be saved.
    const wizard = {
      step: 4,
      completedSteps: [1, 2, 3],
      wizardVersion: 2,
      adapterId: 'wordpress',
      sourceUrl: 'https://astuaeda.ee',
      authMode: 'none',
      connection: {
        status: 'completed',
        report: {
          ok: true,
          site: { name: 'AstuAeda', url: 'https://astuaeda.ee' },
          counts: { posts: 1180, pages: 17, media: 6421 },
          contentTypes: ['post', 'page'],
          warnings: []
        },
        error: null
      },
      targetQdnName: 'AstuAeda',
      siteTitle: 'AstuAeda',
      siteDescription: 'Migration test',
      website: { cms: 'generic-cms', service: 'APP', tagline: 'Astu Aeda', accent: '#4da3ff' },
      preferences: {
        batchSize: '1',
        contentTypes: ['post', 'page'],
        after: '',
        before: '',
        includeReserved: 'false',
        allowExternalMedia: 'false',
        concurrency: '4',
        reserveGib: '10',
        maxRunGib: '2',
        maxFileMib: '256',
        maxFiles: '500',
        unknownPolicy: 'reject',
        nodeSettings: { qortalNodeUrl: 'http://127.0.0.1:24991', updateNodeUrl: 'http://127.0.0.1:62391' },
        discovery: undefined
      },
      planId: null,
      updatedAt: '2026-11-08T08:00:00.000Z'
    };

    const result = validateIpcPayload(IPC.projectSaveWizard, { projectId: 'prj_astuaeda01', wizard });
    const saved = result.wizard as Record<string, unknown>;
    expect(saved.wizardVersion).toBe(3);
    expect(saved.completedSteps).toEqual(['source', 'connection', 'destination']);
    const preferences = saved.preferences as Record<string, unknown>;
    expect(preferences.batchSize).toBe(1);
    expect(preferences.maxFiles).toBe(500);
    expect(preferences.includeReserved).toBe(false);
    expect(preferences.allowExternalMedia).toBe(false);
    // Unknown extension data is preserved (node settings survive migration).
    expect(preferences.nodeSettings).toEqual({ qortalNodeUrl: 'http://127.0.0.1:24991', updateNodeUrl: 'http://127.0.0.1:62391' });
    // Undefined is dropped exactly like JSON would, not rejected.
    expect(Object.prototype.hasOwnProperty.call(preferences, 'discovery')).toBe(false);
  });

  it('mirrors JSON semantics for undefined and null inside persisted state', () => {
    const cleaned = sanitizePersisted({
      step: 3,
      keep: 'value',
      absent: undefined,
      nested: { absent: undefined, zero: 0, no: false, empty: null },
      list: ['one', undefined, 2]
    });
    expect(cleaned).toEqual({
      step: 3,
      keep: 'value',
      nested: { zero: 0, no: false, empty: null },
      list: ['one', null, 2]
    });
    expect(() => sanitizePersisted({ bad: BigInt(1) })).toThrow(/persisted value type/);
  });

  it('rejects oversized payloads', () => {
    expect(() => validateIpcPayload(IPC.projectCreate, {
      name: 'x'.repeat(200),
      source: {},
      target: {},
      padding: 'y'.repeat(1_100_000)
    })).toThrow(/too large/);
  });
});

