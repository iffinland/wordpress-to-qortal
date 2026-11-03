import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExternalAuthSigningBackend } from '../../broker/src/signing/external-auth.js';
import { OWNER, makeResource } from './support/harness.js';

const TOKEN = 'test-bearer-token-0123456789abcdef';

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() { return typeof body === 'string' ? body : JSON.stringify(body); }
  };
}

function setup({ result = { signature: 'MockSignatureA', creatorAddress: OWNER }, status = 200, throwError = false, mode = 0o600 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qms-extauth-'));
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, TOKEN + '\n');
  chmodSync(tokenFile, mode);
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (throwError) throw new Error('connection refused');
    return response(status, status === 200 ? { result } : result);
  };
  const backend = new ExternalAuthSigningBackend({
    baseUrl: 'http://127.0.0.1:3191',
    walletId: 'wallet-test-id',
    tokenFile,
    timeoutMs: 5000,
    expectedAddress: OWNER,
    fetchImpl
  });
  return { dir, tokenFile, calls, backend };
}

function cleanup(dir) {
  rmSync(dir, { recursive: true, force: true });
}

test('calls exactly /qdn/publish with a fixed wallet and no caller node URL', async () => {
  const ctx = setup();
  try {
    await ctx.backend.open();
    const resource = makeResource();
    const outcome = await ctx.backend.publish({
      service: 'DOCUMENT',
      name: 'developer iffi',
      identifier: resource.identifier,
      dataBase64: resource.dataBase64,
      feePerTransaction: 0.001
    });
    assert.equal(outcome.state, 'signed');
    assert.equal(outcome.address, OWNER);
    assert.equal(ctx.calls.length, 1);
    assert.equal(ctx.calls[0].url, 'http://127.0.0.1:3191/qdn/publish');
    assert.equal(ctx.calls[0].init.method, 'POST');
    assert.equal(ctx.calls[0].init.redirect, 'error');
    assert.equal(ctx.calls[0].init.headers.authorization, 'Bearer ' + TOKEN);
    const body = JSON.parse(ctx.calls[0].init.body);
    assert.deepEqual(Object.keys(body).sort(), ['data', 'fee', 'identifier', 'registeredName', 'service', 'walletId']);
    assert.equal(body.walletId, 'wallet-test-id');
    assert.equal(body.service, 'DOCUMENT');
    assert.equal(body.registeredName, 'developer iffi');
    assert.equal(body.identifier, resource.identifier);
    assert.equal(body.data, resource.dataBase64);
    assert.equal(body.fee, 0.001);
    assert.equal(body.nodeUrl, undefined);
    assert.equal(body.password, undefined);
    assert.equal(ctx.calls[0].url.includes('/tx/sign'), false);
  } finally {
    cleanup(ctx.dir);
  }
});

test('refuses a token file readable by other users', async () => {
  const ctx = setup({ mode: 0o644 });
  try {
    await assert.rejects(ctx.backend.open(), (error) => error.code === 'UNAVAILABLE');
  } finally {
    cleanup(ctx.dir);
  }
});

test('treats transport failures and server errors as ambiguous and never retries', async () => {
  for (const options of [{ throwError: true }, { status: 500 }]) {
    const ctx = setup(options);
    try {
      await ctx.backend.open();
      const outcome = await ctx.backend.publish({
        service: 'DOCUMENT',
        name: 'developer iffi',
        identifier: 'qms-dev-test',
        dataBase64: Buffer.from('x').toString('base64'),
        feePerTransaction: 0.001
      });
      assert.equal(outcome.state, 'ambiguous');
      assert.equal(ctx.calls.length, 1);
    } finally {
      cleanup(ctx.dir);
    }
  }
});

test('maps authorization rejection, client failure and missing receipts', async () => {
  const rejected = setup({ status: 403, result: { error: 'approval_required' } });
  try {
    await rejected.backend.open();
    const outcome = await rejected.backend.publish({
      service: 'DOCUMENT', name: 'developer iffi', identifier: 'qms-dev-test',
      dataBase64: 'eA==', feePerTransaction: 0.001
    });
    assert.equal(outcome.state, 'rejected');
    assert.equal(outcome.code, 'SIGNING_APPROVAL_REQUIRED');
  } finally { cleanup(rejected.dir); }

  const failed = setup({ status: 400, result: { error: 'bad_request' } });
  try {
    await failed.backend.open();
    const outcome = await failed.backend.publish({
      service: 'DOCUMENT', name: 'developer iffi', identifier: 'qms-dev-test',
      dataBase64: 'eA==', feePerTransaction: 0.001
    });
    assert.equal(outcome.state, 'failed');
  } finally { cleanup(failed.dir); }

  const missing = setup({ result: { creatorAddress: OWNER } });
  try {
    await missing.backend.open();
    const outcome = await missing.backend.publish({
      service: 'DOCUMENT', name: 'developer iffi', identifier: 'qms-dev-test',
      dataBase64: 'eA==', feePerTransaction: 0.001
    });
    assert.equal(outcome.state, 'ambiguous');
    assert.equal(outcome.code, 'SIGNING_RECEIPT_MISSING');
  } finally { cleanup(missing.dir); }

  const wrongSigner = setup({ result: { signature: 'sig', creatorAddress: 'Qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
  try {
    await wrongSigner.backend.open();
    const outcome = await wrongSigner.backend.publish({
      service: 'DOCUMENT', name: 'developer iffi', identifier: 'qms-dev-test',
      dataBase64: 'eA==', feePerTransaction: 0.001
    });
    assert.equal(outcome.state, 'ambiguous');
    assert.equal(outcome.code, 'SIGNER_MISMATCH');
  } finally { cleanup(wrongSigner.dir); }
});

test('refuses to publish a non-DOCUMENT service', async () => {
  const ctx = setup();
  try {
    await ctx.backend.open();
    await assert.rejects(
      ctx.backend.publish({ service: 'IMAGE', name: 'developer iffi', identifier: 'qms-dev-test', dataBase64: 'eA==', feePerTransaction: 0.001 }),
      (error) => error.code === 'POLICY_SERVICE'
    );
    assert.equal(ctx.calls.length, 0);
  } finally {
    cleanup(ctx.dir);
  }
});
