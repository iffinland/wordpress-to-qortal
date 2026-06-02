import type { ReactNode } from 'react';

export function SectionBand({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'red' | 'black' }) {
  return <h2 className={`section-band ${tone}`}>{children}</h2>;
}
