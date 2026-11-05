#!/usr/bin/env node
/**
 * Verify that the staged engine runtime is self-contained.
 *
 * 0.8.0-alpha.3 shipped lib/engine/publication/index.js, which imports
 * 'fflate', but desktop/engine-package only declared cheerio and dotenv. The
 * .deb installed cleanly and then aborted with ERR_MODULE_NOT_FOUND. Hand
 * maintained dependency lists are not sufficient, so this check resolves the
 * real import graph from bin/qms-host.js against a copy of the staged tree in
 * a directory with no ancestor node_modules. That is the same condition as
 * /opt/qortal-migration-studio/resources/engine after dpkg-deb -x.
 *
 * Any missing relative module, missing package, or resolution that escapes the
 * staged tree fails the build. Run by desktop/scripts/prepare-engine.mjs and
 * therefore by npm run release:deb / release:prepare.
 *
 * Usage: node scripts/release/verify-engine-runtime.mjs [engine-runtime-dir]
 */
import { cp, lstat, mkdtemp, readFile, readdir, readlink, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const engineRoot = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, 'desktop/engine-runtime'));
const esbuildEntry = process.env.QMS_ESBUILD_ENTRY ?? path.join(REPO_ROOT, 'desktop/node_modules/esbuild/lib/main.js');

function fail(message, detail) {
  console.error('ENGINE_RUNTIME_VERIFY_FAILED: ' + message);
  if (detail) console.error(detail);
  process.exit(1);
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

for (const required of ['bin/qms-host.js', 'package.json', 'node_modules']) {
  try {
    await stat(path.join(engineRoot, required));
  } catch {
    fail('the staged engine runtime is missing ' + required + ' (' + engineRoot + ')');
  }
}

async function checkSymlinks(directory, base) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const info = await lstat(absolute);
    if (info.isSymbolicLink()) {
      const target = path.resolve(path.dirname(absolute), await readlink(absolute));
      if (!inside(base, target)) {
        fail('a symlink escapes the engine runtime: ' + path.relative(base, absolute) + ' -> ' + target);
      }
    } else if (info.isDirectory()) {
      await checkSymlinks(absolute, base);
    }
  }
}
await checkSymlinks(engineRoot, engineRoot);

let esbuild;
try {
  ({ build: esbuild } = await import(pathToFileURL(esbuildEntry).href));
} catch (error) {
  fail('esbuild is unavailable; run npm ci in desktop before preparing the engine', String(error));
}

const isolated = await mkdtemp(path.join(tmpdir(), 'qms-engine-selfcheck-'));
try {
  const copy = path.join(isolated, 'engine');
  await cp(engineRoot, copy, { recursive: true, verbatimSymlinks: true });

  let result;
  try {
    result = await esbuild({
      absWorkingDir: copy,
      entryPoints: ['bin/qms-host.js'],
      outfile: path.join(isolated, 'qms-host.bundle.mjs'),
      bundle: true,
      write: false,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      external: ['node:*'],
      logLevel: 'silent',
      metafile: true
    });
  } catch (error) {
    const lines = (error.errors ?? []).map((item) => {
      const location = item.location ? item.location.file + ':' + item.location.line + ' ' : '';
      return location + item.text;
    });
    fail('the staged engine cannot resolve every runtime import', lines.join('\n') || String(error));
  }

  const inputs = Object.keys(result.metafile.inputs);
  const packages = new Set();
  for (const input of inputs) {
    const absolute = path.resolve(copy, input);
    if (!inside(copy, absolute)) {
      fail('a module resolved outside the engine runtime: ' + input + ' -> ' + absolute);
    }
    const match = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input);
    if (match) packages.add(match[1]);
  }

  const runtimePackage = JSON.parse(await readFile(path.join(copy, 'package.json'), 'utf8'));
  const declared = Object.keys(runtimePackage.dependencies ?? {});
  const unusedDeclared = declared.filter((name) => !packages.has(name));

  console.log(JSON.stringify({
    ok: true,
    schema: 'qms-engine-runtime-verify@1',
    engineRoot,
    modules: inputs.length,
    packages: [...packages].sort(),
    declared,
    unusedDeclared,
    bundledBytes: result.outputFiles[0]?.contents?.length ?? 0
  }, null, 2));
} finally {
  await rm(isolated, { recursive: true, force: true });
}

