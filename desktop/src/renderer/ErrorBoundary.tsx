import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
  reported: boolean;
}

/**
 * Top-level UI recovery. React 18 unmounts the whole tree when a render error
 * is uncaught, which used to leave a dark, empty window with no message. This
 * boundary keeps a visible, actionable screen and records the failure in the
 * diagnostics log (redacted, no credentials or content bodies).
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, componentStack: null, reported: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const componentStack = info?.componentStack ?? null;
    this.setState({ componentStack });
    try {
      console.error('QMS_RENDERER_ERROR', error, componentStack);
    } catch {
      // console is best-effort only.
    }
    const api = (window as unknown as { qms?: { app?: { reportError?: (entry: Record<string, unknown>) => Promise<unknown> } } }).qms;
    if (api?.app?.reportError) {
      void api.app.reportError({
        source: 'react-error-boundary',
        message: error?.message ?? 'Unknown render error',
        stack: error?.stack,
        componentStack: componentStack ?? undefined
      }).then(() => this.setState({ reported: true })).catch(() => {});
    }
    try {
      sessionStorage.setItem('qms:last-renderer-error', JSON.stringify({
        at: new Date().toISOString(),
        message: error?.message ?? '',
        componentStack
      }));
    } catch {
      // Storage may be unavailable; the visible screen is the primary recovery.
    }
  }

  private reload = (): void => {
    window.location.reload();
  };

  render(): React.ReactNode {
    const { error, componentStack, reported } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="app-shell" data-testid="renderer-error-screen" role="alert">
        <main className="app-main">
          <section className="card warn stack">
            <h1>The interface hit an unexpected error</h1>
            <p>
              Your project, plans, downloaded media and completed handoffs are stored on disk and were not changed by this
              error. Reload the interface to continue; the app records a redacted diagnostic entry automatically.
            </p>
            <p className="small muted">
              A handoff package that finished writing before the error is kept on disk. After reloading, open the project,
              go to Publishing and select the most recent handoff to export it.
            </p>
            <div className="row gap wrap">
              <button className="primary" type="button" onClick={this.reload}>Reload interface</button>
            </div>
            <p className="small muted">
              Diagnostics: {reported ? 'failure recorded in the workspace logs directory.' : 'could not be recorded (the app may still be starting).'}
            </p>
            <details>
              <summary>Technical details</summary>
              <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
              {componentStack && <pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{componentStack}</pre>}
            </details>
          </section>
        </main>
      </div>
    );
  }
}
