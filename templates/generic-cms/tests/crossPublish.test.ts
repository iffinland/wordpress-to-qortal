import { describe, expect, it } from 'vitest';
import {
  buildQappIdentifier,
  buildQappSearchPrefix,
  qappHashWord,
  stableToken
} from '../src/lib/crossPublish/ids.js';
import {
  QTUBE_VIDEO_IDENTIFIER_BASE,
  buildQTubeMetadata,
  buildQTubeResource,
  isQTubeEligibleVideo,
  isValidQTubeMetadata,
  qtubeMetadataIdentifier
} from '../src/lib/crossPublish/qtube.js';
import {
  SUBWIRE_COVER_RAW_MAX_BYTES,
  buildSubwireArticle,
  convertCoverToWebp,
  fallbackSubwireCover,
  isSubwireRenderableArticle,
  markdownFromHtml,
  subwireArticleIdentifier,
  subwireCoverFromBytes
} from '../src/lib/crossPublish/subwire.js';
import {
  QUITTER_TEXT_LIMIT,
  buildQuitterAnnouncement,
  buildQuitterPost,
  isQuitterRenderablePost,
  quitterAnnouncementProblem,
  quitterPostIdentifier
} from '../src/lib/crossPublish/quitter.js';
import {
  buildCrossPublishPlan,
  buildSitePostUrl
} from '../src/lib/crossPublish/plan.js';

const SUBWIRE_PREFIX = '7l1NGsWiY0SgPb-FJVWQM-T60ZadsfPsbLTh-';
const QUITTER_PREFIX = 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-';

const video = {
  service: 'VIDEO',
  name: 'QortalDemo',
  identifier: 'qms-cms-att-abcdef',
  filename: 'klipp.mp4',
  mime: 'video/mp4',
  size: 123456
};

const draft = {
  title: 'Põhja-Tallinn ja Qortal',
  slug: 'pohja-tallinn-ja-qortal',
  excerpt: 'Lühike kokkuvõte postitusest.',
  html: '<h2>Pealkiri</h2><p>Tekst <strong>paks</strong> ja <a href="https://example.com">link</a>.</p>'
    + '<ul><li>Üks</li><li>Kaks</li></ul>'
    + '<div data-qms-attachment="1" data-kind="video" data-service="VIDEO" data-name="QortalDemo" '
    + 'data-identifier="qms-cms-att-abcdef" data-title="Klipp" data-filename="klipp.mp4" data-size="123456">video</div>'
};

const cover = fallbackSubwireCover({ title: draft.title, siteTitle: 'Qortal Site', accent: '#4da3ff' });

const planInput = (overrides: any = {}) => ({
  draft,
  name: 'QortalDemo',
  siteId: 'site-fixture',
  siteTitle: 'Qortal Site',
  publisherName: 'QortalDemo',
  postUrl: 'qortal://APP/QortalDemo/#/posts/pohja-tallinn-ja-qortal',
  video,
  cover,
  selections: { qtube: false, subwire: false, quitter: false },
  quitterText: '',
  timestamp: 1763000000000,
  accent: '#4da3ff',
  readRemote: async () => null,
  ...overrides
});

describe('qapp-core identifier math', () => {
  it('reproduces the pinned Subwire and Quitter prefixes byte-for-byte', async () => {
    expect(await qappHashWord('subwire', 14, '0drEPfUciLNhQZF9NFBg6RLnwcff/g3Ic7mm3VrIJKw='))
      .toBe('7l1NGsWiY0SgPb');
    await expect(buildQappSearchPrefix({
      appName: 'subwire',
      publicSalt: '0drEPfUciLNhQZF9NFBg6RLnwcff/g3Ic7mm3VrIJKw=',
      entityType: 'SUBWIRE_ARTICLE',
      parentId: 'SUBWIRE_ROOT'
    })).resolves.toBe(SUBWIRE_PREFIX);
    await expect(buildQappSearchPrefix({
      appName: 'quitter',
      publicSalt: '6hMqDBxky6j1G2wZEHgIiOeApj3x3CP8LQwg0Ok0RVc=',
      entityType: 'POST',
      parentId: 'ROOT'
    })).resolves.toBe(QUITTER_PREFIX);
  });

  it('builds deterministic 12-character uids and full identifiers', async () => {
    const first = await stableToken('site-fixture|slug:test|subwire');
    const second = await stableToken('site-fixture|slug:test|subwire');
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{12}$/);
    const identifier = await subwireArticleIdentifier(first);
    expect(identifier.startsWith(SUBWIRE_PREFIX)).toBe(true);
    expect(identifier.endsWith('-' + first + '-v1')).toBe(true);
    const quitter = await quitterPostIdentifier(first);
    expect(quitter.startsWith(QUITTER_PREFIX)).toBe(true);
    expect(quitter.endsWith('-' + first + '-v1')).toBe(true);
    await expect(buildQappIdentifier({
      appName: 'quitter',
      publicSalt: '6hMqDBxky6j1G2wZEHgIiOeApj3x3CP8LQwg0Ok0RVc=',
      entityType: 'POST',
      parentId: 'ROOT',
      uid: first
    })).resolves.toBe(quitter);
  });
});

describe('Q-Tube metadata contract', () => {
  it('accepts playable VIDEO attachments and rejects MKV or non-video resources', () => {
    expect(isQTubeEligibleVideo({ ...video, kind: 'video' })).toBe(true);
    expect(isQTubeEligibleVideo({ ...video, kind: 'video', filename: 'clip.mkv' })).toBe(false);
    expect(isQTubeEligibleVideo({ ...video, kind: 'video', filename: 'clip.mov' })).toBe(false);
    expect(isQTubeEligibleVideo({ ...video, kind: 'audio' })).toBe(false);
    expect(isQTubeEligibleVideo({ ...video, kind: 'video', size: 0 })).toBe(false);
  });

  it('mirrors the Q-Tube VideoMetadata shape and discovery gate', () => {
    const token = 'abcdefabcdef';
    const metadata: any = buildQTubeMetadata({
      title: draft.title,
      description: 'Plain summary',
      htmlDescription: '<p>HTML summary</p>',
      video: { ...video, kind: 'video' },
      token
    });
    expect(metadata).toMatchObject({
      version: 1,
      title: draft.title,
      fullDescription: 'Plain summary',
      htmlDescription: '<p>HTML summary</p>',
      videoImage: null,
      category: '99',
      subcategory: '',
      code: 'abcde',
      commentsId: 'qtube_vid__cm_abcde',
      videoType: 'video/mp4',
      filename: 'klipp.mp4',
      fileSize: 123456,
      duration: 0
    });
    expect(metadata.extracts).toEqual([]);
    expect(metadata.videoReference).toEqual({
      name: 'QortalDemo',
      identifier: 'qms-cms-att-abcdef',
      service: 'VIDEO'
    });
    expect(isValidQTubeMetadata(metadata)).toBe(true);
    expect(isValidQTubeMetadata({ ...metadata, videoReference: { name: '', identifier: 'x', service: 'VIDEO' } })).toBe(false);
  });

  it('publishes the metadata DOCUMENT at qtube_vid_<token>_metadata with tag1', () => {
    const resource: any = buildQTubeResource({
      title: 'A very long Qortal post title that exceeds fifty characters easily',
      plainDescription: 'Summary',
      htmlDescription: '<p>Summary</p>',
      video: { ...video, kind: 'video' },
      token: 'abcdefabcdef'
    });
    expect(resource.stage).toBe('qtube');
    expect(resource.identifier).toBe(qtubeMetadataIdentifier('abcdefabcdef'));
    expect(resource.identifier.startsWith(QTUBE_VIDEO_IDENTIFIER_BASE)).toBe(true);
    expect(resource.identifier.endsWith('_metadata')).toBe(true);
    expect(resource.tag1).toBe('qtube_vid_');
    expect(resource.title.length).toBeLessThanOrEqual(50);
    expect(resource.description).toContain('**category:99;subcategory:;code:abcde**');
    expect(resource.description).toContain('Summary');
  });
});

describe('Subwire article contract', () => {
  it('converts sanitized CMS HTML into GFM Markdown with attachment links', () => {
    const markdown = markdownFromHtml(draft.html);
    expect(markdown).toContain('## Pealkiri');
    expect(markdown).toContain('**paks**');
    expect(markdown).toContain('[link](https://example.com)');
    expect(markdown).toContain('- Üks');
    expect(markdown).toContain('- Kaks');
    // Audio, video and file attachments have no GFM equivalent and are dropped.
    expect(markdown).not.toContain('qortal://VIDEO/QortalDemo/qms-cms-att-abcdef');
  });

  it('never turns literal CMS text into raw HTML for Subwire', () => {
    const markdown = markdownFromHtml('<p>Hello &lt;script&gt;alert(1)&lt;/script&gt; world</p>');
    expect(markdown).toContain('&lt;script&gt;');
    expect(markdown).not.toContain('<script>');
  });

  it('embeds only WebP cover bytes as bare base64', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    const embedded = subwireCoverFromBytes({ bytes: webp, mime: 'image/webp', name: 'cover.webp' });
    expect(embedded?.name).toBe('cover.webp');
    expect(embedded?.src).toBe(btoa(String.fromCharCode(...webp)));
    expect(embedded?.src.startsWith('data:')).toBe(false);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    expect(subwireCoverFromBytes({ bytes: jpeg, mime: 'image/jpeg', name: 'cover.jpg' })).toBeNull();
    expect(subwireCoverFromBytes({ bytes: jpeg, mime: 'image/svg+xml', name: 'cover.svg' })).toBeNull();
  });

  it('converts the featured image to WebP or fails with a clear message', async () => {
    const webp = new Uint8Array([1, 2, 3]);
    await expect(convertCoverToWebp({ bytes: webp, mime: 'image/webp', name: 'a.webp' }))
      .resolves.toMatchObject({ mime: 'image/webp', name: 'a.webp' });
    await expect(convertCoverToWebp({
      bytes: new Uint8Array(SUBWIRE_COVER_RAW_MAX_BYTES + 1), mime: 'image/webp', name: 'big.webp'
    })).rejects.toThrow(/above the/);
    await expect(convertCoverToWebp({
      bytes: new Uint8Array([0xff]), mime: 'image/jpeg', name: 'a.jpg', windowLike: {}
    })).rejects.toThrow(/canvas/);
  });

  it('builds a renderable article and a deterministic fallback cover', () => {
    const article: any = buildSubwireArticle({
      title: draft.title,
      subtitle: draft.excerpt,
      markdown: markdownFromHtml(draft.html),
      cover,
      timestamp: 1763000000000,
      name: 'QortalDemo'
    });
    expect(article.type).toBe('essay');
    expect(article.published).toBe(true);
    expect(article.coverImage).toEqual(cover);
    expect(isSubwireRenderableArticle(article)).toBe(true);
    expect(cover.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
  });
});

describe('Quitter announcement contract', () => {
  it('keeps the default announcement inside the 280-character display window', () => {
    const text = buildQuitterAnnouncement({
      title: 'A very long Qortal publication title that keeps going and going for a while so the header cannot fit on its own',
      excerpt: 'A long summary that should be shortened once the headline and the link have taken their space in the collapsed feed view.',
      postUrl: 'qortal://APP/Some%20Owner/?identifier=qms-site#/posts/very-long-slug'
    });
    expect(text.length).toBeLessThanOrEqual(QUITTER_TEXT_LIMIT);
    expect(text.startsWith('New publication: ')).toBe(true);
    expect(text).toContain('qortal://APP/Some%20Owner/?identifier=qms-site#/posts/very-long-slug');
  });

  it('rejects editable text above the limit and builds the Quitter payload', () => {
    expect(quitterAnnouncementProblem('x'.repeat(QUITTER_TEXT_LIMIT + 1))).toMatch(/characters/);
    expect(quitterAnnouncementProblem('x'.repeat(QUITTER_TEXT_LIMIT))).toBe('');
    const post: any = buildQuitterPost({ text: 'Hello', name: 'QortalDemo', timestamp: 1763000000000 });
    expect(post).toEqual({ text: 'Hello', timestamp: 1763000000000, name: 'QortalDemo' });
    expect(isQuitterRenderablePost(post)).toBe(true);
  });
});

describe('cross-publication planning', () => {
  it('creates no destination resources when nothing is selected', async () => {
    const plan = await buildCrossPublishPlan(planInput());
    expect(plan.entries).toEqual([]);
    expect(plan.resources).toEqual([]);
  });

  it('creates the three destination resources deterministically', async () => {
    const selections = { qtube: true, subwire: true, quitter: true };
    const first = await buildCrossPublishPlan(planInput({ selections }));
    const second = await buildCrossPublishPlan(planInput({ selections }));
    expect(first.resources.map((resource: any) => resource.stage)).toEqual(['qtube', 'subwire', 'quitter', 'crosspost-record']);
    expect(first.resources.map((resource: any) => resource.identifier))
      .toEqual(second.resources.map((resource: any) => resource.identifier));
    expect(first.entries.every((entry: any) => entry.reused === false)).toBe(true);
    expect(first.announcement.length).toBeLessThanOrEqual(QUITTER_TEXT_LIMIT);
    expect(first.announcement).toContain('qortal://APP/QortalDemo/#/posts/pohja-tallinn-ja-qortal');
  });

  it('re-keys every video under qtube_vid_ and moves the CMS references', async () => {
    const videos = [
      { ...video, kind: 'video' },
      { ...video, kind: 'video', identifier: 'qms-cms-att-second', filename: 'teine.mp4' }
    ];
    const plan: any = await buildCrossPublishPlan(planInput({
      selections: { qtube: true, subwire: false, quitter: false },
      videos
    }));
    expect(plan.videoMoves).toHaveLength(2);
    expect(plan.videoMoves[0].to.startsWith('qtube_vid_')).toBe(true);
    expect(plan.videoMoves[1].to).not.toBe(plan.videoMoves[0].to);
    const firstMetadata = plan.entries.find((entry: any) => entry.id === 'qtube');
    const secondMetadata = plan.entries.find((entry: any) => entry.id === 'qtube-2');
    expect(firstMetadata.document.videoReference.identifier).toBe(plan.videoMoves[0].to);
    expect(secondMetadata.document.videoReference.identifier).toBe(plan.videoMoves[1].to);
  });

  it('marks an identical remote destination as reused and removes it from the batch', async () => {
    const selections = { qtube: false, subwire: true, quitter: false };
    const probe = await buildCrossPublishPlan(planInput({ selections }));
    const identifier = probe.entries[0].identifier;
    const document = probe.entries[0].document;
    const plan = await buildCrossPublishPlan(planInput({
      selections,
      readRemote: async (service: string, name: string, requested: string) =>
        requested === identifier ? document : null
    }));
    expect(plan.entries[0].reused).toBe(true);
    expect(plan.resources.map((resource: any) => resource.stage)).toEqual(['crosspost-record']);
    expect(plan.entries[0].identifier).toBe(identifier);
  });

  it('blocks Q-Tube without an eligible video and blocks an over-long announcement', async () => {
    await expect(buildCrossPublishPlan(planInput({
      selections: { qtube: true, subwire: false, quitter: false },
      video: null
    }))).rejects.toThrow(/eligible video attachment/);
    await expect(buildCrossPublishPlan(planInput({
      selections: { qtube: false, subwire: false, quitter: true },
      quitterText: 'x'.repeat(QUITTER_TEXT_LIMIT + 1)
    }))).rejects.toThrow(/characters/);
  });

  it('builds a best-effort post deep link for APP and WEBSITE deployments', () => {
    expect(buildSitePostUrl({ deployment: { service: 'APP', name: 'Some Owner', identifier: 'qms-site' }, name: 'x', slug: 'my-post' }))
      .toBe('qortal://APP/Some%20Owner/?identifier=qms-site#/posts/my-post');
    expect(buildSitePostUrl({ deployment: { service: 'WEBSITE', name: 'Owner', identifier: 'default' }, name: 'x', slug: 'my-post' }))
      .toBe('qortal://WEBSITE/Owner/#/posts/my-post');
    expect(buildSitePostUrl({ name: 'QortalDemo', slug: 'my-post' }))
      .toBe('qortal://APP/QortalDemo/#/posts/my-post');
  });
});
