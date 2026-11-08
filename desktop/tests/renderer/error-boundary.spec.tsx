// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../../src/renderer/ErrorBoundary.js';
import { mockApi } from './fixtures.js';

function Boom(): React.ReactElement {
  throw new Error('resource.status is undefined');
}

describe('top-level renderer recovery', () => {
  beforeEach(() => {
    window.qms = mockApi();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps a visible recovery screen instead of a blank window and records the failure', async () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>
    );
    expect(await screen.findByTestId('renderer-error-screen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload interface' })).toBeInTheDocument();
    expect(screen.getByText(/Your project, plans, downloaded media and completed handoffs are stored on disk/)).toBeInTheDocument();
    await vi.waitFor(() => expect(window.qms.app.reportError).toHaveBeenCalled());
    const entry = (window.qms.app.reportError as unknown as { mock: { calls: Array<[Record<string, unknown>]> } }).mock.calls[0][0];
    expect(String(entry.message)).toContain('resource.status');
    expect(entry.source).toBe('react-error-boundary');
  });
});
