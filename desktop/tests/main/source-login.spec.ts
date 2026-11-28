import { describe, it, expect } from 'vitest';
import { sessionFromCookies, sourceLoginOrigin } from '../../src/main/source-login-policy.js';
describe('isolated website login session', () => {
  it('accepts only website http(s) origins without credentials', () => {
    expect(sourceLoginOrigin('https://example.org/member/')).toBe('https://example.org');
    expect(() => sourceLoginOrigin('file:///tmp/login')).toThrow();
    expect(() => sourceLoginOrigin('https://user:secret@example.org')).toThrow();
  });
  it('transfers only valid WordPress cookies for this website', () => {
    const value = sessionFromCookies('https://example.org', [{ name: 'wordpress_logged_in_hash', value: 'session', domain: '.example.org' }, { name: 'tracker', value: 'unrelated' }, { name: 'wordpress_logged_in_foreign', value: 'foreign', domain: 'another.org' }]);
    expect(value).toEqual({ mode: 'session', browserSession: { origin: 'https://example.org', cookies: [{ name: 'wordpress_logged_in_hash', value: 'session' }] } });
  });
  it('rejects anonymous, expired and malformed browser sessions', () => {
    for (const cookies of [[], [{ name: 'wordpress_logged_in_a', value: '' }], [{ name: 'wordpress_logged_in_a', value: 'bad\r\nheader' }], [{ name: 'wordpress_logged_in_a', value: 'old', expirationDate: 1 }]]) expect(() => sessionFromCookies('https://example.org', cookies)).toThrow(/Finish signing in/);
  });
});
