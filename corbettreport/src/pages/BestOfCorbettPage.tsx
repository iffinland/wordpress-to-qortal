import { useEffect, useMemo, useState } from 'react';
import { postHref } from '../app/routes';
import { bestOfSections, type BestOfLink } from '../data/bestOfCorbett';
import type { ContentPost } from '../types/content';
import { copyText } from '../utils/clipboard';

function slugFromCorbettUrl(value: string) {
  try {
    const url = new URL(value);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) return '';
    return parts[parts.length - 1];
  } catch {
    return '';
  }
}

function findInternalPost(link: BestOfLink, postsBySlug: Map<string, ContentPost>) {
  const slug = slugFromCorbettUrl(link.url);
  return slug ? postsBySlug.get(slug) || null : null;
}

export function BestOfCorbettPage({ posts }: { posts: ContentPost[] }) {
  const [notice, setNotice] = useState<{ message: string; success: boolean } | null>(null);
  const postsBySlug = useMemo(() => new Map(posts.map((post) => [post.slug, post])), [posts]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function copyWeb2Link(event: React.MouseEvent<HTMLAnchorElement>, url: string) {
    event.preventDefault();
    const copied = await copyText(url);
    setNotice({
      success: copied,
      message: copied ? 'Web2 link copied to clipboard.' : 'Unable to copy Web2 link.'
    });
  }

  function scrollToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <section className="page-shell best-of-page">
      {notice && <p className={`copy-status ${notice.success ? 'success' : 'error'}`} role="status">{notice.message}</p>}
      <article>
        <header className="best-of-header">
          <h1>Best of Corbett</h1>
          <p>Select a category below to view some best of content.</p>
        </header>

        <nav className="best-of-category-grid" aria-label="Best of Corbett categories">
          {bestOfSections.map((section) => (
            <button key={section.id} type="button" onClick={() => scrollToSection(section.id)}>
              <img src={section.image} alt="" loading="lazy" />
              <span>{section.title}</span>
            </button>
          ))}
        </nav>

        <div className="best-of-section-list">
          {bestOfSections.map((section) => (
            <section className="best-of-section" id={section.id} key={section.id}>
              <img src={section.image} alt="" loading="lazy" />
              <div>
                <h2>{section.title}</h2>
                <ul>
                  {section.links.map((link) => {
                    const internalPost = findInternalPost(link, postsBySlug);
                    return (
                      <li key={`${section.id}:${link.url}`}>
                        {internalPost ? (
                          <a href={postHref(internalPost.slug)}>{link.title}</a>
                        ) : (
                          <a href={link.url} onClick={(event) => void copyWeb2Link(event, link.url)} title="Click to copy the original Web2 link">
                            {link.title}
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ))}
        </div>
      </article>
    </section>
  );
}
