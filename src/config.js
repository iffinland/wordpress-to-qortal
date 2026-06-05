import dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProfile } from './profile.js';

dotenv.config();

const DEFAULT_OUTPUT_DIR = './wp-qortal-import';
const DEFAULT_LIMIT_POSTS = 5;
const DEFAULT_LIMIT_RECENT_POSTS = 100;
const DEFAULT_LIMIT_PAGES = 5;
const DEFAULT_LIMIT_CATEGORIES = 100;
const DEFAULT_LIMIT_TAGS = 100;
const DEFAULT_LIMIT_MEDIA = 20;

function readRequiredEnv(name) {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value.trim();
}

function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, '');
}

function expandHome(filePath) {
  if (!filePath) {
    return '';
  }
  if (filePath === '~') {
    return os.homedir();
  }
  if (filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function readOptionalFile(filePath) {
  const expanded = expandHome(filePath);
  if (!expanded || !existsSync(expanded)) {
    return '';
  }
  return readFileSync(expanded, 'utf8').trim();
}

function readPositiveInteger(name, fallback) {
  const rawValue = process.env[name];

  if (!rawValue || rawValue.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function readNonNegativeInteger(name, fallback = 0) {
  const rawValue = process.env[name];

  if (!rawValue || rawValue.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function readCsv(name) {
  return (process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function readCsvWithFallback(name, fallback = []) {
  return process.env[name] === undefined ? fallback : readCsv(name);
}

function readOptionalTimestamp(name) {
  const value = process.env[name]?.trim() || '';
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${name} must be a valid ISO timestamp.`);
  }
  return new Date(timestamp).toISOString();
}

export function loadConfig() {
  const profile = loadProfile();
  dotenv.config({ path: profile.envPath, override: false });
  const wordpressAuthMode =
    process.env.WORDPRESS_AUTH_MODE?.trim().toLowerCase() || 'application_password';
  const wordpressLoginUrl = process.env.WORDPRESS_LOGIN_URL?.trim() || '/login/';
  const wordpressUsername = process.env.WORDPRESS_USERNAME?.trim() || '';
  const wordpressAppPassword = process.env.WORDPRESS_APP_PASSWORD?.trim() || '';
  const wordpressPassword = process.env.WORDPRESS_PASSWORD?.trim() || '';
  const downloadMedia = process.env.DOWNLOAD_MEDIA?.trim().toLowerCase() === 'true';
  const downloadExternalMedia =
    process.env.DOWNLOAD_EXTERNAL_MEDIA?.trim().toLowerCase() === 'true';
  const downloadMediaTypes = new Set(
    (process.env.DOWNLOAD_MEDIA_TYPES || 'image,audio,video,document,file')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  const mediaScope = process.env.MEDIA_SCOPE?.trim().toLowerCase() || 'library';
  const fetchHistoricalPosts =
    process.env.FETCH_HISTORICAL_POSTS?.trim().toLowerCase() !== 'false';
  const qortalName = process.env.QORTAL_NAME?.trim() || profile.qortalName;
  const qortalSiteName = process.env.QORTAL_SITE_NAME?.trim() || profile.qortalSiteName || qortalName;
  const qortalContentName =
    process.env.QORTAL_CONTENT_NAME?.trim() || profile.qortalContentName || qortalName;
  const qortalMediaName = process.env.QORTAL_MEDIA_NAME?.trim() || profile.qortalMediaName;
  const publicAuthorName =
    process.env.PUBLIC_AUTHOR_NAME?.trim() || profile.publicAuthorName || 'Site Author';
  const qortalCoauthorNames = [...new Set(
    readCsvWithFallback('QORTAL_COAUTHOR_NAMES', profile.qortalCoauthorNames)
  )];
  const qortalPublisherNames = [...new Set([
    ...(qortalName ? [qortalName] : []),
    ...(qortalSiteName ? [qortalSiteName] : []),
    ...(qortalContentName ? [qortalContentName] : []),
    ...(qortalMediaName ? [qortalMediaName] : []),
    ...readCsvWithFallback('QORTAL_PUBLISHER_NAMES', profile.qortalPublisherNames)
  ])];
  const qortalNodeUrl = normalizeBaseUrl(
    process.env.QORTAL_NODE_URL?.trim() || 'http://localhost:12391'
  );
  const qortalApiKeyFile = process.env.QORTAL_API_KEY_FILE?.trim() || '';
  const qortalApiKey = process.env.QORTAL_API_KEY?.trim() || readOptionalFile(qortalApiKeyFile);

  if (!['application_password', 'session'].includes(wordpressAuthMode)) {
    throw new Error('WORDPRESS_AUTH_MODE must be application_password or session.');
  }

  if (!['library', 'selected_posts'].includes(mediaScope)) {
    throw new Error('MEDIA_SCOPE must be library or selected_posts.');
  }

  return {
    profileId: profile.id,
    resourcePrefix: profile.resourcePrefix,
    qdnIdentifiers: profile.qdnIdentifiers,
    wordpressBaseUrl: normalizeBaseUrl(readRequiredEnv('WORDPRESS_BASE_URL')),
    outputDir: process.env.OUTPUT_DIR?.trim() || profile.defaultOutputDir || DEFAULT_OUTPUT_DIR,
    limitPosts: readPositiveInteger('LIMIT_POSTS', DEFAULT_LIMIT_POSTS),
    limitRecentPosts: readPositiveInteger('LIMIT_RECENT_POSTS', DEFAULT_LIMIT_RECENT_POSTS),
    postsOffset: readNonNegativeInteger('POSTS_OFFSET'),
    postsBefore: readOptionalTimestamp('POSTS_BEFORE'),
    postsAfter: readOptionalTimestamp('POSTS_AFTER'),
    fetchHistoricalPosts,
    limitPages: readPositiveInteger('LIMIT_PAGES', DEFAULT_LIMIT_PAGES),
    limitCategories: readPositiveInteger('LIMIT_CATEGORIES', DEFAULT_LIMIT_CATEGORIES),
    limitTags: readPositiveInteger('LIMIT_TAGS', DEFAULT_LIMIT_TAGS),
    limitMedia: readPositiveInteger('LIMIT_MEDIA', DEFAULT_LIMIT_MEDIA),
    mediaScope,
    downloadMedia,
    downloadExternalMedia,
    downloadMediaTypes,
    wordpressAuthMode,
    wordpressLoginUrl,
    wordpressUsername,
    wordpressAppPassword,
    wordpressPassword,
    hasWordPressAuth:
      wordpressAuthMode === 'session'
        ? Boolean(wordpressUsername && wordpressPassword)
        : Boolean(wordpressUsername && wordpressAppPassword),
    qortalName,
    qortalSiteName,
    qortalContentName,
    qortalMediaName,
    qortalPublisherNames,
    qortalCoauthorNames,
    publicAuthorName,
    qortalNodeUrl,
    qortalApiKey,
    qortalApiKeyFile,
    importerVersion: '0.1.5'
  };
}
