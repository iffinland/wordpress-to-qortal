import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { Documentary } from '../../types/content';
import { SectionBand } from './SectionBand';

export function DocumentaryCarousel({ documentaries }: { documentaries: Documentary[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = documentaries[activeIndex];

  function change(offset: number) {
    setActiveIndex((current) => (current + offset + documentaries.length) % documentaries.length);
  }

  return (
    <section className="documentary-section">
      <SectionBand tone="black">Documentaries</SectionBand>
      <div className="documentary-carousel">
        <button type="button" onClick={() => change(-1)} title="Previous documentary"><ChevronLeft /></button>
        <a href={active.href}><img src={active.image} alt={active.title} loading="lazy" /></a>
        <button type="button" onClick={() => change(1)} title="Next documentary"><ChevronRight /></button>
      </div>
      <div className="carousel-dots">
        {documentaries.map((documentary, index) => <button className={index === activeIndex ? 'active' : ''} type="button" key={documentary.id} onClick={() => setActiveIndex(index)} title={documentary.title} />)}
      </div>
    </section>
  );
}
