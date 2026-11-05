import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function walkJs(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walkJs(absolute));
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(absolute);
  }
  return files;
}

// Static import/export-from and dynamic import() specifiers. The import body is
// allowed to span lines but never a semicolon or a quote.
function importsOf(source) {
  const specifiers = [];
  const re = /(?:^|\n)[ \t]*(?:import|export)\s+(?:[^;'"]*?from\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(source))) {
    const specifier = match[1] || match[2];
    if (specifier) specifiers.push(specifier);
  }
  return specifiers;
}

async function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, base + '.js', base + '.mjs', base + '.cjs', path.join(base, 'index.js')]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

async function engineGraph() {
  const entry = path.join(repo, 'bin/qms-host.js');
  const seen = new Set();
  const bare = new Set();
  const outsideLib = new Set();
  const unresolved = [];
  async function visit(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const source = await readFile(file, 'utf8');
    for (const specifier of importsOf(source)) {
      if (specifier.startsWith('node:')) continue;
      if (specifier.startsWith('.')) {
        const target = await resolveRelative(file, specifier);
        if (!target) {
          unresolved.push(path.relative(repo, file) + ' -> ' + specifier);
          continue;
        }
        if (!target.startsWith(path.join(repo, 'lib') + path.sep)) {
          outsideLib.add(path.relative(repo, target));
        }
        await visit(target);
      } else {
        bare.add(specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]);
      }
    }
  }
  await visit(entry);
  return { seen, bare, outsideLib, unresolved };
}

test('every runtime import of the packaged engine is a declared engine-package dependency', async () => {
  const runtime = JSON.parse(await readFile(path.join(repo, 'desktop/engine-package/package.json'), 'utf8'));
  const graph = await engineGraph();
  assert.deepEqual(graph.unresolved, [], 'the engine entry has unresolved relative imports');
  const missing = [...graph.bare].filter((name) => !(name in runtime.dependencies));
  assert.deepEqual(missing, [], 'engine-package/package.json does not declare: ' + missing.join(', '));
  assert.ok(graph.bare.has('fflate'), 'the regression case (fflate in lib/engine/publication) must stay covered');
});

test('every module reached outside lib is staged by prepare-engine.mjs', async () => {
  const prepare = await readFile(path.join(repo, 'desktop/scripts/prepare-engine.mjs'), 'utf8');
  const graph = await engineGraph();
  const unstaged = [...graph.outsideLib].filter((relative) => {
    const normalized = relative.split(path.sep).join('/');
    if (prepare.includes("'" + normalized + "'")) return false;
    const parent = path.posix.dirname(normalized);
    return !prepare.includes("'" + parent + "'");
  });
  assert.deepEqual(unstaged, [], 'prepare-engine.mjs does not stage: ' + unstaged.join(', '));
  assert.ok(prepare.includes("'src/config.js'"), 'src/config.js is dynamically imported by compat.loadLegacyConfig');
});

test('engine-package lockfile pins every declared production dependency', async () => {
  const runtime = JSON.parse(await readFile(path.join(repo, 'desktop/engine-package/package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(repo, 'desktop/engine-package/package-lock.json'), 'utf8'));
  for (const [name, version] of Object.entries(runtime.dependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, name + ' must be pinned');
    assert.equal(lock.packages['node_modules/' + name]?.version, version, name + ' is not locked at ' + version);
  }
});

test('prepare-engine verifies the resolved runtime graph before hashing the manifest', async () => {
  const prepare = await readFile(path.join(repo, 'desktop/scripts/prepare-engine.mjs'), 'utf8');
  assert.ok(prepare.includes('verify-engine-runtime.mjs'), 'the build must run the resolver check');
  assert.ok(prepare.includes("'node_modules/fflate/package.json'"), 'the build must require the fflate runtime package');
});

test('the release gate requires clean-install and missing-dependency evidence', async () => {
  const gate = await readFile(path.join(repo, 'scripts/release/three-artifact-gate.mjs'), 'utf8');
  assert.ok(gate.includes('engine-clean-install.json'));
  assert.ok(gate.includes('engine-clean-install-negative.json'));
  assert.ok(gate.includes('artifactSha256 !== sha256'));
});

