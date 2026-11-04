import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

function listFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath || entry.path, entry.name));
}

export function validateBundle(distDir) {
  const errors = [];
  const checks = [];
  const indexPath = path.join(distDir, 'index.html');
  if (!existsSync(indexPath)) {
    return { ok: false, errors: ['dist/index.html is missing.'], checks };
  }
  checks.push('index.html exists at bundle root');
  const html = readFileSync(indexPath, 'utf8');
  if (!/<div id="root"><\/div>/.test(html)) {
    errors.push('index.html does not contain the React root element.');
  } else {
    checks.push('index.html contains the root element');
  }
  if (/<script[^>]+src="\//i.test(html)) {
    errors.push('index.html uses an absolute asset path; Q-App bundles must use relative paths.');
  } else {
    checks.push('script sources are relative');
  }
  if (/<link[^>]+href="\//i.test(html)) {
    errors.push('index.html uses an absolute stylesheet path.');
  }
  const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((value) => value && !value.startsWith('#') && !/^(?:https?:|data:|mailto:|tel:)/i.test(value));
  for (const value of referenced) {
    if (!value.startsWith('./')) {
      errors.push('Referenced asset is not relative: ' + value);
      continue;
    }
    const file = path.resolve(distDir, value.slice(2));
    if (!file.startsWith(path.resolve(distDir))) {
      errors.push('Referenced asset escapes the bundle: ' + value);
    } else if (!existsSync(file)) {
      errors.push('Referenced asset is missing: ' + value);
    }
  }
  if (referenced.length > 0 && !errors.some((error) => error.startsWith('Referenced asset'))) {
    checks.push('all referenced assets exist');
  }

  const files = listFiles(distDir);
  const scripts = files.filter((file) => file.endsWith('.js'));
  if (scripts.length === 0) errors.push('The bundle has no JavaScript assets.');
  const forbidden = ['node:fs', 'node:path', 'lib/engine', 'lib/source/wordpress', 'source/wordpress/adapter'];
  for (const file of scripts) {
    const source = readFileSync(file, 'utf8');
    for (const marker of forbidden) {
      if (source.includes(marker)) errors.push(path.relative(distDir, file) + ' contains forbidden engine marker: ' + marker);
    }
    if (source.includes('sourceMappingURL=')) errors.push(path.relative(distDir, file) + ' contains a source map reference.');
  }
  if (!errors.some((error) => error.includes('forbidden engine marker'))) {
    checks.push('no engine internals are bundled');
  }
  const totalBytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  checks.push('bundle contains ' + files.length + ' files and ' + totalBytes + ' bytes');
  return { ok: errors.length === 0, errors, checks, files: files.length, bytes: totalBytes };
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isCli) {
  const distDir = path.resolve(process.argv[2] || 'dist');
  const result = validateBundle(distDir);
  if (!result.ok) {
    console.error('Bundle validation failed:');
    for (const error of result.errors) console.error('- ' + error);
    process.exit(1);
  }
  console.log('Bundle validation passed:');
  for (const check of result.checks) console.log('- ' + check);
}
