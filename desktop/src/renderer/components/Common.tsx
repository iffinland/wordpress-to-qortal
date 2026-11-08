import React from 'react';
import { formatScalar } from '../format.js';

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: React.ReactNode }) {
  return <span className={'badge badge-' + tone}>{children}</span>;
}

export function publicationTone(status: string): 'neutral' | 'good' | 'warn' | 'bad' | 'info' {
  if (status === 'published' || status === 'remotely verified' || status === 'Published (verified)' || status === 'Remotely verified') return 'good';
  if (status === 'reserved' || status === 'prepared' || status === 'Reserved — not published' || status === 'Prepared locally — not published') return 'warn';
  if (status === 'conflict' || status === 'blocked' || status === 'failed') return 'bad';
  if (status === 'ready' || status === 'completed') return 'info';
  return 'neutral';
}

export function Card({ title, subtitle, actions, children, testId }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; testId?: string }) {
  return (
    <section className="card" data-testid={testId}>
      {(title || actions) && (
        <header className="card-header">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted">{subtitle}</p>}
          </div>
          {actions && <div className="row gap">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
      {error && <span className="field-error" role="alert">{error}</span>}
    </label>
  );
}

export function ProgressBar({ completed, total, bytes }: { completed: number; total: number; bytes?: number }) {
  const safeCompleted = Number.isFinite(completed) ? Math.max(0, completed) : 0;
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  // Never invent a denominator. With no known total the bar is indeterminate
  // and shows the real number completed instead of a fake percentage.
  const percent = safeTotal > 0 ? Math.min(100, Math.round((safeCompleted / safeTotal) * 100)) : null;
  return (
    <div className="progress" aria-label="Operation progress">
      <div className={'progress-track' + (percent === null ? ' indeterminate' : '')}>
        <div className="progress-fill" style={percent === null ? undefined : { width: percent + '%' }} />
      </div>
      <div className="progress-meta">
        <span>{safeCompleted} {percent === null ? 'completed (total not reported yet)' : '/ ' + safeTotal}</span>
        {bytes !== undefined && <span>{bytes} bytes downloaded</span>}
        {percent !== null && <span>{percent}%</span>}
      </div>
    </div>
  );
}

export function Alert({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children: React.ReactNode }) {
  return (
    <div className={'alert alert-' + tone} role={tone === 'bad' ? 'alert' : 'status'}>
      {title && <strong>{title}</strong>}
      <div>{children}</div>
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const value = error as { message?: string; code?: string };
  return <Alert tone="bad" title={value.code ?? 'Error'}>{value.message ?? formatScalar(error)}</Alert>;
}

