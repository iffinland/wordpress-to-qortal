import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cmsConfig } from '../src/config/cmsConfig';
import { countPostLikes, postSocialTarget, publishPostSocial, readSocialPage, socialAccount, socialPrefix } from '../src/lib/postSocial.js';
import { requestQortal } from '../src/lib/qortal.js';
vi.mock('../src/lib/qortal.js', () => ({ requestQortal: vi.fn(), discoverHostedQdnResource: (value: any) => value }));
const request = vi.mocked(requestQortal);
const config = { ...cmsConfig, deployment: { service: 'APP', name: 'My Site', identifier: 'edition-2' } };
const item = { id: 'post-42', slug: 'hello world' };
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); request.mockReset(); });
afterEach(() => vi.unstubAllGlobals());
it('keeps engagement across slug edits, isolates deployments and uses a public Qortal link', async () => {
 const original = await postSocialTarget(config, item);
 expect((await postSocialTarget(config, { ...item, slug: 'renamed' })).key).toBe(original.key);
 for (const changed of [{ ...config, deployment: { ...config.deployment, name: 'Other Site' } }, { ...config, deployment: { ...config.deployment, identifier: 'other' } }, { ...config, site: { ...config.site, id: 'other' } }]) expect((await postSocialTarget(changed, item)).key).not.toBe(original.key);
 expect((await postSocialTarget(config, { ...item, id: 'post-43' })).key).not.toBe(original.key);
 expect(original.url).toBe('qortal://APP/My%20Site/?identifier=edition-2#/posts/hello%20world');
});
it('requires a registered name owned by the connected account', async () => {
 request.mockResolvedValueOnce({ address: 'Q123', name: 'spoofed' }).mockResolvedValueOnce([{ name: 'Real Name' }]);
 expect(await socialAccount()).toEqual({ address: 'Q123', name: 'Real Name' });
 request.mockResolvedValueOnce({ address: 'Q123' }).mockResolvedValueOnce([]);
 await expect(socialAccount()).rejects.toThrow('registered');
});
it('uses one like resource per name and preserves Unicode comment text', async () => {
 request.mockResolvedValue(true);
 const a = await publishPostSocial('like', 'key1', { name: 'Alice' });
 const b = await publishPostSocial('like', 'key1', { name: 'Alice' });
 const c = await publishPostSocial('like', 'key1', { name: 'Bob' });
 expect(a.identifier).toBe(b.identifier); expect(c.identifier).not.toBe(a.identifier);
 await publishPostSocial('comment', 'key1', { name: 'Alice' }, { text: 'Tere õäö! ❤️' });
 const call = request.mock.calls.at(-1)![0] as any;
 expect(JSON.parse(Buffer.from(call.data64, 'base64').toString()).text).toBe('Tere õäö! ❤️');
});
it('does not accept cancelled/error publications or blank/oversized comments', async () => {
 request.mockResolvedValue(false);
 await expect(publishPostSocial('like', 'key1', { name: 'Alice' })).rejects.toThrow('confirm');
 request.mockResolvedValue({ error: 'denied', message: 'Permission denied' });
 await expect(publishPostSocial('like', 'key1', { name: 'Alice' })).rejects.toThrow('Permission denied');
 request.mockClear();
 for (const text of [' ', 'x'.repeat(4001)]) await expect(publishPostSocial('comment', 'key1', { name: 'Alice' }, { text })).rejects.toThrow();
 expect(request).not.toHaveBeenCalled();
});
it('validates payload identity and paginates using raw summaries', async () => {
 const prefix = socialPrefix('comment', 'key1');
 request.mockResolvedValueOnce([{ name: 'Alice', identifier: prefix + '1' }, { name: 'Bob', identifier: prefix + '2' }])
 .mockResolvedValueOnce({ schema: 'qms-post-social@1', key: 'other', kind: 'comment', authorName: 'Alice', text: 'wrong site' })
 .mockResolvedValueOnce({ schema: 'qms-post-social@1', key: 'key1', kind: 'comment', authorName: 'Alice', text: 'spoofed' });
 expect(await readSocialPage('comment', 'key1', 10, 2)).toEqual({ entries: [], nextOffset: 12, hasMore: true });
 expect(request.mock.calls[0][0]).toMatchObject({ identifier: prefix, prefix: true, offset: 10, limit: 2 });
});
it('does not turn failed reads into empty success', async () => {
 request.mockRejectedValueOnce(new Error('offline'));
 await expect(readSocialPage('comment', 'key1')).rejects.toThrow('offline');
 request.mockResolvedValueOnce([{ name: 'Alice', identifier: socialPrefix('comment', 'key1') + '1' }]).mockRejectedValueOnce(new Error('not ready'));
 await expect(readSocialPage('comment', 'key1')).rejects.toThrow('could not be read');
});
it('deduplicates likes and rejects forged author identifiers', async () => {
 request.mockResolvedValue(true);
 const like = await publishPostSocial('like', 'key1', { name: 'Alice' });
 request.mockReset();
 request.mockResolvedValueOnce([{ name: 'Alice', identifier: like.identifier }, { name: 'Alice', identifier: like.identifier }, { name: 'Mallory', identifier: like.identifier }])
 .mockResolvedValueOnce(like).mockResolvedValueOnce(like).mockResolvedValueOnce({ ...like, authorName: 'Mallory' });
 expect(await countPostLikes('key1')).toEqual({ count: 1, hasMore: false });
});
