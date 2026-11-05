function hexToRgb(value) {
  const hex = String(value || '').trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  let body = match[1];
  if (body.length === 3) body = body.split('').map((part) => part + part).join('');
  return [parseInt(body.slice(0, 2), 16), parseInt(body.slice(2, 4), 16), parseInt(body.slice(4, 6), 16)];
}

export function contrastText(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return '#ffffff';
  const [red, green, blue] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  });
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  return luminance > 0.45 ? '#111827' : '#ffffff';
}

export const THEME_STORAGE_KEY = 'qms-cms-theme@1';
export const THEME_SCHEMA = 'qms-cms-theme@1';
export const THEME_MODES = ['light', 'dark', 'system'];

function validMode(value) {
  return THEME_MODES.includes(value) ? value : null;
}

export function readStoredTheme(storage) {
  if (!storage) return 'system';
  try {
    const raw = storage.getItem(THEME_STORAGE_KEY);
    if (!raw) return 'system';
    const parsed = JSON.parse(raw);
    if (parsed && parsed.schema === THEME_SCHEMA) return validMode(parsed.mode) || 'system';
    return validMode(parsed) || 'system';
  } catch {
    return 'system';
  }
}

export function writeStoredTheme(storage, mode) {
  if (!storage) return false;
  const next = validMode(mode) || 'system';
  try {
    storage.setItem(THEME_STORAGE_KEY, JSON.stringify({ schema: THEME_SCHEMA, mode: next }));
    return true;
  } catch {
    return false;
  }
}

export function systemPrefersDark(matchMedia) {
  try {
    return Boolean(matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  } catch {
    return true;
  }
}

export function resolveThemeMode(mode, prefersDark = true) {
  const selected = validMode(mode) || 'system';
  if (selected === 'system') return prefersDark ? 'dark' : 'light';
  return selected;
}

export function applyThemeToDocument(documentLike, mode, prefersDark) {
  if (!documentLike || !documentLike.documentElement) return 'dark';
  const resolved = resolveThemeMode(mode, prefersDark);
  const root = documentLike.documentElement;
  root.setAttribute('data-theme', resolved);
  root.setAttribute('data-theme-mode', validMode(mode) || 'system');
  if (root.style) root.style.colorScheme = resolved;
  return resolved;
}

/**
 * Branding-aware palettes. The owner's accent always survives; light mode gets
 * an accessible light surface/text palette instead of reusing dark-on-light
 * values. Values are deliberately computed from the configured colors.
 */
export function buildThemePalette(config, resolvedMode) {
  const colors = (config && config.theme && config.theme.colors) || {};
  const accent = colors.accent || '#4da3ff';
  const accentText = colors.accentText || '#04121f';
  if (resolvedMode === 'light') {
    return {
      '--qms-bg': colors.lightBackground || '#f6f8fb',
      '--qms-surface': colors.lightSurface || '#ffffff',
      '--qms-surface-alt': colors.lightSurfaceAlt || '#eef2f7',
      '--qms-text': colors.lightText || '#111827',
      '--qms-muted': colors.lightMuted || '#52606d',
      '--qms-accent': accent,
      '--qms-accent-text': contrastText(accent),
      '--qms-border': colors.lightBorder || '#d5dde7',
      '--qms-danger': colors.lightDanger || '#b42318',
      '--qms-warning': colors.lightWarning || '#8a5a00',
      '--qms-focus': accent,
      '--qms-shadow': '0 10px 30px rgba(17, 24, 39, 0.10)'
    };
  }
  return {
    '--qms-bg': colors.background,
    '--qms-surface': colors.surface,
    '--qms-surface-alt': colors.surfaceAlt || colors.surface,
    '--qms-text': colors.text,
    '--qms-muted': colors.muted,
    '--qms-accent': accent,
    '--qms-accent-text': accentText || contrastText(accent),
    '--qms-border': colors.border,
    '--qms-danger': colors.danger || '#ff7b72',
    '--qms-warning': colors.warning || '#e3b341',
    '--qms-focus': accent,
    '--qms-shadow': '0 10px 30px rgba(0, 0, 0, 0.35)'
  };
}

/** Inline pre-hydration snippet. Kept as a string so tests can assert it. */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var raw=localStorage.getItem('${THEME_STORAGE_KEY}');var mode='system';if(raw){var p=JSON.parse(raw);mode=(p&&p.mode)||p||'system';}var m=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;var r=mode==='light'?'light':mode==='dark'?'dark':(m?'dark':'light');document.documentElement.setAttribute('data-theme',r);document.documentElement.setAttribute('data-theme-mode',mode);document.documentElement.style.colorScheme=r;}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

