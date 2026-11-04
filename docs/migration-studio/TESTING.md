# Testing the Qortal Migration Studio

All commands run from the repository root. The Node.js suite and the Vitest
suites are deliberately separate runners.

## Commands

| Purpose | Command |
| --- | --- |
| Node test suite (intended scope) | `npm test` |
| Full regression (Node + generic CMS + desktop) | `npm run test:all` |
| Generic CMS Vitest suite | `npm run cms-template:test` |
| Desktop typecheck | `npm --prefix desktop run typecheck` |
| Desktop Vitest suite | `npm run test:desktop` |
| Phase 5.2 suite | `npm run test:phase5.2` |
| Phase 5.2 deployment layout | `node --test test/phase5.2/deploy-script-layout.test.js` |
| Phase 7 suite | `npm run test:phase7` |
| WordPress content policy | `node --test test/source/wordpress-content-policy.test.js` |
| Corbett compatibility | `node --test test/source/corbett-compat.test.js test/phase6/corbett-regression.test.js` |
| Builds | `npm run migration:build && npm run cms:build && npm run cms-template:build` |
| Desktop build | `npm --prefix desktop run build` |

`npm run check` runs `test:all` and all four builds.

## Root runner scope

The root script is:

```json
"test": "node --test \"test/**/*.test.js\""
```

Node's default discovery treats every file under a directory named `test` as a
test file. That previously pulled in two kinds of non-tests:

1. `test/phase5.2/support/deployment-fixture.js`, `test/phase5.2/support/harness.js`,
   `test/phase6/support/fixtures.js` and `test/phase7/support.js` — plain support
   modules, executed as empty file-level tests and inflating the count.
2. `templates/generic-cms/tests/repository.test.ts` — a Vitest test. Node v24
   type-stripping loaded it, but its `vitest` imports are not available to the
   Node runner, so the root run always reported one failure.

The explicit glob keeps the root runner on the Node suite only. The generic CMS
test remains independently executable and is covered by
`npm run cms-template:test` (and by `npm run test:all`).

Expected counts at this revision:

- `npm test`: **378 tests, 377 pass, 0 fail, 1 skip**.
- The skip is `test/phase6/bundle-validation.test.js` → "the built generic CMS
  bundle passes validation"; it is skipped only until
  `npm run cms-template:build` has produced `templates/generic-cms/dist/index.html`.
  After that build, a root run reports 378 tests, 378 pass, 0 skip.

## Phase 5.2 deployment-layout flake

### Symptom

`test/phase5.2/deploy-script-layout.test.js` occasionally failed inside the
full suite at the "already-configured key does not restart External Auth and
requires no unlock" case. The deployment log showed:

```
External Auth process has the Core API key loaded
ERROR: External Auth process does not have QORTAL_AUTH_NODE_API_KEY loaded
```

That triggered an unnecessary rollback and one `OPERATOR UNLOCK ACTION`, so the
test failed with `1 !== 0`.

### Root cause

`broker/scripts/deploy-phase5.2-core-rejection-fix.sh` sets
`set -Eeuo pipefail`. Its key check was:

```bash
tr '\0' '\n' <"/proc/$pid/environ" | grep -q '^QORTAL_AUTH_NODE_API_KEY=.'
```

`grep -q` exits as soon as it finds the key. When the process environment spans
more than one pipe chunk (npm adds many `npm_*` variables, and the fixture adds
~30 more), `tr` still has data to write after grep exits. It receives SIGPIPE
(status 141). With `pipefail`, the whole pipeline returns 141 even though the
key is present. The result depends on scheduling and chunk boundaries, which is
why it passed alone and failed intermittently under the parallel suite.

### Correction

The check now consumes the complete stream:

```bash
tr '\0' '\n' <"/proc/$pid/environ" | grep -c '^QORTAL_AUTH_NODE_API_KEY=.' >/dev/null
```

The same early-exit pattern in `core_key_present` (the `systemctl show |
grep -q` pipeline) was changed to `grep -c ... >/dev/null`.

No assertion was removed or weakened. The test suite gained a regression case,
"key detection tolerates a large process environment without a SIGPIPE false
negative", which injects a 64 KiB environment pad. With the old pipeline it
failed 5/5 runs; with the corrected pipeline it passed 5/5.

Stability evidence after the fix:

- 10/10 consecutive full `npm test` runs: 378 tests, 377 pass, 0 fail,
  1 skip in every run.
- 3 rounds x 6 concurrent deployment-layout processes: 18/18 executions
  passed, each 7/7 tests.
- The single deployment-layout file passes 7/7.
