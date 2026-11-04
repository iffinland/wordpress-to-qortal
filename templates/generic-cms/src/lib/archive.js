export function paginate(items, page, pageSize) {
  const size = Math.max(1, Number(pageSize) || 9);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / size));
  const current = Math.min(Math.max(1, Number(page) || 1), totalPages);
  const start = (current - 1) * size;
  return {
    items: items.slice(start, start + size),
    page: current,
    pageSize: size,
    totalItems,
    totalPages,
    hasPrevious: current > 1,
    hasNext: current < totalPages
  };
}

export function publishedPosts(posts) {
  return [...(posts || [])]
    .filter((item) => item.type === 'post' && item.status === 'published')
    .sort((left, right) => Date.parse(right.publishedAt || right.createdAt || '') - Date.parse(left.publishedAt || left.createdAt || ''));
}

export function postsForTerm(posts, termId) {
  return publishedPosts(posts).filter((item) => (item.categoryIds || []).includes(termId) || (item.tagIds || []).includes(termId));
}

export function archivePosts(posts, year, month) {
  return publishedPosts(posts).filter((item) => {
    const value = item.publishedAt || item.createdAt;
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    if (year && date.getUTCFullYear() !== year) return false;
    if (month && date.getUTCMonth() + 1 !== month) return false;
    return true;
  });
}

export function archiveGroups(posts) {
  const groups = new Map();
  for (const item of publishedPosts(posts)) {
    const value = item.publishedAt || item.createdAt;
    if (!value) continue;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) continue;
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    if (!groups.has(year)) groups.set(year, new Map());
    const months = groups.get(year);
    months.set(month, (months.get(month) || 0) + 1);
  }
  return [...groups.entries()]
    .sort((left, right) => right[0] - left[0])
    .map(([year, months]) => ({
      year,
      count: [...months.values()].reduce((sum, value) => sum + value, 0),
      months: [...months.entries()]
        .sort((left, right) => right[0] - left[0])
        .map(([month, count]) => ({ month, count }))
    }));
}

export function previousAndNext(posts, slug) {
  const ordered = publishedPosts(posts);
  const index = ordered.findIndex((item) => item.slug === slug);
  return {
    previous: index > 0 ? ordered[index - 1] : null,
    next: index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null
  };
}
