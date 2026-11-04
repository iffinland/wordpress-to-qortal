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

  it('rejects oversized payloads', () => {
    expect(() => validateIpcPayload(IPC.projectCreate, {
      name: 'x'.repeat(200),
      source: {},
      target: {},
      padding: 'y'.repeat(1_100_000)
    })).toThrow(/too large/);
  });
});

