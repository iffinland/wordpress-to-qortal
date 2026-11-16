import { formatBytes } from '../../../lib/attachments.js';
import { QTUBE_PLAYABLE_EXTENSIONS } from '../../../lib/crossPublish/qtube.js';

export type CrossPublishDestination = 'qtube' | 'subwire' | 'quitter';
export type CrossPublishSelections = Record<CrossPublishDestination, boolean>;

export function emptyCrossPublishSelections(): CrossPublishSelections {
  return { qtube: false, subwire: false, quitter: false };
}

export function CrossPublishPanel(props: {
  /** First eligible VIDEO attachment, or null. */
  video: { filename: string; size: number } | null;
  selections: CrossPublishSelections;
  quitterText: string;
  quitterLimit: number;
  subwireCoverKind?: 'featured' | 'generated' | null;
  onToggle: (destination: CrossPublishDestination, checked: boolean) => void;
  onQuitterText: (value: string) => void;
  onRegenerateQuitter: () => void;
}) {
  const qtubeChecked = Boolean(props.video) && props.selections.qtube;
  const overLimit = props.quitterText.trim().length > props.quitterLimit;
  return (
    <section className="cross-publish-panel" aria-labelledby="cross-publish-title">
      <h3 id="cross-publish-title">Also publish to other Qortal apps</h3>
      <p className="muted">
        Optional. The CMS post is published to this site either way. Every selected destination joins the same
        Qortal Hub approval and the same fee quote, and each one is verified on its own after publication.
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          aria-label="Publish to Q-Tube"
          checked={qtubeChecked}
          disabled={!props.video}
          onChange={(event) => props.onToggle('qtube', event.target.checked)}
        />
        <span>
          <strong>Q-Tube</strong> — publish video metadata that Q-Tube can discover and play. The existing VIDEO
          attachment is referenced, never uploaded twice.
        </span>
      </label>
      <p className="cross-publish-hint" data-destination="qtube">
        {props.video
          ? 'Eligible video: ' + props.video.filename + ' (' + formatBytes(props.video.size) + ').'
          : 'No eligible video attachment. Q-Tube accepts ' + QTUBE_PLAYABLE_EXTENSIONS.join(', ').toUpperCase() + ' videos (MKV and HEVC are rejected by Q-Tube).'}
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          aria-label="Publish to Subwire"
          checked={props.selections.subwire}
          onChange={(event) => props.onToggle('subwire', event.target.checked)}
        />
        <span>
          <strong>Subwire</strong> — create a Subwire essay from this post body (Markdown) and its featured image.
        </span>
      </label>
      <p className="cross-publish-hint" data-destination="subwire">
        {props.selections.subwire
          ? props.subwireCoverKind === 'generated'
            ? 'No embeddable featured image was found, so a simple generated cover is used.'
            : 'The featured image is embedded as the Subwire cover.'
          : 'A cover image is required by Subwire; the featured image is used when available, otherwise a generated cover.'}
      </p>

      <label className="check-row">
        <input
          type="checkbox"
          aria-label="Publish to Quitter"
          checked={props.selections.quitter}
          onChange={(event) => props.onToggle('quitter', event.target.checked)}
        />
        <span>
          <strong>Quitter</strong> — publish one short public announcement that links to this post.
        </span>
      </label>

      {props.selections.quitter ? (
        <>
          <label htmlFor="quitter-announcement">Quitter announcement text</label>
          <textarea
            id="quitter-announcement"
            value={props.quitterText}
            onChange={(event) => props.onQuitterText(event.target.value)}
            rows={5}
            aria-describedby="quitter-announcement-help"
          />
          <p id="quitter-announcement-help" className="cross-publish-counter" data-over={overLimit ? 'true' : 'false'} role="status">
            {props.quitterText.trim().length} / {props.quitterLimit} characters. The link comes before the summary
            because Quitter collapses longer posts.
          </p>
          {overLimit ? (
            <p className="cross-publish-hint" role="alert">
              The announcement is longer than Quitter's {props.quitterLimit}-character display window. Shorten it before publishing.
            </p>
          ) : null}
          <div className="admin-toolbar">
            <button type="button" className="button button--ghost" onClick={props.onRegenerateQuitter}>
              Regenerate announcement
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
