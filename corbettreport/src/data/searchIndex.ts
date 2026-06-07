import { archiveHref, categoryHref, pageHref, postHref, slugify } from '../app/routes';
import type { SearchResult, SiteDataset } from '../types/content';

export function createSearchIndex(dataset: SiteDataset): SearchResult[] {
  const categoryNames = [...new Set(dataset.posts.flatMap((post) => post.categories))];

  return [
    ...dataset.posts.map((post) => ({
      id: `post:${post.id}`,
      kind: 'post' as const,
      title: post.title,
      description: `${post.categories.join(', ')} - ${post.excerpt}`,
      href: postHref(post.slug)
    })),
    ...dataset.pages.map((page) => ({
      id: `page:${page.slug}`,
      kind: 'page' as const,
      title: page.title,
      description: 'Page',
      href: pageHref(page.slug)
    })),
    {
      id: 'page:archive',
      kind: 'page' as const,
      title: 'Archive',
      description: 'Monthly post archive',
      href: archiveHref()
    },
    ...categoryNames.map((category) => ({
      id: `category:${slugify(category)}`,
      kind: 'category' as const,
      title: category,
      description: 'Category',
      href: categoryHref(slugify(category))
    }))
  ];
}

export function findSearchResults(index: SearchResult[], query: string, limit = 7) {
  const normalized = query.trim().toLowerCase();
  if (normalized.length < 2) return [];

  return index
    .map((result) => {
      const title = result.title.toLowerCase();
      const description = result.description.toLowerCase();
      const score = title === normalized ? 0 : title.startsWith(normalized) ? 1 : title.includes(normalized) ? 2 : description.includes(normalized) ? 3 : 99;
      return { result, score };
    })
    .filter(({ score }) => score < 99)
    .sort((left, right) => left.score - right.score || left.result.title.localeCompare(right.result.title))
    .slice(0, limit)
    .map(({ result }) => result);
}
