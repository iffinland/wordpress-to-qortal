import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  runLifecycle,
  listWorktrees,
  STATUSES
} from '../../scripts/worktree/lifecycle.mjs';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'QMS Test',
      GIT_AUTHOR_EMAIL: 'qms-test@example.invalid',
      GIT_COMMITTER_NAME: 'QMS Test',
      GIT_COMMITTER_EMAIL: 'qms-test@example.invalid'
    }
  }).trim();
}

async function makeRepository() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-worktree-test-'));
  const origin = path.join(root, 'origin.git');
  git(['init', '--bare', '-b', 'main', origin], root);
  const seed = path.join(root, 'seed');
  git(['clone', origin, seed], root);
  await writeFile(path.join(seed, 'README.md'), 'base\n');
  git(['add', '.'], seed);
  git(['commit', '-m', 'base'], seed);
  git(['push', 'origin', 'main'], seed);
  const repo = path.join(root, 'repo');
  git(['clone', origin, repo], root);
  return { root, origin, repo, sha: git(['rev-parse', 'HEAD'], repo) };
}

function addWorktree(repo, root, name, branch) {
  const dir = path.join(root, name);
  git(['worktree', 'add', '-b', branch, dir, 'main'], repo);
  return dir;
}

function cleanup(root) {
  return rm(root, { recursive: true, force: true });
}

test('clean, released, merged worktree is removed without force and its branch is deleted', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'task-a', 'task/a');

  const registered = runLifecycle({ cwd: repo, command: 'register', worktreePath: wt, task: 'task-a' });
  assert.equal(registered.exitCode, 0);
  assert.equal(registered.entry.state, 'active');

  const active = runLifecycle({ cwd: repo, command: 'status', expectedSha: sha });
  assert.equal(active.worktrees.find((w) => w.path === wt).status, STATUSES.BLOCKED_ACTIVE);

  runLifecycle({ cwd: repo, command: 'release', worktreePath: wt });
  const status = runLifecycle({ cwd: repo, command: 'status', expectedSha: sha });
  assert.equal(status.worktrees.find((w) => w.path === wt).status, STATUSES.ELIGIBLE);

  const result = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha, apply: true });
  assert.equal(result.removed.length, 1);
  assert.equal(result.removed[0].path, wt);
  assert.equal(result.removed[0].branchDeleted, true);
  assert.equal(existsSync(wt), false);
  assert.equal(result.finalCount, 1);
  assert.equal(result.cleanupStatus, 'CLEANED');
  assert.equal(result.exitCode, 0);
  const branches = git(['branch', '--format=%(refname:short)'], repo);
  assert.equal(branches, 'main');
});

test('dirty worktree is blocked and never removed', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'dirty', 'task/dirty');
  await writeFile(path.join(wt, 'notes.txt'), 'uncommitted\n');
  runLifecycle({ cwd: repo, command: 'register', worktreePath: wt, task: 'dirty' });
  runLifecycle({ cwd: repo, command: 'release', worktreePath: wt });

  const result = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha, apply: true });
  const status = result.blocked.find((w) => w.path === wt);
  assert.equal(status.status, STATUSES.BLOCKED_DIRTY);
  assert.equal(existsSync(path.join(wt, 'notes.txt')), true);
  assert.equal(result.cleanupStatus, 'BLOCKED');
  assert.equal(result.exitCode, 3);
});

test('worktree with an unmerged commit is blocked', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'unmerged', 'task/unmerged');
  await writeFile(path.join(wt, 'feature.txt'), 'work\n');
  git(['add', '.'], wt);
  git(['commit', '-m', 'unmerged work'], wt);
  runLifecycle({ cwd: repo, command: 'register', worktreePath: wt, task: 'unmerged' });
  runLifecycle({ cwd: repo, command: 'release', worktreePath: wt });

  const result = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha, apply: true });
  const status = result.blocked.find((w) => w.path === wt);
  assert.equal(status.status, STATUSES.BLOCKED_UNMERGED);
  assert.equal(existsSync(wt), true);
  assert.equal(result.exitCode, 3);
});

test('active task worktree is blocked even when clean and merged', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'active', 'task/active');
  runLifecycle({ cwd: repo, command: 'register', worktreePath: wt, task: 'still-running' });

  const result = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha, apply: true });
  assert.equal(result.blocked.find((w) => w.path === wt).status, STATUSES.BLOCKED_ACTIVE);
  assert.equal(existsSync(wt), true);
});

test('owner worktree without an ownership record is retained', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'owner', 'owner/manual');

  const result = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha, apply: true });
  assert.equal(result.worktrees.find((w) => w.path === wt).status, STATUSES.RETAINED_UNOWNED);
  assert.equal(existsSync(wt), true);
  assert.equal(result.removed.length, 0);
  assert.equal(result.cleanupStatus, 'RETAINED');
  assert.equal(result.exitCode, 0);
});

test('primary worktree and the designated main worktree are protected', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  git(['checkout', '-b', 'develop'], repo);
  const mainWorktree = path.join(root, 'main-wt');
  git(['worktree', 'add', mainWorktree, 'main'], repo);
  runLifecycle({ cwd: repo, command: 'register', worktreePath: repo, task: 'primary' });
  runLifecycle({ cwd: repo, command: 'register', worktreePath: mainWorktree, task: 'main' });

  const status = runLifecycle({ cwd: repo, command: 'status', expectedSha: sha });
  assert.equal(status.worktrees.find((w) => w.path === repo).status, STATUSES.PROTECTED_PRIMARY);
  assert.equal(status.worktrees.find((w) => w.path === mainWorktree).status, STATUSES.PROTECTED_MAIN);

  const result = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha, apply: true });
  assert.equal(result.removed.length, 0);
  assert.equal(existsSync(mainWorktree), true);
});

test('locked worktree is blocked', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'locked', 'task/locked');
  runLifecycle({ cwd: repo, command: 'register', worktreePath: wt, task: 'locked' });
  runLifecycle({ cwd: repo, command: 'release', worktreePath: wt });
  git(['worktree', 'lock', wt], repo);

  const result = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha, apply: true });
  assert.equal(result.blocked.find((w) => w.path === wt).status, STATUSES.BLOCKED_LOCKED);
  assert.equal(existsSync(wt), true);
});

test('cleanup is a dry run unless --apply is passed', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'dry', 'task/dry');
  runLifecycle({ cwd: repo, command: 'register', worktreePath: wt, task: 'dry' });
  runLifecycle({ cwd: repo, command: 'release', worktreePath: wt });

  const dry = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha });
  assert.equal(dry.applied, false);
  assert.equal(dry.removed.length, 0);
  assert.equal(existsSync(wt), true);

  const verify = runLifecycle({ cwd: repo, command: 'verify', expectedSha: sha });
  assert.equal(verify.exitCode, 3, 'verify must fail while an eligible worktree remains');
});

test('mismatched expected SHA blocks all cleanup', async (t) => {
  const { root, repo } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'sha', 'task/sha');
  runLifecycle({ cwd: repo, command: 'register', worktreePath: wt, task: 'sha' });
  runLifecycle({ cwd: repo, command: 'release', worktreePath: wt });

  const result = runLifecycle({
    cwd: repo,
    command: 'cleanup',
    expectedSha: '0123456789abcdef0123456789abcdef01234567',
    apply: true
  });
  assert.equal(result.remote.verified, false);
  assert.equal(result.cleanupStatus, 'BLOCKED');
  assert.equal(result.exitCode, 3);
  assert.equal(existsSync(wt), true);
});

test('stale registration is reported and pruned on apply', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'stale', 'task/stale');
  await rm(wt, { recursive: true, force: true });

  const before = listWorktrees(repo);
  assert.equal(before.some((w) => w.path === wt), true, 'registration still exists');
  const status = runLifecycle({ cwd: repo, command: 'status', expectedSha: sha });
  assert.equal(status.stale.length, 1);

  const result = runLifecycle({ cwd: repo, command: 'cleanup', expectedSha: sha, apply: true });
  assert.equal(result.pruned.length, 1);
  assert.equal(listWorktrees(repo).some((w) => w.path === wt), false);
});

test('completion report carries the required fields and statuses', async (t) => {
  const { root, repo, sha } = await makeRepository();
  t.after(() => cleanup(root));
  const wt = addWorktree(repo, root, 'complete', 'task/complete');
  runLifecycle({ cwd: repo, command: 'register', worktreePath: wt, task: 'complete' });
  runLifecycle({ cwd: repo, command: 'release', worktreePath: wt });

  const result = runLifecycle({ cwd: repo, command: 'complete', expectedSha: sha });
  assert.equal(result.verifiedSha, sha);
  assert.equal(result.cleanupStatus, 'CLEANED');
  assert.equal(result.finalCount, 1);
  assert.deepEqual(
    ['remote', 'removed', 'retained', 'blocked', 'finalCount', 'cleanupStatus'],
    ['remote', 'removed', 'retained', 'blocked', 'finalCount', 'cleanupStatus'].filter((key) => key in result)
  );
  for (const key of ['verifiedSha', 'worktreesBefore', 'cleanupStatus', 'reason', 'finalCount']) {
    assert.ok(key in result, 'missing ' + key);
  }
});
