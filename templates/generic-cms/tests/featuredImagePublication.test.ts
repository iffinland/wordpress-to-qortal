import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishMediaFile } from '../src/lib/publish.js';
import { ownerIdentity } from './support/fixtures';

const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const expectedBase64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));

function installBridge(options: { rejectPublish?: boolean; rejectFetch?: boolean } = {}) {
  const calls: any[] = [];
  (window as any).qortalRequest = vi.fn(async (payload: any) => {
    calls.push(payload);
    switch (payload.action) {
      case 'GET_USER_ACCOUNT':
        return { address: ownerIdentity.address };
      case 'GET_ACCOUNT_NAMES':
        return [{ name: 'QortalDemo' }];
      case 'GET_PRIMARY_NAME':
        return 'QortalDemo';
      case 'GET_QDN_RESOURCE_STATUS':
        return { status: 'NOT_FOUND' };
      case 'PUBLISH_QDN_RESOURCE':
        if (options.rejectPublish) throw new Error('connection reset');
        return { signature: 'test-signature' };
      case 'FETCH_QDN_RESOURCE':
        if (options.rejectFetch) throw new Error('not confirmed yet');
        return expectedBase64;
      default:
        return null;
    }
  });
  return calls;
}

function stubRegistry() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/names/')) {
      return { ok: true, status: 200, json: async () => ({ name: 'QortalDemo', owner: ownerIdentity.address }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }));
}

beforeEach(() => {
  stubRegistry();
  localStorage.clear();
});

afterEach(() => {
  delete (window as any).qortalRequest;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('featured image publication after Android file access is lost', () => {
  it('publishes captured bytes and never reads the original File again', async () => {
    const calls = installBridge();
    const file = {
      name: 'cover.jpg',
      type: 'image/jpeg',
      size: bytes.length,
      arrayBuffer: vi.fn(async () => {
        throw new Error('The requested file could not be read, typically due to permission problems that have occurred after a reference to a file was acquired.');
      })
    } as unknown as File;

    const result = await publishMediaFile({
      identity: ownerIdentity,
      name: 'QortalDemo',
      file,
      bytes,
      filename: 'cover.jpg',
      mimeType: 'image/jpeg',
      title: 'Android featured image',
      storage: localStorage
    });

    expect(result.ok).toBe(true);
    expect(file.arrayBuffer).not.toHaveBeenCalled();
    const publish = calls.find((entry) => entry.action === 'PUBLISH_QDN_RESOURCE');
    expect(publish).toBeTruthy();
    expect(publish.service).toBe('IMAGE');
    expect(publish.data64).toBe(expectedBase64);
    expect(publish.file).toBeUndefined();
    expect(publish.filename).toBe('cover.jpg');
  });

  it('still reads a File once at entry when a caller could not capture bytes', async () => {
    const calls = installBridge();
    const file = {
      name: 'cover.png',
      type: 'image/png',
      size: bytes.length,
      arrayBuffer: vi.fn(async () => bytes.buffer.slice(0))
    } as unknown as File;

    const result = await publishMediaFile({
      identity: ownerIdentity,
      name: 'QortalDemo',
      file,
      filename: 'cover.png',
      mimeType: 'image/png',
      storage: localStorage
    });

    expect(result.ok).toBe(true);
    expect(file.arrayBuffer).toHaveBeenCalledTimes(1);
    const publish = calls.find((entry) => entry.action === 'PUBLISH_QDN_RESOURCE');
    expect(publish.data64).toBe(expectedBase64);
    expect(publish.file).toBeUndefined();
  });

  it('fails safely without publishing when no bytes can be read', async () => {
    const calls = installBridge();
    const file = {
      name: 'cover.jpg',
      type: 'image/jpeg',
      size: bytes.length,
      arrayBuffer: vi.fn(async () => {
        throw new Error('The requested file could not be read.');
      })
    } as unknown as File;

    const result = await publishMediaFile({
      identity: ownerIdentity,
      name: 'QortalDemo',
      file,
      filename: 'cover.jpg',
      mimeType: 'image/jpeg',
      storage: localStorage
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/could not be read/);
    expect(calls.some((entry) => entry.action === 'PUBLISH_QDN_RESOURCE')).toBe(false);
  });

  it('does not automatically resend an ambiguous submission on retry', async () => {
    const calls = installBridge({ rejectPublish: true });

    const first = await publishMediaFile({
      identity: ownerIdentity,
      name: 'QortalDemo',
      bytes,
      filename: 'cover.jpg',
      mimeType: 'image/jpeg',
      storage: localStorage,
      maxExactVerifyBytes: 0
    });
    expect(first.ok).toBe(false);
    expect(first.state).toBe('ambiguous');

    const retry = await publishMediaFile({
      identity: ownerIdentity,
      name: 'QortalDemo',
      bytes,
      filename: 'cover.jpg',
      mimeType: 'image/jpeg',
      storage: localStorage,
      maxExactVerifyBytes: 0
    });
    expect(retry.ok).toBe(false);
    expect(retry.state).toBe('ambiguous');
    expect(calls.filter((entry) => entry.action === 'PUBLISH_QDN_RESOURCE')).toHaveLength(1);
  });
});
