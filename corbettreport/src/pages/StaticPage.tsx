import { ContentHtml } from '../components/content/ContentHtml';
import type { PublicPage } from '../types/content';
import { ContactPage } from './ContactPage';

export function StaticPage({ page }: { page: PublicPage }) {
  if (page.slug === 'contact') return <ContactPage />;

  return (
    <section className="page-shell static-page">
      <article>
        <h1>{page.title}</h1>
        <ContentHtml html={page.contentHtml} />
      </article>
    </section>
  );
}
