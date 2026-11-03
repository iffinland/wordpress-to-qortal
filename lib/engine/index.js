import { ProjectService } from './projects.js';
import { defaultDataRoot } from './storage/paths.js';
import { defaultRepoRoot } from './root.js';
import { systemClock } from './clock.js';
import {
  compatibilityRecord,
  loadLegacyConfig,
  listLegacyCommandScripts,
  loadProfile,
  profileIdentifiers,
  verifyCompatibility
} from './compat/index.js';
import { JournalStore } from './storage/journal.js';
import { ProjectLock } from './lock.js';
import { EventBus, EVENT_SCHEMA, EVENT_TYPES, validateEvent } from './events.js';
import { RunService, reconstructRunProgress } from './runs.js';
import { QmsError, ERROR_CODES, isQmsError } from './errors.js';
import { SourceService, DISCOVERY_REPORT_SCHEMA } from './source.js';
import { createBuiltinSourceRegistry } from '../source/builtin.js';
import {
  SOURCE_ADAPTER_CONTRACT,
  SOURCE_ADAPTER_CONTRACT_VERSION,
  SourceAdapterRegistry,
  createSourceRegistry
} from '../source/index.js';
import {
  CONTENT_SCHEMA,
  CONTENT_VERSION,
  HASH_ALGORITHM,
  computeContentHash,
  contentId,
  assertContentDocument
} from '../model/content.js';
import {
  DEFAULT_RESOURCE_PREFIX,
  IDENTITY_STATE_SCHEMA,
  IDENTIFIER_MAX_LENGTH,
  PUBLICATION_STATUSES,
  LOCAL_PREPARATION_STATES,
  QORTAL_NAME_MAX_LENGTH,
  QORTAL_NAME_MIN_LENGTH,
  SITE_IDENTITY_SCHEMA,
  IdentityService,
  assertQdnIdentifier,
  assertTargetForPlanning,
  validateTargetInput,
  classifyCandidate,
  publicationStatusFor,
  publicationIsVerified,
  preparationStatusFor,
  isPendingPublication,
  deriveQdnIdentity,
  namespaceForSite,
  newSiteIdentity,
  projectTarget,
  routeHashFor,
  validateQortalName,
  validateResourcePrefix
} from './identity.js';
import {
  DEFAULT_DISK,
  DEFAULT_MEDIA,
  DEFAULT_PLANNING,
  GIB,
  MIB,
  formatBytes,
  resolveProjectConfig,
  resolveRunConfig
} from './config.js';
import {
  DISK_REPORT_SCHEMA,
  createStatfsProbe,
  defaultDiskProbe,
  diskPreflight,
  fixedDiskProbe,
  measureFreeBytes,
  sequenceDiskProbe
} from './disk.js';
import { PLAN_RECORD_SCHEMA, PLAN_SCHEMA, PlanningService } from './planner.js';
import { MEDIA_INSPECTION_SCHEMA, MEDIA_RECEIPT_SCHEMA, MediaService } from './media.js';
import {
  CONTENT_SCHEMA_NAME,
  readIndexedItem,
  readIndexEntries,
  resolveLatestSourceBatch
} from './source-index.js';
import { MediaDownloader } from '../media/downloader.js';
import { assetPathFor, finalizePart, hashFile, partPathFor, verifyAsset } from '../media/store.js';
import { assertMediaUrl, validateMediaUrl } from '../media/url-policy.js';

export const ENGINE_API_VERSION = 'qms-engine@1';
export const ENGINE_VERSION = '0.1.6-phase4';

/**
 * Create a headless engine instance. No Electron, no renderer, no network.
 */
export function createEngine(options = {}) {
  const clock = options.clock ?? systemClock;
  const dataRoot = options.dataRoot ?? defaultDataRoot(options.env ?? process.env);
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const profileResolver = options.profileResolver ?? (async (profileId) =>
    compatibilityRecord(loadProfile(profileId, { repoRoot })));
  const sourceRegistry = options.sourceRegistry
    ?? (options.sourceAdapters ? createSourceRegistry(options.sourceAdapters) : createBuiltinSourceRegistry());
  const projects = new ProjectService({
    dataRoot,
    repoRoot,
    clock,
    profileResolver,
    lockOptions: options.lockOptions ?? {},
    storeOptions: options.storeOptions ?? {},
    sourceRegistry,
    diskProbe: options.diskProbe ?? null,
    fetchImpl: options.fetchImpl ?? null,
    logger: options.logger ?? null
  });

  return {
    apiVersion: ENGINE_API_VERSION,
    version: ENGINE_VERSION,
    dataRoot,
    repoRoot,
    clock,
    projects,
    sourceRegistry,
    diskProbe: options.diskProbe ?? null,
    sources: {
      list: () => sourceRegistry.list(),
      capabilities: (adapterId) => sourceRegistry.capabilities(adapterId)
    },
    createProject: (input) => projects.create(input),
    openProject: (projectId, openOptions) => projects.open(projectId, openOptions),
    listProjects: (listOptions) => projects.list(listOptions),
    close: () => projects.closeAll(),
    compat: {
      loadProfile: (profileId) => loadProfile(profileId, { repoRoot }),
      profileIdentifiers,
      loadLegacyConfig,
      listLegacyCommandScripts: () => listLegacyCommandScripts(repoRoot),
      verifyCompatibility: (record) => verifyCompatibility(record, { repoRoot })
    }
  };
}

export {
  ProjectService,
  JournalStore,
  ProjectLock,
  EventBus,
  RunService,
  reconstructRunProgress,
  QmsError,
  ERROR_CODES,
  isQmsError,
  EVENT_SCHEMA,
  EVENT_TYPES,
  validateEvent,
  SourceService,
  SourceAdapterRegistry,
  createSourceRegistry,
  createBuiltinSourceRegistry,
  SOURCE_ADAPTER_CONTRACT,
  SOURCE_ADAPTER_CONTRACT_VERSION,
  CONTENT_SCHEMA,
  CONTENT_VERSION,
  HASH_ALGORITHM,
  computeContentHash,
  contentId,
  assertContentDocument,
  DISCOVERY_REPORT_SCHEMA,
  IdentityService,
  PlanningService,
  MediaService,
  MediaDownloader,
  SITE_IDENTITY_SCHEMA,
  IDENTITY_STATE_SCHEMA,
  PLAN_SCHEMA,
  PLAN_RECORD_SCHEMA,
  MEDIA_RECEIPT_SCHEMA,
  MEDIA_INSPECTION_SCHEMA,
  DISK_REPORT_SCHEMA,
  DEFAULT_RESOURCE_PREFIX,
  IDENTIFIER_MAX_LENGTH,
  PUBLICATION_STATUSES,
  LOCAL_PREPARATION_STATES,
  QORTAL_NAME_MIN_LENGTH,
  QORTAL_NAME_MAX_LENGTH,
  DEFAULT_PLANNING,
  DEFAULT_DISK,
  DEFAULT_MEDIA,
  GIB,
  MIB,
  formatBytes,
  resolveProjectConfig,
  resolveRunConfig,
  newSiteIdentity,
  namespaceForSite,
  projectTarget,
  validateQortalName,
  validateResourcePrefix,
  deriveQdnIdentity,
  assertQdnIdentifier,
  assertTargetForPlanning,
  classifyCandidate,
  routeHashFor,
  diskPreflight,
  measureFreeBytes,
  createStatfsProbe,
  defaultDiskProbe,
  fixedDiskProbe,
  sequenceDiskProbe,
  resolveLatestSourceBatch,
  readIndexEntries,
  readIndexedItem,
  CONTENT_SCHEMA_NAME,
  assetPathFor,
  finalizePart,
  hashFile,
  partPathFor,
  verifyAsset,
  validateMediaUrl,
  assertMediaUrl
};

export { defaultDataRoot, defaultRepoRoot };
