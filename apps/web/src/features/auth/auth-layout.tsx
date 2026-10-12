import type { ReactNode } from 'react';
import { Illustration, type IllustrationName } from '@/components/illustration';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function Brand() {
  return (
    <div className="flex items-center gap-2 text-lg font-semibold">
      <img src="/favicon.svg" alt="" className="size-7" />
      Champ
    </div>
  );
}

interface AuthLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** The decorative illustration (CR-03): beside the form on desktop, above it on phones. */
  illustration?: IllustrationName;
  /** Short line under the desktop illustration. */
  tagline?: string;
}

/**
 * Sign-in and invite pages (CR-03): split screen on desktop (illustration panel left, form right) and a stacked
 * layout on phones (smaller illustration above the form).
 */
export function AuthLayout({
  title,
  description,
  children,
  illustration = 'login',
  tagline = 'Device fitments, from request to final approval, in one place.',
}: AuthLayoutProps) {
  return (
    <main className="grid min-h-svh lg:grid-cols-2">
      <aside className="hidden flex-col justify-between gap-10 bg-brand-soft p-10 text-brand-soft-foreground lg:flex" data-testid="auth-aside">
        <Brand />
        <div className="flex flex-1 items-center justify-center">
          <Illustration name={illustration} className="max-w-md" />
        </div>
        <p className="max-w-md text-lg font-medium">{tagline}</p>
      </aside>
      <div className="flex items-center justify-center bg-muted/40 px-4 py-10 lg:bg-background">
        <div className="w-full max-w-sm">
          <div className="mb-4 flex justify-center lg:hidden">
            <Brand />
          </div>
          <div className="mb-6 flex justify-center lg:hidden">
            <Illustration name={illustration} className="max-w-40" />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{title}</CardTitle>
              {description && <CardDescription>{description}</CardDescription>}
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
