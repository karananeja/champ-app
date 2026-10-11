import { Link, Navigate, useParams } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useCurrentUser } from '@/lib/auth';
import { masterBySlug } from './config';
import { MasterTable } from './master-table';

/** `/masters/:slug`: one master, rendered from its config. */
export function MasterPage() {
  const { slug } = useParams();
  const actor = useCurrentUser();
  const config = masterBySlug(slug);
  if (!config) return <Navigate to="/masters" replace />;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="grid gap-1">
        <Link to="/masters" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> Masters
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{config.title}</h1>
          {!config.canEdit(actor) && <Badge variant="secondary">View only</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">{config.description}</p>
      </div>
      {/* key: reset search and filters when switching masters */}
      <MasterTable key={config.slug} config={config} actor={actor} />
    </div>
  );
}
