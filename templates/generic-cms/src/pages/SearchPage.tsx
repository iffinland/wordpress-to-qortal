import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { PostCard } from '../components/PostCard';
import { StateNotice } from '../components/StateNotice';
import { searchDataset } from '../lib/search.js';
import { searchHref } from '../lib/routes.js';
import type { CmsDataset } from '../types';

export function SearchPage(props: { dataset: CmsDataset; query: string }) {
  const [value, setValue] = useState(props.query);
  useEffect(() => setValue(props.query), [props.query]);
  const results = searchDataset(props.dataset, props.query);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    window.location.hash = searchHref(value.trim()).replace(/^#/, '');
  };
  return (
    <div className="page">
      <h1>Search</h1>
      <form className="search-form" role="search" onSubmit={submit}>
        <label className="search-form__label" htmlFor="site-search">Search published content</label>
        <div className="search-form__row">
          <input
            id="site-search"
            className="search-form__input"
            type="search"
            name="q"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="Title, excerpt, category or tag"
            autoComplete="off"
          />
          <button className="button" type="submit">Search</button>
        </div>
      </form>

      {!props.query ? (
        <p className="muted">Enter a term to search titles, excerpts, categories and tags.</p>
      ) : (
        <>
          <p className="search-summary" role="status" aria-live="polite">
            {results.total} result{results.total === 1 ? '' : 's'} for <strong>{props.query}</strong>
          </p>
          {!props.dataset.availability.posts && !props.dataset.availability.pages ? (
            <StateNotice state="partial" title="Search index is incomplete" message="Neither the posts nor pages index could be read, so search results are unavailable." />
          ) : results.total === 0 ? (
            <StateNotice state="empty" title="No matching content" message="The catalog is readable and no published item matches this search." />
          ) : (
            <div className="card-grid">
              {[...results.posts, ...results.pages].map((item) => <PostCard key={item.id} item={item} dataset={props.dataset} />)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
