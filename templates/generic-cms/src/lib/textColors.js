/** Fixed text-colour palette. Colours live in CSS variables (rich-content.css). */
export const TEXT_COLORS = [
  { key: 'red', label: 'Red' },
  { key: 'orange', label: 'Orange' },
  { key: 'yellow', label: 'Yellow' },
  { key: 'green', label: 'Green' },
  { key: 'teal', label: 'Teal' },
  { key: 'blue', label: 'Blue' },
  { key: 'purple', label: 'Purple' },
  { key: 'pink', label: 'Pink' },
  { key: 'gray', label: 'Gray' }
];

const KEYS = new Set(TEXT_COLORS.map((color) => color.key));

export function isTextColor(key) {
  return KEYS.has(String(key));
}

export function colorClass(key) {
  return 'qms-color qms-color-' + key;
}

export function colorFromClass(className) {
  const match = /(?:^|\s)qms-color-([a-z]+)(?:\s|$)/.exec(String(className || ''));
  return match && isTextColor(match[1]) ? match[1] : null;
}
