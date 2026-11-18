import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GalleryPost } from '../src/templates/gallery';
import type { CmsContentItem, CmsDataset, LoadedContent } from '../src/types';
import { loadFixture, loadFixtureContent } from './support/fixtures';

afterEach(cleanup);

let dataset: CmsDataset;
let item: CmsContentItem;
let content: LoadedContent;

beforeAll(async () => {
  dataset = (await loadFixture()).dataset;
  item = dataset.posts.find((entry) => entry.slug === 'hello-qortal') as CmsContentItem;
  const loaded = await loadFixtureContent(item);
  content = {
    ...loaded,
    html: '<p>Field notes from the coast.</p><img src="/arbitrary/IMAGE/QortalDemo/qms-fixture-image-hero" alt="Coast detail" /><p>More to come.</p>'
  };
});

function renderPost() {
  return render(
    <GalleryPost
      dataset={dataset}
      item={item}
      content={content}
      loading={false}
      error=""
      onRetry={() => undefined}
      previous={null}
      next={null}
    />
  );
}

describe('photography full-size viewing', () => {
  it('opens the featured image in a dialog and closes it with the close button', () => {
    renderPost();
    fireEvent.click(screen.getByRole('button', { name: /view full size/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /close full-size image/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the full-size view with Escape', () => {
    renderPost();
    fireEvent.click(screen.getByRole('button', { name: /view full size/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a body image at full size when clicked', () => {
    const view = renderPost();
    const image = view.container.querySelector('.gallery-reading img') as HTMLImageElement;
    expect(image).toBeTruthy();
    fireEvent.click(image);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('dialog').querySelector('img') as HTMLImageElement).src).toContain('qms-fixture-image-hero');
  });
});
