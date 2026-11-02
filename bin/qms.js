#!/usr/bin/env node
/**
 * qms — thin CLI over the Qortal Migration Studio engine.
 *
 * This file adds project/engine tooling. The legacy migration commands
 * (npm run inspect/dump/convert/.../batch:*) are untouched and remain the
 * supported Corbett workflow; `qms compat exec <name>` runs them as-is.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngine, ENGINE_VERSION } from '../lib/engine/index.js';
import { defaultDataRoot } from '../lib/engine/storage/paths.js';
import { runHost } from '../lib/engine/host/server.js';
import { isQmsError } from '../lib/engine/errors.js';
import { GIB, MIB, resolveProjectConfig } from '../lib/engine/config.js';
import { diskPreflight } from '../lib/engine/disk.js';

const HELP = `qms ${ENGINE_VERSION} — Qortal Migration Studio engine CLI

Usage:
  qms engine info [--json]
  qms project create --name <name> [--id <prj_...>] [--profile <id>]
                     [--adapter wordpress] [--source-url <url>]
                     [--qdn-name <name>] [--prefix <prefix>] [--batch-size <n>]
                     [--data-root <dir>] [--json]
  qms project list [--all] [--data-root <dir>] [--json]
  qms project show <projectId> [--json]
  qms project update <projectId> [--name <name>] [--adapter <id>]
                      [--source-url <url>] [--auth-mode <mode>]
                      [--qdn-name <name>] [--prefix <prefix>] [--batch-size <n>] [--json]
  qms identity show <projectId> [--json]
  qms identity conflicts <projectId> [--all] [--json]
  qms identity resolve <projectId> <conflictId> --resolution skip|alternate|abort
  qms identity migrate-preview <projectId> --qdn-name <name> [--prefix <prefix>]
  qms identity migrate-apply <projectId> --token <token>
  qms plan create <projectId> [--batch-size <n>] [--after <iso>] [--before <iso>]
                  [--modified-after <iso>] [--modified-before <iso>]
                  [--content-types post,page] [--statuses publish] [--search <text>]
                  [--no-media-estimates] [--allow-external] [--json]
  qms plan list <projectId> [--json]
  qms plan get <projectId> <planId> [--json]
  qms media download <projectId> --plan <planId> [--concurrency <n>]
                      [--max-files <n>] [--max-bytes-per-run <size>]
                      [--max-file-bytes <size>] [--reserve-gib <n>]
                      [--unknown-size-policy reject|cap|estimate] [--allow-external] [--json]
  qms media inspect <projectId> [--json]
  qms media reconcile <projectId> [--json]
  qms disk check <projectId> [--reserve-gib <n>] [--json]
  qms source capabilities [adapterId] [--json]
  qms source validate <projectId> [--adapter <id>] [--json]
  qms source discover <projectId> [--adapter <id>] [--per-page <n>]
                      [--max-items <n>] [--content-types post,page]
                      [--after <iso>] [--modified-after <iso>] [--json]
  qms project archive <projectId> [--delete-data] [--recover-stale]
  qms project validate <projectId> [--json]
  qms state compact <projectId> [--json]
  qms events <projectId> [--run <runId>] [--after <seq>] [--json]
  qms host [--data-root <dir>]
  qms compat list [--json]
  qms compat exec <script-name> [-- <args>]

Environment:
  QMS_DATA_ROOT   Override the XDG data root
                  (default: $XDG_DATA_HOME/qortal-migration-studio)

No command publishes to QDN. WordPress authentication secrets are read only
from WORDPRESS_USERNAME / WORDPRESS_APP_PASSWORD / WORDPRESS_PASSWORD and are
never written to project state, artifacts or logs.
`;

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  const passthrough = [];
  let afterDoubleDash = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (afterDoubleDash) {
      passthrough.push(arg);
      continue;
    }
    if (arg === '--') {
      afterDoubleDash = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const [rawKey, inlineValue] = arg.slice(2).split('=');
      const key = rawKey;
      if (inlineValue !== undefined) {
        flags[key] = inlineValue;
      } else if (argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) {
        flags[key] = argv[index + 1];
        index += 1;
      } else {
        flags[key] = true;
      }
      continue;
    }
    positional.push(arg);
  }
  return { positional, flags, passthrough };
}

function print(value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (typeof value === 'string') {
    process.stdout.write(`${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatProject(project) {
  const archived = project.archivedAt ? ' (archived)' : '';
  const profile = project.profileId ? ` profile=${project.profileId}` : '';
  return `${project.id}  ${project.name}${archived}${profile}\n  root: ${project.storageRoot}`;
}

function buildWordpressAuth(flags) {
  const mode = String(flags['auth-mode'] ?? process.env.WORDPRESS_AUTH_MODE ?? 'none').trim().toLowerCase();
  if (mode === 'application_password') {
    return {
      mode,
      username: process.env.WORDPRESS_USERNAME?.trim() ?? '',
      appPassword: process.env.WORDPRESS_APP_PASSWORD?.trim() ?? ''
    };
  }
  if (mode === 'session') {
    return {
      mode,
      username: process.env.WORDPRESS_USERNAME?.trim() ?? '',
      password: process.env.WORDPRESS_PASSWORD?.trim() ?? '',
      loginUrl: process.env.WORDPRESS_LOGIN_URL?.trim() || '/login/'
    };
  }
  return { mode: 'none' };
}

function parseBooleanFlag(value) {
  return value === true || value === 'true' || value === '1';
}

function parseByteSize(value, label) {
  if (value === undefined) return undefined;
  if (value === true) {
    throw new Error(label + ' requires a value.');
  }
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/i.exec(String(value).trim());
  if (!match) throw new Error(label + ' must be a byte size such as 512MiB or 10GiB.');
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const multiplier = unit === 'b' ? 1
    : unit === 'kb' || unit === 'kib' ? 1024
      : unit === 'mb' || unit === 'mib' ? MIB
        : GIB;
  return Math.floor(amount * multiplier);
}

function buildRunOverrides(flags) {
  const disk = {};
  if (flags['reserve-gib'] !== undefined) disk.reserveBytes = Math.floor(Number(flags['reserve-gib']) * GIB);
  if (flags['reserve-bytes'] !== undefined) disk.reserveBytes = parseByteSize(flags['reserve-bytes'], '--reserve-bytes');
  if (flags['max-bytes-per-run'] !== undefined) disk.maxBytesPerRun = parseByteSize(flags['max-bytes-per-run'], '--max-bytes-per-run');
  if (flags['max-file-bytes'] !== undefined) disk.maxFileBytes = parseByteSize(flags['max-file-bytes'], '--max-file-bytes');
  if (flags['max-files'] !== undefined) disk.maxFilesPerRun = Number(flags['max-files']);
  if (flags['unknown-size-policy'] !== undefined) disk.unknownSizePolicy = String(flags['unknown-size-policy']);
  if (flags['unknown-size-bytes'] !== undefined) disk.unknownSizeBytes = parseByteSize(flags['unknown-size-bytes'], '--unknown-size-bytes');
  if (flags['safety-factor'] !== undefined) disk.safetyFactor = Number(flags['safety-factor']);
  const media = {};
  if (flags['allow-external'] !== undefined) media.allowExternalMedia = parseBooleanFlag(flags['allow-external']);
  if (flags['allow-loopback'] !== undefined) media.allowLoopback = parseBooleanFlag(flags['allow-loopback']);
  if (flags.concurrency !== undefined) media.concurrency = Number(flags.concurrency);
  if (flags['max-retries'] !== undefined) media.maxRetries = Number(flags['max-retries']);
  if (flags['timeout-ms'] !== undefined) media.timeoutMs = Number(flags['timeout-ms']);
  return { disk, media };
}

function planFiltersFromFlags(flags) {
  return {
    ...(flags.after ? { after: flags.after } : {}),
    ...(flags.before ? { before: flags.before } : {}),
    ...(flags['modified-after'] ? { modifiedAfter: flags['modified-after'] } : {}),
    ...(flags['modified-before'] ? { modifiedBefore: flags['modified-before'] } : {}),
    ...(flags['content-types'] ? { contentTypes: String(flags['content-types']).split(',').map((value) => value.trim()).filter(Boolean) } : {}),
    ...(flags.statuses ? { statuses: String(flags.statuses).split(',').map((value) => value.trim()).filter(Boolean) } : {}),
    ...(flags.search ? { search: flags.search } : {})
  };
}

function formatPlanSummary(result) {
  const lines = [
    'plan ' + result.planId + ': ' + result.status,
    'batch: ' + result.plan.batchId,
    'selected: ' + result.stats.selected + ' of ' + result.stats.scanned + ' scanned',
    'classification: new ' + result.stats.new + ', modified ' + result.stats.modified + ', unchanged ' + result.stats.unchanged + ', route_changed ' + result.stats.route_changed + ', conflict ' + result.stats.conflict,
    'media: ' + result.media.count + ' files, ' + result.media.knownBytes + ' known bytes, ' + result.media.unknownCount + ' unknown, ' + result.media.missingCount + ' missing, ' + result.media.skippedExternal + ' external',
    'disk: ' + (result.disk.fits ? 'fits' : 'BLOCKED') + ' (free ' + result.disk.availableBytes + ', projected ' + result.disk.projectedBytes + ', reserve ' + result.disk.reserveBytes + ')',
    'plan file: ' + result.planFile
  ];
  for (const error of result.errors ?? []) lines.push('  [error] ' + error.code + ': ' + error.message);
  return lines.join('\n');
}

function formatMediaSummary(result) {
  const counts = result.counts ?? {};
  const lines = [
    'media ' + result.status + ' for plan ' + result.planId,
    'verified: ' + (counts.verified ?? 0) + ' (reused ' + (counts.reused ?? 0) + ')',
    'failed: ' + (counts.failed ?? 0) + ', paused: ' + (counts.paused ?? 0) + ', skipped: ' + (counts.skipped ?? 0) + ', conflicts: ' + (counts.conflicts ?? 0),
    'bytes downloaded: ' + (result.bytes ?? 0)
  ];
  if (result.errors?.length) {
    for (const error of result.errors.slice(0, 10)) lines.push('  [error] ' + error.code + ': ' + error.message);
  }
  return lines.join('\n');
}

function summarizeRun(result) {
  const lines = [`run ${result.runId}: ${result.status}`];
  for (const check of result.checks ?? []) {
    lines.push(`  [ok] ${check.name}`);
  }
  for (const warning of result.warnings ?? []) {
    lines.push(`  [warn] ${warning}`);
  }
  if (result.error) {
    lines.push(`  [error] ${result.error.code}: ${result.error.message}`);
  }
  return lines.join('\n');
}

async function openEngine(flags) {
  const dataRoot = flags['data-root'] ? path.resolve(String(flags['data-root'])) : defaultDataRoot();
  const engine = createEngine({ dataRoot });
  return engine;
}

async function main() {
  const { positional, flags, passthrough } = parseArgs(process.argv.slice(2));
  const [group, action, argument] = positional;
  const asJson = flags.json === true;

  if (!group || group === 'help' || flags.help) {
    process.stdout.write(HELP);
    return 0;
  }

  if (group === 'engine' && action === 'info') {
    print({
      apiVersion: 'qms-engine@1',
      version: ENGINE_VERSION,
      dataRoot: defaultDataRoot(),
      repoRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
      node: process.version
    }, asJson);
    return 0;
  }

  if (group === 'host') {
    const engine = await openEngine(flags);
    const host = await runHost({ engine, input: process.stdin, output: process.stdout });
    await host.closed;
    return 0;
  }

  if (group === 'compat') {
    const engine = await openEngine(flags);
    const commands = await engine.compat.listLegacyCommandScripts();
    if (action === 'list' || action === undefined) {
      print(commands, asJson);
      return 0;
    }
    if (action === 'exec') {
      const name = argument ?? positional[2];
      const allowed = new Set(commands.map((entry) => entry.name));
      if (!name || !allowed.has(name)) {
        process.stderr.write(`Unknown legacy command: ${name ?? '(missing)'}\n`);
        return 2;
      }
      return await new Promise((resolve) => {
        const child = spawn('npm', ['run', name, ...(passthrough.length ? ['--', ...passthrough] : [])], {
          cwd: engine.repoRoot,
          stdio: 'inherit'
        });
        child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
        child.on('error', (error) => {
          process.stderr.write(`Failed to run npm script ${name}: ${error.message}\n`);
          resolve(1);
        });
      });
    }
    process.stderr.write(HELP);
    return 2;
  }

  if (group === 'identity') {
    const engine = await openEngine(flags);
    const handle = await engine.projects.open(argument, {
      recoverStaleLock: flags['recover-stale'] === true
    });
    try {
      if (action === 'show') {
        const result = {
          identity: handle.identity.describe(),
          mappings: handle.identity.listMappings({ limit: Number(flags.limit ?? 1000) })
        };
        print(result, asJson);
        return 0;
      }
      if (action === 'conflicts') {
        const conflicts = handle.identity.listConflicts({
          includeResolved: flags.all === true,
          limit: Number(flags.limit ?? 1000)
        });
        print(conflicts, asJson);
        return 0;
      }
      if (action === 'resolve') {
        const conflictId = positional[3];
        if (!conflictId || !flags.resolution) {
          process.stderr.write('identity resolve requires <conflictId> and --resolution.\n');
          return 2;
        }
        const result = await handle.identity.resolveConflict({
          conflictId,
          resolution: String(flags.resolution)
        });
        print(result, asJson);
        return 0;
      }
      if (action === 'migrate-preview') {
        if (!flags['qdn-name']) {
          process.stderr.write('identity migrate-preview requires --qdn-name.\n');
          return 2;
        }
        const preview = await handle.identity.migrationPreview({
          target: {
            qdnName: String(flags['qdn-name']),
            ...(flags.prefix ? { resourcePrefix: String(flags.prefix) } : {})
          }
        });
        print(preview, asJson);
        return 0;
      }
      if (action === 'migrate-apply') {
        if (!flags.token) {
          process.stderr.write('identity migrate-apply requires --token from migrate-preview.\n');
          return 2;
        }
        const result = await handle.identity.applyMigration({ token: String(flags.token) });
        print(result, asJson);
        return 0;
      }
    } finally {
      await handle.close();
    }
    process.stderr.write(HELP);
    return 2;
  }

  if (group === 'plan') {
    const engine = await openEngine(flags);
    const handle = await engine.projects.open(argument, {
      recoverStaleLock: flags['recover-stale'] === true
    });
    try {
      if (action === 'create') {
        const overrides = buildRunOverrides(flags);
        const result = await handle.planning.create({
          batchSize: flags['batch-size'] !== undefined ? Number(flags['batch-size']) : undefined,
          filters: planFiltersFromFlags(flags),
          planning: {
            ...(flags.order ? { order: String(flags.order) } : {}),
            ...(flags['include-route-changes'] !== undefined
              ? { includeRouteChanges: parseBooleanFlag(flags['include-route-changes']) }
              : {}),
            ...(flags['max-scan-items'] !== undefined ? { maxScanItems: Number(flags['max-scan-items']) } : {})
          },
          disk: overrides.disk,
          media: overrides.media,
          estimateMedia: !parseBooleanFlag(flags['no-media-estimates'])
        });
        print(asJson ? result : formatPlanSummary(result), asJson);
        return result.status === 'failed' ? 1 : 0;
      }
      if (action === 'list') {
        print(handle.planning.list({ limit: Number(flags.limit ?? 100) }), asJson);
        return 0;
      }
      if (action === 'get') {
        const planId = positional[3];
        if (!planId) {
          process.stderr.write('plan get requires <planId>.\n');
          return 2;
        }
        print(await handle.planning.get(planId), asJson);
        return 0;
      }
    } finally {
      await handle.close();
    }
    process.stderr.write(HELP);
    return 2;
  }

  if (group === 'media') {
    const engine = await openEngine(flags);
    const handle = await engine.projects.open(argument, {
      recoverStaleLock: flags['recover-stale'] === true
    });
    try {
      if (action === 'download') {
        if (!flags.plan) {
          process.stderr.write('media download requires --plan <planId>.\n');
          return 2;
        }
        const overrides = buildRunOverrides(flags);
        const result = await handle.media.download({
          planId: String(flags.plan),
          disk: overrides.disk,
          media: overrides.media,
          concurrency: flags.concurrency !== undefined ? Number(flags.concurrency) : undefined
        });
        print(asJson ? result : formatMediaSummary(result), asJson);
        return ['failed'].includes(result.status) ? 1 : 0;
      }
      if (action === 'inspect') {
        print(await handle.media.inspect(), asJson);
        return 0;
      }
      if (action === 'reconcile') {
        print(await handle.media.reconcileReferences(), asJson);
        return 0;
      }
    } finally {
      await handle.close();
    }
    process.stderr.write(HELP);
    return 2;
  }

  if (group === 'disk' && action === 'check') {
    const engine = await openEngine(flags);
    const handle = await engine.projects.open(argument, {
      recoverStaleLock: flags['recover-stale'] === true
    });
    try {
      const overrides = buildRunOverrides(flags);
      const config = resolveProjectConfig(handle.project);
      const limits = { ...config.disk, ...overrides.disk };
      const report = await diskPreflight({
        probe: engine.diskProbe,
        workspacePath: handle.paths.root,
        limits,
        knownBytes: 0,
        unknownCount: 0,
        metadataBytes: 0
      });
      print(report, asJson);
      return report.fits ? 0 : 1;
    } finally {
      await handle.close();
    }
  }

  if (group === 'source') {
    const engine = await openEngine(flags);
    if (action === 'capabilities') {
      const adapterId = argument ?? flags.adapter ?? 'wordpress';
      print(engine.sourceRegistry.capabilities(adapterId), asJson);
      return 0;
    }
    if (action === 'validate') {
      const handle = await engine.projects.open(argument, {
        recoverStaleLock: flags['recover-stale'] === true
      });
      try {
        const result = await handle.source.validate({
          adapterId: flags.adapter ?? null,
          auth: buildWordpressAuth(flags),
          source: flags['source-url'] ? { baseUrl: String(flags['source-url']) } : {}
        });
        if (asJson) {
          print(result, true);
        } else if (result.status === 'completed') {
          const report = result.report;
          print([
            `run ${result.runId}: completed`,
            `site: ${report.site?.name ?? '(unknown)'} ${report.site?.url ?? ''}`.trim(),
            `auth: ${report.auth?.mode ?? 'none'}`,
            `warnings: ${report.warnings?.length ?? 0}`,
            `unsupported: ${report.unsupported?.length ?? 0}`
          ].join('\n'));
        } else {
          print(summarizeRun(result));
        }
        return result.status === 'completed' ? 0 : 1;
      } finally {
        await handle.close();
      }
    }
    if (action === 'discover') {
      const handle = await engine.projects.open(argument, {
        recoverStaleLock: flags['recover-stale'] === true
      });
      try {
        const contentTypes = flags['content-types']
          ? String(flags['content-types']).split(',').map((value) => value.trim()).filter(Boolean)
          : null;
        const result = await handle.source.discover({
          adapterId: flags.adapter ?? null,
          auth: buildWordpressAuth(flags),
          source: flags['source-url'] ? { baseUrl: String(flags['source-url']) } : {},
          contentTypes,
          perPage: flags['per-page'] ? Number(flags['per-page']) : 100,
          progressEvery: flags['progress-every'] ? Number(flags['progress-every']) : 25,
          maxItems: flags['max-items'] ? Number(flags['max-items']) : null,
          includeTerms: !parseBooleanFlag(flags['no-terms']),
          includeAssets: !parseBooleanFlag(flags['no-assets']),
          query: {
            ...(flags.after ? { after: flags.after } : {}),
            ...(flags.before ? { before: flags.before } : {}),
            ...(flags['modified-after'] ? { modified_after: flags['modified-after'] } : {}),
            ...(flags['modified-before'] ? { modified_before: flags['modified-before'] } : {})
          }
        });
        if (asJson) {
          print(result, true);
        } else if (result.status === 'completed') {
          print([
            `run ${result.runId}: completed`,
            `batch: ${result.batchId}`,
            `items: ${result.summary.items} (new ${result.summary.new}, updated ${result.summary.updated}, unchanged ${result.summary.unchanged})`,
            `content root: ${result.summary.contentRoot}`,
            `batch directory: ${result.paths.batchDir}`,
            `truncated: ${result.summary.truncated === true}`,
            `warnings: ${result.report.warnings.length}`,
            `unsupported: ${result.report.unsupported.length}`
          ].join('\n'));
        } else {
          print(summarizeRun(result));
        }
        return result.status === 'completed' ? 0 : 1;
      } finally {
        await handle.close();
      }
    }
    process.stderr.write(HELP);
    return 2;
  }

  if (group === 'project') {
    const engine = await openEngine(flags);
    if (action === 'create') {
      const source = {};
      if (flags.adapter) source.adapter = String(flags.adapter);
      if (flags['source-url']) source.baseUrl = String(flags['source-url']);
      if (flags['auth-mode']) source.authMode = String(flags['auth-mode']);
      const settings = {};
      if (flags['batch-size'] !== undefined) settings.planning = { batchSize: Number(flags['batch-size']) };
      if (flags.prefix !== undefined) settings.identity = { resourcePrefix: String(flags.prefix) };
      const target = flags['qdn-name'] !== undefined ? { qdnName: String(flags['qdn-name']) } : {};
      const project = await engine.projects.create({
        name: flags.name,
        id: flags.id,
        profileId: flags.profile,
        compatibility: flags.profile ? undefined : null,
        source,
        settings,
        target
      });
      print(project, asJson);
      return 0;
    }
    if (action === 'list') {
      const projects = await engine.projects.list({ includeArchived: flags.all === true });
      if (asJson) {
        print(projects, true);
      } else if (projects.length === 0) {
        print('No projects.');
      } else {
        print(projects.map(formatProject).join('\n\n'));
      }
      return 0;
    }
    if (action === 'show') {
      const { project, paths } = await engine.projects.get(argument);
      print({ project, paths }, asJson);
      return 0;
    }
    if (action === 'update') {
      const patch = flags.name ? { name: flags.name } : {};
      if (flags.adapter || flags['source-url'] || flags['auth-mode']) {
        patch.source = {};
        if (flags.adapter) patch.source.adapter = String(flags.adapter);
        if (flags['source-url']) patch.source.baseUrl = String(flags['source-url']);
        if (flags['auth-mode']) patch.source.authMode = String(flags['auth-mode']);
      }
      if (flags['qdn-name'] !== undefined) {
        patch.target = { qdnName: String(flags['qdn-name']) };
      }
      if (flags['batch-size'] !== undefined || flags.prefix !== undefined) {
        const { project } = await engine.projects.get(argument);
        patch.settings = { ...project.settings };
        if (flags['batch-size'] !== undefined) {
          patch.settings.planning = {
            ...(project.settings?.planning ?? {}),
            batchSize: Number(flags['batch-size'])
          };
        }
        if (flags.prefix !== undefined) {
          patch.settings.identity = {
            ...(project.settings?.identity ?? {}),
            resourcePrefix: String(flags.prefix)
          };
        }
      }
      const updated = await engine.projects.update(argument, patch);
      print(updated.project, asJson);
      return 0;
    }
    if (action === 'archive') {
      const result = await engine.projects.archive(argument, {
        deleteLocalData: flags['delete-data'] === true,
        recoverStaleLock: flags['recover-stale'] === true
      });
      print(result, asJson);
      return 0;
    }
    if (action === 'validate') {
      const handle = await engine.projects.open(argument, {
        recoverStaleLock: flags['recover-stale'] === true
      });
      try {
        const result = await handle.validate();
        print(asJson ? result : summarizeRun(result), asJson);
        return result.status === 'completed' ? 0 : 1;
      } finally {
        await handle.close();
      }
    }
    process.stderr.write(HELP);
    return 2;
  }

  if (group === 'run' && action === 'validate') {
    const engine = await openEngine(flags);
    const handle = await engine.projects.open(argument);
    try {
      const result = await handle.validate();
      print(asJson ? result : summarizeRun(result), asJson);
      return result.status === 'completed' ? 0 : 1;
    } finally {
      await handle.close();
    }
  }

  if (group === 'state' && action === 'compact') {
    const engine = await openEngine(flags);
    const handle = await engine.projects.open(argument);
    try {
      const result = await handle.store.compact({ reason: 'cli' });
      await handle.events.emit({
        type: 'state_snapshot',
        phase: 'state',
        level: 'info',
        code: 'STATE_SNAPSHOT',
        message: 'Project state compacted.',
        retryable: false,
        details: result
      });
      print(result, asJson);
      return 0;
    } finally {
      await handle.close();
    }
  }

  if (group === 'events') {
    const engine = await openEngine(flags);
    const handle = await engine.projects.open(action);
    try {
      const events = handle.events.list({
        runId: flags.run ?? null,
        afterSeq: Number(flags.after ?? 0),
        limit: Number(flags.limit ?? 500)
      });
      print(events, asJson);
      return 0;
    } finally {
      await handle.close();
    }
  }

  process.stderr.write(HELP);
  return 2;
}

main()
  .then((code) => {
    process.exitCode = code ?? 0;
  })
  .catch((error) => {
    if (isQmsError(error)) {
      process.stderr.write(`error [${error.code}]: ${error.message}\n`);
      if (Object.keys(error.details ?? {}).length > 0) {
        process.stderr.write(`${JSON.stringify(error.details, null, 2)}\n`);
      }
    } else {
      process.stderr.write(`error: ${error?.stack ?? error}\n`);
    }
    process.exitCode = 1;
  });
