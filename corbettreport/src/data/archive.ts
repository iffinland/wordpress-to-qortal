import type { ContentPost } from '../types/content';

export interface ArchiveMonth {
  key: string;
  year: number;
  month: number;
  label: string;
  count: number;
}

export function archiveMonthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1));
}

export function createArchiveMonths(posts: ContentPost[]): ArchiveMonth[] {
  const months = new Map<string, ArchiveMonth>();

  for (const post of posts) {
    const date = new Date(post.publishedAt);
    if (Number.isNaN(date.getTime())) continue;
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    const current = months.get(key);
    if (current) {
      current.count += 1;
    } else {
      months.set(key, {
        key,
        year,
        month,
        label: archiveMonthLabel(year, month),
        count: 1
      });
    }
  }

  return [...months.values()].sort((left, right) => right.year - left.year || right.month - left.month);
}

export function postsForArchiveMonth(posts: ContentPost[], year?: number, month?: number) {
  const sorted = [...posts].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
  if (!year || !month) return sorted;
  return sorted.filter((post) => {
    const date = new Date(post.publishedAt);
    return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() + 1 === month;
  });
}
