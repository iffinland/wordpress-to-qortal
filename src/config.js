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
  const wordpressUsername = process.env.WORDPRESS_USERNAME?.trim() || '';
  const wordpressAppPassword = process.env.WORDPRESS_APP_PASSWORD?.trim() || '';
  const downloadMedia = process.env.DOWNLOAD_MEDIA?.trim().toLowerCase() === 'true';

  return {
    wordpressBaseUrl: normalizeBaseUrl(readRequiredEnv('WORDPRESS_BASE_URL')),
    outputDir: process.env.OUTPUT_DIR?.trim() || DEFAULT_OUTPUT_DIR,
    limitPosts: readPositiveInteger('LIMIT_POSTS', DEFAULT_LIMIT_POSTS),
    limitPages: readPositiveInteger('LIMIT_PAGES', DEFAULT_LIMIT_PAGES),
    limitCategories: readPositiveInteger('LIMIT_CATEGORIES', DEFAULT_LIMIT_CATEGORIES),
    limitTags: readPositiveInteger('LIMIT_TAGS', DEFAULT_LIMIT_TAGS),
    limitMedia: readPositiveInteger('LIMIT_MEDIA', DEFAULT_LIMIT_MEDIA),
    downloadMedia,
    wordpressUsername,
    wordpressAppPassword,
    hasWordPressAuth: Boolean(wordpressUsername && wordpressAppPassword),
    importerVersion: '0.1.0'
  };
}
