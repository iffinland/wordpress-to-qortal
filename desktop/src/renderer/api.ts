import type { QmsApi } from '../shared/types.js';

export function api(): QmsApi {
  if (!window.qms) {
    throw new Error('The secure desktop bridge is not available.');
  }
  return window.qms;
}

