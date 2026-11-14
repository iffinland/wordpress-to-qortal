import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FeaturedImagePicker } from '../src/pages/admin/FeaturedImagePicker';
import { ownerIdentity } from './support/fixtures';

const baseProps = {
  identity: ownerIdentity,
  name: 'QortalDemo',
  datasetMedia: [],
  galleries: [],
  current: { ref: null, url: '', alt: '', source: 'none' },
  automatic: null,
  pendingFile: null,
  onSelectRef: vi.fn(),
  onUseAutomatic: vi.fn(),
  onPublishWithout: vi.fn(),
  onClose: vi.fn()
};

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:featured-test'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('featured image picker byte capture', () => {
  it('hands the captured bytes to the editor during the selection event', async () => {
    const onSelectFile = vi.fn();
    render(<FeaturedImagePicker {...baseProps} onSelectFile={onSelectFile} />);
    const input = screen.getByLabelText('Choose a featured image from this device') as HTMLInputElement;
    const file = new File(['abcd'], 'cover.jpg', { type: 'image/jpeg' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(onSelectFile).toHaveBeenCalledTimes(1));
    const [selected, captured] = onSelectFile.mock.calls[0];
    expect(selected.name).toBe('cover.jpg');
    expect(Array.from(captured)).toEqual([97, 98, 99, 100]);
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('reports an unreadable file instead of selecting it', async () => {
    const onSelectFile = vi.fn();
    render(<FeaturedImagePicker {...baseProps} onSelectFile={onSelectFile} />);
    const input = screen.getByLabelText('Choose a featured image from this device') as HTMLInputElement;
    const file = new File(['abcd'], 'cover.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: async () => { throw new Error('permission problems'); },
      configurable: true
    });
    class FailingFileReader {
      onerror: ((error: any) => void) | null = null;
      onload: (() => void) | null = null;
      readAsArrayBuffer() { setTimeout(() => this.onerror && this.onerror(new Error('permission problems')), 0); }
    }
    vi.stubGlobal('FileReader', FailingFileReader as any);

    fireEvent.change(input, { target: { files: [file] } });

    await screen.findByText(/could not be read from this device/);
    expect(onSelectFile).not.toHaveBeenCalled();
  });
});
