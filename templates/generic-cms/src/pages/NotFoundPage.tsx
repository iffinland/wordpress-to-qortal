export function NotFoundPage(props: { title?: string; message?: string }) {
  return (
    <div className="page page--narrow">
      <h1>{props.title || 'Page not found'}</h1>
      <p>{props.message || 'The requested route does not match a published post, page, category, tag or archive.'}</p>
      <p><a className="button" href="#/">Return home</a></p>
    </div>
  );
}
