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

const HELP = `qms ${ENGINE_VERSION} — Qortal Migration Studio engine CLI

Usage:
  qms engine info [--json]
  qms project create --name <name> [--id <prj_...>] [--profile <id>]
                     [--data-root <dir>] [--json]
  qms project list [--all] [--data-root <dir>] [--json]
  qms project show <projectId> [--json]
  qms project update <projectId> [--name <name>] [--json]
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

No command performs a WordPress import or a QDN publish.
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

  if (group === 'project') {
    const engine = await openEngine(flags);
    if (action === 'create') {
      const project = await engine.projects.create({
        name: flags.name,
        id: flags.id,
        profileId: flags.profile,
        compatibility: flags.profile ? undefined : null
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
