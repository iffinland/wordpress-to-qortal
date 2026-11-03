import test from 'node:test';
import assert from 'node:assert/strict';
import { WordPressClient } from '../../lib/source/wordpress/client.js';

test('application-password authentication sends the exact Basic header and never exposes the secret', () => {
  const client = new WordPressClient({
    baseUrl: 'https://wordpress.example.test',
    auth: { mode: 'application_password', username: 'fixture-user', appPassword: 'fixture app password' }
  });
  const headers = client._headers();
  assert.equal(headers.Authorization, 'Basic ' + Buffer.from('fixture-user:fixture app password').toString('base64'));
  assert.ok(headers.Authorization.startsWith('Basic '));
  const summary = client.authSummary();
  assert.equal(summary.mode, 'application_password');
  assert.equal(summary.authenticated, true);
  assert.equal(JSON.stringify(summary).includes('fixture app password'), false);
});
