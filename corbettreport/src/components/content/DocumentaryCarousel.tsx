import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { Documentary } from '../../types/content';
import { SectionBand } from './SectionBand';

export function DocumentaryCarousel({ documentaries }: { documentaries: Documentary[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const visible = documentaries.length <= 3
    ? documentaries
    : [0, 1, 2].map((offset) => documentaries[(activeIndex + offset) % documentaries.length]);

  function change(offset: number) {
    setActiveIndex((current) => (current + offset + documentaries.length) % documentaries.length);
  }

  if (documentaries.length === 0) return null;

  return (
    <section className="documentary-section">
      <SectionBand tone="black">Documentaries</SectionBand>
      <div className="documentary-carousel">
        <button type="button" onClick={() => change(-1)} title="Previous documentary"><ChevronLeft /></button>
        <div className="documentary-track">
          {visible.map((documentary, index) => (
            <a className={index === 1 || visible.length < 3 ? 'featured' : ''} key={documentary.id} href={documentary.href}>
              <img src={documentary.image} alt={documentary.title} loading="lazy" />
            </a>
          ))}
        </div>
        <button type="button" onClick={() => change(1)} title="Next documentary"><ChevronRight /></button>
      </div>
      <div className="carousel-dots">
        {documentaries.map((documentary, index) => <button className={index === activeIndex ? 'active' : ''} type="button" key={documentary.id} onClick={() => setActiveIndex(index)} title={documentary.title} />)}
      </div>
    </section>
  );
}
