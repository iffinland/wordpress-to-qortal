import { useEffect, useState } from 'react';
import { parseHashRoute } from '../lib/routes.js';
import type { AppRoute } from '../types';

export function useHashRoute(): AppRoute {
  const [route, setRoute] = useState<AppRoute>(() => parseHashRoute(window.location.hash) as AppRoute);
  useEffect(() => {
    const update = () => setRoute(parseHashRoute(window.location.hash) as AppRoute);
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  return route;
}
