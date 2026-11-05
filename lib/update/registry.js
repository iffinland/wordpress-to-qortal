/**
 * Shared QMS update-registry contract and update-decision logic.
 *
 * This module is imported by the release tooling and by all three QMS
 * applications. It must stay dependency-free and browser-safe: no Node
 * built-ins, no network access, no filesystem access.
 *
 * The registry is untrusted input until parseRegistryDocument() validates it.
 * Nothing here executes registry-provided code or trusts registry-provided
 * ownership. URLs are restricted to the project's GitHub release assets.
 */

export const REGISTRY_SCHEMA = 'qms-update-registry@1';
export const REGISTRY_MIGRATIONS = Object.freeze({
  'qms-update-registry@0': 'qms-update-registry@1'
});
export const REGISTRY_IDENTITY = Object.freeze({
  service: 'DOCUMENT',
  name: 'developer iffi',
  identifier: 'qms-update-registry'
});
export const COMPONENT_IDS = Object.freeze(['desktop', 'publisher', 'cms']);
export const CHANNELS = Object.freeze(['alpha', 'beta', 'rc', 'stable']);
export const UPDATE_STATES = Object.freeze([
  'idle',
  'checking',
  'up_to_date',
  'update_available',
  'incompatible',
  'unverified',
  'unable_to_check'
]);

const CHANNEL_RANK = Object.freeze({ alpha: 0, beta: 1, rc: 2, stable: 3 });
const REPO_OWNER = 'iffinland';
const REPO_NAME = 'wordpress-to-qortal';
const GITHUB_HOST = 'github.com';
const RELEASE_BASE = 'https://github.com/' + REPO_OWNER + '/' + REPO_NAME + '/releases';
const MAX_SUMMARY = 2000;
const MAX_INSTRUCTIONS = 4000;
const MAX_ARTIFACTS = 16;
const MAX_COMPONENTS = 8;
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024 * 1024;
const PLATFORM = /^[a-z0-9][a-z0-9-]{1,31}$/;
const IDENTIFIER = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._+~-]{0,199}$/;
const ALLOWED_FORMATS = Object.freeze(['deb', 'zip']);
const ALLOWED_INSTALL_KINDS = Object.freeze(['debian-package', 'qapp-zip']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 40) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

// ---------------------------------------------------------------------------
// Semantic version comparison
// ---------------------------------------------------------------------------

export function parseSemver(value) {
  if (typeof value !== 'string') return null;
  const match = SEMVER.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
    raw: value
  };
}

export function isValidSemver(value) {
  return parseSemver(value) !== null;
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1; // a stable release is newer than a prerelease
  if (right.length === 0) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const delta = Number(a) - Number(b);
      if (delta !== 0) return delta < 0 ? -1 : 1;
      continue;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    if (a !== b) return a < b ? -1 : 1;
  }
  return 0;
}

/**
 * Numeric-aware SemVer precedence. Returns -1, 0 or 1. Throws on invalid
 * input so a malformed registry can never compare as "newer".
 */
export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a) throw new Error('Invalid semantic version: ' + String(left));
  if (!b) throw new Error('Invalid semantic version: ' + String(right));
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

/** Channel implied by the version itself: prerelease tags map to a channel. */
export function channelOfVersion(version) {
  const parsed = parseSemver(version);
  if (!parsed) return null;
  if (parsed.prerelease.length === 0) return 'stable';
  const first = parsed.prerelease[0].toLowerCase();
  if (first === 'alpha' || first === 'beta' || first === 'rc') return first;
  return null;
}

export function channelRank(channel) {
  return Object.prototype.hasOwnProperty.call(CHANNEL_RANK, channel) ? CHANNEL_RANK[channel] : -1;
}

/** Candidate channel must be at least as stable as the installed channel. */
export function isChannelAllowed(installedChannel, candidateChannel) {
  const installed = channelRank(installedChannel);
  const candidate = channelRank(candidateChannel);
  return installed >= 0 && candidate >= 0 && candidate >= installed;
}

// ---------------------------------------------------------------------------
// Registry parsing and migration
// ---------------------------------------------------------------------------

function migrationToV1(raw) {
  // Pre-freeze draft shape: one global release with per-kind artifact arrays.
  // It is migrated so an old cached document cannot be mistaken for current
  // data or silently ignored.
  const components = {};
  for (const id of COMPONENT_IDS) {
    const artifacts = Array.isArray(raw.artifacts?.[id]) ? raw.artifacts[id] : [];
    components[id] = {
      id,
      displayName: String(raw.displayNames?.[id] ?? id),
      version: raw.version,
      channel: raw.channel,
      releaseTag: raw.tag ?? ('v' + String(raw.version)),
      releaseDate: raw.releaseDate ?? raw.generatedAt,
      releaseUrl: RELEASE_BASE + '/tag/' + String(raw.tag ?? ('v' + String(raw.version))),
      changelog: { summary: raw.changelog?.summary ?? 'No changelog was supplied.', url: raw.changelog?.url ?? '' },
      supportedPlatforms: [...new Set(artifacts.map((entry) => entry?.platform).filter(Boolean))],
      minimumDependencies: {},
      install: raw.install?.[id] ?? { kind: id === 'desktop' ? 'debian-package' : 'qapp-zip', instructions: 'See the release page.' },
      artifacts
    };
  }
  return {
    schema: REGISTRY_SCHEMA,
    registry: { ...REGISTRY_IDENTITY },
    product: raw.product ?? 'Qortal Migration Studio',
    generatedAt: raw.generatedAt,
    sequence: Number(raw.sequence ?? 1),
    components
  };
}

export function migrateRegistryDocument(raw) {
  if (!isObject(raw)) return { ok: false, code: 'registry_malformed', error: 'Registry document must be a JSON object.' };
  if (raw.schema === REGISTRY_SCHEMA) return { ok: true, document: raw, migrations: [] };
  if (raw.schema === 'qms-update-registry@0') {
    return { ok: true, document: migrationToV1(raw), migrations: ['qms-update-registry@0 -> qms-update-registry@1'] };
  }
  return {
    ok: false,
    code: 'registry_schema_unsupported',
    error: 'Unsupported update-registry schema: ' + String(raw.schema ?? '<missing>') + '. This build supports ' + REGISTRY_SCHEMA + '.'
  };
}

function validateIdentity(value, errors) {
  if (!isObject(value)) {
    errors.push('registry.registry must be an object.');
    return;
  }
  for (const key of ['service', 'name', 'identifier']) {
    if (value[key] !== REGISTRY_IDENTITY[key]) {
      errors.push('registry.registry.' + key + ' must be "' + REGISTRY_IDENTITY[key] + '".');
    }
  }
}

function validateArtifactUrl(url, tag, name, errors, label) {
  if (typeof url !== 'string' || url.length > 1000) {
    errors.push(label + '.url must be a string.');
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    errors.push(label + '.url is not a valid URL.');
    return;
  }
  if (parsed.protocol !== 'https:' || parsed.host !== GITHUB_HOST) {
    errors.push(label + '.url must use https://github.com.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    errors.push(label + '.url must not contain credentials, a query or a fragment.');
  }
  let segments;
  try {
    segments = parsed.pathname.split('/').filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    segments = [];
  }
  const expected = [REPO_OWNER, REPO_NAME, 'releases', 'download', tag, name];
  if (segments.length !== expected.length || segments.some((segment, index) => segment !== expected[index])) {
    errors.push(label + '.url does not match the expected release asset URL.');
  }
}

function validateReleaseUrl(url, tag, errors, label) {
  if (typeof url !== 'string' || url.length > 1000) {
    errors.push(label + ' must be a string.');
    return;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    errors.push(label + ' is not a valid URL.');
    return;
  }
  const expected = RELEASE_BASE + '/tag/' + tag;
  if (parsed.protocol !== 'https:' || parsed.host !== GITHUB_HOST || parsed.username || parsed.password || url !== expected) {
    errors.push(label + ' must equal ' + expected + '.');
  }
}

function validateArtifact(artifact, component, index, errors) {
  const label = 'components.' + component.id + '.artifacts[' + index + ']';
  if (!isObject(artifact)) {
    errors.push(label + ' must be an object.');
    return;
  }
  for (const key of sortedKeys(artifact)) {
    if (!['platform', 'format', 'name', 'bytes', 'sha256', 'url'].includes(key)) {
      errors.push(label + ' has an unknown field: ' + key + '.');
    }
  }
  if (typeof artifact.platform !== 'string' || !PLATFORM.test(artifact.platform)) {
    errors.push(label + '.platform is invalid.');
  }
  if (!ALLOWED_FORMATS.includes(artifact.format)) {
    errors.push(label + '.format is unsupported.');
  }
  if (typeof artifact.name !== 'string' || !SAFE_NAME.test(artifact.name) || artifact.name.includes('/')) {
    errors.push(label + '.name is invalid.');
  }
  if (!Number.isInteger(artifact.bytes) || artifact.bytes <= 0 || artifact.bytes > MAX_ARTIFACT_BYTES) {
    errors.push(label + '.bytes is invalid.');
  }
  if (typeof artifact.sha256 !== 'string' || !SHA256.test(artifact.sha256)) {
    errors.push(label + '.sha256 must be a lowercase SHA-256 hex digest.');
  }
  validateArtifactUrl(artifact.url, component.releaseTag, artifact.name, errors, label);
  if (artifact.format === 'deb' && !artifact.name.endsWith('.deb')) {
    errors.push(label + '.name must end with .deb for a Debian artifact.');
  }
  if (artifact.format === 'zip' && !artifact.name.endsWith('.zip')) {
    errors.push(label + '.name must end with .zip for a Q-App artifact.');
  }
}

function validateComponent(component, key, errors, warnings) {
  const label = 'components.' + key;
  if (!isObject(component)) {
    errors.push(label + ' must be an object.');
    return;
  }
  for (const field of sortedKeys(component)) {
    if (!['id', 'displayName', 'version', 'channel', 'releaseTag', 'releaseDate', 'releaseUrl', 'changelog', 'supportedPlatforms', 'minimumDependencies', 'install', 'artifacts'].includes(field)) {
      errors.push(label + ' has an unknown field: ' + field + '.');
    }
  }
  if (component.id !== key) errors.push(label + '.id must equal ' + key + '.');
  if (!COMPONENT_IDS.includes(key)) errors.push(label + ' is not a supported component id.');

  const parsedVersion = parseSemver(component.version);
  if (!parsedVersion) errors.push(label + '.version is not a semantic version.');
  if (!CHANNELS.includes(component.channel)) {
    errors.push(label + '.channel is invalid.');
  } else if (parsedVersion) {
    const implied = channelOfVersion(component.version);
    if (implied !== component.channel) {
      errors.push(label + '.channel must match the version prerelease (' + String(implied) + ').');
    }
  }
  if (typeof component.releaseTag !== 'string' || !TAG.test(component.releaseTag)) {
    errors.push(label + '.releaseTag must be a release tag such as v0.8.0-alpha.1.');
  }
  if (!isIsoDate(component.releaseDate)) errors.push(label + '.releaseDate must be an ISO date.');
  validateReleaseUrl(component.releaseUrl, component.releaseTag, errors, label + '.releaseUrl');

  if (!boundedString(component.displayName, 120)) errors.push(label + '.displayName is invalid.');
  if (!isObject(component.changelog)) {
    errors.push(label + '.changelog must be an object.');
  } else {
    if (!boundedString(component.changelog.summary, MAX_SUMMARY)) errors.push(label + '.changelog.summary is invalid.');
    if (component.changelog.url !== undefined && component.changelog.url !== '') {
      let parsed = null;
      try { parsed = new URL(component.changelog.url); } catch { parsed = null; }
      if (!parsed || parsed.protocol !== 'https:' || parsed.host !== GITHUB_HOST || parsed.username || parsed.password) {
        errors.push(label + '.changelog.url must be an https://github.com URL.');
      }
    }
  }

  if (!Array.isArray(component.supportedPlatforms) || component.supportedPlatforms.length === 0 || component.supportedPlatforms.length > MAX_ARTIFACTS) {
    errors.push(label + '.supportedPlatforms is invalid.');
  } else {
    for (const platform of component.supportedPlatforms) {
      if (typeof platform !== 'string' || !PLATFORM.test(platform)) errors.push(label + '.supportedPlatforms contains an invalid platform.');
    }
  }

  if (!isObject(component.minimumDependencies)) {
    errors.push(label + '.minimumDependencies must be an object.');
  } else {
    for (const [dependency, version] of Object.entries(component.minimumDependencies)) {
      if (!PLATFORM.test(dependency)) errors.push(label + '.minimumDependencies has an invalid name: ' + dependency + '.');
      if (!isValidSemver(version)) errors.push(label + '.minimumDependencies.' + dependency + ' is not a semantic version.');
    }
  }

  if (!isObject(component.install)) {
    errors.push(label + '.install must be an object.');
  } else {
    if (!ALLOWED_INSTALL_KINDS.includes(component.install.kind)) errors.push(label + '.install.kind is unsupported.');
    if (!boundedString(component.install.instructions, MAX_INSTRUCTIONS)) errors.push(label + '.install.instructions is invalid.');
  }

  if (!Array.isArray(component.artifacts) || component.artifacts.length === 0 || component.artifacts.length > MAX_ARTIFACTS) {
    errors.push(label + '.artifacts must contain between 1 and ' + MAX_ARTIFACTS + ' entries.');
  } else {
    const names = new Set();
    const platforms = new Set();
    component.artifacts.forEach((artifact, index) => {
      validateArtifact(artifact, component, index, errors);
      if (isObject(artifact)) {
        if (typeof artifact.name === 'string') {
          if (names.has(artifact.name)) errors.push(label + ' has a duplicate artifact name: ' + artifact.name + '.');
          names.add(artifact.name);
        }
        if (typeof artifact.platform === 'string') {
          if (platforms.has(artifact.platform)) errors.push(label + ' has more than one artifact for platform ' + artifact.platform + '; platform selection is ambiguous.');
          platforms.add(artifact.platform);
        }
      }
    });
  }

  // Desktop updates must name a Linux x64 artifact because the packaged
  // application currently targets Debian/amd64. Additional platforms may be
  // added later without changing the schema.
  if (key === 'desktop' && Array.isArray(component.artifacts)) {
    if (!component.artifacts.some((artifact) => isObject(artifact) && artifact.platform === 'linux-x64' && artifact.format === 'deb')) {
      warnings.push('components.desktop has no linux-x64 .deb artifact.');
    }
  }
}

/**
 * Validate a registry document. Never throws for malformed input; returns a
 * structured result so callers can render "unable to check" without breaking
 * the host application.
 */
export function parseRegistryDocument(input) {
  let raw = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return { ok: false, code: 'registry_malformed', errors: ['Registry document is not valid JSON.'], warnings: [], migrations: [] };
    }
  }
  const migrated = migrateRegistryDocument(raw);
  if (!migrated.ok) {
    return { ok: false, code: migrated.code, errors: [migrated.error], warnings: [], migrations: [] };
  }
  const document = migrated.document;
  const errors = [];
  const warnings = [];
  for (const field of sortedKeys(document)) {
    if (!['schema', 'registry', 'product', 'generatedAt', 'sequence', 'components'].includes(field)) {
      errors.push('Registry has an unknown top-level field: ' + field + '.');
    }
  }
  if (document.schema !== REGISTRY_SCHEMA) errors.push('Registry schema is not ' + REGISTRY_SCHEMA + '.');
  validateIdentity(document.registry, errors);
  if (!boundedString(document.product, 120)) errors.push('Registry product is invalid.');
  if (!isIsoDate(document.generatedAt)) errors.push('Registry generatedAt must be an ISO date.');
  if (!Number.isInteger(document.sequence) || document.sequence < 1 || document.sequence > 1_000_000) {
    errors.push('Registry sequence must be a positive integer.');
  }
  if (!isObject(document.components)) {
    errors.push('Registry components must be an object.');
  } else {
    const keys = sortedKeys(document.components);
    if (keys.length === 0 || keys.length > MAX_COMPONENTS) errors.push('Registry components is empty or too large.');
    for (const id of COMPONENT_IDS) {
      if (!Object.prototype.hasOwnProperty.call(document.components, id)) {
        errors.push('Registry is missing the required component: ' + id + '.');
      }
    }
    for (const key of keys) {
      if (!COMPONENT_IDS.includes(key)) errors.push('Registry contains an unsupported component: ' + key + '.');
      validateComponent(document.components[key], key, errors, warnings);
    }
  }
  if (errors.length > 0) {
    return { ok: false, code: 'registry_invalid', errors, warnings, migrations: migrated.migrations, document };
  }
  return {
    ok: true,
    registry: document,
    errors: [],
    warnings,
    migrations: migrated.migrations,
    sequence: document.sequence,
    generatedAt: document.generatedAt
  };
}

// ---------------------------------------------------------------------------
// Update assessment
// ---------------------------------------------------------------------------

export function pickArtifact(component, platform) {
  if (!component || !Array.isArray(component.artifacts)) return null;
  if (platform) {
    return component.artifacts.find((artifact) => artifact.platform === platform) ?? null;
  }
  return component.artifacts[0] ?? null;
}

function dependencyFailures(component, dependencies) {
  const failures = [];
  const required = component.minimumDependencies ?? {};
  for (const [name, minimum] of Object.entries(required)) {
    const actual = isObject(dependencies) ? dependencies[name] : undefined;
    if (typeof actual !== 'string' || !isValidSemver(actual)) {
      failures.push('Cannot establish the installed ' + name + ' version; this update requires ' + name + ' ' + minimum + ' or newer.');
      continue;
    }
    if (compareSemver(actual, minimum) < 0) {
      failures.push('This update requires ' + name + ' ' + minimum + ' or newer; installed ' + name + ' is ' + actual + '.');
    }
  }
  return failures;
}

/**
 * Decide whether a registry component is an applicable update.
 *
 * installedVersion must be a plain SemVer. installedChannel defaults to the
 * channel implied by installedVersion. Unchanged components always report
 * up_to_date and never produce a badge.
 */
export function assessUpdate({ registry, componentId, installedVersion, platform = null, dependencies = {} }) {
  let effective = null;
  if (registry && registry.ok !== false) {
    if (isObject(registry.components)) effective = registry;
    else if (isObject(registry.registry?.components)) effective = registry.registry;
  }
  if (!effective || !isObject(effective.components)) {
    return { status: 'unverified', reasonCode: 'registry_invalid', reason: 'The update registry is not available or has not been validated.', showBadge: false };
  }
  const component = effective.components[componentId];
  if (!component) {
    return { status: 'unverified', reasonCode: 'component_missing', reason: 'The registry does not contain a ' + componentId + ' record.', showBadge: false };
  }
  const installed = parseSemver(installedVersion);
  if (!installed) {
    return { status: 'incompatible', reasonCode: 'installed_version_invalid', reason: 'The installed version is not a semantic version.', component, showBadge: false };
  }
  const order = compareSemver(component.version, installedVersion);
  if (order === 0) {
    return {
      status: 'up_to_date',
      reasonCode: 'same_version',
      reason: 'Installed version is current.',
      component,
      installedVersion,
      latestVersion: component.version,
      showBadge: false
    };
  }
  if (order < 0) {
    return {
      status: 'up_to_date',
      reasonCode: 'installed_newer',
      reason: 'Installed version is newer than the published registry version.',
      component,
      installedVersion,
      latestVersion: component.version,
      installedNewer: true,
      showBadge: false
    };
  }

  const installedChannel = channelOfVersion(installedVersion);
  if (!installedChannel || !isChannelAllowed(installedChannel, component.channel)) {
    return {
      status: 'incompatible',
      reasonCode: 'channel_not_allowed',
      reason: 'The published ' + component.channel + ' release is not offered to an installed ' + String(installedChannel || 'unknown') + ' channel.',
      component,
      installedVersion,
      latestVersion: component.version,
      showBadge: false
    };
  }

  const failures = dependencyFailures(component, dependencies);
  if (failures.length > 0) {
    return {
      status: 'incompatible',
      reasonCode: 'dependency_incompatible',
      reason: failures.join(' '),
      failures,
      component,
      installedVersion,
      latestVersion: component.version,
      showBadge: false
    };
  }

  const artifact = pickArtifact(component, platform);
  if (!artifact) {
    return {
      status: 'unverified',
      reasonCode: 'artifact_missing',
      reason: 'The registry lists no verified artifact for platform ' + String(platform || '<default>') + '.',
      component,
      installedVersion,
      latestVersion: component.version,
      showBadge: false
    };
  }

  return {
    status: 'update_available',
    reasonCode: 'newer_version',
    reason: 'Version ' + component.version + ' is available.',
    component,
    artifact,
    artifacts: component.artifacts,
    installedVersion,
    latestVersion: component.version,
    installedChannel,
    latestChannel: component.channel,
    showBadge: true
  };
}

// ---------------------------------------------------------------------------
// Bounded, cached update checker
// ---------------------------------------------------------------------------

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Update check timed out after ' + timeoutMs + ' ms.')), timeoutMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Framework-free update checker with bounded retries, timeouts and caching.
 *
 * fetchRegistry() must return the registry document as JSON text or an object.
 * It receives { signal } and should abort on signal when possible.
 *
 * Cached data older than staleMs never produces a badge and is reported as
 * unable_to_check: an old registry must not look like a confirmed update.
 */
export function createUpdateChecker(options) {
  const {
    componentId,
    installedVersion,
    platform = null,
    dependencies = {},
    fetchRegistry,
    cacheMs = 30 * 60 * 1000,
    staleMs = 7 * 24 * 60 * 60 * 1000,
    timeoutMs = 8000,
    retries = 2,
    retryDelayMs = 400,
    now = () => Date.now(),
    sleep = defaultSleep
  } = options;
  if (typeof fetchRegistry !== 'function') throw new Error('fetchRegistry is required.');
  if (!COMPONENT_IDS.includes(componentId)) throw new Error('Unknown component id: ' + componentId);

  let state = {
    status: 'idle',
    componentId,
    installedVersion,
    checkedAt: null,
    stale: false,
    showBadge: false,
    reason: 'Update check has not run yet.'
  };
  const listeners = new Set();
  let cachedDocument = null;
  let cachedAt = 0;
  let inFlight = null;

  function emit(next) {
    state = { ...state, ...next, componentId, installedVersion };
    for (const listener of listeners) {
      try { listener(state); } catch { /* UI isolation */ }
    }
    return state;
  }

  function assess(document) {
    const parsed = parseRegistryDocument(document);
    if (!parsed.ok) {
      return {
        status: 'unverified',
        reasonCode: parsed.code,
        reason: parsed.errors[0] ?? 'The update registry could not be validated.',
        errors: parsed.errors,
        showBadge: false
      };
    }
    const assessment = assessUpdate({ registry: parsed.registry, componentId, installedVersion, platform, dependencies });
    return { ...assessment, registrySequence: parsed.sequence };
  }

  function emitCached(document, checkedAt, stale) {
    const assessment = assess(document);
    return emit({
      ...assessment,
      checkedAt,
      stale,
      showBadge: !stale && assessment.status === 'update_available',
      reason: stale && assessment.status === 'update_available'
        ? 'An update was reported by a cached registry and could not be refreshed. Open the update view for details.'
        : assessment.reason
    });
  }

  async function run(force) {
    const startedAt = now();
    if (!force && state.checkedAt !== null && startedAt - state.checkedAt < cacheMs && state.status !== 'unable_to_check') {
      return state;
    }
    emit({ status: 'checking', showBadge: false, reason: 'Checking for updates…', stale: false });
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempt > 0) await sleep(retryDelayMs * attempt);
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      try {
        const document = await withTimeout(
          Promise.resolve().then(() => fetchRegistry({ signal: controller?.signal ?? null })),
          timeoutMs
        );
        const parsed = parseRegistryDocument(document);
        if (!parsed.ok) {
          // Well-formed transport with invalid content: retrying cannot fix it.
          return emit({
            status: 'unverified',
            reasonCode: parsed.code,
            reason: parsed.errors[0] ?? 'The update registry could not be validated.',
            errors: parsed.errors,
            checkedAt: now(),
            stale: false,
            showBadge: false
          });
        }
        cachedDocument = parsed.registry;
        cachedAt = now();
        const assessment = assess(parsed.registry);
        return emit({ ...assessment, checkedAt: cachedAt, stale: false, showBadge: assessment.status === 'update_available' });
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (controller) controller.abort();
      }
    }

    const cacheAge = cachedDocument ? now() - cachedAt : Infinity;
    if (cachedDocument && cacheAge <= staleMs) {
      const assessment = assess(cachedDocument);
      return emit({
        ...assessment,
        checkedAt: cachedAt,
        stale: true,
        showBadge: false,
        reason: assessment.status === 'update_available'
          ? 'An update was reported by a cached registry and could not be refreshed. Open the update view for details.'
          : assessment.reason,
        networkError: lastError ? lastError.message : 'Network unavailable.'
      });
    }
    return emit({
      status: 'unable_to_check',
      reasonCode: 'registry_unreachable',
      reason: 'Unable to check for updates: ' + (lastError?.message ?? 'the registry could not be read.'),
      checkedAt: now(),
      stale: false,
      showBadge: false
    });
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    check(force = false) {
      if (inFlight) return inFlight;
      inFlight = run(force === true).finally(() => { inFlight = null; });
      return inFlight;
    },
    /** Seed a persistent cache (desktop) without marking it as a fresh check. */
    seed(document, checkedAt = now()) {
      const parsed = parseRegistryDocument(document);
      if (!parsed.ok) return false;
      cachedDocument = parsed.registry;
      cachedAt = Number.isFinite(checkedAt) ? checkedAt : now();
      return true;
    },
    getDocument() {
      return cachedDocument;
    },
    /** Assess a cached document with an explicit timestamp and stale flag. */
    assessCached(document, checkedAt = now(), stale = true) {
      const parsed = parseRegistryDocument(document);
      if (!parsed.ok) return false;
      cachedDocument = parsed.registry;
      cachedAt = Number.isFinite(checkedAt) ? checkedAt : now();
      emitCached(parsed.registry, cachedAt, stale === true);
      return true;
    }
  };
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
