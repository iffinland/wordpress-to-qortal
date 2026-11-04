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
    expect(builder).toContain('- dir');
    expect(builder).toContain('extraResources:');
    expect(builder).toContain('engine-runtime');
    expect(builder).toContain('afterPack: scripts/after-pack.cjs');
    const fuses = await readFile(path.join(root, 'scripts/after-pack.cjs'), 'utf8');
    expect(fuses).toContain('OnlyLoadAppFromAsar]: true');
    expect(fuses).toContain('EnableEmbeddedAsarIntegrityValidation]: false');
    expect(fuses).toContain('EnableNodeOptionsEnvironmentVariable]: false');
  });

  it('uses project-owned deterministic Debian metadata', async () => {
    const config = JSON.parse(await readFile(path.join(root, 'release.config.json'), 'utf8'));
    expect(config.schema).toBe('qms-deb-release@1');
    expect(config.packageName).toBe('qortal-migration-studio');
    expect(config.installationRoot).toBe('/opt/qortal-migration-studio');
    expect(config.depends.join(',')).toContain('libgtk-3-0');
    expect(config.depends.join(',')).toContain('libsecret-1-0');
  });

  it('pins the engine runtime dependency graph', async () => {
    const pkg = JSON.parse(await readFile(path.join(root, 'engine-package/package.json'), 'utf8'));
    const lock = JSON.parse(await readFile(path.join(root, 'engine-package/package-lock.json'), 'utf8'));
    expect(lock.lockfileVersion).toBe(3);
    for (const [name, version] of Object.entries(pkg.dependencies as Record<string, string>)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(lock.packages['node_modules/' + name].version).toBe(version);
    }
  });

  it('stages the engine with npm ci and bundles the generic CMS template', async () => {
    const source = await readFile(path.join(root, 'scripts/prepare-engine.mjs'), 'utf8');
    expect(source).toContain("execFileSync('npm', ['ci'");
    expect(source).not.toContain("'install', '--omit=dev'");
    expect(source).toContain('templates/generic-cms');
    expect(source).toContain('engine-runtime.json');
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

