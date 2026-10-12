import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * unDraw illustrations (https://undraw.co, free to use without attribution), bundled locally in
 * `src/assets/illustrations` (CR-03 / D-085). Each SVG is its own lazily loaded chunk and is inlined so the theme
 * can recolour it: index.css maps unDraw's accent (#6c63ff) to the brand primary and its inks/greys to light and
 * dark values. Sources: empty = add-files, no-results = file-searching, tasks-empty = add-tasks, all-done =
 * all-checked, not-found = the-void, access-denied = access-denied, server-error = server-error, offline =
 * connection-lost, invite-error = empty-mailbox, login = authentication, welcome-aboard = welcome-aboard,
 * dashboard = hello, travel = destination.
 */
export type IllustrationName =
  | 'empty'
  | 'no-results'
  | 'tasks-empty'
  | 'all-done'
  | 'not-found'
  | 'access-denied'
  | 'server-error'
  | 'offline'
  | 'invite-error'
  | 'login'
  | 'welcome-aboard'
  | 'dashboard'
  | 'travel';

const loaders = import.meta.glob<string>('../assets/illustrations/*.svg', { query: '?raw', import: 'default' });
const cache = new Map<IllustrationName, string>();

function load(name: IllustrationName): Promise<string> {
  const loader = loaders[`../assets/illustrations/${name}.svg`];
  if (!loader) return Promise.resolve('');
  return loader().then((svg) => {
    cache.set(name, svg);
    return svg;
  });
}

/** A decorative illustration (`aria-hidden`; always pair it with real text). Sized by `className`. */
export function Illustration({ name, className }: { name: IllustrationName; className?: string }) {
  const [loaded, setLoaded] = useState<{ name: IllustrationName; svg: string } | null>(() =>
    cache.has(name) ? { name, svg: cache.get(name)! } : null,
  );
  useEffect(() => {
    let live = true;
    if (!cache.has(name)) void load(name).then((svg) => live && setLoaded({ name, svg }));
    return () => {
      live = false;
    };
  }, [name]);
  const svg = loaded?.name === name ? loaded.svg : cache.get(name);

  return (
    <div
      aria-hidden="true"
      data-illustration={name}
      className={cn('illustration aspect-[4/3] w-full max-w-60 shrink-0', className)}
      // Trusted, bundled SVG files (checked for scripts and links when added).
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}
