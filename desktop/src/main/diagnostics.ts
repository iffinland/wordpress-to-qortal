import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineHost } from './host.js';
import { exportsDir } from './paths.js';

const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|seed|privatekey|private_key|wallet|authorization|cookie)/i;

export function sanitizeForDiagnostics(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.slice(0, 2000).map((entry) => sanitizeForDiagnostics(entry, depth + 1));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : sanitizeForDiagnostics(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string' && value.length > 4000) return value.slice(0, 4000) + '...';
  return value;
}

export async function exportDiagnostics({
  host,
  dataRoot,
  projectId,
  appInfo,
  settings,
  keyring
}: {
  host: EngineHost;
  dataRoot: string;
  projectId: string;
  appInfo: Record<string, unknown>;
  settings: Record<string, unknown>;
  keyring: Record<string, unknown>;
}): Promise<{ path: string; bytes: number; createdAt: string }> {
  const createdAt = new Date().toISOString();
  const inspection = await host.request('project.inspect', { projectId }, 30_000);
  const document = await host.request('project.get', { projectId }, 30_000);
  const payload = sanitizeForDiagnostics({
    schema: 'qms-diagnostics@1',
    version: 1,
    createdAt,
    product: 'Qortal Migration Studio',
    app: appInfo,
    settings,
    keyring,
    notes: [
      'Diagnostics contain metadata only. Credentials, authorization headers, cookies, wallet material and content bodies are excluded.',
      'reserved means planned/prepared locally and never published.',
      'published/remote_verified requires a Phase 5 read-back receipt and is never inferred from hashes or local files.'
    ],
    project: inspection,
    projectDocument: document,
    engineStderr: host.logLines.slice(-100)
  });
  const body = JSON.stringify(payload, null, 2) + '\n';
  const dir = exportsDir(dataRoot);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const safeProject = projectId.replace(/[^a-z0-9-]/g, '');
  const file = path.join(dir, 'diagnostics-' + safeProject + '-' + createdAt.replace(/[:.]/g, '-') + '.json');
  await writeFile(file, body, { mode: 0o600 });
  return { path: file, bytes: Buffer.byteLength(body), createdAt };
}

