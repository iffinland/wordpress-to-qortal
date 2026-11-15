import { FEATURED_IMAGE_HELP } from '../../../lib/featuredImage.js';
import type { FeaturedImageChoice } from '../FeaturedImagePicker';

export function FeaturedImagePanel(props: {
  draft: any;
  featuredChoice: FeaturedImageChoice;
  automaticChoice: FeaturedImageChoice;
  featuredFile: File | null;
  onChoose: () => void;
  onUseAutomatic: () => void;
  onRemove: () => void;
}) {
  return (
    <section className="featured-editor" aria-labelledby="featured-editor-title">
      <h3 id="featured-editor-title">Featured image</h3>
      <p className="muted">{FEATURED_IMAGE_HELP}</p>
      <div className="featured-editor__row">
        {props.featuredChoice.url ? (
          <img className="featured-editor__preview" src={props.featuredChoice.url} alt={props.featuredChoice.alt || 'Featured image preview'} />
        ) : (
          <div className="featured-editor__preview featured-editor__preview--empty" aria-hidden="true">No image</div>
        )}
        <div className="featured-editor__body">
          <p className="featured-editor__source" role="status">
            {props.featuredChoice.source === 'explicit' ? 'Selected by you' : null}
            {props.featuredChoice.source === 'wordpress' ? 'Preserved WordPress featured image' : null}
            {props.featuredChoice.source === 'body' ? 'Automatic: first suitable image in the post body' : null}
            {props.featuredChoice.source === 'published' ? 'Published featured image' : null}
            {props.featuredChoice.source === 'local-file' ? 'New local image, published when you confirm' : null}
            {props.featuredChoice.source === 'none' ? 'No featured image will be published' : null}
            {props.draft.featuredImagePending && !props.featuredFile ? ' · re-select ' + props.draft.featuredImagePending.name : ''}
          </p>
          <div className="admin-toolbar">
            <button type="button" className="button" onClick={props.onChoose}>
              {props.featuredChoice.url ? 'Replace featured image' : 'Choose featured image'}
            </button>
            {props.automaticChoice.url ? (
              <button type="button" className="button button--ghost" onClick={props.onUseAutomatic} disabled={props.featuredChoice.source === 'body'}>
                Use automatic image
              </button>
            ) : null}
            <button type="button" className="button button--ghost" onClick={props.onRemove} disabled={!props.featuredChoice.url && props.featuredChoice.source === 'none'}>
              Remove featured image
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
