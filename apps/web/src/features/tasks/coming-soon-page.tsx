import type { LucideIcon } from 'lucide-react';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

/** Placeholder for task views that arrive in later features (Travel, F08). */
export function ComingSoonPage({ title, description, icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title={title} description={description} icon={icon} />
      <EmptyState
        className="rounded-xl border border-dashed"
        illustration="travel"
        title="Coming in a later release"
        description="This list fills in once the task workflow that feeds it is built. Nothing to do here yet."
      />
    </div>
  );
}
