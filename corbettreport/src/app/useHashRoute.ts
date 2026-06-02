import { useEffect, useState } from 'react';
import { parseHashRoute } from './routes';

export function useHashRoute() {
  const [route, setRoute] = useState(() => parseHashRoute());

  useEffect(() => {
    const updateRoute = () => setRoute(parseHashRoute());
    window.addEventListener('hashchange', updateRoute);
    return () => window.removeEventListener('hashchange', updateRoute);
  }, []);

  return route;
}
