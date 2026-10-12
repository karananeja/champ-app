import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogOut, Menu, UserRound, WifiOff } from 'lucide-react';
import { ROLE_LABELS } from '@champ/shared';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useOnline } from '@/hooks/use-online';
import { useAuth, useCurrentUser } from '@/lib/auth';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ErrorBoundary } from '@/features/errors/error-pages';
import { NotificationBell } from '@/features/notifications/notification-bell';
import { GlobalSearch } from '@/features/search/global-search';
import { navGroupsFor } from './nav';

function Brand() {
  return (
    <div className="flex items-center gap-2 font-semibold">
      <img src="/favicon.svg" alt="" className="size-6" />
      Champ
    </div>
  );
}

/** The menu (CR-03): groups split by dividers, the active item marked with a brand accent bar and colour. */
function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser();
  return (
    <nav className="grid grid-cols-1" aria-label="Main">
      {navGroupsFor(user).map((group, index) => (
        <div key={group.label ?? index} className={cn('grid grid-cols-1 gap-1', index > 0 && 'mt-3 border-t border-sidebar-border pt-3')}>
          {group.label && (
            <div className="px-3 pb-1 text-xs font-medium tracking-wide text-sidebar-foreground/60 uppercase">
              {group.label}
            </div>
          )}
          {group.items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end ?? to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                  isActive &&
                    'bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-1 before:rounded-full before:bg-sidebar-primary [&>svg]:text-sidebar-primary',
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Shown while the browser is offline (CR-03 network state). */
function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100" data-testid="offline-banner">
      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
      You're offline. Changes won't be saved until the connection is back.
    </div>
  );
}

function UserMenu() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto gap-2 px-2 py-1.5" aria-label="User menu">
          <Avatar className="size-8">
            <AvatarFallback className="bg-brand-soft text-brand-soft-foreground">{initials(user.name)}</AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate text-sm sm:inline">{user.name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="truncate">{user.name}</div>
          <div className="truncate text-xs font-normal text-muted-foreground">{ROLE_LABELS[user.role]}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/profile')}>
          <UserRound /> Profile
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
        >
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  return (
    <div className="min-h-svh md:grid md:grid-cols-[15rem_1fr]">
      {/* Sidebar (md and up) */}
      <aside className="hidden border-r bg-sidebar md:sticky md:top-0 md:flex md:h-svh md:flex-col md:gap-6 md:self-start md:overflow-y-auto md:p-4">
        <div className="px-3 pt-1">
          <Brand />
        </div>
        <NavLinks />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          {/* Hamburger + sheet (below md) */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 overflow-y-auto bg-sidebar p-4">
              <SheetHeader className="p-0 px-3">
                <SheetTitle>
                  <Brand />
                </SheetTitle>
                <SheetDescription className="sr-only">Main menu</SheetDescription>
              </SheetHeader>
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <div className="md:hidden">
            <Brand />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <GlobalSearch />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <OfflineBanner />
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
