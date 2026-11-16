#!/usr/bin/env node
/**
 * QMS worktree lifecycle enforcement.
 *
 * Safe, auditable worktree cleanup for agent tasks. A temporary worktree is
 * only eligible for cleanup when all of the following hold:
 *
 *   1. It has an explicit task ownership record in the shared registry.
 *   2. The owning task released it (state "idle"); active tasks are blocked.
 *   3. It has no modified, untracked or staged files.
 *   4. Its HEAD is an ancestor of the verified origin/main commit.
 *   5. The verified commit was read back from the Git remote (ls-remote).
 *   6. It is not the primary worktree and does not hold the main branch.
 *   7. Git does not report it as locked.
 *
 * Cleanup uses `git worktree remove` without --force. Local branches are
 * deleted only after an explicit ancestor check against the verified remote
 * commit. Remote branches are never touched.
 *
 * Commands:
 *   register  --task <id> [--path <dir>] [--branch <name>] [--json]
 *   release   [--path <dir>] [--json]
 *   status    [--expected-sha <sha>] [--json]
 *   cleanup   [--expected-sha <sha>] [--apply] [--json]
 *   verify    [--expected-sha <sha>] [--json]
 *   complete  --expected-sha <sha> [--json]
 *
 * Exit codes: 0 ok, 2 usage/state error, 3 blocked.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

export const SCHEMA = 'qms-worktree-lifecycle@1';
export const REGISTRY_SCHEMA = 'qms-worktree-registry@1';
export const REGISTRY_FILE = 'qms-worktrees.json';

const PROTECTED_BRANCHES = new Set(['main']);
const STATUS = {
  ELIGIBLE: 'ELIGIBLE',
  PROTECTED_PRIMARY: 'PROTECTED_PRIMARY',
  PROTECTED_MAIN: 'PROTECTED_MAIN',
  RETAINED_UNOWNED: 'RETAINED_UNOWNED',
  BLOCKED_DIRTY: 'BLOCKED_DIRTY',
  BLOCKED_UNMERGED: 'BLOCKED_UNMERGED',
  BLOCKED_ACTIVE: 'BLOCKED_ACTIVE',
  BLOCKED_LOCKED: 'BLOCKED_LOCKED',
  BLOCKED_REMOTE: 'BLOCKED_REMOTE',
  STALE_REGISTRATION: 'STALE_REGISTRATION'
};
export const STATUSES = STATUS;

function git(args, cwd, { allowFailure = false, env } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ? { ...process.env, ...env } : process.env
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = error && error.stderr ? String(error.stderr).trim() : error.message;
    throw new Error('git ' + args.join(' ') + ' failed: ' + detail);
  }
}

function isAncestor(commit, ancestor, cwd) {
  if (!commit || !ancestor) return false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, ancestor], {
      cwd,
      stdio: 'ignore'
    });
    return true;
  } catch {
    return false;
  }
}

export function gitCommonDir(cwd) {
  return path.resolve(cwd, git(['rev-parse', '--git-common-dir'], cwd));
}

export function registryPath(cwd) {
  return path.join(gitCommonDir(cwd), REGISTRY_FILE);
}

export function readRegistry(cwd) {
  const file = registryPath(cwd);
  if (!existsSync(file)) {
    return { schema: REGISTRY_SCHEMA, worktrees: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || parsed.schema !== REGISTRY_SCHEMA || typeof parsed.worktrees !== 'object') {
      throw new Error('unsupported registry schema');
    }
    return parsed;
  } catch (error) {
    throw new Error('Cannot read worktree registry ' + file + ': ' + error.message);
  }
}

export function writeRegistry(cwd, registry) {
  const file = registryPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  return file;
}

export function listWorktrees(cwd) {
  const raw = git(['worktree', 'list', '--porcelain'], cwd);
  const records = [];
  for (const block of raw.split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const record = { path: null, head: null, branch: null, detached: false, locked: false, prunable: false };
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) record.path = line.slice('worktree '.length).trim();
      else if (line.startsWith('HEAD ')) record.head = line.slice('HEAD '.length).trim();
      else if (line.startsWith('branch ')) record.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      else if (line === 'detached') record.detached = true;
      else if (line.startsWith('locked')) record.locked = true;
      else if (line.startsWith('prunable')) record.prunable = true;
    }
    if (record.path) records.push(record);
  }
  return records;
}

export function verifyRemoteMain(cwd, expectedSha) {
  const remote = git(['ls-remote', 'origin', 'refs/heads/main'], cwd, { allowFailure: true });
  if (!remote) {
    return { verified: false, sha: null, reason: 'git ls-remote origin refs/heads/main failed' };
  }
  const remoteSha = remote.split(/\s+/)[0];
  if (!remoteSha) {
    return { verified: false, sha: null, reason: 'origin/main was not found on the remote' };
  }
  if (expectedSha && expectedSha !== remoteSha) {
    return {
      verified: false,
      sha: remoteSha,
      reason: 'expected ' + expectedSha + ' but the remote main is ' + remoteSha
    };
  }
  return { verified: true, sha: remoteSha, reason: null };
}

function worktreeStatus(record, { primaryPath, verifiedSha, registry, cwd }) {
  if (!existsSync(record.path)) {
    return { status: STATUS.STALE_REGISTRATION, reason: 'worktree directory no longer exists' };
  }
  if (path.resolve(record.path) === path.resolve(primaryPath)) {
    return { status: STATUS.PROTECTED_PRIMARY, reason: 'primary repository worktree' };
  }
  if (record.branch && PROTECTED_BRANCHES.has(record.branch)) {
    return { status: STATUS.PROTECTED_MAIN, reason: 'designated main worktree' };
  }
  if (record.locked) {
    return { status: STATUS.BLOCKED_LOCKED, reason: 'worktree is locked' };
  }
  const dirty = git(['-C', record.path, 'status', '--porcelain=v1'], cwd, { allowFailure: true });
  if (dirty === null) {
    return { status: STATUS.BLOCKED_DIRTY, reason: 'worktree status could not be read' };
  }
  if (dirty !== '') {
    const paths = dirty.split('\n').filter(Boolean);
    return {
      status: STATUS.BLOCKED_DIRTY,
      reason: 'uncommitted or untracked files (' + paths.length + ')',
      details: paths.slice(0, 20)
    };
  }
  const entry = registry.worktrees[path.resolve(record.path)];
  if (!entry) {
    return { status: STATUS.RETAINED_UNOWNED, reason: 'no task ownership record; owner worktree' };
  }
  if (entry.state === 'active') {
    return { status: STATUS.BLOCKED_ACTIVE, reason: 'task ' + (entry.task || 'unknown') + ' is still active' };
  }
  if (!verifiedSha) {
    return { status: STATUS.BLOCKED_REMOTE, reason: 'origin/main could not be verified' };
  }
  if (!isAncestor(record.head, verifiedSha, cwd)) {
    return {
      status: STATUS.BLOCKED_UNMERGED,
      reason: 'HEAD ' + record.head.slice(0, 12) + ' is not contained in verified main ' + verifiedSha.slice(0, 12)
    };
  }
  return { status: STATUS.ELIGIBLE, reason: 'clean, merged and released by task ' + (entry.task || 'unknown') };
}

export function classifyWorktrees({ cwd, expectedSha }) {
  const remote = verifyRemoteMain(cwd, expectedSha);
  const registry = readRegistry(cwd);
  const records = listWorktrees(cwd);
  const primaryPath = records.length ? records[0].path : null;
  const verifiedSha = remote.verified ? remote.sha : null;
  const worktrees = records.map((record) => {
    const verdict = worktreeStatus(record, { primaryPath, verifiedSha, registry, cwd });
    return {
      path: record.path,
      branch: record.branch,
      head: record.head,
      detached: record.detached,
      registered: Boolean(registry.worktrees[path.resolve(record.path)]),
      task: registry.worktrees[path.resolve(record.path)]?.task ?? null,
      ...verdict,
      remoteVerified: remote.verified,
      reason: remote.verified ? verdict.reason : (verdict.status === STATUS.ELIGIBLE ? remote.reason : verdict.reason)
    };
  });
  return {
    schema: SCHEMA,
    remote,
    verifiedSha,
    worktrees,
    eligible: worktrees.filter((w) => w.status === STATUS.ELIGIBLE),
    blocked: worktrees.filter((w) => w.status.startsWith('BLOCKED_')),
    retained: worktrees.filter((w) =>
      w.status === STATUS.RETAINED_UNOWNED ||
      w.status === STATUS.PROTECTED_PRIMARY ||
      w.status === STATUS.PROTECTED_MAIN
    ),
    stale: worktrees.filter((w) => w.status === STATUS.STALE_REGISTRATION)
  };
}

function branchIsMerged(cwd, branch, verifiedSha) {
  return isAncestor('refs/heads/' + branch, verifiedSha, cwd);
}

export function cleanupWorktrees({ cwd, expectedSha, apply = false }) {
  const before = classifyWorktrees({ cwd, expectedSha });
  const registry = readRegistry(cwd);
  const removed = [];
  const failed = [];
  const pruned = [];

  if (!before.remote.verified) {
    return {
      ...before,
      applied: false,
      removed,
      failed,
      pruned,
      worktreesBefore: before.worktrees.length,
      worktreesAfter: before.worktrees.length,
      finalCount: before.worktrees.length,
      cleanupStatus: 'BLOCKED',
      reason: 'remote main could not be verified: ' + before.remote.reason,
      exitCode: 3
    };
  }

  for (const stale of before.stale) {
    if (!apply) continue;
    const result = git(['worktree', 'prune'], cwd, { allowFailure: true });
    if (result !== null) pruned.push(stale.path);
  }

  for (const item of before.eligible) {
    if (!apply) continue;
    const result = git(['worktree', 'remove', item.path], cwd, { allowFailure: true });
    if (result === null || existsSync(item.path)) {
      failed.push({ path: item.path, reason: 'git worktree remove refused or left the directory in place' });
      continue;
    }
    let branchDeleted = false;
    if (item.branch && !PROTECTED_BRANCHES.has(item.branch) && branchIsMerged(cwd, item.branch, before.verifiedSha)) {
      const deleted = git(['branch', '-D', item.branch], cwd, { allowFailure: true });
      branchDeleted = deleted !== null;
      if (!branchDeleted) {
        failed.push({ path: item.path, reason: 'worktree removed but branch ' + item.branch + ' could not be deleted' });
      }
    }
    delete registry.worktrees[path.resolve(item.path)];
    removed.push({ path: item.path, branch: item.branch, branchDeleted });
  }

  if (apply) writeRegistry(cwd, registry);

  const after = apply ? classifyWorktrees({ cwd, expectedSha }) : before;
  const blocked = after.blocked;
  const eligibleLeft = after.eligible;
  const cleanupStatus = blocked.length
    ? 'BLOCKED'
    : removed.length
      ? 'CLEANED'
      : eligibleLeft.length
        ? 'RETAINED'
        : after.worktrees.every(
            (w) => w.status === STATUS.PROTECTED_PRIMARY || w.status === STATUS.PROTECTED_MAIN
          )
          ? 'NOT_APPLICABLE'
          : 'RETAINED';

  return {
    schema: SCHEMA,
    command: apply ? 'cleanup' : 'status',
    applied: apply,
    remote: before.remote,
    verifiedSha: before.verifiedSha,
    worktrees: after.worktrees,
    eligible: eligibleLeft,
    retained: after.retained,
    blocked,
    stale: after.stale,
    removed,
    failed,
    pruned,
    worktreesBefore: before.worktrees.length,
    worktreesAfter: after.worktrees.length,
    finalCount: after.worktrees.length,
    cleanupStatus,
    reason: blocked.length
      ? 'blocked worktrees require owner or agent action: ' + blocked.map((b) => path.basename(b.path)).join(', ')
      : removed.length
        ? 'removed ' + removed.length + ' eligible worktree(s)'
        : eligibleLeft.length
          ? eligibleLeft.length + ' eligible worktree(s) remain; run with --apply'
          : 'no eligible worktrees; retained worktrees are protected or unowned',
    exitCode: blocked.length ? 3 : 0
  };
}

export function registerWorktree({ cwd, worktreePath, task, branch, state = 'active' }) {
  const target = path.resolve(worktreePath || cwd);
  const records = listWorktrees(cwd);
  const record = records.find((r) => path.resolve(r.path) === target);
  if (!record) throw new Error('not a registered worktree: ' + target);
  const registry = readRegistry(cwd);
  registry.worktrees[target] = {
    task,
    branch: branch || record.branch || (record.detached ? null : null),
    head: record.head,
    state,
    registeredAt: new Date().toISOString()
  };
  writeRegistry(cwd, registry);
  return registry.worktrees[target];
}

export function releaseWorktree({ cwd, worktreePath }) {
  const target = path.resolve(worktreePath || cwd);
  const registry = readRegistry(cwd);
  const entry = registry.worktrees[target];
  if (!entry) throw new Error('no ownership record for ' + target);
  entry.state = 'idle';
  entry.releasedAt = new Date().toISOString();
  writeRegistry(cwd, registry);
  return entry;
}

export function formatCompletionReport(result) {
  const lines = [];
  lines.push('Worktree lifecycle');
  lines.push('  Remote SHA: ' + (result.verifiedSha || 'unverified'));
  lines.push('  Remote verified: ' + (result.remote && result.remote.verified ? 'yes' : 'no'));
  lines.push('  Worktrees before: ' + result.worktreesBefore);
  lines.push('  Removed: ' + result.removed.length);
  const retainedLabel = result.retained.map((w) => path.basename(w.path) + ' (' + w.status + ')').join(', ');
  lines.push('  Retained: ' + (retainedLabel || 'none'));
  lines.push('  Blocked: ' + (result.blocked.map((w) => path.basename(w.path) + ' (' + w.status + ')').join(', ') || 'none'));
  lines.push('  Final worktree count: ' + result.finalCount);
  lines.push('  Cleanup status: ' + result.cleanupStatus);
  lines.push('  Reason: ' + result.reason);
  return lines.join('\n');
}

function parseArgs(argv) {
  const args = { command: argv[0] || 'status' };
  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') args.json = true;
    else if (token === '--apply') args.apply = true;
    else if (token === '--task') args.task = argv[++i];
    else if (token === '--path') args.worktreePath = argv[++i];
    else if (token === '--branch') args.branch = argv[++i];
    else if (token === '--expected-sha') args.expectedSha = argv[++i];
    else if (token === '--cwd') args.cwd = argv[++i];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error('unknown argument: ' + token);
  }
  return args;
}

function usage() {
  return [
    'Usage: node scripts/worktree/lifecycle.mjs <command> [options]',
    '',
    '  register --task <id> [--path <dir>]   record task ownership (state active)',
    '  release  [--path <dir>]               mark the owning task finished (state idle)',
    '  status   [--expected-sha <sha>]       classify every worktree',
    '  cleanup  [--expected-sha <sha>] [--apply]  remove eligible worktrees',
    '  verify   [--expected-sha <sha>]       exit 3 when cleanup is blocked',
    '  complete --expected-sha <sha>         cleanup + completion report',
    '',
    'Cleanup is dry-run unless --apply is passed.'
  ].join('\n');
}

export function runLifecycle(options) {
  const cwd = options.cwd || process.cwd();
  const command = options.command || 'status';
  if (command === 'register') {
    const entry = registerWorktree({
      cwd,
      worktreePath: options.worktreePath,
      task: options.task,
      branch: options.branch
    });
    return { schema: SCHEMA, command, entry, exitCode: 0 };
  }
  if (command === 'release') {
    const entry = releaseWorktree({ cwd, worktreePath: options.worktreePath });
    return { schema: SCHEMA, command, entry, exitCode: 0 };
  }
  if (command === 'status') {
    const result = classifyWorktrees({ cwd, expectedSha: options.expectedSha });
    const blocked = result.blocked.length > 0;
    return {
      ...result,
      command,
      worktreesBefore: result.worktrees.length,
      worktreesAfter: result.worktrees.length,
      finalCount: result.worktrees.length,
      removed: [],
      cleanupStatus: blocked ? 'BLOCKED' : 'RETAINED',
      reason: blocked ? 'blocked worktrees present' : 'classification only; nothing removed',
      exitCode: 0
    };
  }
  if (command === 'cleanup') {
    return cleanupWorktrees({ cwd, expectedSha: options.expectedSha, apply: Boolean(options.apply) });
  }
  if (command === 'verify') {
    const result = cleanupWorktrees({ cwd, expectedSha: options.expectedSha, apply: false });
    const eligibleLeft = result.eligible ? result.eligible.length : 0;
    const code = result.blocked.length > 0 || eligibleLeft > 0 || !result.remote.verified ? 3 : 0;
    return {
      ...result,
      command,
      cleanupStatus: result.blocked.length ? 'BLOCKED' : eligibleLeft ? 'RETAINED' : result.cleanupStatus,
      reason: result.blocked.length
        ? result.reason
        : eligibleLeft
          ? eligibleLeft + ' eligible worktree(s) still present; run npm run worktree:cleanup -- --apply'
          : result.reason,
      exitCode: code
    };
  }
  if (command === 'complete') {
    const result = cleanupWorktrees({ cwd, expectedSha: options.expectedSha, apply: true });
    return { ...result, command, exitCode: result.cleanupStatus === 'BLOCKED' ? 3 : 0 };
  }
  throw new Error('unknown command: ' + command);
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exitCode = 2;
    return;
  }
  if (args.help) {
    console.log(usage());
    return;
  }
  try {
    const result = runLifecycle({ ...args, cwd: args.cwd || process.cwd() });
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (args.command === 'complete') {
      console.log(formatCompletionReport(result));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    process.exitCode = result.exitCode || 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (import.meta.url === 'file://' + process.argv[1]) {
  main();
}
