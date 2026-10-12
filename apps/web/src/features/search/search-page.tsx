import { Link, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { SEARCH_MIN_CHARS } from '@champ/shared';
import { EmptyState } from '@/components/empty-state';
import { ListStates } from '@/components/list-states';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { useGlobalSearch } from './queries';
import { hitPath, isSearchable } from './search-format';
import { FitmentHitContent, TaskHitContent, TravelHitContent } from './search-hits';

const PAGE_LIMIT = 100;
const linkClass = 'flex min-w-0 gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none';

/** All results of a search (F14 "Show all results"): up to 100, grouped like the dialog, cards that fit phones. */
export function SearchPage() {
  const [searchParams] = useSearchParams();
  const q = (searchParams.get('q') ?? '').trim();
  const searchable = isSearchable(q);
  const search = useGlobalSearch(q, { limit: PAGE_LIMIT, enabled: searchable });
  const hits = search.data?.hits ?? [];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        title="Search results"
        icon={Search}
        description={
          search.data
            ? `${search.data.total} match${search.data.total === 1 ? '' : 'es'} for “${q}”${search.data.truncated ? `, showing the first ${PAGE_LIMIT}` : ''}`
            : q && `Results for “${q}”`
        }
      />
      {!searchable ? (
        <EmptyState size="sm" illustration="no-results" title="Nothing to search" description={`Type at least ${SEARCH_MIN_CHARS} characters, or an id.`} />
      ) : (
        <ListStates
          isPending={search.isPending}
          isError={search.isError}
          error={search.error}
          onRetry={() => void search.refetch()}
          isEmpty={hits.length === 0}
          filtered
          noMatches={{ title: `No matches for “${q}”`, description: 'Check the id, or try fewer characters.', action: null }}
          empty={{ title: 'No matches' }}
        >
          <ul className="grid grid-cols-1 gap-3" data-testid="search-results">
            {hits.map((hit) =>
              hit.kind === 'TASK' ? (
                <li key={hit.taskId}>
                  <Card className="gap-1 p-2" data-testid="search-task">
                    <Link to={hitPath(hit)} className={linkClass}>
                      <TaskHitContent hit={hit} q={q} />
                    </Link>
                    {hit.fitments.map((f) => (
                      <Link key={f.fitmentId} to={hitPath(hit, f.fitmentId)} className={`${linkClass} ml-4 border-l pl-3`} data-testid="search-fitment">
                        <FitmentHitContent fitment={f} q={q} />
                      </Link>
                    ))}
                  </Card>
                </li>
              ) : (
                <li key={hit.travelTaskId}>
                  <Card className="p-2" data-testid="search-travel">
                    <Link to={hitPath(hit)} className={linkClass}>
                      <TravelHitContent hit={hit} q={q} />
                    </Link>
                  </Card>
                </li>
              ),
            )}
          </ul>
        </ListStates>
      )}
    </div>
  );
}
