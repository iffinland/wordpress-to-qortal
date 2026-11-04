import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCmsConfig, themeStyle } from '../../templates/generic-cms/src/lib/config.js';
import { TEMPLATE_ROOT } from './support/fixtures.js';

async function defaultConfig() {
  return JSON.parse(await readFile(path.join(TEMPLATE_ROOT, 'cms.config.json'), 'utf8'));
}

test('default generic template config is valid and free of Corbett branding', async () => {
  const config = await defaultConfig();
  const validation = validateCmsConfig(config);
  assert.deepEqual(validation.errors, []);
  assert.equal(validation.ok, true);
  const serialized = JSON.stringify(config);
  assert.equal(/corbett/i.test(serialized), false);
  assert.equal(/CorbettReport/.test(serialized), false);
  assert.equal(config.site.title, 'Qortal Site');
  assert.ok(config.navigation.some((item) => item.href === '#/admin'));
  assert.ok(config.navigation.some((item) => item.href === '#/search'));
});

test('theme settings are exposed as CSS custom properties', async () => {
  const config = await defaultConfig();
  config.theme.colors.accent = '#ff6600';
  config.theme.colors.background = '#000000';
  config.theme.maxWidth = '1440px';
  const style = themeStyle(config);
  assert.equal(style['--qms-accent'], '#ff6600');
  assert.equal(style['--qms-bg'], '#000000');
  assert.equal(style['--qms-max-width'], '1440px');
});

test('a project can override title, tagline, navigation and colors', async () => {
  const config = await defaultConfig();
  config.site.title = 'My Independent Site';
  config.site.tagline = 'A custom tagline';
  config.navigation = [
    { label: 'Start', href: '#/' },
    { label: 'Writing', href: '#/posts' }
  ];
  config.theme.colors.accent = '#00aa77';
  const validation = validateCmsConfig(config);
  assert.equal(validation.ok, true);
  assert.equal(config.site.title, 'My Independent Site');
  assert.equal(config.navigation.length, 2);
});

test('invalid configuration fails with actionable errors', async () => {
  const config = await defaultConfig();
  config.site.title = '';
  config.navigation = [];
  config.theme.colors.accent = 'not a color';
  const validation = validateCmsConfig(config);
  assert.equal(validation.ok, false);
  assert.ok(validation.errors.some((error) => error.includes('site.title')));
  assert.ok(validation.errors.some((error) => error.includes('navigation')));
  assert.ok(validation.errors.some((error) => error.includes('theme.colors.accent')));
});
