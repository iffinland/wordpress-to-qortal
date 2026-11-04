// @vitest-environment jsdom
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/renderer/App.js';
import { mockApi, project } from './fixtures.js';

describe('stale project lock recovery', () => {
  beforeEach(() => {
    window.qms = mockApi();
  });

  it('offers explicit recovery instead of dead-ending after an unclean shutdown', async () => {
    const api = mockApi();
    let closed = 0;
    api.projects.open = vi.fn(async (_projectId: string, recoverStaleLock = false) => {
      if (!recoverStaleLock) {
        closed += 1;
        const error = new Error('Project lock is stale (owner-process-gone). Re-run with explicit stale-lock recovery.') as Error & { code: string };
        error.code = 'PROJECT_LOCK_STALE';
        throw error;
      }
      return { project: project(), snapshot: {} };
    });
    window.qms = api;

    render(<App />);
    const openButtons = await screen.findAllByRole('button', { name: 'Open' });
    await userEvent.click(openButtons[0]);

    expect(await screen.findByRole('alert')).toHaveTextContent('Project needs recovery');
    expect(closed).toBe(1);
    expect(screen.getByText(/does not publish anything/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Recover project' }));
    await waitFor(() => expect(screen.getByText('Project recovery')).toBeInTheDocument());
    expect(api.projects.open).toHaveBeenLastCalledWith(project().id, true);
  });
});
