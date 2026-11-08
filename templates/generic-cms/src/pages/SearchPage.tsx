import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { StateNotice } from '../components/StateNotice';
import {
  buildSearchIndexDocument,
  createSearchEntryFromItem,
  highlightTextParts,
  isSearchIndexStale,
  searchIndexEntries,
  searchIndexHref,
  SEARCH_REBUILD_HINT
} from '../lib/search.js';
import { searchHref } from '../lib/routes.js';
import { featuredImageUrlForItem } from '../lib/featuredImage.js';
import type { CmsDataset } from '../types';

export type SearchIndexLoadResult = {
  ok: boolean;
  state: 'ready' | 'missing' | 'invalid' | 'unavailable';
  entries: Array<{ id: string; type: 'post' | 'page'; title: string; slug: string; excerpt: string; text: string; updated_at?: string | null; origin?: string }>;
  updatedAt?: string | null;
  notices?: string[];
};

const DEBOUNCE_MS = 220;

function Highlight(props: { text: string; terms: string[] }) {
  const parts = highlightTextParts(props.text, props.terms);
  return (
    <>
      {parts.map((part, index) => part.match
        ? <mark className="search-hit" key={index}>{part.text}</mark>
        : <span key={index}>{part.text}</span>)}
    </>
  );
}

function fallbackIndex(dataset: CmsDataset) {
  const entries = [...dataset.posts, ...dataset.pages]
    .filter((item) => item.status === 'published')
    .map((item) => createSearchEntryFromItem(item, item.excerpt || ''))
    .filter(Boolean) as any[];
  return buildSearchIndexDocument({ siteId: dataset.site.id, entries: entries as never[], source: 'fallback' });
}

export function SearchPage(props: {
  dataset: CmsDataset;
  query: string;
  loadSearchIndex?: () => Promise<SearchIndexLoadResult>;
}) {
  const [value, setValue] = useState(props.query || '');
  const [debounced, setDebounced] = useState(props.query || '');
  const [index, setIndex] = useState<SearchIndexLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const requestRef = useRef(0);

  useEffect(() => { setValue(props.query || ''); setDebounced(props.query || ''); }, [props.query]);

  // Debounced, cancellable live search. A keystroke never triggers a QDN scan:
  // the index is loaded once and all subsequent queries are local.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [value]);

  useEffect(() => {
    if (!debounced.trim()) return;
    let cancelled = false;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setLoadError('');
    const load = props.loadSearchIndex
      ? props.loadSearchIndex()
      : Promise.resolve<SearchIndexLoadResult>({ ok: true, state: 'ready', entries: fallbackIndex(props.dataset).entries, notices: [] });
    load.then((result) => {
      if (cancelled || requestRef.current !== requestId) return;
      setIndex(result);
      if (!result.ok) setLoadError(result.notices && result.notices.length > 0 ? result.notices.join(' ') : 'The search index is unavailable.');
    }).catch((error: Error) => {
      if (cancelled || requestRef.current !== requestId) return;
      setIndex(null);
      setLoadError(error.message || 'The search index could not be loaded.');
    }).finally(() => {
      if (!cancelled && requestRef.current === requestId) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [debounced, props.loadSearchIndex, props.dataset]);

  const terms = useMemo(() => debounced.trim().split(/\s+/).filter(Boolean), [debounced]);
  const results = useMemo(() => {
    if (!debounced.trim()) return { results: [], total: 0 };
    if (index && index.ok) {
      return searchIndexEntries({ schema: 'qms-cms-search-index@1', version: 1, entries: index.entries }, debounced);
    }
    if (index && !index.ok) {
      return searchIndexEntries(fallbackIndex(props.dataset), debounced);
    }
    if (!index && !props.loadSearchIndex) {
      return searchIndexEntries(fallbackIndex(props.dataset), debounced);
    }
    return { results: [], total: 0 };
  }, [debounced, index, props.dataset, props.loadSearchIndex]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    window.location.hash = searchHref(value.trim()).replace(/^#/, '');
  };

  const indexNotice = index && !index.ok
    ? 'The full-text index is unavailable or incomplete, so results cover titles and excerpts only. ' + SEARCH_REBUILD_HINT
    : '';
  const stale = index && index.ok && isSearchIndexStale({ updated_at: index.updatedAt || index.entries[0]?.updated_at || null });
  const itemsById = useMemo(() => new Map([...props.dataset.posts, ...props.dataset.pages].map((item) => [String(item.id), item])), [props.dataset]);
  const itemsBySlug = useMemo(() => new Map([...props.dataset.posts, ...props.dataset.pages].map((item) => [item.type + ':' + item.slug, item])), [props.dataset]);

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
            placeholder="Title, excerpt or full text"
            autoComplete="off"
            aria-describedby="search-status"
          />
          <button className="button" type="submit">Search</button>
        </div>
      </form>

      {!debounced.trim() ? (
        <p className="muted">Type to search titles, excerpts and full article text. Use quotes for a phrase.</p>
      ) : (
        <>
          <p className="search-summary" id="search-status" role="status" aria-live="polite">
            {loading ? 'Searching…' : results.total + ' result' + (results.total === 1 ? '' : 's')} for <strong>{debounced}</strong>
          </p>
          {loadError ? <StateNotice state="partial" title="Full-text search is incomplete" message={loadError} /> : null}
          {indexNotice ? <StateNotice state="partial" title="Search index missing or stale" message={indexNotice} /> : null}
          {stale ? <StateNotice state="stale" compact message={'The search index has not been updated recently. ' + SEARCH_REBUILD_HINT} /> : null}
          {loading && results.total === 0 ? (
            <StateNotice state="loading" title="Loading the search index" message="Reading the versioned index once; no content is downloaded per keystroke." />
          ) : results.total === 0 ? (
            <StateNotice state="empty" title="No matching content" message="The catalog is readable and no published item matches this search." />
          ) : (
            <ul className="search-results-list">
              {results.results.map(({ entry, snippet }) => {
                const item = itemsById.get(String(entry.id)) || itemsBySlug.get(entry.type + ':' + entry.slug);
                const imageUrl = item ? featuredImageUrlForItem(item, props.dataset) : '';
                return (
                <li key={entry.id} className="search-result">
                  {imageUrl ? <img className="search-result__image" src={imageUrl} alt={item?.featuredImageAlt || ''} loading="lazy" decoding="async" /> : null}
                  <p className="search-result__kind">{entry.type === 'page' ? 'Page' : 'Post'}{entry.origin ? ' · ' + entry.origin : ''}</p>
                  <h2 className="search-result__title">
                    <a href={searchIndexHref(entry.slug, entry.type, debounced)} aria-label={entry.title}>
                      <Highlight text={entry.title} terms={terms} />
                    </a>
                  </h2>
                  {entry.excerpt ? <p className="search-result__excerpt"><Highlight text={entry.excerpt} terms={terms} /></p> : null}
                  {snippet && snippet !== entry.excerpt ? <p className="search-result__snippet"><Highlight text={snippet} terms={terms} /></p> : null}
                </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
