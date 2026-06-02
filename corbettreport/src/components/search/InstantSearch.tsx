import { Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { findSearchResults } from '../../data/searchIndex';
import type { SearchResult } from '../../types/content';
import { HighlightedText } from './HighlightedText';

export function InstantSearch({ index, compact = false, onNavigate }: { index: SearchResult[]; compact?: boolean; onNavigate?: () => void }) {
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const results = useMemo(() => findSearchResults(index, query), [index, query]);
  const open = focused && query.trim().length >= 2;

  function navigate(href: string) {
    window.location.hash = href.slice(1);
    setQuery('');
    setFocused(false);
    onNavigate?.();
  }

  return (
    <div className={`instant-search ${compact ? 'compact' : ''}`}>
      <label>
        <Search size={compact ? 18 : 15} />
        <span className="visually-hidden">Search the Corbett Report</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => window.setTimeout(() => setFocused(false), 150)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setQuery('');
              setFocused(false);
            }
            if (event.key === 'Enter' && results[0]) navigate(results[0].href);
          }}
          placeholder={compact ? 'Search...' : '...'}
        />
        {query && <button type="button" onClick={() => setQuery('')} title="Clear search"><X size={14} /></button>}
      </label>
      {open && (
        <div className="search-results">
          {results.map((result) => (
            <button key={result.id} type="button" onMouseDown={() => navigate(result.href)}>
              <small>{result.kind}</small>
              <strong><HighlightedText text={result.title} query={query} /></strong>
              <span><HighlightedText text={result.description} query={query} /></span>
            </button>
          ))}
          {results.length === 0 && <p>No matching content found.</p>}
        </div>
      )}
    </div>
  );
}
