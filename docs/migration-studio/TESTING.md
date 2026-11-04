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
| Phase 8 suite | `npm run test:phase8` |
| WordPress content policy | `node --test test/source/wordpress-content-policy.test.js` |
| Corbett compatibility | `node --test test/source/corbett-compat.test.js test/phase6/corbett-regression.test.js` |
| Builds | `npm run migration:build && npm run cms:build && npm run cms-template:build` |
| Desktop build | `npm --prefix desktop run build` |
| Phase 9 release tests | `npm run test:phase9` |
| Version consistency | `npm run version:check` |
| Deterministic .deb | `npm run release:deb` |
| Package validation | `npm run release:validate` |
| Security gate | `npm run release:security` |
| SBOM / provenance | `npm run release:sbom && npm run release:provenance` |
| Clean-checkout reproducibility | `npm run release:repro` |
| Isolated install test | `node scripts/release/install-test.mjs --rootfs=<dir> --distro=<label>` |
| Real-site alpha validation | `node scripts/release/alpha-validation.mjs --base-url=https://wordpressfoundation.org` |
| Read-only QDN exact read-back | `node scripts/release/qdn-read-only-check.mjs --node-url=<url>` |

`npm run check` runs `test:all` and all four builds. `npm run check:phase9` runs
the version check, Phase 9 tests, desktop typecheck and desktop tests.

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

Expected counts at this revision (0.6.0 alpha):

- `npm test`: **415 tests, 415 pass, 0 fail, 0 skip** after the template build; before `npm run cms-template:build` the generic-CMS bundle test skips (414 pass, 1 skip).
- `npm run test:desktop`: 44 tests in 13 files.
- The skip is `test/phase6/bundle-validation.test.js` → "the built generic CMS
  bundle passes validation"; it is skipped only until
  `npm run cms-template:build` has produced `templates/generic-cms/dist/index.html`.
  After that build, a root run reports 415 tests, 415 pass, 0 skip.

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

## Verified counts at this revision

| Suite | Result |
| --- | --- |
| Root Node (`npm test`) | 415 tests, 415 pass, 0 fail, 0 skip |
| Phase 9 release/security | 14 pass |
| Phase 8 | 23 pass |
| Phase 7 | 24 pass |
| Phase 5.2 | 118 pass |
| Deployment layout | 7 pass |
| WordPress content policy | 7 pass |
| Corbett compatibility (source + phase6 regression) | 11 pass |
| Generic CMS Vitest | 19 tests / 3 files pass |
| Desktop Vitest | 43 tests / 12 files pass |
| Desktop typecheck | clean |
| Builds (migration, Corbett CMS, generic CMS, desktop) | all successful |

## Phase 8 tests

`npm run test:phase8` runs `test/phase8/*.test.js`:

| Suite | What it proves |
| --- | --- |
| `recovery.test.js` | Real `SIGKILL` at discovery, planning, download, handoff preparation, receipt import and verification; resume without duplicate assets/handoffs/receipts/resources; ambiguous publication reconciliation without resubmission; network loss; torn checkpoint/power loss |
| `cleanup.test.js` | Receipt + history snapshot written before deletion; refusal for pending/failed publication; shared-media protection; interrupted quarantine resume; restore inside retention; purge measured bytes; traversal, absolute path, protected state and symlink refusal; disk-full download recovery |
| `diagnostics.test.js` | Five-canary support bundle, credential pattern refusal, content-body exclusion, hash-chained ledger validation, sealed snapshot, snapshot path escape |
| `host.test.js` | Phase 8 RPC surface, cleanup refusal, support bundle file mode, resume argument validation, unknown-method isolation |
| `migration.test.js` | Store v4 → v5 migration; newer version fails closed |

Crash tests use `test-support/phase8/crashWorker.mjs`, a separate process that
performs one real engine operation and kills itself at a named checkpoint. The
parent reopens the project with stale-lock recovery, then asserts resumption and
idempotency. `createEngine({ onCheckpoint })` is the deterministic crash hook.

Desktop coverage: `desktop/tests/renderer/recovery.spec.tsx`.

### Phase 8 expected results (this revision)

- `npm run test:phase8`: 23 tests, 23 pass, 0 fail.
- `npm test`: 401 tests, 401 pass, 0 fail, 0 skip after the template build (before it, the Phase 6
  generic-CMS bundle test skips until the template build produces `dist`).
- Desktop: 38 tests (35 existing + 3 recovery), 0 fail; typecheck passes.

