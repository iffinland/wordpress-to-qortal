import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');

function read(relative: string): string {
  return readFileSync(path.join(root, relative), 'utf8');
}

describe('ZIP work isolation (BUG-002 diagnostics)', () => {
  it('never imports a ZIP library into the Electron main or renderer process', () => {
    for (const file of ['src/main/ipc.ts', 'src/main/index.ts', 'src/renderer/components/Publishing.tsx']) {
      const source = read(file);
      expect(source, file).not.toMatch(/from ['"]fflate['"]/);
      expect(source, file).not.toMatch(/zipSync|unzipSync/);
    }
  });

  it('keeps ZIP export behind the engine host RPC rather than an IPC Buffer payload', () => {
    const ipc = read('src/main/ipc.ts');
    expect(ipc).toContain("invoke('publication.exportBundle'");
    expect(ipc).toContain("invoke('publication.prepare'");
  });
});
