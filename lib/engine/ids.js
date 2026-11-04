import { randomBytes } from 'node:crypto';

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomSuffix(length) {
  const bytes = randomBytes(length);
  let suffix = '';
  for (let index = 0; index < length; index += 1) {
    suffix += ID_CHARS[bytes[index] % ID_CHARS.length];
  }
  return suffix;
}

export function newProjectId() {
  return `prj_${randomSuffix(16)}`;
}

export function newRunId() {
  return `run_${randomSuffix(16)}`;
}

export function newEventId() {
  return `evt_${randomSuffix(16)}`;
}

export function newTransactionId() {
  return `txn_${randomSuffix(16)}`;
}

export function newLockToken() {
  return `lock_${randomSuffix(24)}`;
}

export function slugify(value) {
  const slug = String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'project';
}
