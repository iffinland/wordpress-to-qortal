import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_OUTPUT_DIR = './wp-qortal-import';
const DEFAULT_LIMIT_POSTS = 5;
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

export function loadConfig() {
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

  if (!['application_password', 'session'].includes(wordpressAuthMode)) {
    throw new Error('WORDPRESS_AUTH_MODE must be application_password or session.');
  }

  if (!['library', 'selected_posts'].includes(mediaScope)) {
    throw new Error('MEDIA_SCOPE must be library or selected_posts.');
  }

  return {
    wordpressBaseUrl: normalizeBaseUrl(readRequiredEnv('WORDPRESS_BASE_URL')),
    outputDir: process.env.OUTPUT_DIR?.trim() || DEFAULT_OUTPUT_DIR,
    limitPosts: readPositiveInteger('LIMIT_POSTS', DEFAULT_LIMIT_POSTS),
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
    importerVersion: '0.1.0'
  };
}
