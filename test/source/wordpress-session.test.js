import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { WordPressClient } from '../../lib/source/wordpress/client.js';
async function site(t, { captcha = false, rejectLogin = false, externalAction = false, expiredNonce = false, externalRedirect = false } = {}) {
  const requests = []; let nonceRequests = 0; let posts = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const cookie = req.headers.cookie ?? ''; requests.push({ path: url.pathname, method: req.method, nonce: req.headers['x-wp-nonce'], cookie });
    if (url.pathname === '/login/') { res.writeHead(302, { location: '/members/login/', 'set-cookie': 'wordpress_test_cookie=yes; Path=/' }); return res.end(); }
    if (url.pathname === '/members/login/' && req.method === 'GET') return res.end('<form id="loginform" action="' + (externalAction ? 'https://another.invalid/login/' : '/members/login/') + '"><input name="log"><input name="pwd">' + (captcha ? '<input name="hcaptcha-signature-test" type="hidden" value="not-a-solution">' : '') + '</form>');
    if (url.pathname === '/members/login/' && req.method === 'POST') {
      posts++; const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = new URLSearchParams(Buffer.concat(chunks).toString());
      assert.equal(body.get('log'), 'member@example.test'); assert.equal(body.get('pwd'), 'ordinary-password'); assert.match(cookie, /wordpress_test_cookie=yes/);
      if (captcha) assert.equal(body.get('hcaptcha-signature-test'), 'not-a-solution');
      if (rejectLogin) { res.statusCode = 403; return res.end('Sign-in requires an additional check on the website.'); }
      res.writeHead(302, { location: '/account/', 'set-cookie': 'wordpress_logged_in_fixture=valid-session; Path=/; HttpOnly' }); return res.end();
    }
    if (url.pathname === '/account/') return res.end('Member account');
    if (url.pathname === '/wp-admin/admin-ajax.php' && url.searchParams.get('action') === 'rest-nonce') { nonceRequests++; return res.end(expiredNonce && nonceRequests === 1 ? 'nonce-expired' : 'nonce-current'); }
    if (externalRedirect) { res.writeHead(302, { location: 'https://another.invalid/wp-json/' }); return res.end(); }
    res.setHeader('content-type', 'application/json');
    if (!cookie.includes('wordpress_logged_in_fixture=valid-session')) { res.statusCode = 401; return res.end(JSON.stringify({ code: 'rest_authorization_required' })); }
    if (req.headers['x-wp-nonce'] !== 'nonce-current') { res.statusCode = 403; return res.end(JSON.stringify({ code: 'rest_cookie_invalid_nonce' })); }
    return res.end(JSON.stringify({ name: 'Protected member website', namespaces: ['wp/v2'] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return { url: 'http://127.0.0.1:' + server.address().port, requests, get posts() { return posts; }, get nonceRequests() { return nonceRequests; } };
}
const login = { mode: 'session', username: 'member@example.test', password: 'ordinary-password' };
test('normal website login follows same-origin redirects, preserves cookies and sends the REST nonce', async t => {
  const server = await site(t); const client = new WordPressClient({ baseUrl: server.url, auth: login });
  assert.equal((await client.getSiteInfo()).name, 'Protected member website'); assert.equal(server.posts, 1);
  assert.ok(server.requests.some(request => request.path === '/wp-json/' && request.nonce === 'nonce-current'));
  assert.equal(JSON.stringify(client.authSummary()).includes('ordinary-password'), false);
});
test('an expired REST nonce refreshes once without submitting the login form again', async t => {
  const server = await site(t, { expiredNonce: true }); const client = new WordPressClient({ baseUrl: server.url, auth: login });
  assert.equal((await client.getSiteInfo()).name, 'Protected member website'); assert.equal(server.posts, 1); assert.equal(server.nonceRequests, 2);
});
test('beta.2-style normal login succeeds when the page merely references a CAPTCHA plugin', async t => {
  const server = await site(t, { captcha: true }); const client = new WordPressClient({ baseUrl: server.url, auth: login });
  assert.equal((await client.getSiteInfo()).name, 'Protected member website'); assert.equal(server.posts, 1);
});
test('a server that actually rejects normal login is respected without retries or challenge solving', async t => {
  const server = await site(t, { captcha: true, rejectLogin: true }); const client = new WordPressClient({ baseUrl: server.url, auth: login });
  await assert.rejects(client.getSiteInfo(), error => error.code === 'SOURCE_AUTH_FAILED'); assert.equal(server.posts, 1);
});
test('a manually signed-in browser session works without exposing cookies in its summary', async t => {
  const server = await site(t); const client = new WordPressClient({ baseUrl: server.url, auth: { mode: 'session', browserSession: { origin: server.url, cookies: [{ name: 'wordpress_logged_in_fixture', value: 'valid-session' }] } } });
  assert.equal((await client.getSiteInfo()).name, 'Protected member website'); assert.equal(server.posts, 0);
  assert.ok(!server.requests.some(request => request.path === '/login/')); assert.ok(!JSON.stringify(client.authSummary()).includes('valid-session'));
});
test('session cookies and form credentials cannot follow another website', async t => {
  const server = await site(t, { externalAction: true }); const client = new WordPressClient({ baseUrl: server.url, auth: login });
  await assert.rejects(client.getSiteInfo(), /another website/); assert.equal(server.posts, 0);
  assert.throws(() => new WordPressClient({ baseUrl: server.url, auth: { mode: 'session', browserSession: { origin: 'https://another.invalid', cookies: [] } } }), /another website/);
});
test('a source redirect cannot forward signed-in cookies to another origin', async t => {
  const server = await site(t, { externalRedirect: true }); const client = new WordPressClient({ baseUrl: server.url, auth: login });
  await assert.rejects(client.getSiteInfo(), /another website/);
});
