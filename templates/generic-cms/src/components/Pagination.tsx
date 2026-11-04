export function Pagination(props: {
  page: number;
  totalPages: number;
  totalItems: number;
  hrefForPage: (page: number) => string;
  label: string;
}) {
  if (props.totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label={props.label}>
      <p className="pagination__summary">Page {props.page} of {props.totalPages} ({props.totalItems} items)</p>
      <div className="pagination__controls">
        {props.page > 1 ? <a className="button button--ghost" href={props.hrefForPage(props.page - 1)} rel="prev">Previous</a> : null}
        {props.page < props.totalPages ? <a className="button button--ghost" href={props.hrefForPage(props.page + 1)} rel="next">Next</a> : null}
      </div>
    </nav>
  );
}
