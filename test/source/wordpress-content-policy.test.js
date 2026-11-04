import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContentDocument } from '../../lib/model/content.js';
import { normalizePostOrPage } from '../../lib/source/wordpress/normalize.js';
import { renderContentPayload } from '../../lib/engine/publication/payloads.js';

const SITE = 'https://wordpressfoundation.org';
const JWT_A = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJlbmNyeXB0ZWRfYXR0cmlidXRlcyI6IkFBQUEifQ.c2lnbmF0dXJlLUFBQUE';
const JWT_B = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJlbmNyeXB0ZWRfYXR0cmlidXRlcyI6IkJCQkIifQ.c2lnbmF0dXJlLUJCQkI';

function pageHtml(jwt) {
  return [
    '<p class="wp-block-paragraph">Questions before getting in touch: <a href="/about/">about WordPress</a>.</p>',
    '<p class="wp-block-paragraph">If the above does not answer your question, feel free to get in touch.</p>',
    '<img src="/wp-content/uploads/editorial.jpg" alt="Editorial">',
    '<div data-test="contact-form" id="contact-form-108" class="jetpack-contact-form-container " data-wp-interactive="jetpack/form">',
    '<img src="/wp-content/uploads/plugin-gallery.jpg" alt="Plugin gallery">',
    '<form action="https://wordpressfoundation.org/contact/" class="contact-form commentsblock jetpack-contact-form__form" data-wp-on--submit="actions.onFormSubmit">',
    `<input type="hidden" name="jetpack_contact_form_jwt" value="${jwt}">`,
    '<label>Name</label><input type="text" name="name"><textarea name="message"></textarea><button type="submit">Send</button>',
    '</form></div>',
    '<script>window.jetpackContactForm = true;</script>',
    '<iframe src="https://widgets.example.net/app"></iframe>',
    '<p class="wp-block-paragraph">Kind regards, the WordPress Foundation.</p>'
  ].join('\n');
}

function rawPage(html, overrides = {}) {
  return {
    id: 108,
    slug: 'contact',
    link: `${SITE}/contact/`,
    title: { rendered: 'Contact' },
    content: { rendered: html },
    excerpt: { rendered: '<p>How to contact us</p>' },
    date: '2022-10-14T11:38:59',
    date_gmt: '2022-10-14T11:38:59',
    modified: '2022-10-14T11:38:59',
    modified_gmt: '2022-10-14T11:38:59',
    status: 'publish',
    author: 7,
    featured_media: 0,
    categories: [],
    tags: [],
    parent: 0,
    menu_order: 0,
    format: 'standard',
    ...overrides
  };
}

function normalize(html, overrides = {}) {
  return normalizePostOrPage({ contentType: 'page', raw: rawPage(html, overrides), site: SITE });
}

test('Jetpack form interaction and its short-lived JWT never reach the canonical content', () => {
  const document = normalize(pageHtml(JWT_A));
  assert.equal(document.body.html.includes('<form'), false);
  assert.equal(document.body.html.includes('jetpack_contact_form_jwt'), false);
  assert.equal(document.body.html.includes('data-wp-'), false);
  assert.equal(document.body.html.includes('widgets.example.net'), false);
  assert.equal(document.body.html.includes('<script'), false);
  assert.equal(document.body.html.includes(JWT_A), false);
  assert.equal(JSON.stringify(document).includes(JWT_A), false);
  assert.equal(document.body.html.includes('Questions before getting in touch'), true);
  assert.equal(document.body.html.includes('href="/about/"'), true);
  assert.equal(document.body.text.includes('Kind regards, the WordPress Foundation.'), true);
  // Meaningful media inside the plugin-generated block survives.
  assert.equal(document.body.html.includes('/wp-content/uploads/plugin-gallery.jpg'), true);
  assert.equal(document.body.html.includes('/wp-content/uploads/editorial.jpg'), true);
  assert.ok(document.media.images.some((entry) => entry.url === '/wp-content/uploads/plugin-gallery.jpg'));
  assertContentDocument(document, { verifyHash: true, baseUrl: SITE });
});

test('unsupported functionality produces a non-sensitive structured import warning', () => {
  const document = normalize(pageHtml(JWT_A));
  const warning = document.warnings.find((entry) => entry.code === 'UNSUPPORTED_INTERACTIVE_CONTENT');
  assert.ok(warning);
  assert.equal(warning.details.sourceKey, 'page:108');
  assert.equal(warning.details.feature, 'contact_form');
  assert.equal(warning.details.provider, 'jetpack');
  assert.match(warning.details.suggestion, /Qortal-native service/);
  assert.equal(JSON.stringify(document.warnings).includes(JWT_A), false);
  assert.equal(/eyJ[A-Za-z0-9_-]{10,}\./.test(JSON.stringify(document.warnings)), false);
  assert.ok(document.unsupported.some((entry) => entry.code === 'UNSUPPORTED_INTERACTIVE_CONTENT' && entry.review === 'manual'));
  assert.equal(document.source.extra.wordpress.content_policy.id, 'qms-wp-content-only@1');
});

test('JWT rotation does not create a false content modification', () => {
  const first = normalize(pageHtml(JWT_A));
  const second = normalize(pageHtml(JWT_B));
  assert.notEqual(JWT_A, JWT_B);
  assert.equal(first.content_hash, second.content_hash);
  assert.equal(first.body.hash, second.body.hash);
});

test('a real editorial change still produces a modification', () => {
  const first = normalize(pageHtml(JWT_A));
  const edited = normalize(pageHtml(JWT_A).replace('Kind regards', 'Warm regards'));
  assert.notEqual(first.content_hash, edited.content_hash);
});

test('the canonical publication payload contains no unsupported interaction or token', () => {
  const document = normalize(pageHtml(JWT_A));
  const bytes = renderContentPayload({
    document,
    mediaByUrl: new Map(),
    resource: { service: 'DOCUMENT', name: 'ContactSite', identifier: 'contact-page' },
    publishedAt: '2026-01-01T00:00:00.000Z'
  });
  const payload = JSON.parse(bytes.toString('utf8'));
  assert.equal(payload.schema, 'qms-qdn-content@1');
  assert.equal(payload.body.html.includes('<form'), false);
  assert.equal(payload.body.html.includes('jetpack_contact_form_jwt'), false);
  assert.equal(JSON.stringify(payload).includes(JWT_A), false);
  assert.equal(payload.body.html.includes('Questions before getting in touch'), true);
});

test('volatile WordPress block instance classes do not create a false modification', () => {
  const gallery = (instance) => [
    '<p>Workshops in 2018.</p>',
    `<ul class="wp-block-gallery columns-3 is-cropped wp-block-gallery-${instance} is-layout-flex wp-block-gallery-is-layout-flex">`,
    '<li class="blocks-gallery-item"><figure><img class="wp-image-44148" src="/wp-content/uploads/kumasi.jpg" alt="Kumasi"></figure></li>',
    '</ul>'
  ].join('');
  const first = normalize(gallery(1));
  const second = normalize(gallery(4));
  assert.notEqual(gallery(1), gallery(4));
  assert.equal(first.content_hash, second.content_hash);
  assert.equal(/wp-block-gallery-\d+/.test(first.body.html), false);
  assert.equal(/wp-block-gallery-\d+/.test(second.body.html), false);
  assert.equal(first.body.html.includes('wp-image-44148'), true);
  assert.equal(first.body.html.includes('columns-3'), true);
});

test('clean editorial HTML stays byte-identical for Corbett compatibility', () => {
  const html = '<p>Hello &amp; welcome to the <a href="/about/">About</a> page.</p><img src="/wp-content/uploads/one.jpg" alt="One"><iframe src="https://www.youtube.com/embed/abc"></iframe>';
  const document = normalize(html);
  assert.equal(document.body.html, html);
  assert.equal(document.warnings.some((warning) => warning.code === 'UNSUPPORTED_INTERACTIVE_CONTENT'), false);
});
