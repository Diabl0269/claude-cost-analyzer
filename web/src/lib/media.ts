import { useEffect, useState } from 'react';

/**
 * Subscribes to a CSS media query from React.
 *
 * The shell needs the breakpoints in JavaScript, not only in CSS: below 1180px the date range
 * has to *change shape* (one button plus a popover) rather than be hidden, and rendering both
 * shapes and hiding one with CSS would put two controls with the same accessible name in the
 * accessibility tree. Returns `false` during SSR-less first paint only if the query does not
 * match, so there is no flash of the wrong shape.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    setMatches(list.matches);
    const onChange = (event: MediaQueryListEvent): void => setMatches(event.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
