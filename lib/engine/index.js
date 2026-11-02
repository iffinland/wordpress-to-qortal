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

export const ENGINE_API_VERSION = 'qms-engine@1';
export const ENGINE_VERSION = '0.1.5-phase2';

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
  DISCOVERY_REPORT_SCHEMA
};

export { defaultDataRoot, defaultRepoRoot };
