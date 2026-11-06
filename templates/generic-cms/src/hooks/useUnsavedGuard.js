import { useEffect } from 'react';

/**
 * Warn before a browser-level navigation when the editor has unsaved changes.
 * In-app navigation is guarded explicitly by the editor's Back button so the
 * owner can choose Save draft / Discard / Stay.
 */
export function useUnsavedGuard(dirty) {
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return undefined;
    const handler = (event) => {
      event.preventDefault();
      event.returnValue = 'You have unsaved changes. Save a local draft or discard them before leaving.';
      return event.returnValue;
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
}
