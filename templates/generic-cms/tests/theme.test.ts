import { describe, expect, it } from 'vitest';
import { THEME_BOOTSTRAP_SCRIPT, THEME_STORAGE_KEY, applyThemeToDocument, buildThemePalette, readStoredTheme, resolveThemeMode, writeStoredTheme } from '../src/lib/theme.js';

function storage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.has(key) ? map.get(key) as string : null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => map.clear(),
    key: () => null,
    length: 0
  } as unknown as Storage;
}

describe('theme persistence and application', () => {
  it('defaults to system, persists light/dark/system and rejects unknown values', () => {
    const store = storage();
    expect(readStoredTheme(store)).toBe('system');
    expect(writeStoredTheme(store, 'light')).toBe(true);
    expect(readStoredTheme(store)).toBe('light');
    writeStoredTheme(store, 'system');
    expect(readStoredTheme(store)).toBe('system');
    store.setItem(THEME_STORAGE_KEY, JSON.stringify({ schema: 'qms-cms-theme@1', mode: 'neon' }));
    expect(readStoredTheme(store)).toBe('system');
  });

  it('resolves system mode from the media query result', () => {
    expect(resolveThemeMode('system', true)).toBe('dark');
    expect(resolveThemeMode('system', false)).toBe('light');
    expect(resolveThemeMode('dark', false)).toBe('dark');
    expect(resolveThemeMode('light', true)).toBe('light');
  });

  it('applies the theme attributes without a reload', () => {
    const attrs: Record<string, string> = {};
    const documentLike = { documentElement: { setAttribute: (name: string, value: string) => { attrs[name] = value; }, getAttribute: (name: string) => attrs[name], style: {} as any } } as any;
    expect(applyThemeToDocument(documentLike, 'light', true)).toBe('light');
    expect(documentLike.documentElement.getAttribute('data-theme')).toBe('light');
    expect(documentLike.documentElement.getAttribute('data-theme-mode')).toBe('light');
    expect(documentLike.documentElement.style.colorScheme).toBe('light');
  });

  it('keeps the owner accent in both palettes and changes surfaces', () => {
    const config = { theme: { colors: { accent: '#ff5500', background: '#000', surface: '#111', text: '#fff', muted: '#aaa', border: '#333' } } };
    const dark = buildThemePalette(config, 'dark');
    const light = buildThemePalette(config, 'light');
    expect(dark['--qms-accent']).toBe('#ff5500');
    expect(light['--qms-accent']).toBe('#ff5500');
    expect(dark['--qms-bg']).not.toBe(light['--qms-bg']);
    expect(light['--qms-text']).toBe('#111827');
  });

  it('ships a pre-hydration bootstrap that reads the same storage key', () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('qms-cms-theme@1');
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('data-theme');
    expect(THEME_BOOTSTRAP_SCRIPT).toContain('prefers-color-scheme');
  });
});

