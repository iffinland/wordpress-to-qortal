import { describe, expect, it } from 'vitest';
import { CredentialStore } from '../../src/main/credentials.js';

describe('credential storage', () => {
  it('keeps session credentials only when persistence is not requested', async () => {
    const store = new CredentialStore();
    await store.initialize();
    await store.store('prj_test', { mode: 'application_password', username: 'u', appPassword: 'p' }, false);
    const auth = await store.get('prj_test');
    expect(auth).toMatchObject({ mode: 'application_password', username: 'u' });
    expect(store.status().persistentCredentials).toBe(store.status().available);
    await store.forget('prj_test');
    expect(await store.get('prj_test')).toBeNull();
  });

  it('never falls back to a plaintext file when the keyring is absent', async () => {
    const store = new CredentialStore();
    await store.initialize();
    await store.store('prj_test', { mode: 'session', username: 'u', password: 'p' }, true);
    const status = store.status();
    expect(['libsecret', 'session-memory']).toContain(status.backend);
    if (!status.available) {
      expect(status.sessionOnly).toBe(true);
      expect(status.persistentCredentials).toBe(false);
    }
  });
});

