import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ALL_IPC_CHANNELS } from '../../src/shared/channels.js';
import { sanitizeForDiagnostics } from '../../src/main/diagnostics.js';

const root = path.resolve(__dirname, '../..');

describe('desktop security posture', () => {
  it('enables renderer isolation and sandboxing', async () => {
    const source = await readFile(path.join(root, 'src/main/window.ts'), 'utf8');
    expect(source).toContain('contextIsolation: true');
    expect(source).toContain('nodeIntegration: false');
    expect(source).toContain('sandbox: true');
    expect(source).toContain('webviewTag: false');
    expect(source).toContain('setWindowOpenHandler');
    expect(source).toContain('will-navigate');
    expect(source).toContain('setPermissionRequestHandler');
  });

  it('exposes only allowlisted IPC channels through preload', async () => {
    const source = await readFile(path.join(root, 'src/preload/index.ts'), 'utf8');
    expect(source).not.toContain('ipcRenderer.send(');
    expect(source).not.toContain('ipcRenderer.sendSync');
    expect(source).not.toContain('invoke(channel: string)');
    expect(ALL_IPC_CHANNELS.length).toBeGreaterThan(10);
    expect(source).toContain('contextBridge.exposeInMainWorld');
  });

  it('redacts secrets, authorization headers and cookies from diagnostics', () => {
    const sanitized = sanitizeForDiagnostics({
      username: 'public',
      password: 'hunter2',
      appPassword: 'app-secret',
      headers: { Authorization: 'Basic abc', Cookie: 'sid=secret' },
      body: '<p>content body is not part of diagnostics</p>',
      nested: { seed: 'wallet seed', token: 'abc' }
    }) as Record<string, unknown>;
    const text = JSON.stringify(sanitized);
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('app-secret');
    expect(text).not.toContain('Basic abc');
    expect(text).not.toContain('sid=secret');
    expect(text).not.toContain('wallet seed');
    expect(text).toContain('public');
  });

  it('does not use a plaintext credential file', async () => {
    const credentials = await readFile(path.join(root, 'src/main/credentials.ts'), 'utf8');
    expect(credentials).toContain('secret-tool');
    expect(credentials).toContain('session-memory');
    expect(credentials).not.toContain('writeFile');
    expect(credentials).not.toContain('localStorage');
  });
});

