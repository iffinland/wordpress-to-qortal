import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadProfile as loadLegacyProfile, createQdnIdentifiers } from '../../../src/profile.js';
import { QmsError, ERROR_CODES } from '../errors.js';
import { defaultRepoRoot } from '../root.js';

export const CORBETT_PROFILE_ID = 'corbettreport';
export const CORBETT_RESOURCE_PREFIX = 'cr';

/**
 * Compatibility layer over the existing Corbett CLI modules.
 * It exists so the engine and the legacy scripts share one behavior; it does
 * not reimplement them. No Electron, no network.
 */
export function loadProfile(profileId, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  return loadLegacyProfile(profileId, { baseDir: repoRoot });
}

export function profileIdentifiers(resourcePrefix) {
  return createQdnIdentifiers(resourcePrefix);
}

export function compatibilityRecord(profile) {
  return {
    profileId: profile.id,
    resourcePrefix: profile.resourcePrefix,
    qdnIdentifiers: profile.qdnIdentifiers,
    qdnName: profile.qortalName,
    siteName: profile.qortalSiteName || profile.qortalName,
    contentName: profile.qortalContentName || profile.qortalName,
    mediaName: profile.qortalMediaName || null
  };
}

/** Load the legacy CLI config lazily (keeps engine import side-effect free). */
export async function loadLegacyConfig() {
  const { loadConfig } = await import('../../../src/config.js');
  return loadConfig();
}

export async function listLegacyCommandScripts(repoRoot = defaultRepoRoot()) {
  const raw = await readFile(path.join(repoRoot, 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  return Object.entries(pkg.scripts ?? {})
    .map(([name, command]) => ({ name, command }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Verify that a project compatibility record still matches the installed
 * Corbett profile. Used by local validation; read-only.
 */
export function verifyCompatibility(record, { repoRoot } = {}) {
  if (!record || !record.profileId) {
    return { ok: true, skipped: true, warnings: ['PROFILE_NOT_CONFIGURED'] };
  }
  let profile;
  try {
    profile = loadProfile(record.profileId, { repoRoot });
  } catch (error) {
    throw new QmsError(
      ERROR_CODES.INVALID_ARGUMENT,
      `Compatibility profile "${record.profileId}" is not available: ${error.message}`,
      { cause: error, details: { profileId: record.profileId } }
    );
  }
  const warnings = [];
  if (profile.resourcePrefix !== record.resourcePrefix) {
    warnings.push('RESOURCE_PREFIX_CHANGED');
  }
  for (const [key, value] of Object.entries(profile.qdnIdentifiers)) {
    if (record.qdnIdentifiers?.[key] !== value) {
      warnings.push(`IDENTIFIER_CHANGED:${key}`);
    }
  }
  return {
    ok: warnings.length === 0,
    skipped: false,
    profileId: profile.id,
    resourcePrefix: profile.resourcePrefix,
    qdnIdentifiers: profile.qdnIdentifiers,
    warnings
  };
}
