import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { applyTextSize, readStoredTextSize } from './textSize.js';
import './styles.css';

// Apply the persisted text size before the first paint to avoid a layout jump.
applyTextSize(readStoredTextSize());

// Report unhandled renderer failures that React cannot catch (async event
// handlers, rejected promises). Redacted logging only; never include content.
function reportRendererFailure(source: string, error: unknown): void {
  const api = (window as unknown as { qms?: { app?: { reportError?: (entry: Record<string, unknown>) => Promise<unknown> } } }).qms;
  if (!api?.app?.reportError) return;
  const value = error as { message?: string; stack?: string };
  void api.app.reportError({
    source,
    message: value?.message ?? String(error),
    stack: value?.stack
  }).catch(() => {});
}
window.addEventListener('error', (event) => reportRendererFailure('window-error', event.error ?? event.message));
window.addEventListener('unhandledrejection', (event) => reportRendererFailure('unhandled-rejection', event.reason));

const root = document.getElementById('root');
if (!root) throw new Error('Renderer root element is missing.');
createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

