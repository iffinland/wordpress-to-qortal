export const systemClock = Object.freeze({
  now() {
    return new Date();
  },
  nowIso() {
    return new Date().toISOString();
  },
  /** Epoch milliseconds, used for lock heartbeats. */
  nowMs() {
    return Date.now();
  }
});

export function createFixedClock(isoTimestamp = '2026-01-01T00:00:00.000Z') {
  let current = Date.parse(isoTimestamp);
  return {
    now() {
      return new Date(current);
    },
    nowIso() {
      return new Date(current).toISOString();
    },
    nowMs() {
      return current;
    },
    advance(ms) {
      current += ms;
    },
    set(iso) {
      current = Date.parse(iso);
    }
  };
}
