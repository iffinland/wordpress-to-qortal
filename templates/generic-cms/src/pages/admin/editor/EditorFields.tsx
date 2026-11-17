import { finalizeSlug } from '../../../lib/slug.js';
import type { CmsTerm } from '../../../types';

/**
 * Comma-separated taxonomy field with suggestions from the existing catalog.
 * The datalist is the compact native control; the chips work even in embedded
 * Android WebViews whose datalist support is unreliable.
 */
function TaxonomyInput(props: {
  id: string;
  label: string;
  value: string;
  terms: CmsTerm[];
  onChange: (value: string) => void;
}) {
  const selected = String(props.value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const suggestions = props.terms
    .filter((term) => term && term.name && !selected.includes(term.name.toLowerCase()))
    .slice(0, 8);
  const append = (name: string) => {
    const next = String(props.value || '').trim();
    props.onChange(next ? next + ', ' + name : name);
  };
  return (
    <div className="taxonomy-field">
      <label>{props.label}
        <input
          list={props.id + '-options'}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          aria-describedby={props.id + '-help'}
        />
      </label>
      <datalist id={props.id + '-options'}>
        {props.terms.map((term) => <option key={term.id} value={term.name} />)}
      </datalist>
      <p id={props.id + '-help'} className="muted">Comma separated. Suggestions come from the published catalog.</p>
      {suggestions.length ? (
        <div className="taxonomy-suggestions" aria-label={'Suggested ' + props.label.toLowerCase()}>
          {suggestions.map((term) => (
            <button
              key={term.id}
              type="button"
              className="chip-button"
              onClick={() => append(term.name)}
            >
              {term.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SlugField(props: {
  draft: any;
  autoSlugWarning: string;
  slugChanged: boolean;
  publishedSlug: string;
  advancedSlug: boolean;
  slugConfirmChecked: boolean;
  onSlug: (value: string) => void;
  onRegenerate: () => void;
  onCheckAvailability: () => void;
  onOpenAdvanced: () => void;
  onCancelAdvanced: () => void;
  onConfirmChecked: (checked: boolean) => void;
  onUnlock: () => void;
  onCancelSlugChange: () => void;
}) {
  const { draft } = props;
  return (
    <>
      <label>
        Slug
        <input
          value={draft.slug}
          onChange={(event) => props.onSlug(event.target.value)}
          disabled={draft.slugLocked}
          aria-describedby="slug-help"
          inputMode="url"
          spellCheck={false}
        />
      </label>
      <p id="slug-help" className="muted">
        {draft.slugLocked
          ? 'Locked because this item is published. Editing the title never changes a published slug.'
          : draft.slugTouched
            ? 'Manual slug. Further title changes will not overwrite it.'
            : 'Generated from the complete title; keeps updating until you edit it.'}
        {' '}
        {draft.slug ? <span>Final slug: <code>{finalizeSlug(draft.slug)}</code></span> : null}
      </p>
      {props.autoSlugWarning ? (
        <p className="slug-warning" role="alert">
          {props.autoSlugWarning}{' '}
          <button type="button" className="button button--ghost" onClick={props.onRegenerate}>Regenerate slug now</button>
        </p>
      ) : null}
      <div className="admin-toolbar">
        <button type="button" className="button button--ghost" onClick={props.onRegenerate} disabled={draft.slugLocked}>Regenerate slug</button>
        {draft.slug && !draft.slugLocked ? (
          <button type="button" className="button button--ghost" onClick={props.onCheckAvailability}>Check availability</button>
        ) : null}
        {draft.slugLocked ? (
          <button type="button" className="button button--ghost" onClick={props.onOpenAdvanced}>Change slug (advanced)…</button>
        ) : null}
      </div>

      {props.advancedSlug && draft.slugLocked ? (
        <section className="advanced-slug" aria-labelledby="advanced-slug-title">
          <h3 id="advanced-slug-title">Change a published slug</h3>
          <p>
            The old URL stays valid as an alias in this CMS. The old QDN content resource is kept, never
            overwritten or deleted. External links that use the QDN resource identifier keep working. The new
            version is published under a new identifier and needs its own Hub approval and fee.
          </p>
          <label className="check-row">
            <input type="checkbox" checked={props.slugConfirmChecked} onChange={(event) => props.onConfirmChecked(event.target.checked)} />
            I understand the consequences and want to change this published slug.
          </label>
          <div className="admin-toolbar">
            <button type="button" className="button" disabled={!props.slugConfirmChecked} onClick={props.onUnlock}>Unlock slug field</button>
            <button type="button" className="button button--ghost" onClick={props.onCancelAdvanced}>Cancel</button>
          </div>
        </section>
      ) : null}

      {props.slugChanged && !draft.slugLocked ? (
        <p className="preview-banner" role="status">
          Slug will change from <code>{props.publishedSlug}</code> to <code>{finalizeSlug(draft.slug)}</code>. The old
          URL will resolve through an alias.
          <button type="button" className="button button--ghost" onClick={props.onCancelSlugChange}>Cancel slug change</button>
        </p>
      ) : null}
    </>
  );
}

export function EditorFields(props: {
  draft: any;
  autoSlugWarning: string;
  slugChanged: boolean;
  publishedSlug: string;
  advancedSlug: boolean;
  slugConfirmChecked: boolean;
  onTitle: (value: string) => void;
  onSlug: (value: string) => void;
  onRegenerate: () => void;
  onCheckAvailability: () => void;
  onOpenAdvanced: () => void;
  onCancelAdvanced: () => void;
  onConfirmChecked: (checked: boolean) => void;
  onUnlock: () => void;
  onCancelSlugChange: () => void;
  onUpdate: (key: string, value: unknown) => void;
  categories: CmsTerm[];
  tags: CmsTerm[];
}) {
  const { draft } = props;
  return (
    <div className="editor-fields">
      <label>Title<input value={draft.title} maxLength={200} onChange={(event) => props.onTitle(event.target.value)} /></label>
      <SlugField
        draft={draft}
        autoSlugWarning={props.autoSlugWarning}
        slugChanged={props.slugChanged}
        publishedSlug={props.publishedSlug}
        advancedSlug={props.advancedSlug}
        slugConfirmChecked={props.slugConfirmChecked}
        onSlug={props.onSlug}
        onRegenerate={props.onRegenerate}
        onCheckAvailability={props.onCheckAvailability}
        onOpenAdvanced={props.onOpenAdvanced}
        onCancelAdvanced={props.onCancelAdvanced}
        onConfirmChecked={props.onConfirmChecked}
        onUnlock={props.onUnlock}
        onCancelSlugChange={props.onCancelSlugChange}
      />

      <label>Excerpt<textarea rows={2} value={draft.excerpt} onChange={(event) => props.onUpdate('excerpt', event.target.value)} /></label>
      <TaxonomyInput
        id="categories"
        label="Categories (comma separated)"
        value={draft.categoriesText}
        terms={props.categories}
        onChange={(value) => props.onUpdate('categoriesText', value)}
      />
      <TaxonomyInput
        id="tags"
        label="Tags (comma separated)"
        value={draft.tagsText}
        terms={props.tags}
        onChange={(value) => props.onUpdate('tagsText', value)}
      />
      <label>Author<input value={draft.author} onChange={(event) => props.onUpdate('author', event.target.value)} /></label>
      {!draft.remoteId && !draft.sourceItemId ? (
        <label>Content type
          <select value={draft.type} onChange={(event) => props.onUpdate('type', event.target.value)}>
            <option value="post">Post</option>
            <option value="page">Page</option>
          </select>
        </label>
      ) : null}
    </div>
  );
}
