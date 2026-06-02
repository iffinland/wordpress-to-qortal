import * as cheerio from 'cheerio';

export function toPlainText(html = '') {
  const $ = cheerio.load(String(html));
  $('script, style').remove();
  return $('body')
    .text()
    .replace(/\s+/g, ' ')
    .trim();
}

export function decodeHtmlText(html = '') {
  return toPlainText(html);
}

export function truncateText(value = '', maxLength = 240) {
  const normalized = String(value).replace(/\s+/g, ' ').trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}
