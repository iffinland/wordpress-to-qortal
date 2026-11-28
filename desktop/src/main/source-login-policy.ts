export function sourceLoginOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use a WordPress http(s) address without credentials.');
  return url.origin;
}
export function sessionFromCookies(baseUrl: string, cookies: Array<{ name: string; value: string; domain?: string; expirationDate?: number }>): Record<string, unknown> {
  const origin = sourceLoginOrigin(baseUrl); const host = new URL(origin).hostname;
  const valid = cookies.filter(cookie => {
    const domain = cookie.domain?.replace(/^\./, '');
    return (!domain || host === domain || host.endsWith('.' + domain)) && (!cookie.expirationDate || cookie.expirationDate > Date.now() / 1000) && /^wordpress_(?:logged_in_|sec_|test_cookie)/.test(cookie.name) && /^[a-zA-Z0-9_-]+$/.test(cookie.name) && typeof cookie.value === 'string' && cookie.value.length > 0 && !/[\x00-\x20;\x7f]/.test(cookie.value);
  }).map(({ name, value }) => ({ name, value }));
  if (!valid.some(cookie => cookie.name.startsWith('wordpress_logged_in_'))) throw new Error('Finish signing in on the website first, including any CAPTCHA or two-factor check. Then choose Use signed-in session.');
  return { mode: 'session', browserSession: { origin, cookies: valid } };
}
