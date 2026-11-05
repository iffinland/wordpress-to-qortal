import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { artifactName } from './lib.mjs';
import { stripPinnedRegistryIdentity } from './identity-scrub.mjs';

/**
 * The three production artifacts every QMS release must ship. The names are
 * user-facing download names and must not change without a README/docs update.
 */
export const REQUIRED_ARTIFACT_KINDS = ['deb', 'publisher', 'cms'];

export const ARTIFACT_LABELS = {
  deb: 'Qortal Migration Studio (Linux .deb)',
  publisher: 'Migration Publisher (Q-App ZIP)',
  cms: 'Generic CMS (Q-App ZIP)'
};

export const ARTIFACT_COMPONENTS = Object.freeze({ deb: 'desktop', publisher: 'publisher', cms: 'cms' });

export const QAPP_LIMIT_BYTES = 20 * 1024 * 1024;

/** Component versions are independent of the GitHub release bundle version. */
export function componentVersion(release, kind) {
  const component = ARTIFACT_COMPONENTS[kind];
  return release?.components?.[component]?.version ?? release.version;
}

export function releaseArtifactPaths(repoRoot, release) {
  const desktopVersion = componentVersion(release, 'deb');
  const publisherVersion = componentVersion(release, 'publisher');
  const cmsVersion = componentVersion(release, 'cms');
  return {
    deb: path.join(
      repoRoot,
      'desktop/release',
      artifactName('qortal-migration-studio', desktopVersion, release.architecture)
    ),
    publisher: path.join(
      repoRoot,
      'release',
      'qortal-migration-publisher-v' + publisherVersion + '.zip'
    ),
    cms: path.join(
      repoRoot,
      'release',
      'qortal-migration-generic-cms-v' + cmsVersion + '.zip'
    )
  };
}

function fail(errors, message) {
  errors.push(message);
}

function relativeRefs(html) {
  const refs = [];
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    const value = match[1];
    if (!value || value.startsWith('#') || /^(?:https?:|data:|mailto:|tel:|blob:)/i.test(value)) continue;
    refs.push(value);
  }
  return refs;
}

function decodeText(bytes) {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

const FORBIDDEN_PATH_PATTERNS = [
  { pattern: /\.map$/i, message: 'source map' },
  { pattern: /(^|\/)node_modules\//, message: 'node_modules' },
  { pattern: /(^|\/)\.git\//, message: '.git metadata' },
  { pattern: /(^|\/)(?:fixtures?|tests?|test-support)\//, message: 'development fixtures or tests' },
  { pattern: /(^|\/)profiles\//, message: 'developer profile data' },
  { pattern: /(^|\/)\.env(?:\.|$)/, message: 'environment file' },
  { pattern: /\.(?:ts|tsx|vue|svelte|scss|sass|less)$/i, message: 'development source file' },
  { pattern: /(^|\/)package(?:-lock)?\.json$/, message: 'development package metadata' }
];

const FORBIDDEN_CONTENT_MARKERS = [
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, message: 'private key material' },
  { pattern: /gh[pousr]_[A-Za-z0-9]{20,}/, message: 'GitHub token' },
  { pattern: /(?:QORTAL_[A-Z_]*KEY|WORDPRESS_(?:APP_)?PASSWORD|WALLET_PASSWORD)\s*=\s*[^\s"']+/, message: 'credential assignment' },
  { pattern: /developer iffi/i, message: 'hardcoded developer identity' },
  { pattern: /corbettreport/i, message: 'hardcoded Corbett Report profile identity' },
  { pattern: /Corbett Report/, message: 'hardcoded Corbett Report identity' }
];

function inspectEntries(entries, kind, version) {
  const errors = [];
  const names = Object.keys(entries).sort();
  if (names.length === 0) fail(errors, 'ZIP is empty.');
  const hasRootIndex = names.includes('index.html');
  if (!hasRootIndex) {
    const nested = names.find((name) => /^[^/]+\/index\.html$/.test(name));
    fail(errors, nested
      ? 'index.html is nested under a parent directory (' + nested + '); Q-App assets must be at the ZIP root.'
      : 'ZIP has no root index.html entry point.');
  }
  for (const name of names) {
    if (name.startsWith('/') || name.includes('..')) fail(errors, 'Unsafe ZIP entry path: ' + name);
    for (const rule of FORBIDDEN_PATH_PATTERNS) {
      if (rule.pattern.test(name)) fail(errors, 'ZIP contains ' + rule.message + ': ' + name);
    }
  }
  const totalBytes = names.reduce((sum, name) => sum + entries[name].length, 0);
  if (totalBytes > QAPP_LIMIT_BYTES) fail(errors, 'ZIP exceeds ' + QAPP_LIMIT_BYTES + ' bytes.');

  let html = '';
  if (hasRootIndex) {
    html = decodeText(entries['index.html']);
    if (!/<div id="root"><\/div>/.test(html)) fail(errors, 'index.html does not contain the React root element.');
    const refs = relativeRefs(html);
    for (const ref of refs) {
      if (!ref.startsWith('./')) {
        fail(errors, 'index.html references a non-relative asset: ' + ref);
        continue;
      }
      const target = ref.slice(2).split(/[?#]/)[0];
      if (!Object.prototype.hasOwnProperty.call(entries, target)) {
        fail(errors, 'index.html references a missing asset: ' + ref);
      }
    }
    if (refs.length === 0) fail(errors, 'index.html has no relative application assets.');
  }

  const scripts = names.filter((name) => name.endsWith('.js'));
  if (scripts.length === 0) fail(errors, 'ZIP contains no JavaScript bundle.');
  const text = [html, ...scripts.map((name) => decodeText(entries[name]))].join('\n');
  const scanText = stripPinnedRegistryIdentity(text);

  for (const rule of FORBIDDEN_CONTENT_MARKERS) {
    if (rule.pattern.test(scanText)) fail(errors, 'Bundle contains ' + rule.message + '.');
  }
  if (!text.includes(version)) fail(errors, 'Bundle does not carry the release version ' + version + '.');
  if (kind === 'publisher') {
    if (!/<title>[^<]*Migration Publisher[^<]*<\/title>/i.test(html)) {
      fail(errors, 'Publisher index.html has no Migration Publisher title.');
    }
    if (!text.includes('qms-publication-handoff@1')) fail(errors, 'Publisher bundle is missing qms-publication-handoff@1.');
    if (!text.includes('qms-publication-receipt@1')) fail(errors, 'Publisher bundle is missing qms-publication-receipt@1.');
    if (!text.includes('qms-cms-bundle@1')) fail(errors, 'Publisher bundle is missing qms-cms-bundle@1.');
    if (/window\.(?:parent|top)\.qortalRequest/.test(text)) fail(errors, 'Publisher assumes a parent/top frame bridge.');
  }
  if (kind === 'cms') {
    if (!text.includes('qms-cms-template-config@1')) fail(errors, 'Generic CMS bundle is missing qms-cms-template-config@1.');
    if (!text.includes('qms-cms-manifest@1')) fail(errors, 'Generic CMS bundle is missing qms-cms-manifest@1.');
    if (!text.includes('qms-qdn-manifest@1')) fail(errors, 'Generic CMS bundle is missing qms-qdn-manifest@1.');
  }

  return { errors, files: names, bytes: totalBytes, sha256: null };
}

export async function inspectQappZip(file, { kind, version }) {
  const body = await readFile(file);
  let entries;
  try {
    entries = unzipSync(new Uint8Array(body));
  } catch (error) {
    return { ok: false, errors: ['ZIP cannot be read: ' + error.message], files: [], bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
  }
  const result = inspectEntries(entries, kind, version);
  result.sha256 = createHash('sha256').update(body).digest('hex');
  result.ok = result.errors.length === 0;
  return result;
}

export async function sha256OfFile(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

export async function fileSize(file) {
  return (await stat(file)).size;
}
