import type { ReactNode } from 'react';
import type { SearchResult } from '../../types/content';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

export function PublicLayout({ searchIndex, children }: { searchIndex: SearchResult[]; children: ReactNode }) {
  return (
    <>
      <SiteHeader searchIndex={searchIndex} />
      <main>{children}</main>
      <SiteFooter />
    </>
  );
}
