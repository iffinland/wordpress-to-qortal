import { ConfirmPublishDialog, type PublishPhase } from '../../../components/ConfirmPublishDialog';
import { finalizeSlug } from '../../../lib/slug.js';
import type { ViewerIdentity } from '../../../types';
import type { FeaturedImageChoice } from '../FeaturedImagePicker';

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
  slugChanged: boolean;
  publishedSlug: string;
  phase: PublishPhase;
  statusMessage: string;
  onConfirm: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
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
        <div><dt>Fee</dt><dd>{props.fee}</dd></div>
        <div><dt>Signer</dt><dd>{props.identity.address}</dd></div>
        {props.slugChanged ? <div><dt>Slug change</dt><dd>Old slug /{props.publishedSlug} becomes an alias; old content resource is kept.</dd></div> : null}
      </dl>
      <p className="muted">HTML is sanitized before publication. Ownership is revalidated immediately before each signature.</p>
    </ConfirmPublishDialog>
  );
}
