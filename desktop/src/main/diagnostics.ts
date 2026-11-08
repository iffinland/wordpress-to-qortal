import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { EngineHost } from './host.js';
import { exportsDir } from './paths.js';

export interface RendererErrorRecord {
  source: string;
  message: string;
  stack?: string;
  componentStack?: string;
  at: string;
}

const rendererErrors: RendererErrorRecord[] = [];
const MAX_RENDERER_ERRORS = 50;

export function recentRendererErrors(): RendererErrorRecord[] {
  return [...rendererErrors];
}

function trim(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  return value.length > max ? value.slice(0, max) + '...' : value;
}

/**
 * Persist a redacted renderer/main-process failure record. This is how a blank
 * window becomes diagnosable without asking the user to reproduce it: the
 * renderer ErrorBoundary, unhandled rejections and render-process-gone all
 * land in <dataRoot>/logs/renderer-errors.log and in diagnostics exports.
 */
export async function recordRendererError(
  dataRoot: string,
  entry: { source?: unknown; message?: unknown; stack?: unknown; componentStack?: unknown }
): Promise<RendererErrorRecord> {
  const record: RendererErrorRecord = {
    source: trim(entry.source, 120) ?? 'renderer',
    message: trim(entry.message, 2000) ?? 'Unknown renderer failure',
    stack: trim(entry.stack, 8000),
    componentStack: trim(entry.componentStack, 8000),
    at: new Date().toISOString()
  };
  const sanitized = sanitizeForDiagnostics(record) as RendererErrorRecord;
  rendererErrors.push(sanitized);
  if (rendererErrors.length > MAX_RENDERER_ERRORS) rendererErrors.splice(0, rendererErrors.length - MAX_RENDERER_ERRORS);
  try {
    const dir = path.join(dataRoot, 'logs');
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await appendFile(path.join(dir, 'renderer-errors.log'), JSON.stringify(sanitized) + '\n', { mode: 0o600 });
  } catch {
    // Logging must never turn a UI failure into a second failure.
  }
  return sanitized;
}

const SECRET_KEY = /(password|passwd|secret|token|apikey|api_key|seed|privatekey|private_key|wallet|authorization|cookie|session|credential|mnemonic|bearer)/i;
const URL_CREDENTIALS = /(https?:\/\/)([^\s"'<>\/:@]+):([^\s"'<>\/@]+)@/gi;
const SECRET_VALUE = [
  /bearer\s+[a-z0-9._~+/=-]{8,}/i,
  /eyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}/i,
  /(?:password|passwd|secret|token|api[_-]?key|seed|private[_-]?key)\s*[:=]\s*\S+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /Q[1-9A-HJ-NP-Za-km-z]{40,60}/
];

function redactString(value: string): string {
  if (SECRET_VALUE.some((pattern) => pattern.test(value))) return '[redacted]';
  return value.replace(URL_CREDENTIALS, '$1[redacted]@');
}

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
  if (typeof value === 'string') {
    const redacted = redactString(value);
    return redacted.length > 4000 ? redacted.slice(0, 4000) + '...' : redacted;
  }
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
    engineStderr: host.logLines.slice(-100),
    rendererErrors: recentRendererErrors()
  });
  const body = JSON.stringify(payload, null, 2) + '\n';
  const dir = exportsDir(dataRoot);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const safeProject = projectId.replace(/[^a-z0-9-]/g, '');
  const file = path.join(dir, 'diagnostics-' + safeProject + '-' + createdAt.replace(/[:.]/g, '-') + '.json');
  await writeFile(file, body, { mode: 0o600 });
  return { path: file, bytes: Buffer.byteLength(body), createdAt };
}

