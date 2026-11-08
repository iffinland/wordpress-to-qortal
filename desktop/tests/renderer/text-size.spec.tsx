// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProgressBar } from '../../src/renderer/components/Common.js';
import { TEXT_SIZES, applyTextSize, readStoredTextSize, storeTextSize } from '../../src/renderer/textSize.js';

describe('global text size', () => {
  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('style');
    delete document.documentElement.dataset.textSize;
  });

  it('offers keyboard-selectable 90/100/115/130/150% sizes and persists the choice', () => {
    expect([...TEXT_SIZES]).toEqual([90, 100, 115, 130, 150]);
    expect(readStoredTextSize()).toBe(100);
    storeTextSize(130);
    expect(readStoredTextSize()).toBe(130);
    expect(document.documentElement.style.getPropertyValue('--qms-font-scale')).toBe('1.3');
    expect(document.documentElement.dataset.textSize).toBe('130');
    applyTextSize(150);
    expect(document.documentElement.style.getPropertyValue('--qms-font-scale')).toBe('1.5');
  });

  it('shows no fabricated percentage when the total is unknown', () => {
    render(<ProgressBar completed={7} total={0} />);
    expect(screen.getByText(/7 completed \(total not reported yet\)/)).toBeInTheDocument();
    expect(screen.queryByText(/%$/)).toBeNull();
  });

  it('shows a real percentage only with a known denominator', () => {
    render(<ProgressBar completed={5} total={10} />);
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('5 / 10')).toBeInTheDocument();
  });
});
