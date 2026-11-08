import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { IPC } from '../src/shared/channels.js';
import { validateIpcPayload } from '../src/shared/validation.js';
import {
  completedStepIndexes,
  migrateWizardForLoad,
  normalizeCompletedSteps
} from '../src/shared/wizard.js';

const fixturePath = path.join(__dirname, 'fixtures', 'legacy-wizard-project.json');

function savedWizard(input: Record<string, unknown>) {
  const result = validateIpcPayload(IPC.projectSaveWizard, {
    projectId: 'prj_7vhfkdo51nrbd0us',
    wizard: input
  });
  return result.wizard as Record<string, unknown>;
}

describe('wizard completed-step migration', () => {
  it('maps legacy numeric indexes, mixed arrays and numeric strings to canonical ids', () => {
    expect(normalizeCompletedSteps([1, 2, 3, 4, 5])).toEqual(['source', 'connection', 'destination', 'preferences', 'plan']);
    expect(normalizeCompletedSteps([1, 'connection', 'destination', 5, 'plan', 2])).toEqual(['source', 'connection', 'destination', 'plan']);
    expect(normalizeCompletedSteps(['1', '3'])).toEqual(['source', 'destination']);
    expect(normalizeCompletedSteps(['source', 'plan'])).toEqual(['source', 'plan']);
    expect(completedStepIndexes([1, 'plan'])).toEqual([1, 5]);
  });

  it('is idempotent and never introduces duplicates', () => {
    const once = normalizeCompletedSteps([5, 1, 2, 2, 'connection']);
    const twice = normalizeCompletedSteps(once);
    expect(twice).toEqual(once);
    expect(new Set(twice).size).toBe(twice.length);
  });

  it('loads a persisted real-world project with numeric completedSteps and migrates once', () => {
    const project = JSON.parse(readFileSync(fixturePath, 'utf8'));
    const first = migrateWizardForLoad(project.settings.desktopWizard);
    expect(first.changed).toBe(true);
    expect(first.legacySteps).toBe(true);
    expect(first.wizard.completedSteps).toEqual(['source', 'connection', 'destination', 'preferences']);
    expect(first.wizard.wizardVersion).toBe(3);
    expect((first.wizard.preferences as Record<string, unknown>).before).toBe('2026-10-21T23:59:59.999Z');
    // No setting or selected value is dropped.
    expect((first.wizard.preferences as Record<string, unknown>).batchSize).toBe(5);
    expect(first.wizard.targetQdnName).toBe('developer iffi');
    expect(first.wizard.planId).toBeNull();

    const second = migrateWizardForLoad(first.wizard);
    expect(second.changed).toBe(false);
    expect(second.wizard).toEqual(first.wizard);
  });

  it('accepts numeric completedSteps through IPC validation without the red banner error', () => {
    const wizard = savedWizard({
      step: 5,
      completedSteps: [1, 2, 3, 4],
      adapterId: 'wordpress',
      sourceUrl: 'https://vabadused.ee',
      authMode: 'none',
      connection: { status: 'completed', report: { ok: true } },
      targetQdnName: 'developer iffi',
      siteTitle: 'Vabadused',
      siteDescription: '',
      preferences: { batchSize: 5, contentTypes: ['post'], before: '2026-10-21T00:00:00.000Z' },
      planId: null,
      updatedAt: '2026-11-05T12:00:00.000Z'
    });
    expect(wizard.completedSteps).toEqual(['source', 'connection', 'destination', 'preferences']);
    expect(wizard.wizardVersion).toBe(3);
    expect((wizard.preferences as Record<string, unknown>).batchSize).toBe(5);
    expect((wizard.preferences as Record<string, unknown>).before).toBe('2026-10-21T23:59:59.999Z');
  });

  it('accepts mixed arrays and preserves unrelated wizard settings', () => {
    const wizard = savedWizard({
      step: 4,
      completedSteps: [1, 'connection', 'destination', 4],
      adapterId: 'wordpress',
      sourceUrl: 'https://vabadused.ee',
      authMode: 'none',
      connection: null,
      targetQdnName: 'developer iffi',
      siteTitle: 'Vabadused',
      siteDescription: 'Preserved',
      website: { cms: 'generic-cms', service: 'WEBSITE', tagline: 'Tagline', accent: '#123456' },
      preferences: { batchSize: 7, contentTypes: ['post', 'page'], after: '2026-11-01T00:00:00.000Z' },
      planId: null,
      updatedAt: '2026-11-05T12:00:00.000Z'
    });
    expect(wizard.completedSteps).toEqual(['source', 'connection', 'destination', 'preferences']);
    expect(wizard.siteDescription).toBe('Preserved');
    expect((wizard.website as Record<string, unknown>).service).toBe('WEBSITE');
  });

  it('rejects a non-array completedSteps instead of stringifying an object', () => {
    expect(() => savedWizard({
      step: 2,
      completedSteps: { 0: 1 },
      adapterId: 'wordpress',
      sourceUrl: 'https://example.org',
      authMode: 'none',
      connection: null,
      targetQdnName: '',
      siteTitle: '',
      siteDescription: '',
      preferences: {},
      planId: null,
      updatedAt: '2026-11-05T12:00:00.000Z'
    })).toThrow(/completedSteps must be an array/);
  });
});
