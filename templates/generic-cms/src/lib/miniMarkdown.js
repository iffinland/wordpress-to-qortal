import { sanitizeHtml, sanitizeUrl } from './sanitize.js';

/**
 * Small Markdown subset (headings, paragraphs, lists, quotes, code, rules,
 * bold, italic, inline code, http(s)/mailto links). All text is HTML-escaped
 * first, links are scheme-checked and the result always passes DOMPurify.
 */
function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
    const raw = href.replace(/&amp;/g, '&');
    const safe = /^(https?:|mailto:)/i.test(raw) ? sanitizeUrl(raw, { allowQortal: false }) : '';
    return safe ? '<a href="' + escapeHtml(safe) + '" rel="noopener noreferrer">' + label + '</a>' : label;
  });
  return out;
}

export function markdownToSafeHtml(source) {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const html = [];
  let paragraph = [];
  let list = null;
  let code = null;
  const flushParagraph = () => { if (paragraph.length) { html.push('<p>' + inline(paragraph.join(' ')) + '</p>'); paragraph = []; } };
  const flushList = () => { if (list) { html.push('</' + list + '>'); list = null; } };
  for (const line of lines) {
    if (code !== null) {
      if (/^```/.test(line)) { html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>'); code = null; } else code.push(line);
      continue;
    }
    if (/^```/.test(line)) { flushParagraph(); flushList(); code = []; continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);
    if (heading) { flushParagraph(); flushList(); const level = Math.min(4, heading[1].length + 1); html.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>'); }
    else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushParagraph(); flushList(); html.push('<hr>'); }
    else if (bullet || ordered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (list !== type) { flushList(); list = type; html.push('<' + type + '>'); }
      html.push('<li>' + inline((bullet || ordered)[1]) + '</li>');
    } else if (quote) { flushParagraph(); flushList(); html.push('<blockquote><p>' + inline(quote[1]) + '</p></blockquote>'); }
    else if (!line.trim()) { flushParagraph(); flushList(); }
    else { flushList(); paragraph.push(line.trim()); }
  }
  if (code !== null) html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>');
  flushParagraph();
  flushList();
  return sanitizeHtml(html.join('\n'));
}
