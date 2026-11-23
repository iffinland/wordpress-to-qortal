import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as tar from 'tar';
import { restoreProjectBackup } from '../../lib/engine/backup.js';
import { verifyNameOwnership } from '../../lib/engine/publication/remote.js';

test('backup restore refuses symlink entries before extraction', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'qms-untrusted-backup-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'project.json'), '{}');
  await writeFile(path.join(root, 'qms-project-backup.json'), '{}');
  await symlink('/etc/passwd', path.join(root, 'link'));
  const archive = path.join(root, 'bad.tar.gz');
  await tar.c({ cwd: root, file: archive, gzip: true }, ['project.json', 'qms-project-backup.json', 'link']);
  await assert.rejects(restoreProjectBackup(path.join(root, 'workspace'), archive), /links or special files/);
});

test('QDN timeout covers a response body which stalls after headers', async (t) => {
  const server = http.createServer((_request, response) => { response.writeHead(200, { 'content-type': 'application/json' }); response.write('{'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const started = Date.now();
  const result = await verifyNameOwnership({ nodeUrl: 'http://127.0.0.1:' + server.address().port, name: 'SafetyFixture', ownerAddress: 'QZLJV7wbaFyxaoZQsjm6rb9MWMiDzWsqM2', timeoutMs: 80 });
  assert.equal(result.code, 'NODE_UNREACHABLE');
  assert.ok(Date.now() - started < 2000);
});
