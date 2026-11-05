export function formatBytes(value: unknown): string {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 'unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = Math.max(0, number);
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return amount.toFixed(unit === 0 ? 0 : 1) + ' ' + units[unit];
}

export function formatDate(value: unknown): string {
  if (!value) return 'never';
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === 'object') return 'invalid date';
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) return String(value);
  return new Date(time).toLocaleString();
}

/** Render a value without ever producing [object Object] in the UI. */
export function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) return value.map((entry) => formatScalar(entry)).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const label = record.name ?? record.type ?? record.feature ?? record.message ?? record.code;
    if (label !== undefined) return formatScalar(label);
    const entries = Object.entries(record);
    if (entries.length === 0) return '—';
    return entries.map(([key, entry]) => key + ': ' + formatScalar(entry)).join(', ');
  }
  return 'unsupported value';
}

export function shortId(value: unknown): string {
  const text = String(value ?? '');
  if (text.length <= 18) return text || '—';
  return text.slice(0, 10) + '…' + text.slice(-4);
}

export function publicationTone(status: string): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'published' || status === 'remotely verified' || status === 'Published (verified)' || status === 'Remotely verified') return 'good';
  if (status === 'reserved' || status === 'prepared' || status === 'Reserved — not published' || status === 'Prepared locally — not published') return 'warn';
  if (status === 'conflict' || status === 'blocked' || status === 'failed') return 'bad';
  if (status === 'ready' || status === 'completed') return 'info';
  return 'neutral';
}

export function publicationLabel(mapping: { publicationStatus?: string; localPreparation?: string; status?: string }): string {
  const publication = mapping.publicationStatus ?? (mapping.status === 'published' ? 'published' : 'reserved');
  if (publication === 'published') return 'Published (verified)';
  if (publication === 'remote_verified') return 'Remotely verified';
  if (mapping.localPreparation === 'prepared') return 'Prepared locally — not published';
  if (mapping.localPreparation === 'partial') return 'Partly prepared — not published';
  return 'Reserved — not published';
}

