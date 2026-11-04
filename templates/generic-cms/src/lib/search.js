import { stripHtml } from './text.js';

function tokenize(query) {
  return String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(item, termsById) {
  const terms = [...(item.categoryIds || []), ...(item.tagIds || [])]
    .map((id) => termsById.get(id) || '')
    .join(' ');
  return [item.title, item.slug, item.excerpt, stripHtml(item.excerpt), terms]
    .join(' ')
    .toLowerCase();
}

export function searchDataset(dataset, query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return { posts: [], pages: [], total: 0 };
  const termsById = new Map([
    ...(dataset.categories || []).map((term) => [term.id, term.name]),
    ...(dataset.tags || []).map((term) => [term.id, term.name])
  ]);
  const match = (item) => {
    const hay = haystack(item, termsById);
    return tokens.every((token) => hay.includes(token));
  };
  const posts = (dataset.posts || []).filter((item) => item.status === 'published' && item.type === 'post' && match(item));
  const pages = (dataset.pages || []).filter((item) => item.status === 'published' && item.type === 'page' && match(item));
  return { posts, pages, total: posts.length + pages.length };
}
