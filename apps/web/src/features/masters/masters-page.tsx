import { Link } from 'react-router-dom';
import { ChevronRight, Database } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MASTERS } from './config';
import { useLookups } from './queries';

/** `/masters`: a card per master with its active item count. */
export function MastersPage() {
  const lookups = useLookups();
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader icon={Database} title="Masters" description="The lists behind every dropdown in Champ." />
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {MASTERS.map((master) => (
          <li key={master.slug}>
            <Link
              to={`/masters/${master.slug}`}
              className="block h-full rounded-xl focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <Card className="h-full gap-0 py-4 transition-colors hover:border-primary/40 hover:bg-brand-soft/40">
                <CardHeader className="px-4">
                  <CardTitle className="flex items-center justify-between gap-2">
                    {master.title}
                    <ChevronRight className="size-4 text-muted-foreground" />
                  </CardTitle>
                  <CardDescription>
                    {lookups.data ? (
                      <span data-testid="master-count">{master.count(lookups.data)} active</span>
                    ) : (
                      <Skeleton className="h-4 w-16" />
                    )}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
