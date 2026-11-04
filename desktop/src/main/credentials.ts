import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SERVICE = 'org.iffinland.qortal-migration-studio';

interface SecretRecord {
  auth: Record<string, unknown>;
  updatedAt: string;
}

export class CredentialStore {
  private memory = new Map<string, SecretRecord>();
  private keyringAvailable = false;
  private backend = 'session-memory';
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    try {
      await execFileAsync('secret-tool', ['--version'], { timeout: 3000 });
      this.keyringAvailable = true;
      this.backend = 'libsecret';
    } catch {
      this.keyringAvailable = false;
      this.backend = 'session-memory';
    }
  }

  status(): { available: boolean; backend: string; persistentCredentials: boolean; sessionOnly: boolean; count: number } {
    return {
      available: this.keyringAvailable,
      backend: this.backend,
      persistentCredentials: this.keyringAvailable,
      sessionOnly: !this.keyringAvailable,
      count: this.memory.size
    };
  }

  async store(projectId: string, auth: Record<string, unknown>, remember: boolean): Promise<void> {
    await this.initialize();
    const record: SecretRecord = { auth, updatedAt: new Date().toISOString() };
    this.memory.set(projectId, record);
    if (!remember || !this.keyringAvailable) return;
    await this.secretTool(['store', '--label', 'Qortal Migration Studio WordPress credentials', 'service', SERVICE, 'account', projectId], JSON.stringify(record));
  }

  async get(projectId: string): Promise<Record<string, unknown> | null> {
    await this.initialize();
    const inMemory = this.memory.get(projectId);
    if (inMemory) return inMemory.auth;
    if (!this.keyringAvailable) return null;
    try {
      const raw = await this.secretTool(['lookup', 'service', SERVICE, 'account', projectId]);
      const parsed = JSON.parse(raw) as SecretRecord;
      if (parsed && typeof parsed === 'object' && parsed.auth && typeof parsed.auth === 'object') {
        this.memory.set(projectId, parsed);
        return parsed.auth;
      }
    } catch {
      return null;
    }
    return null;
  }

  async forget(projectId: string): Promise<void> {
    this.memory.delete(projectId);
    if (!this.keyringAvailable) return;
    await this.secretTool(['clear', 'service', SERVICE, 'account', projectId]).catch(() => {});
  }

  clearAll(): void {
    this.memory.clear();
  }

  private secretTool(args: string[], input?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('secret-tool', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error('secret-tool failed: ' + stderr.trim()));
      });
      if (input !== undefined) child.stdin.end(input);
      else child.stdin.end();
    });
  }
}

