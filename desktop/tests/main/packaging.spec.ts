import { describe, expect, it } from 'vitest';
import { readFile, access, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');

describe('Debian packaging metadata', () => {
  it('uses an independent product name and a stable app id', async () => {
    const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('qortal-migration-studio');
    expect(pkg.productName).toBe('Qortal Migration Studio');
    expect(pkg.main).toBe('dist-electron/main.cjs');
    const builder = await readFile(path.join(root, 'electron-builder.yml'), 'utf8');
    expect(builder).toContain('appId: org.iffinland.qortal-migration-studio');
    expect(builder).toContain('target:');
    expect(builder).toContain('- deb');
    expect(builder).toContain('extraResources:');
    expect(builder).toContain('engine-runtime');
  });

  it('declares desktop integration and icons', async () => {
    const builder = await readFile(path.join(root, 'electron-builder.yml'), 'utf8');
    expect(builder).toContain('Name: Qortal Migration Studio');
    expect(builder).toContain('Categories: Office;Utility;');
    expect(builder).toContain('build/icons');
    for (const size of ['16x16', '32x32', '48x48', '64x64', '128x128', '256x256', '512x512']) {
      await expect(access(path.join(root, 'build/icons', size + '.png'))).resolves.toBeUndefined();
    }
  });

  it('contains no historical branding in the desktop product source', async () => {
    const entries = await readdir(path.join(root, 'src'), { recursive: true });
    for (const entry of entries) {
      if (!/\.(ts|tsx|css|html)$/.test(entry)) continue;
      const source = await readFile(path.join(root, 'src', entry), 'utf8');
      expect(source.toLowerCase()).not.toContain('corbett');
      expect(source.toLowerCase()).not.toContain('corbettreport');
    }
  });
});

