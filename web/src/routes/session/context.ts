/**
 * The session detail is fetched once by the tab shell and handed to every tab through the
 * router outlet, so switching tabs never refetches and every tab agrees on the same numbers.
 */
import { useOutletContext } from 'react-router';
import type { SessionDetail } from '@core/types';
import type { WhatIfStore } from '@/lib/whatif';

export interface SessionContextValue {
  id: string;
  detail: SessionDetail;
  whatIf: WhatIfStore;
}

export function useSessionContext(): SessionContextValue {
  return useOutletContext<SessionContextValue>();
}
