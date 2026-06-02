import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_PROFILE_ID = 'generic';

function validateProfileId(profileId) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(profileId)) {
    throw new Error('MIGRATION_PROFILE must contain only lowercase letters, numbers, and hyphens.');
  }
}

function validateResourcePrefix(prefix) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(prefix)) {
    throw new Error('Profile resource_prefix must contain only lowercase letters, numbers, and hyphens.');
  }
  if (prefix.length > 20) {
    throw new Error('Profile resource_prefix must not exceed 20 characters.');
  }
}

function readStringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))]
    : [];
}

export function createQdnIdentifiers(resourcePrefix) {
  validateResourcePrefix(resourcePrefix);
  return {
    qdn_manifest: `${resourcePrefix}-qdn-manifest`,
    posts_index: `${resourcePrefix}-posts-index`,
    pages_index: `${resourcePrefix}-pages-index`,
    categories: `${resourcePrefix}-categories`,
    tags: `${resourcePrefix}-tags`,
    media_map: `${resourcePrefix}-media-map`,
    url_map: `${resourcePrefix}-url-map`,
    import_manifest: `${resourcePrefix}-import-manifest`
  };
}

export function loadProfile(profileId = process.env.MIGRATION_PROFILE?.trim() || DEFAULT_PROFILE_ID) {
  validateProfileId(profileId);
  const profileDir = path.resolve('profiles', profileId);
  const profilePath = path.join(profileDir, 'profile.json');

  if (!existsSync(profilePath)) {
    throw new Error(`Migration profile does not exist: ${profilePath}`);
  }

  const raw = JSON.parse(readFileSync(profilePath, 'utf8'));
  const resourcePrefix = String(raw.resource_prefix || '').trim();
  validateResourcePrefix(resourcePrefix);

  return {
    id: String(raw.id || profileId),
    profileDir,
    envPath: path.join(profileDir, '.env'),
    resourcePrefix,
    qdnIdentifiers: createQdnIdentifiers(resourcePrefix),
    defaultOutputDir: String(raw.default_output_dir || `./workspaces/${profileId}/wp-qortal-import`),
    publicAuthorName: String(raw.public_author_name || 'Site Author').trim(),
    qortalName: String(raw.qortal_name || '').trim(),
    qortalSiteName: String(raw.qortal_site_name || '').trim(),
    qortalContentName: String(raw.qortal_content_name || '').trim(),
    qortalMediaName: String(raw.qortal_media_name || '').trim(),
    qortalPublisherNames: readStringList(raw.qortal_publisher_names),
    qortalCoauthorNames: readStringList(raw.qortal_coauthor_names),
    cmsTrustedCoauthorsCanAdoptImports: Boolean(raw.cms_trusted_coauthors_can_adopt_imports),
    cmsTrustedCoauthorsCanPublishMedia: Boolean(raw.cms_trusted_coauthors_can_publish_media)
  };
}
