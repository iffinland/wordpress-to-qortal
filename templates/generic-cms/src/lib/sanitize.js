import createDOMPurify from 'dompurify';

const ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'cite', 'code', 'col', 'colgroup',
  'dd', 'del', 'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'ins', 'kbd', 'li', 'mark',
  'ol', 'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strong', 'sub', 'summary',
  'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'u', 'ul',
  'var', 'audio', 'video', 'source', 'track'
];

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title', 'width', 'height', 'class', 'id', 'lang', 'dir',
  'colspan', 'rowspan', 'scope', 'datetime', 'cite', 'start', 'reversed', 'type',
  'controls', 'poster', 'preload', 'loop', 'muted', 'playsinline', 'kind', 'srclang',
  'label', 'loading', 'decoding', 'rel', 'target', 'role', 'aria-label',
  'aria-labelledby', 'aria-describedby', 'aria-hidden'
];

const FORBID_TAGS = [
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'meta',
  'link', 'base', 'math', 'svg', 'template', 'noscript'
];

const FORBID_ATTR = [
  'style', 'srcdoc', 'formaction', 'action', 'background', 'xlink:href', 'ping',
  'contenteditable', 'autofocus'
];

const ALLOWED_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

export function sanitizeUrl(value, options = {}) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  if (raw.startsWith('#')) return raw;
  const compact = raw.replace(/[\u0000-\u0020\u007f]+/g, '');
  const schemeMatch = /^([a-z][a-z0-9+.-]*):/i.exec(compact);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (!ALLOWED_SCHEMES.has(scheme)) return '';
    if (scheme === 'http' || scheme === 'https') {
      try {
        const parsed = new URL(compact);
        if (!parsed.hostname) return '';
      } catch {
        return '';
      }
    }
    return raw;
  }
  if (compact.startsWith('//')) return options.allowProtocolRelative === false ? '' : raw;
  return raw;
}

function postProcess(html, windowLike) {
  const Parser = windowLike && windowLike.DOMParser;
  if (!Parser) return html;
  const document = new Parser().parseFromString('<!doctype html><html><body>' + html + '</body></html>', 'text/html');
  const body = document.body;

  for (const element of Array.from(body.querySelectorAll('*'))) {
    if (FORBID_TAGS.includes(element.tagName.toLowerCase())) {
      element.remove();
      continue;
    }
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || FORBID_ATTR.includes(name) || name.startsWith('data-')) {
        element.removeAttribute(attribute.name);
      }
    }
    if (element.tagName.toLowerCase() === 'a') {
      const href = element.getAttribute('href');
      if (href != null) {
        const safe = sanitizeUrl(href);
        if (safe) {
          element.setAttribute('href', safe);
          const lower = safe.toLowerCase();
          if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('//')) {
            const rel = new Set((element.getAttribute('rel') || '').split(/\s+/).filter(Boolean));
            rel.add('noopener');
            rel.add('noreferrer');
            element.setAttribute('rel', Array.from(rel).join(' '));
          }
        } else {
          element.removeAttribute('href');
        }
      }
    }
    if (element.tagName.toLowerCase() === 'img') {
      const src = element.getAttribute('src');
      const safe = src ? sanitizeUrl(src) : '';
      if (!safe) {
        element.remove();
        continue;
      }
      element.setAttribute('src', safe);
      element.setAttribute('loading', 'lazy');
      element.setAttribute('decoding', 'async');
      if (element.getAttribute('alt') == null) element.setAttribute('alt', '');
      element.removeAttribute('srcset');
      element.removeAttribute('sizes');
    }
    if (['audio', 'video', 'source', 'track'].includes(element.tagName.toLowerCase())) {
      for (const attr of ['src', 'poster']) {
        const value = element.getAttribute(attr);
        if (value == null) continue;
        const safe = sanitizeUrl(value);
        if (safe) element.setAttribute(attr, safe);
        else element.removeAttribute(attr);
      }
    }
  }
  return body.innerHTML;
}

export function createSanitizer(windowLike) {
  if (!windowLike) throw new Error('A DOM window is required to create the HTML sanitizer.');
  const purifier = createDOMPurify(windowLike);
  return {
    sanitize(dirty) {
      const clean = purifier.sanitize(String(dirty == null ? '' : dirty), {
        ALLOWED_TAGS,
        ALLOWED_ATTR,
        FORBID_TAGS,
        FORBID_ATTR,
        ALLOW_DATA_ATTR: false,
        ALLOW_ARIA_ATTR: true,
        ALLOW_UNKNOWN_PROTOCOLS: false,
        KEEP_CONTENT: true,
        RETURN_TRUSTED_TYPE: false
      });
      return postProcess(String(clean), windowLike);
    }
  };
}

let cachedSanitizer = null;

export function getSanitizer() {
  if (!cachedSanitizer) {
    if (typeof window === 'undefined') {
      throw new Error('sanitizeHtml requires a browser-like window.');
    }
    cachedSanitizer = createSanitizer(window);
  }
  return cachedSanitizer;
}

export function sanitizeHtml(dirty) {
  return getSanitizer().sanitize(dirty);
}
