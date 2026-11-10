import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { QmsError, ERROR_CODES } from '../errors.js';
import { checkQortalName } from '../qortal-name.js';
import { stableStringify } from '../../model/content.js';
import { stableSiteIdentifier } from './payloads.js';
import {
  BUNDLE_SCHEMA,
  MAX_BUNDLE_BYTES,
  MAX_BUNDLE_FILES,
  bundleMembers,
  normalizeMemberPath,
  sha256Bytes,
  validateBundleBytes,
  zipBundle
} from './bundle.js';

/**
 * Generic CMS deployment bundle.
 *
 * Studio prepares the site configuration and packages the already-built
 * generic CMS Q-App into a deterministic ZIP. The Publisher publishes that ZIP
 * as the QDN APP service (multi-file), so the CMS reads the exact manifest and
 * content resources produced by the same handoff.
 */
export const CMS_BUNDLE_SCHEMA = BUNDLE_SCHEMA;
export const CMS_CONFIG_FILE = 'qms-cms-config.json';
export const CMS_TEMPLATE_ID = 'generic-cms';
export const CMS_TEMPLATE_CONFIG_SCHEMA = 'qms-cms-template-config@1';
export { validateBundleBytes as validateCmsBundleBytes };

function fail(code, message, details) {
  throw new QmsError(code, message, { details });
}

export function resolveCmsTemplateDir(repoRoot) {
  const root = repoRoot ? path.resolve(repoRoot) : null;
  if (!root) fail(ERROR_CODES.PUBLICATION_NOT_READY, 'The application root is unavailable; the CMS template cannot be located.');
  return path.join(root, 'templates', CMS_TEMPLATE_ID, 'dist');
}

async function walkFiles(root, current = '', out = []) {
  const directory = current ? path.join(root, current) : root;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === '.DS_Store' || entry.name === '.git') continue;
    const relative = current ? current + '/' + entry.name : entry.name;
    if (entry.isSymbolicLink()) {
      fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'The CMS template contains a symbolic link: ' + relative);
    }
    if (entry.isDirectory()) {
      await walkFiles(root, relative, out);
    } else if (entry.isFile()) {
      const bytes = await readFile(path.join(root, relative));
      out.push({ path: normalizeMemberPath(relative), bytes });
      if (out.length > MAX_BUNDLE_FILES) {
        fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'The CMS template contains too many files.');
      }
      if (out.reduce((total, file) => total + file.bytes.length, 0) > MAX_BUNDLE_BYTES) {
        fail(ERROR_CODES.PUBLICATION_PACKAGE_CORRUPT, 'The CMS template exceeds the bundle size limit.');
      }
    }
  }
  return out;
}

function safeColor(value, fallback) {
  if (typeof value !== 'string' || value.length > 40) return fallback;
  return /^#(?:[0-9a-f]{3,8})$/i.test(value.trim()) || /^(?:rgb|hsl)a?\([^)]*\)$/i.test(value.trim()) || /^[a-z]+$/i.test(value.trim())
    ? value.trim()
    : fallback;
}

export const DEFAULT_CMS_THEME = Object.freeze({
  colors: Object.freeze({
    background: '#0b0f14',
    surface: '#121820',
    surfaceAlt: '#18212b',
    text: '#e8edf4',
    muted: '#9fb0c3',
    accent: '#4da3ff',
    accentText: '#04121f',
    border: '#263545',
    danger: '#ff7b72',
    warning: '#e3b341'
  }),
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
  radius: '10px',
  maxWidth: '1120px',
  headingFontFamily: 'Georgia, Cambria, Times New Roman, serif'
});

export const DEFAULT_CMS_NAVIGATION = Object.freeze([
  { label: 'Home', href: '#/' },
  { label: 'Posts', href: '#/posts' },
  { label: 'Archive', href: '#/archive' },
  { label: 'Search', href: '#/search' },
  { label: 'Admin', href: '#/admin' }
]);

export function websiteSettings(project) {
  const settings = project?.settings && typeof project.settings === 'object' ? project.settings : {};
  // Early desktop projects persisted the completed wizard as a snapshot but
  // did not copy website settings to the canonical settings.website field.
  // Read that snapshot only when the canonical setting is absent; newer edits
  // must always win over stale wizard state.
  const website = settings.website && typeof settings.website === 'object'
    ? settings.website
    : (settings.desktopWizard && typeof settings.desktopWizard === 'object' && settings.desktopWizard.website && typeof settings.desktopWizard.website === 'object'
      ? settings.desktopWizard.website
      : {});
  return {
    cms: website.cms === undefined ? 'none' : String(website.cms),
    service: website.service === undefined ? 'APP' : String(website.service).toUpperCase(),
    tagline: typeof website.tagline === 'string' ? website.tagline : '',
    publicAuthor: typeof website.publicAuthor === 'string' ? website.publicAuthor : '',
    navigation: Array.isArray(website.navigation) ? website.navigation : null,
    theme: website.theme && typeof website.theme === 'object' ? website.theme : {}
  };
}

export function buildCmsRuntimeConfig({
  project,
  target,
  manifestIdentifier,
  deployment,
  generatedAt = new Date().toISOString()
} = {}) {
  const name = target?.qdnName;
  const checked = checkQortalName(name);
  if (!checked.ok) fail(ERROR_CODES.TARGET_NAME_REQUIRED, checked.message);
  const site = project?.target ?? {};
  const settings = websiteSettings(project);
  const title = String(site.siteName ?? '').trim() || checked.name;
  if (!title) fail(ERROR_CODES.CONFIG_INVALID, 'A website title is required to build the CMS.');
  const tagline = settings.tagline.trim() || String(site.siteDescription ?? '').trim() || 'Published on Qortal QDN';
  const navigation = Array.isArray(settings.navigation) && settings.navigation.length > 0
    ? settings.navigation
      .filter((entry) => entry && typeof entry.label === 'string' && typeof entry.href === 'string')
      .map((entry) => ({ label: entry.label.slice(0, 80), href: entry.href.slice(0, 300) }))
    : DEFAULT_CMS_NAVIGATION.map((entry) => ({ ...entry }));
  if (navigation.length === 0) fail(ERROR_CODES.CONFIG_INVALID, 'CMS navigation must contain at least one item.');
  const theme = settings.theme ?? {};
  const colors = theme.colors && typeof theme.colors === 'object' ? theme.colors : {};
  return {
    schema: CMS_TEMPLATE_CONFIG_SCHEMA,
    deployment: {
      service: deployment?.service === 'WEBSITE' ? 'WEBSITE' : 'APP',
      name: checked.name,
      identifier: String(deployment?.identifier || '')
    },
    site: {
      id: String(project?.identity?.siteId ?? project?.siteId ?? 'site'),
      title,
      tagline,
      description: String(site.siteDescription ?? '').trim() || tagline,
      ownerName: checked.name,
      publicAuthor: settings.publicAuthor.trim() || title,
      footerText: 'Published on Qortal. Content is served directly from QDN.'
    },
    content: {
      source: 'qdn',
      manifestIdentifier: String(manifestIdentifier),
      legacyManifestIdentifier: 'cr-qdn-manifest',
      staleAfterDays: 30,
      pageSize: 9
    },
    navigation,
    theme: {
      colors: {
        background: safeColor(colors.background, DEFAULT_CMS_THEME.colors.background),
        surface: safeColor(colors.surface, DEFAULT_CMS_THEME.colors.surface),
        surfaceAlt: safeColor(colors.surfaceAlt, DEFAULT_CMS_THEME.colors.surfaceAlt),
        text: safeColor(colors.text, DEFAULT_CMS_THEME.colors.text),
        muted: safeColor(colors.muted, DEFAULT_CMS_THEME.colors.muted),
        accent: safeColor(colors.accent, DEFAULT_CMS_THEME.colors.accent),
        accentText: safeColor(colors.accentText, DEFAULT_CMS_THEME.colors.accentText),
        border: safeColor(colors.border, DEFAULT_CMS_THEME.colors.border),
        danger: safeColor(colors.danger, DEFAULT_CMS_THEME.colors.danger),
        warning: safeColor(colors.warning, DEFAULT_CMS_THEME.colors.warning)
      },
      fontFamily: typeof theme.fontFamily === 'string' && theme.fontFamily.trim() ? theme.fontFamily.trim().slice(0, 200) : DEFAULT_CMS_THEME.fontFamily,
      radius: typeof theme.radius === 'string' && theme.radius.trim() ? theme.radius.trim().slice(0, 20) : DEFAULT_CMS_THEME.radius,
      maxWidth: typeof theme.maxWidth === 'string' && theme.maxWidth.trim() ? theme.maxWidth.trim().slice(0, 20) : DEFAULT_CMS_THEME.maxWidth,
      headingFontFamily: typeof theme.headingFontFamily === 'string' && theme.headingFontFamily.trim() ? theme.headingFontFamily.trim().slice(0, 200) : DEFAULT_CMS_THEME.headingFontFamily
    },
    admin: {
      qdnName: checked.name,
      requireOwnerForImport: true
    },
    generated_at: generatedAt
  };
}

export async function readCmsTemplateFiles(templateDir) {
  let info;
  try {
    info = await stat(templateDir);
  } catch {
    fail(ERROR_CODES.PUBLICATION_NOT_READY, 'The generic CMS template is not built. Reinstall or rebuild the application.');
  }
  if (!info.isDirectory()) fail(ERROR_CODES.PUBLICATION_NOT_READY, 'The generic CMS template path is not a directory.');
  const files = await walkFiles(templateDir);
  if (!files.some((file) => file.path === 'index.html')) {
    fail(ERROR_CODES.PUBLICATION_NOT_READY, 'The generic CMS template has no index.html entrypoint.');
  }
  return files;
}

async function readTemplateVersion(templateDir) {
  for (const candidate of [path.join(templateDir, '..', 'template.json'), path.join(templateDir, '..', 'package.json')]) {
    try {
      const parsed = JSON.parse(await readFile(candidate, 'utf8'));
      if (typeof parsed.version === 'string' && parsed.version.length > 0) return parsed.version;
    } catch {
      // A development build may not have template.json; the dist is still valid.
    }
  }
  return '0.0.0';
}

export async function buildCmsSiteBundle({
  repoRoot,
  project,
  target,
  prefix,
  namespace,
  manifestIdentifier,
  manifestResourceId,
  service = 'APP',
  generatedAt = new Date().toISOString()
} = {}) {
  if (!['APP', 'WEBSITE'].includes(service)) {
    fail(ERROR_CODES.CONFIG_INVALID, 'CMS hosting service must be APP or WEBSITE.');
  }
  const templateDir = resolveCmsTemplateDir(repoRoot);
  const templateVersion = await readTemplateVersion(templateDir);
  const templateFiles = await readCmsTemplateFiles(templateDir);
  const identifier = stableSiteIdentifier({
    prefix,
    namespace,
    kind: service === 'WEBSITE' ? 'web' : 'app',
    key: CMS_TEMPLATE_ID
  });
  const config = buildCmsRuntimeConfig({
    project,
    target,
    manifestIdentifier,
    deployment: { service, name: target.qdnName, identifier },
    generatedAt
  });
  const configBytes = Buffer.from(stableStringify(config) + '\n', 'utf8');
  const files = [
    ...templateFiles.filter((file) => file.path !== CMS_CONFIG_FILE),
    { path: CMS_CONFIG_FILE, bytes: configBytes }
  ].sort((left, right) => left.path.localeCompare(right.path));
  const members = bundleMembers(files);
  const zip = zipBundle(files);
  return {
    id: 'res_' + createHash('sha256').update('site|' + CMS_TEMPLATE_ID + '|' + identifier, 'utf8').digest('hex').slice(0, 24),
    kind: 'site',
    service,
    name: target.qdnName,
    identifier,
    relativePath: 'payload/site/' + identifier + '.zip',
    contentType: 'application/zip',
    bytes: zip.length,
    sha256: sha256Bytes(zip),
    order: 0,
    dependsOn: [manifestResourceId],
    payload: zip,
    metadata: {
      template: CMS_TEMPLATE_ID,
      service,
      templateVersion,
      configFile: CMS_CONFIG_FILE,
      bundle: {
        schema: BUNDLE_SCHEMA,
        format: 'zip',
        entrypoint: 'index.html',
        files: members
      }
    }
  };
}
