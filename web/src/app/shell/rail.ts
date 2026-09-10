/**
 * Left-rail slots. Pages can replace the project tree with their own (a session
 * detail page shows its agent tree, for example) via `useRailSlot`.
 */
import { createContext, useContext, useEffect, type DependencyList, type ReactNode } from 'react';

export interface RailSlotApi {
  /** null means "use the rail's own project tree" */
  content: ReactNode | null;
  setContent: (content: ReactNode | null) => void;
}

export const RailSlotContext = createContext<RailSlotApi | null>(null);

export function useRailSlotApi(): RailSlotApi {
  const value = useContext(RailSlotContext);
  if (!value) throw new Error('useRailSlot must be used inside the app shell');
  return value;
}

/**
 * Renders `content` in the rail while the calling page is mounted.
 * `deps` must describe everything the node closes over — the node itself is a new
 * object on every render, so it cannot be a dependency.
 */
export function useRailSlot(content: ReactNode, deps: DependencyList): void {
  const { setContent } = useRailSlotApi();
  useEffect(() => {
    setContent(content);
    return () => setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setContent, ...deps]);
}
