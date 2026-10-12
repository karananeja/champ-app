import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Primary action(s), on the right from sm up and stacked under the title on phones. */
  actions?: ReactNode;
  /** Shown before the icon, e.g. a back button. */
  leading?: ReactNode;
  className?: string;
}

/** Page title, short description, icon and primary actions (CR-03 polish). */
export function PageHeader({ title, description, icon: Icon, actions, leading, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {leading}
        {Icon && (
          <div className="hidden size-10 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-foreground sm:flex">
            <Icon className="size-5" aria-hidden="true" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight break-words">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">{actions}</div>}
    </div>
  );
}
