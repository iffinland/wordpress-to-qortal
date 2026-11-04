import { fail, BROKER_ERROR } from './errors.js';

export const ATOMIC_PER_QORT = 100000000;

/**
 * Convert a QORT decimal to integer atomic units without floating point
 * arithmetic. Accepts a number or a decimal string with at most 8 places.
 */
export function qortToAtomic(value, label = 'amount') {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,8})?$/.test(text)) {
    fail(BROKER_ERROR.FEE_INVALID, label + ' must be a non-negative QORT decimal with at most 8 decimal places.');
  }
  const [whole, fraction = ''] = text.split('.');
  const atomic = Number(whole) * ATOMIC_PER_QORT + Number(fraction.padEnd(8, '0'));
  if (!Number.isSafeInteger(atomic)) {
    fail(BROKER_ERROR.FEE_INVALID, label + ' is outside the supported range.');
  }
  return atomic;
}

export function atomicToQort(atomic) {
  if (!Number.isSafeInteger(atomic) || atomic < 0) throw new Error('atomic amount is invalid');
  const whole = Math.floor(atomic / ATOMIC_PER_QORT);
  const fraction = String(atomic % ATOMIC_PER_QORT).padStart(8, '0');
  return whole + '.' + fraction;
}

export function formatQort(atomic) {
  return atomicToQort(atomic).replace(/\.?0+$/, '') || '0';
}
