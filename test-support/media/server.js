import http from 'node:http';

/**
 * Deterministic media fixture server for Phase 3 tests.
 * No external network access is involved.
 */
function bodyFor(pathname, searchParams) {
  const size = Math.max(0, Number(searchParams.get('bytes') ?? 4096));
  if (pathname === '/media/shared-a' || pathname === '/media/shared-b') {
    return Buffer.alloc(size, 0x51);
  }
  if (pathname === '/media/known/alpha.jpg') return Buffer.alloc(size, 0x41);
  if (pathname === '/media/known/beta.png') return Buffer.alloc(size, 0x42);
  if (pathname === '/media/known/gamma.pdf') return Buffer.alloc(size, 0x43);
  if (pathname === '/media/known/delta.mp3') return Buffer.alloc(size, 0x44);
  if (pathname === '/media/unknown') return Buffer.alloc(size, 0x55);
  if (pathname === '/media/html') return Buffer.from('<html><body>not media</body></html>', 'utf8');
  if (pathname === '/media/interrupt') return Buffer.alloc(size, 0x49);
  if (pathname === '/media/slow') return Buffer.alloc(size, 0x53);
  return Buffer.alloc(size, 0x2e);
}

function isKnownPath(pathname) {
  return pathname === '/media/unknown'
    || pathname === '/media/html'
    || pathname === '/media/interrupt'
    || pathname === '/media/slow'
    || pathname === '/media/shared-a'
    || pathname === '/media/shared-b'
    || pathname.startsWith('/media/known/')
    || pathname === '/media/redirect';
}

function contentTypeFor(pathname) {
  if (pathname === '/media/html') return 'text/html; charset=utf-8';
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.pdf')) return 'application/pdf';
  if (pathname.endsWith('.mp3')) return 'audio/mpeg';
  return 'image/jpeg';
}

export async function startMediaServer({ chunkSize = 64 * 1024, chunkDelayMs = 0 } = {}) {
  const requests = [];
  const interrupted = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const pathname = url.pathname;
    requests.push({
      method: req.method,
      path: pathname,
      range: req.headers.range ?? null,
      at: Date.now()
    });

    if (pathname === '/media/missing') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('missing');
      return;
    }
    if (pathname === '/media/redirect') {
      res.writeHead(302, { location: '/media/known/alpha.jpg?bytes=' + (url.searchParams.get('bytes') ?? '4096') });
      res.end();
      return;
    }
    if (pathname === '/media/redirect-file') {
      res.writeHead(302, { location: 'file:///etc/passwd' });
      res.end();
      return;
    }
    if (pathname === '/media/redirect-private') {
      res.writeHead(302, { location: 'http://127.0.0.1:9/private' });
      res.end();
      return;
    }
    if (!isKnownPath(pathname)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('unknown fixture path');
      return;
    }

    const body = bodyFor(pathname, url.searchParams);
    const isUnknown = pathname === '/media/unknown';
    const isHtml = pathname === '/media/html';
    const headers = {
      'content-type': contentTypeFor(pathname),
      'accept-ranges': 'bytes'
    };
    if (!isUnknown) headers['content-length'] = String(body.length);

    if (req.method === 'HEAD') {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    let start = 0;
    const rangeHeader = req.headers.range;
    if (rangeHeader && !isUnknown) {
      const match = /^bytes=(\d+)-$/.exec(String(rangeHeader));
      if (match) start = Number(match[1]);
      if (start >= body.length) {
        res.writeHead(416, { 'content-range': 'bytes */' + body.length });
        res.end();
        return;
      }
      headers['content-range'] = 'bytes ' + start + '-' + (body.length - 1) + '/' + body.length;
      headers['content-length'] = String(body.length - start);
      res.writeHead(206, headers);
    } else {
      res.writeHead(200, headers);
    }

    const key = pathname + '?' + url.searchParams.toString();
    const shouldInterrupt = pathname === '/media/interrupt' && !interrupted.has(key);
    const payload = body.subarray(start);
    const limit = shouldInterrupt ? Math.max(1, Math.floor(payload.length / 2)) : payload.length;

    let offset = 0;
    const writeNext = () => {
      if (offset >= limit) {
        if (shouldInterrupt) {
          interrupted.add(key);
          setTimeout(() => res.destroy(), 25);
          return;
        }
        res.end();
        return;
      }
      const end = Math.min(limit, offset + chunkSize);
      const chunk = payload.subarray(offset, end);
      offset = end;
      const ok = res.write(chunk);
      const schedule = () => {
        if (end >= limit) {
          setTimeout(writeNext, chunkDelayMs);
        } else if (ok) {
          setTimeout(writeNext, chunkDelayMs);
        } else {
          res.once('drain', () => setTimeout(writeNext, chunkDelayMs));
        }
      };
      if (chunkDelayMs > 0) setTimeout(writeNext, chunkDelayMs);
      else schedule();
    };
    if (chunkDelayMs > 0) setTimeout(writeNext, chunkDelayMs);
    else writeNext();
    void isHtml;
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;
  return {
    server,
    url: baseUrl,
    requests,
    mediaUrl: (pathname, params = {}) => {
      const url = new URL(pathname, baseUrl);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      return url.toString();
    },
    close: () => new Promise((resolve) => server.close(resolve))
  };
}
