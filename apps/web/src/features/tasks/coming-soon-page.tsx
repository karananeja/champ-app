import type { LucideIcon } from 'lucide-react';

/** Placeholder for task views that arrive in later features (Travel F08, Faulty and Re-opened F05). */
export function ComingSoonPage({ title, description, icon: Icon }: { title: string; description: string; icon: LucideIcon }) {
  return (
    <div className="grid grid-cols-1 gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
        <div className="flex size-14 items-center justify-center rounded-full bg-muted">
          <Icon className="size-7 text-muted-foreground" aria-hidden />
        </div>
        <p className="font-medium">Coming in a later release</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          This list fills in once the task workflow that feeds it is built. Nothing to do here yet.
        </p>
      </div>
    </div>
  );
}
