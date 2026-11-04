import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface HostPaths {
  entry: string;
  cwd: string;
  dataRoot: string;
  repoRoot: string;
}

export class EngineHost {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: readline.Interface | null = null;
  private pending = new Map<number, Pending>();
  private listeners = new Set<(event: Record<string, unknown>) => void>();
  private nextId = 1;
  private closed = true;
  private stderrLines: string[] = [];
  private paths: HostPaths;

  constructor(paths: HostPaths) {
    this.paths = paths;
  }

  get logLines(): string[] {
    return [...this.stderrLines];
  }

  get isRunning(): boolean {
    return !this.closed;
  }

  async start(): Promise<void> {
    if (!this.closed) return;
    const child = spawn(process.execPath, [this.paths.entry], {
      cwd: this.paths.cwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        QMS_DATA_ROOT: this.paths.dataRoot,
        QMS_REPO_ROOT: this.paths.repoRoot
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.child = child;
    this.closed = false;
    const connection = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    this.connection = connection;
    connection.on('line', (line) => this.onLine(line));
    connection.on('close', () => this.onClose(new Error('Engine host connection closed.')));
    child.stderr.on('data', (chunk) => {
      const lines = String(chunk).split('\n').filter(Boolean);
      this.stderrLines.push(...lines);
      if (this.stderrLines.length > 200) this.stderrLines.splice(0, this.stderrLines.length - 200);
    });
    child.on('error', (error) => this.onClose(error));
    child.on('exit', (code, signal) => {
      if (!this.closed) {
        this.onClose(new Error('Engine host exited: code=' + String(code) + ' signal=' + String(signal)));
      }
    });
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.method === 'qms.event' && message.id === undefined) {
      const event = message.params as Record<string, unknown>;
      for (const listener of this.listeners) {
        try { listener(event); } catch { /* renderer listener isolation */ }
      }
      return;
    }
    const id = Number(message.id);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (message.error) {
      const error = message.error as { message?: string; data?: Record<string, unknown> };
      const wrapped = new Error(error.message ?? 'Engine request failed.');
      (wrapped as Error & { code?: string; details?: unknown }).code = String(error.data?.code ?? 'HOST_PROTOCOL_ERROR');
      (wrapped as Error & { details?: unknown }).details = error.data ?? {};
      pending.reject(wrapped);
    } else {
      pending.resolve(message.result);
    }
  }

  private onClose(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.connection?.close();
    this.connection = null;
    this.child = null;
  }

  request<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 60_000): Promise<T> {
    if (this.closed || !this.child) {
      return Promise.reject(new Error('Engine host is not running.'));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Engine request timed out: ' + method));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      this.child!.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  onEvent(listener: (event: Record<string, unknown>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop(): Promise<void> {
    if (this.closed || !this.child) return;
    const child = this.child;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Engine host stopped.'));
    }
    this.pending.clear();
    this.connection?.close();
    this.connection = null;
    child.stdin.end();
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    this.child = null;
  }

  async restart(dataRoot = this.paths.dataRoot): Promise<void> {
    await this.stop();
    this.paths = { ...this.paths, dataRoot };
    await this.start();
  }
}

export function resolveHostPaths(appPath: string, isPackaged: boolean, resourcesPath: string, dataRoot: string, repoRootFallback: string): HostPaths {
  if (isPackaged) {
    const root = path.join(resourcesPath, 'engine');
    return {
      entry: path.join(root, 'bin/qms-host.js'),
      cwd: root,
      dataRoot,
      repoRoot: root
    };
  }
  const repoRoot = path.resolve(appPath, '..');
  return {
    entry: path.join(repoRoot, 'bin/qms-host.js'),
    cwd: repoRoot,
    dataRoot,
    repoRoot: repoRootFallback
  };
}

