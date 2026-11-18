import { ConfirmPublishDialog, type PublishPhase } from '../../../components/ConfirmPublishDialog';
import { formatBytes } from '../../../lib/attachments.js';
import { finalizeSlug } from '../../../lib/slug.js';
import type { ViewerIdentity } from '../../../types';
import type { FeaturedImageChoice } from '../FeaturedImagePicker';

export type CrossPublishPlanView = {
  entries: Array<{
    id: string;
    label: string;
    service: string;
    identifier: string;
    reused: boolean;
    summary: string;
  }>;
  resources: unknown[];
  announcement?: string;
  warnings?: string[];
};

export type CrossPublishResultView = {
  id: string;
  label: string;
  state: 'success' | 'reused' | 'failed' | 'ambiguous' | 'declined' | 'not-sent';
  message: string;
};

const RESULT_TEXT: Record<CrossPublishResultView['state'], string> = {
  success: 'published and verified',
  reused: 'already published with identical content (no fee)',
  failed: 'not published',
  ambiguous: 'unconfirmed — nothing was resent',
  declined: 'declined in Qortal Hub',
  'not-sent': 'not sent'
};

export function ConfirmPublishPanel(props: {
  draft: any;
  name: string;
  identity: ViewerIdentity;
  revision: number;
  overlayRevision: number;
  featuredBytes: Uint8Array | null;
  featuredMeta: { name: string; type: string; size: number } | null;
  featuredFile: File | null;
  featuredChoice: FeaturedImageChoice;
  fee: string;
  attachments?: Array<{ service: string; identifier: string; filename: string; size: number; poster: boolean }>;
  progress?: Array<{ stage: string; identifier: string; state: string }>;
  sectionsChange?: { slugs: string[]; hideFromHome: boolean; revision: number } | null;
  crossPlan?: CrossPublishPlanView | null;
  crossResults?: CrossPublishResultView[] | null;
  slugChanged: boolean;
  publishedSlug: string;
  phase: PublishPhase;
  statusMessage: string;
  onConfirm: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const crossPlan = props.crossPlan || null;
  return (
    <ConfirmPublishDialog
      title="Confirm post publication"
      phase={props.phase}
      statusMessage={props.statusMessage}
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
      onClose={props.onClose}
    >
      <dl className="meta-grid">
        <div><dt>Title</dt><dd>{props.draft.title}</dd></div>
        <div><dt>Final slug</dt><dd><code>{finalizeSlug(props.draft.slug)}</code></dd></div>
        <div><dt>Content</dt><dd>DOCUMENT / {props.name} / {props.draft.contentIdentifier || 'stable slug identifier'}</dd></div>
        <div><dt>Index</dt><dd>{props.draft.sourceKind === 'wordpress-overlay' ? 'DOCUMENT / ' + props.name + ' / qms-cms-edit-overlay (revision ' + (props.overlayRevision + 1) + ')' : 'DOCUMENT / ' + props.name + ' / qms-cms-native-index (revision ' + (props.revision + 1) + ')'}</dd></div>
        <div><dt>Featured image</dt><dd>{props.featuredBytes ? 'New local image / ' + ((props.featuredMeta && props.featuredMeta.name) || (props.featuredFile && props.featuredFile.name) || 'selected image') : props.featuredChoice.url ? (props.featuredChoice.ref ? 'QDN IMAGE / ' + (props.featuredChoice.ref.name || props.name) + ' / ' + props.featuredChoice.ref.identifier : props.featuredChoice.url) : 'None'}{props.featuredBytes ? ' (fee includes one image resource)' : ''}</dd></div>
        {props.sectionsChange ? <div><dt>Page assignments</dt><dd>DOCUMENT / {props.name} / qms-cms-sections (revision {props.sectionsChange.revision}): {props.sectionsChange.slugs.length ? props.sectionsChange.slugs.join(', ') : 'no pages'}{props.sectionsChange.hideFromHome ? '; hidden from home' : ''}</dd></div> : null}
        {props.attachments && props.attachments.length ? (
          <div><dt>Attachments</dt><dd>
            <ul>{props.attachments.map((item) => <li key={item.identifier}>{item.service} / {props.name} / {item.identifier} — {item.filename} ({formatBytes(item.size)}){item.poster ? ' + IMAGE poster' : ''}</li>)}</ul>
          </dd></div>
        ) : null}
        {crossPlan && crossPlan.entries.length ? (
          <div><dt>Also publishing</dt><dd>
            <ul className="cross-publish-resources" aria-label="Destination resources">
              {crossPlan.entries.map((entry) => (
                <li key={entry.id} data-destination={entry.id}>
                  <strong>{entry.label}</strong>: {entry.service} / {props.name} / <code>{entry.identifier}</code>
                  {entry.reused ? ' — already published with identical content (no fee)' : ''}
                  {entry.summary ? <span className="muted"> {entry.summary}</span> : null}
                </li>
              ))}
            </ul>
            {crossPlan.announcement ? <p className="muted">Quitter announcement: “{crossPlan.announcement}”</p> : null}
            {crossPlan.warnings && crossPlan.warnings.length ? (
              <p className="muted" role="status">{crossPlan.warnings.join(' ')}</p>
            ) : null}
          </dd></div>
        ) : null}
        <div><dt>Fee</dt><dd>{props.fee}</dd></div>
        <div><dt>Signer</dt><dd>{props.identity.address}</dd></div>
        {props.slugChanged ? <div><dt>Slug change</dt><dd>Old slug /{props.publishedSlug} becomes an alias; old content resource is kept.</dd></div> : null}
      </dl>
      {props.phase !== 'confirm' ? (
        <section className="publish-progress-section" aria-labelledby="publish-progress-title">
          <h4 id="publish-progress-title">Publishing progress</h4>
          {props.progress && props.progress.length ? (
            <ul className="publish-progress" aria-label="Progress per resource">
              {props.progress.map((item) => <li key={item.stage + item.identifier}>{item.stage}: {item.state}</li>)}
            </ul>
          ) : (
            <p className="muted" role="status">Preparing resources for the owner-approved batch…</p>
          )}
        </section>
      ) : null}
      {props.crossResults && props.crossResults.length && props.phase !== 'confirm' ? (
        <section className="destination-results" aria-labelledby="destination-results-title">
          <h4 id="destination-results-title">Results per destination</h4>
          <ul aria-label="Results per destination">
            {props.crossResults.map((entry) => (
              <li key={entry.id} data-state={entry.state}>
                <strong>{entry.label}</strong>: {RESULT_TEXT[entry.state]}{entry.message ? ' — ' + entry.message : ''}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="muted">HTML is sanitized before publication. Ownership is revalidated immediately before each signature.</p>
    </ConfirmPublishDialog>
  );
}
