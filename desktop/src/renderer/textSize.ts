/**
 * Global UI text size. The scale is applied to the root font-size, so every
 * rem/em based size, grid and card reflows together. Persisted per desktop
 * profile and restored before the first React render.
 */
export const TEXT_SIZES = [90, 100, 115, 130, 150] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
const STORAGE_KEY = 'qms:text-size';
const DEFAULT_TEXT_SIZE: TextSize = 100;

function isTextSize(value: unknown): value is TextSize {
  return typeof value === 'number' && (TEXT_SIZES as readonly number[]).includes(value);
}

export function readStoredTextSize(): TextSize {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw === null ? NaN : Number(raw);
    return isTextSize(parsed) ? parsed : DEFAULT_TEXT_SIZE;
  } catch {
    return DEFAULT_TEXT_SIZE;
  }
}

export function applyTextSize(size: TextSize): void {
  const root = document.documentElement;
  root.style.setProperty('--qms-font-scale', String(size / 100));
  root.dataset.textSize = String(size);
}

export function storeTextSize(size: TextSize): TextSize {
  const safe = isTextSize(size) ? size : DEFAULT_TEXT_SIZE;
  applyTextSize(safe);
  try {
    window.localStorage.setItem(STORAGE_KEY, String(safe));
  } catch {
    // Persistence is best-effort; the current session still applies the size.
  }
  return safe;
}
