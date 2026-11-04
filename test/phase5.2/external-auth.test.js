import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ExternalAuthSigningBackend,
  classifyExternalAuthError
} from '../../broker/src/signing/external-auth.js';
import { OWNER, makeResource } from './support/harness.js';

const TOKEN = 'test-bearer-token-0123456789abcdef';
const FEE_ATOMIC = 1000000; // 0.01 QORT

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

function publish(ctx, overrides = {}) {
  return ctx.backend.publish({
    service: 'DOCUMENT',
    name: 'developer iffi',
    identifier: 'qms-dev-test',
    dataBase64: 'eA==',
    feeAtomic: FEE_ATOMIC,
    ...overrides
  });
}

test('sends the reserved atomic fee unchanged and calls exactly /qdn/publish', async () => {
  const ctx = setup();
  try {
    await ctx.backend.open();
    const resource = makeResource();
    const outcome = await ctx.backend.publish({
      service: 'DOCUMENT',
      name: 'developer iffi',
      identifier: resource.identifier,
      dataBase64: resource.dataBase64,
      feeAtomic: FEE_ATOMIC
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
    // Core binds /arbitrary?fee= to a Java Long in atomic units. A QORT
    // decimal such as 0.01 fails Core parameter binding.
    assert.equal(body.fee, FEE_ATOMIC);
    assert.equal(Number.isSafeInteger(body.fee), true);
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
      const outcome = await publish(ctx);
      assert.equal(outcome.state, 'ambiguous');
      assert.equal(ctx.calls.length, 1);
      if (options.status === 500) {
        assert.equal(outcome.code, 'SIGNING_BACKEND_UNAVAILABLE');
        assert.deepEqual(outcome.diagnostic, {
          httpStatus: 500,
          errorClass: 'BACKEND',
          errorCode: 'UNKNOWN'
        });
      }
    } finally {
      cleanup(ctx.dir);
    }
  }
});

test('maps authorization rejection, client failure and missing receipts', async () => {
  const rejected = setup({ status: 403, result: { error: 'approval_required' } });
  try {
    await rejected.backend.open();
    const outcome = await publish(rejected);
    assert.equal(outcome.state, 'rejected');
    assert.equal(outcome.code, 'SIGNING_APPROVAL_REQUIRED');
    assert.deepEqual(outcome.diagnostic, {
      httpStatus: 403,
      errorClass: 'AUTH',
      errorCode: 'APPROVAL_REQUIRED'
    });
  } finally { cleanup(rejected.dir); }

  const locked = setup({ status: 403, result: { error: 'wallet_locked' } });
  try {
    await locked.backend.open();
    const outcome = await publish(locked);
    assert.equal(outcome.state, 'rejected');
    assert.equal(outcome.code, 'SIGNING_REJECTED');
    assert.equal(outcome.diagnostic.httpStatus, 403);
    assert.equal(outcome.diagnostic.errorCode, 'WALLET_LOCKED');
  } finally { cleanup(locked.dir); }

  const unauthorized = setup({ status: 401, result: { error: 'unauthorized' } });
  try {
    await unauthorized.backend.open();
    const outcome = await publish(unauthorized);
    assert.equal(outcome.state, 'rejected');
    assert.equal(outcome.code, 'SIGNING_REJECTED');
    assert.equal(outcome.diagnostic.httpStatus, 401);
    assert.equal(outcome.diagnostic.errorCode, 'UNAUTHORIZED');
  } finally { cleanup(unauthorized.dir); }

  const failed = setup({ status: 400, result: { error: 'wallet_not_found' } });
  try {
    await failed.backend.open();
    const outcome = await publish(failed);
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.code, 'SIGNING_FAILED');
    assert.deepEqual(outcome.diagnostic, {
      httpStatus: 400,
      errorClass: 'REQUEST',
      errorCode: 'WALLET_NOT_FOUND'
    });
  } finally { cleanup(failed.dir); }

  const missing = setup({ result: { creatorAddress: OWNER } });
  try {
    await missing.backend.open();
    const outcome = await publish(missing);
    assert.equal(outcome.state, 'ambiguous');
    assert.equal(outcome.code, 'SIGNING_RECEIPT_MISSING');
  } finally { cleanup(missing.dir); }

  const wrongSigner = setup({ result: { signature: 'sig', creatorAddress: 'Qaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } });
  try {
    await wrongSigner.backend.open();
    const outcome = await publish(wrongSigner);
    assert.equal(outcome.state, 'ambiguous');
    assert.equal(outcome.code, 'SIGNER_MISMATCH');
  } finally { cleanup(wrongSigner.dir); }
});

test('records the 4xx status and a bounded code without storing the backend body', async () => {
  const sensitiveBody = {
    error:
      'Core rejected /arbitrary/DOCUMENT/developer iffi/base64?fee=0.01 ' +
      'authorization=Bearer eyJhbGciOiJIUzI1NiJ9.secret ' +
      'seed="abandon ability able about above absent absorb abstract absurd abuse access accident" ' +
      'privateKey=0f0e0d0c cookie=session%3Dabc'
  };
  const ctx = setup({ status: 400, result: sensitiveBody });
  try {
    await ctx.backend.open();
    const outcome = await publish(ctx);
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.code, 'SIGNING_FAILED');
    assert.deepEqual(outcome.diagnostic, {
      httpStatus: 400,
      errorClass: 'REQUEST',
      errorCode: 'CORE_REQUEST_REJECTED'
    });
    const serialized = JSON.stringify(outcome);
    for (const secret of ['eyJhbGciOiJIUzI1NiJ9', 'abandon ability', 'privateKey', 'cookie', 'developer iffi']) {
      assert.equal(serialized.includes(secret), false, 'leaked: ' + secret);
    }
  } finally {
    cleanup(ctx.dir);
  }
});

test('classifies known and unknown External Auth error bodies safely', () => {
  for (const [body, expected] of [
    [{ error: 'unauthorized' }, 'UNAUTHORIZED'],
    [{ error: 'approval_required' }, 'APPROVAL_REQUIRED'],
    [{ error: 'wallet_locked' }, 'WALLET_LOCKED'],
    [{ error: 'wallet_not_found' }, 'WALLET_NOT_FOUND'],
    [{ error: 'publish_failed' }, 'PUBLISH_FAILED'],
    [{ error: 'Name not registered: developer iffi' }, 'CORE_NAME_NOT_REGISTERED'],
    [{ error: 'Request failed: 404' }, 'CORE_HTTP_ERROR'],
    [{ error: '<html>Bad query parameter fee=0.01</html>' }, 'CORE_REQUEST_REJECTED'],
    [{ error: 'arbitrary_long_token_name_with_spaces and /paths' }, 'CORE_REQUEST_REJECTED'],
    [{}, 'UNKNOWN'],
    [null, 'UNKNOWN']
  ]) {
    assert.equal(classifyExternalAuthError(body), expected);
  }
});

test('refuses a non-positive, fractional or non-integer atomic fee before calling the backend', async () => {
  const ctx = setup();
  try {
    await ctx.backend.open();
    for (const fee of [0, -1000000, 0.01, Number.NaN, Number.POSITIVE_INFINITY, '1000000', 1000000.5]) {
      await assert.rejects(
        publish(ctx, { feeAtomic: fee }),
        (error) => error.code === 'FEE_INVALID'
      );
    }
    assert.equal(ctx.calls.length, 0);
  } finally {
    cleanup(ctx.dir);
  }
});

test('refuses to publish a non-DOCUMENT service', async () => {
  const ctx = setup();
  try {
    await ctx.backend.open();
    await assert.rejects(
      publish(ctx, { service: 'IMAGE' }),
      (error) => error.code === 'POLICY_SERVICE'
    );
    assert.equal(ctx.calls.length, 0);
  } finally {
    cleanup(ctx.dir);
  }
});

test('prefers a structured Core diagnostic over the generic error token', async () => {
  const ctx = setup({
    status: 400,
    result: {
      error: 'publish_failed',
      diagnostic: {
        stage: 'upload',
        coreStatus: 401,
        coreErrorCode: 'CORE_API_KEY_MISSING',
        coreMessage: "Missing 'X-API-KEY' header"
      }
    }
  });
  try {
    await ctx.backend.open();
    const outcome = await publish(ctx);
    assert.equal(outcome.state, 'failed');
    assert.equal(outcome.code, 'SIGNING_FAILED');
    assert.deepEqual(outcome.diagnostic, {
      httpStatus: 400,
      errorClass: 'REQUEST',
      errorCode: 'CORE_API_KEY_MISSING',
      stage: 'upload',
      coreStatus: 401,
      coreMessage: "Missing 'X-API-KEY' header"
    });
  } finally {
    cleanup(ctx.dir);
  }
});

test('collapses unknown Core codes and redacts long values in structured messages', async () => {
  const secret = 'Z'.repeat(64);
  const ctx = setup({
    status: 400,
    result: {
      error: 'publish_failed',
      diagnostic: {
        stage: 'process',
        coreStatus: 500,
        coreErrorCode: 'CORE_SOMETHING_NEW',
        coreMessage: 'upstream said ' + secret
      }
    }
  });
  try {
    await ctx.backend.open();
    const outcome = await publish(ctx);
    assert.equal(outcome.diagnostic.errorCode, 'CORE_REQUEST_REJECTED');
    assert.equal(outcome.diagnostic.stage, 'process');
    assert.equal(outcome.diagnostic.coreStatus, 500);
    assert.equal(outcome.diagnostic.coreMessage, 'upstream said [redacted]');
    assert.equal(JSON.stringify(outcome).includes(secret), false);
  } finally {
    cleanup(ctx.dir);
  }
});

test('drops malformed structured diagnostics instead of trusting them', async () => {
  const ctx = setup({
    status: 400,
    result: {
      error: 'publish_failed',
      diagnostic: {
        stage: 'DROP TABLE',
        coreStatus: 9999,
        coreErrorCode: 'not-a-core-code',
        coreMessage: 'x'.repeat(5000)
      }
    }
  });
  try {
    await ctx.backend.open();
    const outcome = await publish(ctx);
    assert.deepEqual(outcome.diagnostic, {
      httpStatus: 400,
      errorClass: 'REQUEST',
      errorCode: 'CORE_REQUEST_REJECTED'
    });
  } finally {
    cleanup(ctx.dir);
  }
});
