import { useCallback, useEffect, useState } from 'react';
import type { UpdateCheckerState } from '../../../../lib/update/registry.js';
import { createCmsUpdateChecker } from './updates.js';

export interface CmsUpdateController {
  state: UpdateCheckerState;
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  check: (force?: boolean) => void;
}

export function useCmsUpdate(templateVersion: string): CmsUpdateController {
  const [checker] = useState(() => createCmsUpdateChecker(templateVersion));
  const [state, setState] = useState<UpdateCheckerState>(() => checker.getState());
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const unsubscribe = checker.subscribe(setState);
    void checker.check();
    return unsubscribe;
  }, [checker]);

  const openPanel = useCallback(() => {
    setOpen(true);
    if (state.status === 'idle' || state.status === 'unable_to_check' || state.status === 'unverified') {
      void checker.check(true);
    }
  }, [checker, state.status]);

  return {
    state,
    open,
    openPanel,
    closePanel: () => setOpen(false),
    check: (force = true) => { void checker.check(force); }
  };
}
