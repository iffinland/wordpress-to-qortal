import { createHash } from 'node:crypto';

/**
 * Deterministic signing backend for tests. It records only non-secret request
 * metadata and never exposes arbitrary signing operations.
 */
export function createMockSigningBackend({
  address = 'QipPqwJeLtx89dXcSkY7vimMUNT8Gy5k2E',
  results = [],
  defaultResult = { state: 'signed' },
  clock = () => Date.now(),
  onSigned = null
} = {}) {
  const calls = [];
  let counter = 0;

  return {
    calls,
    async publish(request) {
      const record = {
        service: request.service,
        name: request.name,
        identifier: request.identifier,
        bytes: Buffer.from(request.dataBase64, 'base64').length,
        feeAtomic: request.feeAtomic,
        at: clock()
      };
      calls.push(record);
      const queued = results.length > 0 ? results.shift() : defaultResult;
      const outcome = typeof queued === 'function' ? queued(request) : queued;
      counter += 1;
      if (outcome.state === 'signed') {
        const signature = outcome.signature ?? ('MockSignature' + String(counter).padStart(4, '0') +
          createHash('sha256').update(request.identifier + ':' + counter).digest('hex').slice(0, 16));
        if (typeof onSigned === 'function') await onSigned(request, outcome);
        return {
          state: 'signed',
          signature,
          address: outcome.address ?? address,
          message: 'mock signature'
        };
      }
      return { ...outcome, address: outcome.address ?? address };
    }
  };
}
