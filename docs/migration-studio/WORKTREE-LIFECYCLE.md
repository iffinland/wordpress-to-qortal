# Worktree lifecycle (enforced)

QMS agent tasks run in temporary Git worktrees. Every task must leave the
repository in a predictable state: the integration commit is on GitHub main, the
temporary worktree is gone, and no unrelated work was discarded.

This document describes the executable mechanism, not a convention.
`scripts/worktree/lifecycle.mjs` performs the checks and cleanup, and
`npm run worktree:complete -- --expected-sha <sha>` is the task-completion gate.

## Ownership registry

Worktrees are only cleaned automatically when they have an explicit ownership
record. The registry lives in the shared Git directory, never in the repository
history:

```
<git-common-dir>/qms-worktrees.json
```

Schema `qms-worktree-registry@1`:

```json
{
  "schema": "qms-worktree-registry@1",
  "worktrees": {
    "/abs/path/to/worktree": {
      "task": "cms-attachments",
      "branch": "agent/cms-attachments",
      "head": "0123456789abcdef...",
      "state": "active",
      "registeredAt": "2026-11-16T18:00:00.000Z"
    }
  }
}
```

- A worktree without a record is treated as an owner worktree and is never
  removed automatically.
- `state: "active"` blocks cleanup even when the worktree is clean and merged.
- The task releases the worktree (`state: "idle"`) only after the integration
  commit is verified on the remote.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run worktree:register -- --task <id>` | Record task ownership (run inside the worktree). |
| `npm run worktree:release` | Mark the current worktree's task finished. |
| `npm run worktree:status -- --expected-sha <sha>` | Classify every worktree without changing anything. |
| `npm run worktree:cleanup -- --expected-sha <sha>` | Dry run: report what would be removed. |
| `npm run worktree:cleanup -- --expected-sha <sha> --apply` | Remove eligible worktrees. |
| `npm run worktree:verify -- --expected-sha <sha>` | Exit 3 while an eligible or blocked worktree remains. |
| `npm run worktree:complete -- --expected-sha <sha>` | Cleanup plus the mandatory completion report. |

Every command accepts `--json` for machine-readable output. Exit codes:
`0` clean, `2` usage or state error, `3` blocked.

## Eligibility rules

A worktree is removed only when all of these hold:

1. An ownership record exists and its state is `idle`.
2. `git status --porcelain` is empty (no modified, staged or untracked files).
3. HEAD is an ancestor of the verified `origin/main`.
4. The verified commit was read back from the remote with
   `git ls-remote origin refs/heads/main` and matches `--expected-sha`.
5. It is not the primary worktree.
6. It does not hold a protected branch, including `main`.
7. Git does not report it as locked.

Cleanup always uses `git worktree remove` without `--force`. A local branch is
deleted only after an explicit `git merge-base --is-ancestor` check against the
verified remote commit. Remote branches are never touched.

## Blocked states

| Status | Meaning |
| --- | --- |
| `BLOCKED_DIRTY` | Uncommitted or untracked files exist. |
| `BLOCKED_UNMERGED` | HEAD is not contained in the verified main commit. |
| `BLOCKED_ACTIVE` | The owning task has not released the worktree. |
| `BLOCKED_LOCKED` | Git reports the worktree as locked. |
| `BLOCKED_REMOTE` | `origin/main` could not be verified, or the expected SHA differs. |
| `RETAINED_UNOWNED` | No ownership record; treated as owner work. |
| `PROTECTED_PRIMARY`, `PROTECTED_MAIN` | Canonical worktrees that are never removed. |
| `STALE_REGISTRATION` | The directory is gone; `cleanup --apply` prunes the record. |

## Task completion report

`npm run worktree:complete -- --expected-sha <sha>` prints and exits with:

```
Worktree lifecycle
  Remote SHA: <sha>
  Remote verified: yes
  Worktrees before: N
  Removed: N
  Retained: <path> (RETAINED_UNOWNED), ...
  Blocked: <path> (BLOCKED_DIRTY), ...
  Final worktree count: N
  Cleanup status: CLEANED | RETAINED | BLOCKED | NOT_APPLICABLE
  Reason: <text>
```

A blocked result exits `3`. Report the blocker; never claim full cleanup while
the command fails.

## Agent workflow

1. Create the temporary worktree and register it:
   `npm run worktree:register -- --task <task-id>` (run inside the worktree).
2. Develop, test, commit and push the branch.
3. Merge to `main` and read back the remote SHA with
   `git ls-remote origin refs/heads/main`.
4. Release the worktree: `npm run worktree:release` (inside it).
5. Run `npm run worktree:complete -- --expected-sha <remote-sha>` from the
   canonical worktree and include its report in the final task summary.

Steps 1, 4 and 5 are executable gates. Steps 2 and 3 remain process rules
enforced by the repository AGENTS.md and the existing release gates.

## Tests

`npm run test:worktree` covers successful cleanup, dirty worktrees, unmerged
commits, active tasks, locked worktrees, unowned owner worktrees, protected
canonical paths, dry-run behaviour, stale registrations and SHA mismatches.
