import { access, stat } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { readJson, writeJson } from './utils/files.js';

const MAX_WARN_BYTES = 450 * 1024 * 1024;
const REQUIRED_DRY_RUN_FLAG = '--dry-run';

function parseArgs(argv) {
  return {
    dryRun: argv.includes(REQUIRED_DRY_RUN_FLAG),
    force: argv.includes('--force'),
    limit: readLimit(argv)
  };
}

function readLimit(argv) {
  const inline = argv.find((arg) => arg.startsWith('--limit='));
  if (inline) {
    return parseLimitValue(inline.slice('--limit='.length));
  }

  const index = argv.indexOf('--limit');
  if (index >= 0) {
    return parseLimitValue(argv[index + 1]);
  }

  return null;
}

function parseLimitValue(value) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('--limit must be a positive integer.');
  }
  return parsed;
}

function flattenResources(plan) {
  const resources = plan.resources || {};
  return [
    ...(resources.media || []),
    ...(resources.posts || []),
    ...(resources.pages || []),
    ...(resources.indexes || [])
  ];
}

function resolveResourcePath(outputDir, resource) {
  if (!resource.local_path) {
    return null;
  }
  return path.join(outputDir, resource.local_path);
}

function qortalPayloadFor(resource, qortalName) {
  const basePayload = {
    action: 'PUBLISH_QDN_RESOURCE',
    name: qortalName,
    service: resource.service,
    identifier: resource.identifier
  };

  if (['DOCUMENT', 'JSON'].includes(resource.service)) {
    return {
      ...basePayload,
      data64: '<base64 file content>',
      encoding: 'base64'
    };
  }

  return {
    ...basePayload,
    file: '<local file>',
    filename: path.basename(resource.local_path || resource.identifier)
  };
}

async function validateResource(config, resource) {
  const filePath = resolveResourcePath(config.outputDir, resource);
  const errors = [];
  const warnings = [];
  let bytes = resource.bytes || 0;

  if (!filePath) {
    errors.push('Missing local_path.');
    return { filePath, bytes, errors, warnings };
  }

  try {
    await access(filePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      errors.push('Path is not a file.');
    } else {
      bytes = fileStat.size;
    }
  } catch {
    errors.push('Local file does not exist.');
  }

  if (!resource.service) {
    errors.push('Missing QDN service.');
  }

  if (!resource.identifier) {
    errors.push('Missing QDN identifier.');
  }

  if (resource.identifier && resource.identifier.length > 64) {
    errors.push('Identifier is longer than 64 characters.');
  }

  if (bytes > MAX_WARN_BYTES) {
    warnings.push(`Large resource: ${(bytes / 1024 / 1024).toFixed(2)} MB.`);
  }

  return { filePath, bytes, errors, warnings };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const publishLogDir = path.join(config.outputDir, 'publish-log');
  const planPath = path.join(publishLogDir, 'publish-plan.json');
  const dryRunLogPath = path.join(publishLogDir, 'dry-run.json');

  if (!args.dryRun) {
    throw new Error(
      'Real QDN publishing is not implemented yet. Run npm run publish -- --dry-run first.'
    );
  }

  if (!config.qortalName) {
    throw new Error('Missing QORTAL_NAME. Add it to .env before running publish checks.');
  }

  const plan = await readJson(planPath);
  const allResources = flattenResources(plan);
  const resources = args.limit ? allResources.slice(0, args.limit) : allResources;
  const seen = new Set();
  const duplicateIdentifiers = [];
  const rows = [];
  const errors = [];
  const warnings = [];
  let totalBytes = 0;

  for (const resource of resources) {
    const key = `${resource.service}:${config.qortalName}:${resource.identifier}`;
    if (seen.has(key)) {
      duplicateIdentifiers.push(key);
    }
    seen.add(key);

    const validation = await validateResource(config, resource);
    totalBytes += validation.bytes || 0;

    if (validation.errors.length) {
      errors.push({ resource, errors: validation.errors });
    }

    if (validation.warnings.length) {
      warnings.push({ resource, warnings: validation.warnings });
    }

    rows.push({
      type: resource.type,
      service: resource.service,
      identifier: resource.identifier,
      local_path: resource.local_path,
      bytes: validation.bytes,
      qortal_payload: qortalPayloadFor(resource, config.qortalName),
      valid: validation.errors.length === 0,
      warnings: validation.warnings
    });
  }

  if (duplicateIdentifiers.length) {
    errors.push({
      resource: null,
      errors: duplicateIdentifiers.map((identifier) => `Duplicate identifier: ${identifier}`)
    });
  }

  const log = {
    version: '0.1.0',
    generated_at: new Date().toISOString(),
    mode: 'dry-run',
    qortal_name: config.qortalName,
    qortal_node_url: config.qortalNodeUrl,
    force: args.force,
    resources_checked: resources.length,
    resources_total: allResources.length,
    total_bytes: totalBytes,
    errors,
    warnings,
    resources: rows
  };

  await writeJson(dryRunLogPath, log);

  console.log('');
  console.log('QDN publish dry-run complete');
  console.log('');
  console.log(`Qortal name: ${config.qortalName}`);
  console.log(`Qortal node URL: ${config.qortalNodeUrl}`);
  console.log(`Resources checked: ${resources.length} / ${allResources.length}`);
  console.log(`Total checked size: ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Warnings: ${warnings.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Dry-run log: ${dryRunLogPath}`);

  if (errors.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('');
  console.error('QDN publish dry-run failed');
  console.error(error.message);
  process.exitCode = 1;
});
