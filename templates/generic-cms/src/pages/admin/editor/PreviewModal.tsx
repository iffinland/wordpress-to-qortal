import { finalizeSlug } from '../../../lib/slug.js';
import { sanitizeHtml } from '../../../lib/sanitize.js';
import type { FeaturedImageChoice } from '../FeaturedImagePicker';

export function PreviewModal(props: {
  draft: any;
  featuredChoice: FeaturedImageChoice;
  onClose: () => void;
}) {
  return (
    <div className="preview-modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
      <div className="preview-modal__bar">
        <h3 id="preview-title">Preview: {props.draft.title || '(untitled)'}</h3>
        <button type="button" className="button button--ghost" onClick={props.onClose}>Close preview</button>
      </div>
      <p className="muted">Slug: /{finalizeSlug(props.draft.slug)} · Preview only, not published.</p>
      <article className="post-body">
        <h1>{props.draft.title}</h1>
        {props.featuredChoice.url ? <img className="article-image" src={props.featuredChoice.url} alt={props.featuredChoice.alt || props.draft.title} /> : null}
        {props.draft.excerpt ? <p className="post-card__excerpt">{props.draft.excerpt}</p> : null}
        <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(props.draft.html) }} />
      </article>
    </div>
  );
}
