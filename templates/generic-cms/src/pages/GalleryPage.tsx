import { useEffect, useMemo, useRef, useState } from 'react';
import type { Gallery, GalleryImage } from '../types';
import { createQdnResourceUrl } from '../lib/qortal.js';
import { StateNotice } from '../components/StateNotice';

function imageUrl(image: GalleryImage) {
  return createQdnResourceUrl(image.service, image.name, image.identifier);
}

function Lightbox(props: {
  images: GalleryImage[];
  index: number;
  title: string;
  onClose: () => void;
  onIndex: (next: number) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const touchStart = useRef<number | null>(null);
  const count = props.images.length;
  const image = props.images[props.index];

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => { if (previous) previous.focus(); };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); props.onClose(); }
      if (event.key === 'ArrowLeft' && count > 1) { event.preventDefault(); props.onIndex((props.index - 1 + count) % count); }
      if (event.key === 'ArrowRight' && count > 1) { event.preventDefault(); props.onIndex((props.index + 1) % count); }
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((element) => !element.hasAttribute('disabled'));
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.index, count]);

  if (!image) return null;
  return (
    <div
      ref={dialogRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={props.title + ' image ' + (props.index + 1) + ' of ' + count}
      onTouchStart={(event) => { touchStart.current = event.touches[0]?.clientX ?? null; }}
      onTouchEnd={(event) => {
        if (touchStart.current == null) return;
        const delta = (event.changedTouches[0]?.clientX ?? 0) - touchStart.current;
        touchStart.current = null;
        if (Math.abs(delta) < 50 || count < 2) return;
        props.onIndex(delta > 0 ? (props.index - 1 + count) % count : (props.index + 1) % count);
      }}
    >
      <div className="lightbox__bar">
        <p className="lightbox__count">{props.index + 1} / {count}</p>
        <button ref={closeRef} type="button" className="button button--ghost lightbox__close" onClick={props.onClose} aria-label="Close gallery viewer">Close</button>
      </div>
      <div className="lightbox__stage">
        {count > 1 ? (
          <button type="button" className="lightbox__nav" onClick={() => props.onIndex((props.index - 1 + count) % count)} aria-label="Previous image">‹</button>
        ) : null}
        <figure className="lightbox__figure">
          {failed[props.index] ? (
            <StateNotice state="error" title="Image unavailable" message="This QDN image could not be loaded. It may still be publishing." />
          ) : (
            <img
              src={imageUrl(image)}
              alt={image.alt || image.caption || props.title}
              onError={() => setFailed((current) => ({ ...current, [props.index]: true }))}
            />
          )}
          {image.caption ? <figcaption>{image.caption}</figcaption> : null}
        </figure>
        {count > 1 ? (
          <button type="button" className="lightbox__nav" onClick={() => props.onIndex((props.index + 1) % count)} aria-label="Next image">›</button>
        ) : null}
      </div>
    </div>
  );
}

export function GalleryPage(props: { galleries: Gallery[]; catalogLoading?: boolean; catalogError?: string; slug?: string }) {
  const [open, setOpen] = useState<{ gallery: Gallery; index: number } | null>(null);
  const galleries = useMemo(() => props.galleries || [], [props.galleries]);
  useEffect(() => {
    document.body.classList.toggle('lightbox-open', Boolean(open));
    return () => document.body.classList.remove('lightbox-open');
  }, [open]);
  const viewer = open ? (
    <Lightbox
      images={open.gallery.images}
      index={open.index}
      title={open.gallery.title}
      onClose={() => setOpen(null)}
      onIndex={(index) => setOpen({ gallery: open.gallery, index })}
    />
  ) : null;
  if (props.catalogLoading) {
    return <div className="page"><StateNotice state="loading" title="Loading galleries..." /></div>;
  }
  if (props.catalogError) {
    return <div className="page"><StateNotice state="error" title="Galleries unavailable" message={props.catalogError} /></div>;
  }
  if (props.slug) {
    const gallery = galleries.find((item) => item.slug === props.slug);
    if (!gallery) return <div className="page"><h1>Gallery not found</h1><p><a href="#/gallery">All galleries</a></p></div>;
    return (
      <div className="page">
        {viewer}
        <p><a href="#/gallery">← All galleries</a></p>
        <h1>{gallery.title}</h1>
        {gallery.description ? <p className="muted">{gallery.description}</p> : null}
        <ul className="gallery-grid">
          {gallery.images.map((image, index) => (
            <li key={image.identifier} className="gallery-card">
              <button type="button" className="gallery-card__button" onClick={() => setOpen({ gallery, index })} aria-label={(image.caption || gallery.title) + ', open full screen'}>
                <img src={imageUrl(image)} alt={image.alt || image.caption || gallery.title} loading="lazy" />
                {image.caption ? <span className="gallery-card__caption">{image.caption}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (galleries.length === 0) {
    return <div className="page"><h1>Galleries</h1><StateNotice state="empty" title="No galleries yet" message="Galleries published by the site owner will appear here." /></div>;
  }
  return (
    <div className="page">
      {viewer}
      <h1>Galleries</h1>
      <ul className="gallery-list">
        {galleries.map((gallery) => {
          const cover = gallery.images[0];
          return (
            <li key={gallery.id} className="gallery-list__item">
              <a href={'#/gallery/' + encodeURIComponent(gallery.slug)}>
                {cover ? <img src={imageUrl(cover)} alt="" loading="lazy" /> : null}
                <span>{gallery.title}</span>
                <span className="muted">{gallery.images.length} image(s)</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

