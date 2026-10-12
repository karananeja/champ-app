import { useCallback, useSyncExternalStore } from 'react';

/** Whether a CSS media query matches, kept in sync with the viewport. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Tailwind's `md` breakpoint and up (desktop layouts). */
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 768px)');
