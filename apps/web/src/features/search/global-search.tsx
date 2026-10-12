import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Loader2, Search } from 'lucide-react';
import { SEARCH_MIN_CHARS } from '@champ/shared';
import { Button } from '@/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useDebounced } from '@/hooks/use-debounced';
import { useCurrentUser } from '@/lib/auth';
import { canViewTasks } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { useGlobalSearch } from './queries';
import { hitPath, isSearchable } from './search-format';
import { FitmentHitContent, TaskHitContent, TravelHitContent } from './search-hits';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function Status({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/** The dialog body: debounced GET /search and the grouped results (cmdk gives the arrow keys). */
function SearchResults({ q, onOpen }: { q: string; onOpen: (path: string) => void }) {
  const debounced = useDebounced(q.trim(), 250);
  const searchable = isSearchable(debounced);
  const search = useGlobalSearch(debounced, { enabled: searchable });

  if (!q.trim()) return <Status>Search by OM, OE, TK or travel id, device id, chassis, asset or reg. no.</Status>;
  if (!isSearchable(q)) return <Status>Type at least {SEARCH_MIN_CHARS} characters</Status>;
  if (debounced !== q.trim() || search.isPending) {
    return (
      <Status>
        <Loader2 className="size-4 animate-spin" /> Searching…
      </Status>
    );
  }
  if (search.isError) {
    return (
      <Status>
        Could not search.
        <Button variant="outline" size="sm" onClick={() => void search.refetch()}>
          Try again
        </Button>
      </Status>
    );
  }
  const { hits, truncated } = search.data;
  if (!hits.length) return <Status>No matches for “{debounced}”</Status>;

  const tasks = hits.filter((h) => h.kind === 'TASK');
  const travel = hits.filter((h) => h.kind === 'TRAVEL');
  return (
    <>
      {tasks.length > 0 && (
        <CommandGroup heading="Tasks">
          {tasks.map((hit) => (
            <div key={hit.taskId} data-testid="search-task">
              <CommandItem value={`task-${hit.taskId}`} onSelect={() => onOpen(hitPath(hit))}>
                <TaskHitContent hit={hit} q={debounced} />
              </CommandItem>
              {hit.fitments.map((f) => (
                <CommandItem
                  key={f.fitmentId}
                  value={`fitment-${f.fitmentId}`}
                  onSelect={() => onOpen(hitPath(hit, f.fitmentId))}
                  className="ml-4 border-l pl-3"
                  data-testid="search-fitment"
                >
                  <FitmentHitContent fitment={f} q={debounced} />
                </CommandItem>
              ))}
            </div>
          ))}
        </CommandGroup>
      )}
      {travel.length > 0 && (
        <CommandGroup heading="Travel tasks">
          {travel.map((hit) => (
            <CommandItem key={hit.travelTaskId} value={`travel-${hit.travelTaskId}`} onSelect={() => onOpen(hitPath(hit))} data-testid="search-travel">
              <TravelHitContent hit={hit} q={debounced} />
            </CommandItem>
          ))}
        </CommandGroup>
      )}
      {truncated && (
        <CommandGroup>
          <CommandItem value="show-all" onSelect={() => onOpen(`/search?q=${encodeURIComponent(debounced)}`)}>
            <ArrowRight /> Show all results
          </CommandItem>
        </CommandGroup>
      )}
    </>
  );
}

/**
 * The top-bar global search (F14), for task viewers: an input-looking button (a search icon on phones) and
 * Ctrl/⌘ K open a command dialog, full screen on phones, that searches ids across tasks, fitments and travel.
 */
export function GlobalSearch() {
  const user = useCurrentUser();
  const allowed = canViewTasks(user);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allowed]);

  if (!allowed) return null;

  const openPath = (path: string) => {
    setOpen(false);
    setQ('');
    navigate(path);
  };

  return (
    <>
      <Button
        variant="outline"
        className="hidden h-9 w-64 justify-start gap-2 px-3 font-normal text-muted-foreground md:flex"
        onClick={() => setOpen(true)}
      >
        <Search />
        <span className="flex-1 text-left">Search ids…</span>
        <kbd className="rounded border bg-muted px-1.5 font-mono text-[10px] font-medium" aria-hidden="true">
          {isMac ? '⌘K' : 'Ctrl K'}
        </kbd>
      </Button>
      <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search" onClick={() => setOpen(true)}>
        <Search />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            'gap-0 overflow-hidden p-0 sm:max-w-xl',
            // Phones: full screen.
            'max-md:inset-0 max-md:h-svh max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none max-md:border-0',
          )}
        >
          <DialogTitle className="sr-only">Search</DialogTitle>
          <DialogDescription className="sr-only">Search tasks, fitments and travel tasks by id</DialogDescription>
          <Command shouldFilter={false} label="Search ids" className="h-full [&_[data-slot=command-input-wrapper]]:h-12 [&_[data-slot=command-input-wrapper]]:pr-10">
            <CommandInput value={q} onValueChange={setQ} placeholder="Search ids…" />
            <CommandList className="max-h-[min(28rem,70vh)] max-md:max-h-none max-md:flex-1">
              <SearchResults q={q} onOpen={openPath} />
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
