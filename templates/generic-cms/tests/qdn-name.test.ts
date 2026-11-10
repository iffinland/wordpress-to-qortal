import { describe, expect, it } from 'vitest';
import { safeDecodeQdnName, createQdnResourcePath, discoverHostedQdnResource, discoverQdnName } from '../src/lib/qortal.js';

describe('QDN name decoding', () => {
  it('decodes single percent-encoding', () => {
    expect(safeDecodeQdnName('developer%20iffi')).toBe('developer iffi');
  });

  it('decodes double percent-encoding (Qortal Hub global)', () => {
    expect(safeDecodeQdnName('developer%2520iffi')).toBe('developer iffi');
  });

  it('treats plus as a space', () => {
    expect(safeDecodeQdnName('developer+iffi')).toBe('developer iffi');
  });

  it('keeps plain names intact and trims', () => {
    expect(safeDecodeQdnName(' developer iffi ')).toBe('developer iffi');
    expect(safeDecodeQdnName('')).toBe('');
    expect(safeDecodeQdnName(undefined as unknown as string)).toBe('');
  });

  it('survives malformed sequences without throwing', () => {
    expect(safeDecodeQdnName('100%')).toBe('100%');
  });

  it('never double-encodes when building a resource URL', () => {
    const url = createQdnResourcePath('DOCUMENT', safeDecodeQdnName('developer%2520iffi'), 'qms-cms-manifest');
    expect(url).toBe('/arbitrary/DOCUMENT/developer%20iffi/qms-cms-manifest');
    expect(url).not.toContain('%2520');
  });

  it('resolves the name from the Qortal Hub hosting global', () => {
    (globalThis as any).window = {
      location: { search: '', pathname: '/', hash: '' },
      _qdnName: 'developer%20iffi'
    };
    expect(discoverQdnName('Qortal')).toBe('developer iffi');
  });

  it('does not let a visitor query string override the hosted APP triple', () => {
    (globalThis as any).window = {
      location: { search: '?name=developer%20iffi&identifier=foreign', pathname: '/arbitrary/APP/NASA-Official/qms-nasa', hash: '' },
      _qdnName: 'NASA-Official',
      _qdnService: 'APP',
      _qdnIdentifier: 'qms-nasa'
    };
    expect(discoverHostedQdnResource({ name: 'fallback', identifier: 'default' })).toEqual({
      name: 'NASA-Official', service: 'APP', identifier: 'qms-nasa'
    });
  });
});
