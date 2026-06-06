import { ChevronLeft, ChevronRight } from 'lucide-react';

function paginationItems(currentPage: number, pageCount: number) {
  const candidates = new Set([1, pageCount, currentPage - 2, currentPage - 1, currentPage, currentPage + 1, currentPage + 2]);
  const pages = [...candidates].filter((page) => page >= 1 && page <= pageCount).sort((left, right) => left - right);
  const items: Array<number | string> = [];

  for (const page of pages) {
    const previous = items[items.length - 1];
    if (typeof previous === 'number' && page - previous > 1) items.push(`ellipsis-${previous}-${page}`);
    items.push(page);
  }

  return items;
}

export function Pagination({ currentPage, pageCount, hrefForPage }: { currentPage: number; pageCount: number; hrefForPage: (page: number) => string }) {
  if (pageCount <= 1) return null;

  return (
    <nav className="content-pagination" aria-label="Posts pagination">
      {currentPage > 1 ? (
        <a className="pagination-direction" href={hrefForPage(currentPage - 1)}><ChevronLeft size={16} /> Previous</a>
      ) : (
        <span className="pagination-direction disabled"><ChevronLeft size={16} /> Previous</span>
      )}

      <div className="pagination-pages">
        {paginationItems(currentPage, pageCount).map((item) => typeof item === 'number' ? (
          <a
            className={item === currentPage ? 'active' : ''}
            href={hrefForPage(item)}
            key={item}
            aria-current={item === currentPage ? 'page' : undefined}
          >
            {item}
          </a>
        ) : <span className="pagination-ellipsis" key={item}>...</span>)}
      </div>

      {currentPage < pageCount ? (
        <a className="pagination-direction" href={hrefForPage(currentPage + 1)}>Next <ChevronRight size={16} /></a>
      ) : (
        <span className="pagination-direction disabled">Next <ChevronRight size={16} /></span>
      )}
    </nav>
  );
}
