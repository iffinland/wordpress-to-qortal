import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCmsDataset, normalizeContentPayload } from '../../src/lib/manifest.js';
import type { CmsContentItem, CmsDataset, LoadedContent, ViewerIdentity } from '../../src/types';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.resolve(HERE, '..', '..', 'fixtures');

export function readFixture(relativePath: string): unknown {
  return JSON.parse(readFileSync(path.join(FIXTURES, relativePath), 'utf8'));
}

export async function loadFixture(relativePath = 'qms-cms-manifest.json') {
  const raw = readFixture(relativePath) as {
    resources?: { by_identifier?: Record<string, { local_path?: string }> };
  };
  const byIdentifier = raw.resources && raw.resources.by_identifier ? raw.resources.by_identifier : {};
  const fetchRef = async (ref: { identifier: string }) => {
    const entry = byIdentifier[ref.identifier];
    if (!entry || !entry.local_path) throw new Error('Fixture has no local_path for ' + ref.identifier);
    return readFixture(entry.local_path);
  };
  const dataset = await loadCmsDataset(raw, {
    fetchRef,
    now: Date.parse('2026-11-04T12:00:00.000Z'),
    staleAfterMs: 3650 * 24 * 60 * 60 * 1000
  }) as CmsDataset;
  return { raw, fetchRef, dataset };
}

export async function loadFixtureContent(item: CmsContentItem): Promise<LoadedContent> {
  const fixture = await loadFixture();
  const payload = await fixture.fetchRef(item.contentRef as { identifier: string });
  return normalizeContentPayload(payload, item) as LoadedContent;
}

export const ownerIdentity: ViewerIdentity = {
  role: 'owner',
  owner: true,
  address: 'QOwnerAddress111111111111111111111',
  name: 'QortalDemo',
  names: ['QortalDemo'],
  qdnName: 'QortalDemo',
  bridgeAvailable: true,
  nameRecordStatus: 'verified',
  reason: 'name-record-verified',
  message: 'Owner mode is enabled. QortalDemo is owned by the signed-in account.'
};

export const readerIdentity: ViewerIdentity = {
  role: 'reader',
  owner: false,
  address: 'QReaderAddress1111111111111111111',
  name: '',
  names: [],
  qdnName: 'QortalDemo',
  bridgeAvailable: true,
  nameRecordStatus: 'mismatch',
  reason: 'name-not-owned',
  message: 'The signed-in account does not own QortalDemo. This site is read-only.'
};
