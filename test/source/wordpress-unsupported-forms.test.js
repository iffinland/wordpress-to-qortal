import test from 'node:test';
import assert from 'node:assert/strict';
import { assertContentDocument } from '../../lib/model/content.js';
import { normalizePostOrPage } from '../../lib/source/wordpress/normalize.js';
import { renderContentPayload } from '../../lib/engine/publication/payloads.js';

const SITE = 'https://wordpressfoundation.org';
const NONCE_A = '85a2e111e6';
const NONCE_B = '9f4c7b22d1';
const TOKEN_A = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JtIn0.c2lnbmF0dXJlQQ';
const TOKEN_B = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmb3JtIn0.c2lnbmF0dXJlQg';
const CONTROL_TAGS = /<(form|input|select|textarea|button|datalist|output|progress|meter|option|optgroup|label)\b/i;
const SUBMISSION_MARKERS = /admin-post\.php|admin-ajax\.php|wp-login\.php|xmlrpc\.php|\baction=|_wpnonce|_wp_http_referer|type="hidden"/i;

function rawPage(html, overrides = {}) {
  return {
    id: 30,
    slug: 'donate',
    link: SITE + '/donate/',
    title: { rendered: 'Donate' },
    content: { rendered: html },
    excerpt: { rendered: '<p>Support the WordPress Foundation</p>' },
    date: '2023-01-10T09:00:00',
    date_gmt: '2023-01-10T09:00:00',
    modified: '2023-01-10T09:00:00',
    modified_gmt: '2023-01-10T09:00:00',
    status: 'publish',
    author: 3,
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

function assertNoUnsupportedFormMarkup(document) {
  const html = document.body.html;
  assert.equal(CONTROL_TAGS.test(html), false, 'canonical HTML still contains a form or form control: ' + html.slice(0, 400));
  assert.equal(SUBMISSION_MARKERS.test(html), false, 'canonical HTML still references an unsupported submission endpoint');
  assert.equal(/<\/form/i.test(html), false);
}

function donationPage(nonce, editorial = 'Your gift funds workshops, hackathons and open source education.') {
  return [
    '<p class="wp-block-paragraph">The WordPress Foundation depends on donors like you.</p>',
    '<div id="custom-subscription">',
    '<form method="post" action="https://wordpressfoundation.org/wp/wp-admin/admin-post.php">',
    '<input type="hidden" id="custom-subscription" name="custom-subscription" value="' + nonce + '" />',
    '<input type="hidden" name="_wp_http_referer" value="/donate/" />',
    '<input type="hidden" name="action" value="custom_subscription" />',
    '<div><label for="custom-subscription-amount">Choose a custom subscription amount.</label>',
    '<div id="custom-subscription-amount-container"><div class="custom-subscription-amount-row">',
    '<button type="button" id="decrease" aria-label="Decrease donation amount">&minus;</button>',
    '<input id="custom-subscription-amount" name="custom-subscription-amount" type="number" value="2500">',
    '<button type="button" id="increase" aria-label="Increase donation amount">+</button>',
    '</div><span class="inline-help">USD/year</span></div></div>',
    '<p>' + editorial + ' Read <a href="/about/">about the Foundation</a>.</p>',
    '<img src="/wp-content/uploads/donate-community.jpg" alt="Community workshop">',
    '</form></div>',
    '<p class="wp-block-paragraph">Thank you for supporting WordPress.</p>'
  ].join('\n');
}

test('a generic POST donation form never survives canonical normalization', () => {
  const document = normalize(donationPage(NONCE_A));
  assertNoUnsupportedFormMarkup(document);
  assert.equal(document.body.html.includes('admin-post.php'), false);
  assert.equal(document.body.html.includes(NONCE_A), false);
  assert.equal(JSON.stringify(document).includes(NONCE_A), false);
  // Editorial content inside the form container is salvaged as neutral content.
  assert.equal(document.body.text.includes('The WordPress Foundation depends on donors like you.'), true);
  assert.equal(document.body.text.includes('Your gift funds workshops, hackathons and open source education.'), true);
  assert.equal(document.body.text.includes('Thank you for supporting WordPress.'), true);
  assert.equal(document.body.html.includes('href="/about/"'), true);
  assert.equal(document.body.html.includes('/wp-content/uploads/donate-community.jpg'), true);
  assert.ok(document.media.images.some((entry) => entry.url === '/wp-content/uploads/donate-community.jpg'));
  const warning = document.warnings.find((entry) => entry.code === 'UNSUPPORTED_INTERACTIVE_CONTENT');
  assert.ok(warning);
  assert.equal(warning.details.sourceKey, 'page:30');
  assert.equal(warning.details.feature, 'form');
  assert.equal(warning.details.provider, null);
  assert.match(warning.details.suggestion, /Qortal-native service/);
  assertContentDocument(document, { verifyHash: true, baseUrl: SITE });
});

const FORM_CASES = [
  {
    feature: 'contact',
    markup: '<form action="/contact/" method="post" class="contact-page-form"><label>Name</label><input name="name">' +
      '<label>Email</label><input type="email" name="email"><textarea name="message"></textarea><button type="submit">Send</button>' +
      '<p>Prefer email? Write to <a href="/about/">the Foundation</a>.</p><img src="/wp-content/uploads/contact-desk.jpg" alt="Desk"></form>',
    editorial: 'Prefer email? Write to'
  },
  {
    feature: 'donation',
    markup: '<form action="/wp/wp-admin/admin-post.php" method="post"><input type="hidden" name="nonce" value="' + NONCE_A + '">' +
      '<label>Amount</label><select name="amount"><option>10</option><option>50</option></select><button type="submit">Donate</button>' +
      '<p>Every donation supports community education.</p><img src="/wp-content/uploads/donor.jpg" alt="Donor"></form>',
    editorial: 'Every donation supports community education.'
  },
  {
    feature: 'booking',
    markup: '<form action="/booking/" method="post" class="booking-form"><label>Date</label><input type="date" name="date">' +
      '<label>Guests</label><input type="number" name="guests"><button type="submit">Book</button>' +
      '<p>Workshops run monthly in the community space.</p><img src="/wp-content/uploads/booking.jpg" alt="Workshop"></form>',
    editorial: 'Workshops run monthly in the community space.'
  },
  {
    feature: 'authentication',
    markup: '<form id="loginform" action="/wp-login.php" method="post"><label>Username</label><input name="log">' +
      '<label>Password</label><input type="password" name="pwd"><input type="hidden" name="_wpnonce" value="' + NONCE_A + '">' +
      '<button type="submit">Log in</button></form>',
    editorial: null
  },
  {
    feature: 'checkout',
    markup: '<form class="checkout woocommerce-checkout" action="/checkout/" method="post"><input type="hidden" name="cart_token" value="' + NONCE_A + '">' +
      '<label>Card number</label><input name="card" autocomplete="cc-number"><select name="expiry"><option>01</option></select>' +
      '<button type="submit">Pay</button><img src="/wp-content/uploads/merch.jpg" alt="Merch"></form>',
    editorial: null
  }
];

for (const formCase of FORM_CASES) {
  test('an unsupported ' + formCase.feature + ' form is removed without leaking controls or tokens', () => {
    const html = '<p>Before the form: editorial introduction for visitors.</p>' + formCase.markup + '<p>After the form: editorial conclusion.</p>';
    const document = normalize(html);
    assertNoUnsupportedFormMarkup(document);
    assert.equal(JSON.stringify(document).includes(NONCE_A), false);
    assert.equal(document.body.text.includes('Before the form: editorial introduction'), true);
    assert.equal(document.body.text.includes('After the form: editorial conclusion'), true);
    if (formCase.editorial) {
      assert.equal(document.body.text.includes(formCase.editorial), true);
      assert.ok(document.warnings.some((entry) => entry.code === 'UNSUPPORTED_INTERACTIVE_CONTENT'));
    }
    assert.equal(document.unsupported.some((entry) => entry.code === 'UNSUPPORTED_INTERACTIVE_CONTENT' && entry.review === 'manual'), true);
    assertContentDocument(document, { verifyHash: true, baseUrl: SITE });
  });
}

test('hidden fields, CSRF nonces and rotating tokens cannot change the canonical hash', () => {
  const first = normalize(donationPage(NONCE_A));
  const second = normalize(donationPage(NONCE_B));
  assert.notEqual(NONCE_A, NONCE_B);
  assert.equal(first.content_hash, second.content_hash);
  assert.equal(first.body.hash, second.body.hash);
  const third = normalize(donationPage(NONCE_A));
  assert.equal(first.content_hash, third.content_hash);
  assert.equal(first.body.html, third.body.html);
});

test('a real editorial change inside a salvaged form region changes the hash', () => {
  const first = normalize(donationPage(NONCE_A, 'Your gift funds local workshops.'));
  const second = normalize(donationPage(NONCE_A, 'Your gift funds international workshops.'));
  assert.notEqual(first.content_hash, second.content_hash);
  assert.notEqual(first.body.hash, second.body.hash);
});

test('JWT form tokens in hidden inputs and text never reach the document', () => {
  const html = [
    '<p>Members can manage their own subscription details.</p>',
    '<form action="/wp/wp-admin/admin-post.php" method="post">',
    '<input type="hidden" name="jetpack_form_jwt" value="' + TOKEN_A + '">',
    '<p>Account token: ' + TOKEN_B + '</p>',
    '<label>Email</label><input name="email"><button>Continue</button>',
    '<p>Contact the membership team for help.</p>',
    '</form>'
  ].join('');
  const document = normalize(html);
  assertNoUnsupportedFormMarkup(document);
  assert.equal(JSON.stringify(document).includes(TOKEN_A), false);
  assert.equal(JSON.stringify(document).includes(TOKEN_B), false);
  assert.equal(document.body.text.includes('Members can manage their own subscription details.'), true);
  assert.equal(document.body.text.includes('Contact the membership team for help.'), true);
  assert.ok(document.warnings.some((entry) => entry.code === 'VOLATILE_TOKEN_REMOVED'));
  assert.equal(document.body.html.includes('[redacted-token]'), true);
});

test('a nested form, a formaction attribute and an admin-post link leave no submission endpoint', () => {
  const html = [
    '<div class="entry-content">',
    '<p>Our volunteer programme welcomes new members each spring.</p>',
    '<form action="/apply/" method="post" class="volunteer-form">',
    '<form action="/wp/wp-admin/admin-post.php?action=apply"><input type="hidden" name="nonce" value="' + NONCE_A + '"></form>',
    '<p>Read the <a href="/volunteer-guide/">volunteer guide</a>.</p>',
    '<p>Older applications used <a href="https://wordpressfoundation.org/wp/wp-admin/admin-post.php?action=apply">this form</a>.</p>',
    '<img src="/wp-content/uploads/volunteers.jpg" alt="Volunteers">',
    '<button formaction="/wp/wp-admin/admin-post.php">Apply</button>',
    '</form></div>'
  ].join('');
  const document = normalize(html);
  assertNoUnsupportedFormMarkup(document);
  assert.equal(document.body.html.includes('admin-post'), false);
  assert.equal(document.body.text.includes('Our volunteer programme welcomes new members each spring.'), true);
  assert.equal(document.body.html.includes('href="/volunteer-guide/"'), true);
  assert.equal(document.body.html.includes('/wp-content/uploads/volunteers.jpg'), true);
  assert.equal(document.body.html.includes('Apply'), false);
});

test('a form that only wraps controls is removed without leaving an empty interaction shell', () => {
  const html = '<p>Editorial paragraph before the widget.</p>' +
    '<form action="/wp/wp-admin/admin-post.php"><input type="text" name="q"><button>Go</button></form>' +
    '<p>Editorial paragraph after the widget.</p>';
  const document = normalize(html);
  assertNoUnsupportedFormMarkup(document);
  assert.equal(document.body.text.includes('Editorial paragraph before the widget.'), true);
  assert.equal(document.body.text.includes('Editorial paragraph after the widget.'), true);
  assert.equal(document.warnings.some((entry) => entry.code === 'UNSUPPORTED_INTERACTIVE_CONTENT'), true);
});

test('the canonical publication payload for a generic form page has no form functionality', () => {
  const document = normalize(donationPage(NONCE_A));
  const bytes = renderContentPayload({
    document,
    mediaByUrl: new Map(),
    resource: { service: 'DOCUMENT', name: 'FoundationSite', identifier: 'donate-page' },
    publishedAt: '2026-01-01T00:00:00.000Z'
  });
  const payload = JSON.parse(bytes.toString('utf8'));
  assert.equal(payload.schema, 'qms-qdn-content@1');
  assert.equal(CONTROL_TAGS.test(payload.body.html), false);
  assert.equal(SUBMISSION_MARKERS.test(payload.body.html), false);
  assert.equal(JSON.stringify(payload).includes(NONCE_A), false);
  assert.equal(payload.body.html.includes('Your gift funds workshops'), true);
  assert.equal(payload.body.html.includes('/wp-content/uploads/donate-community.jpg'), true);
});

test('a Jetpack contact form keeps its media but never its form, scripts or JWT', () => {
  const html = '<p>Questions before getting in touch: <a href="/about/">about WordPress</a>.</p>' +
    '<div id="contact-form-108" class="jetpack-contact-form-container" data-wp-interactive="jetpack/form">' +
    '<img src="/wp-content/uploads/plugin-gallery.jpg" alt="Plugin gallery">' +
    '<form action="https://wordpressfoundation.org/contact/" class="contact-form" data-wp-on--submit="actions.onFormSubmit">' +
    '<input type="hidden" name="jetpack_contact_form_jwt" value="' + TOKEN_A + '">' +
    '<label>Name</label><input name="name"><textarea name="message"></textarea><button>Send</button></form></div>' +
    '<script>window.jetpackContactForm = true;</script>' +
    '<p>Kind regards, the WordPress Foundation.</p>';
  const document = normalize(html);
  assertNoUnsupportedFormMarkup(document);
  assert.equal(document.body.html.includes('/wp-content/uploads/plugin-gallery.jpg'), true);
  assert.equal(document.body.html.includes(TOKEN_A), false);
  assert.equal(document.body.html.includes('data-wp-'), false);
  assert.equal(document.body.html.includes('<script'), false);
  assert.ok(document.warnings.some((entry) => entry.code === 'UNSUPPORTED_INTERACTIVE_CONTENT' && entry.details.feature === 'contact_form' && entry.details.provider === 'jetpack'));
  assertContentDocument(document, { verifyHash: true, baseUrl: SITE });
});
