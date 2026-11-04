function pathnameFor(value) {
  try {
    return new URL(value, 'https://qms.invalid').pathname;
  } catch {
    return null;
  }
}

export function rewriteMediaUrls(html, options = {}) {
  const source = String(html || '');
  if (!source) return '';
  const Parser = typeof DOMParser === 'undefined' ? null : DOMParser;
  if (!Parser || typeof options.createUrl !== 'function') return source;

  const bySourceUrl = options.bySourceUrl || {};
  const mediaByUrl = new Map();
  for (const entry of options.media || []) {
    if (entry && entry.url && entry.qdn) mediaByUrl.set(entry.url, entry.qdn);
  }
  const byPath = new Map();
  for (const [url, ref] of Object.entries(bySourceUrl)) {
    const pathname = pathnameFor(url);
    if (pathname && ref) byPath.set(pathname, ref);
  }

  const resolve = (value) => {
    if (!value) return null;
    const exact = bySourceUrl[value] || mediaByUrl.get(value);
    if (exact) return options.createUrl(exact.service, exact.name || options.defaultName, exact.identifier);
    const pathname = pathnameFor(value);
    if (pathname && byPath.has(pathname)) {
      const ref = byPath.get(pathname);
      return options.createUrl(ref.service, ref.name || options.defaultName, ref.identifier);
    }
    return null;
  };

  const document = new Parser().parseFromString('<!doctype html><html><body>' + source + '</body></html>', 'text/html');
  for (const element of Array.from(document.body.querySelectorAll('[src], [href], [poster]'))) {
    for (const attribute of ['src', 'href', 'poster']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const rewritten = resolve(value);
      if (rewritten) element.setAttribute(attribute, rewritten);
    }
  }
  return document.body.innerHTML;
}
