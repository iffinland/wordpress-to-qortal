import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
export const TEMPLATE_ROOT = path.join(REPO_ROOT, 'templates', 'generic-cms');
export const FIXTURES_ROOT = path.join(TEMPLATE_ROOT, 'fixtures');

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function readTemplateJson(relativePath) {
  return readJson(path.join(FIXTURES_ROOT, relativePath));
}

export async function readRepoJson(relativePath) {
  return readJson(path.join(REPO_ROOT, relativePath));
}

export async function loadFixtureManifest(relativePath) {
  const raw = await readTemplateJson(relativePath);
  const byIdentifier = raw.resources && raw.resources.by_identifier ? raw.resources.by_identifier : {};
  async function fetchRef(ref) {
    const entry = byIdentifier[ref.identifier];
    if (!entry || !entry.local_path) {
      throw new Error('Fixture has no local_path for ' + ref.identifier);
    }
    return readTemplateJson(path.join(entry.local_path.split('/').join(path.sep)));
  }
  return { raw, fetchRef, byIdentifier, byPath: raw.resources ? raw.resources.by_path || {} : {} };
}

export async function corbettSiteDefaults() {
  const profile = await readRepoJson('profiles/corbettreport/profile.json');
  return {
    id: profile.id,
    title: profile.cms_site_title,
    tagline: profile.cms_tagline,
    ownerName: profile.qortal_site_name,
    publicAuthor: profile.public_author_name
  };
}

export function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    }
  };
}
