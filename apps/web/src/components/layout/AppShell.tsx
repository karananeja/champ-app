import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, Menu, UserRound } from 'lucide-react';
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
import { useAuth, useCurrentUser } from '@/lib/auth';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import { navGroupsFor } from './nav';

function Brand() {
  return (
    <div className="flex items-center gap-2 font-semibold">
      <img src="/favicon.svg" alt="" className="size-6" />
      Champ
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const user = useCurrentUser();
  return (
    <nav className="grid grid-cols-1 gap-4" aria-label="Main">
      {navGroupsFor(user).map((group, index) => (
        <div key={group.label ?? index} className="grid grid-cols-1 gap-1">
          {group.label && (
            <div className="px-3 pb-1 text-xs font-medium tracking-wide text-sidebar-foreground/60 uppercase">
              {group.label}
            </div>
          )}
          {group.items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  isActive && 'bg-sidebar-accent text-sidebar-accent-foreground',
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

function UserMenu() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto gap-2 px-2 py-1.5" aria-label="User menu">
          <Avatar className="size-8">
            <AvatarFallback>{initials(user.name)}</AvatarFallback>
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
  return (
    <div className="min-h-svh md:grid md:grid-cols-[15rem_1fr]">
      {/* Sidebar (md and up) */}
      <aside className="hidden border-r bg-sidebar md:flex md:flex-col md:gap-6 md:p-4">
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
            <SheetContent side="left" className="w-64 bg-sidebar p-4">
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
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
