import type { CmsContentItem } from '../../../types';

export function SectionsPicker(props: {
  pages: CmsContentItem[];
  slugs: string[];
  hideFromHome: boolean;
  onChange: (next: { slugs: string[]; hideFromHome: boolean }) => void;
}) {
  const toggle = (slug: string, checked: boolean) => {
    const slugs = checked ? [...props.slugs.filter((s) => s !== slug), slug] : props.slugs.filter((s) => s !== slug);
    props.onChange({ slugs, hideFromHome: props.hideFromHome });
  };
  return (
    <fieldset className="admin-fieldset">
      <legend>Show on page(s)</legend>
      {props.pages.length === 0 ? <p className="muted">No user-created pages exist yet. Create a page first to assign posts to it.</p> : null}
      {props.pages.map((page) => (
        <label key={page.id} className="admin-check">
          <input type="checkbox" checked={props.slugs.includes(page.slug)} onChange={(event) => toggle(page.slug, event.target.checked)} />
          {page.title}
        </label>
      ))}
      <label className="admin-check">
        <input type="checkbox" checked={props.hideFromHome} onChange={(event) => props.onChange({ slugs: props.slugs, hideFromHome: event.target.checked })} />
        Hide from home
      </label>
    </fieldset>
  );
}
