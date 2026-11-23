import type { QmsApi } from '../shared/types.js';

function rendererError(value: unknown): Error {
  if (value instanceof Error) return value;
  const payload = value as { code?: string; message?: string; details?: unknown } | null;
  const error = new Error(typeof payload?.message === 'string' ? payload.message : 'Desktop request failed.');
  if (typeof payload?.code === 'string') Object.assign(error, { code: payload.code });
  if (payload?.details !== undefined) Object.assign(error, { details: payload.details });
  return error;
}

// Error instances lose custom fields across Electron's contextBridge. Preload
// rejects with plain data; recreate the Error only in the renderer context.
// Keep event subscription functions synchronous and preserve their disposers.
const wrappers = new WeakMap<object, object>();
function wrap<T extends object>(target: T): T {
  const cached = wrappers.get(target);
  if (cached) return cached as T;
  // Bridge objects are frozen; an empty proxy target avoids changing the
  // reported value of their non-configurable function properties.
  const proxy = new Proxy({} as T, {
    get(_object, key) {
      const value = Reflect.get(target, key);
      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          try {
            const result = Reflect.apply(value, target, args);
            return result && typeof result.then === 'function'
              ? Promise.resolve(result).catch((error: unknown) => { throw rendererError(error); })
              : result;
          } catch (error) { throw rendererError(error); }
        };
      }
      return value && typeof value === 'object' ? wrap(value) : value;
    }
  });
  wrappers.set(target, proxy);
  return proxy;
}

export function api(): QmsApi {
  if (!window.qms) throw new Error('The secure desktop bridge is not available.');
  return wrap(window.qms);
}
