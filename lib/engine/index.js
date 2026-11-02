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

export const ENGINE_API_VERSION = 'qms-engine@1';
export const ENGINE_VERSION = '0.1.5-phase1';

/**
 * Create a headless engine instance. No Electron, no renderer, no network.
 */
export function createEngine(options = {}) {
  const clock = options.clock ?? systemClock;
  const dataRoot = options.dataRoot ?? defaultDataRoot(options.env ?? process.env);
  const repoRoot = options.repoRoot ?? defaultRepoRoot();
  const profileResolver = options.profileResolver ?? (async (profileId) =>
    compatibilityRecord(loadProfile(profileId, { repoRoot })));
  const projects = new ProjectService({
    dataRoot,
    repoRoot,
    clock,
    profileResolver,
    lockOptions: options.lockOptions ?? {},
    storeOptions: options.storeOptions ?? {},
    logger: options.logger ?? null
  });

  return {
    apiVersion: ENGINE_API_VERSION,
    version: ENGINE_VERSION,
    dataRoot,
    repoRoot,
    clock,
    projects,
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
  validateEvent
};

export { defaultDataRoot, defaultRepoRoot };
