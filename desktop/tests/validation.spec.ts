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

  it('rejects oversized payloads', () => {
    expect(() => validateIpcPayload(IPC.projectCreate, {
      name: 'x'.repeat(200),
      source: {},
      target: {},
      padding: 'y'.repeat(1_100_000)
    })).toThrow(/too large/);
  });
});

