import type { ReactNode } from 'react';
import type { ContentPost, SearchResult } from '../../types/content';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { SiteSidebar } from './SiteSidebar';

export function PublicLayout({ searchIndex, posts, showSidebar = false, children }: { searchIndex: SearchResult[]; posts: ContentPost[]; showSidebar?: boolean; children: ReactNode }) {
  return (
    <>
      <SiteHeader searchIndex={searchIndex} />
      <main className={showSidebar ? 'public-main with-sidebar' : 'public-main'}>
        <div className="public-content">{children}</div>
        {showSidebar && <SiteSidebar posts={posts} />}
      </main>
      <SiteFooter />
    </>
  );
}
