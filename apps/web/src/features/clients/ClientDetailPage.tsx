import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, MapPin, Pencil, Plus } from 'lucide-react';
import type { ClientDto, ClientSiteDto } from '@champ/shared';
import { SitesMap } from '@/components/map/SitesMap';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { useCurrentUser } from '@/lib/auth';
import { canEditClients } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { ActiveBadge } from './ActiveBadge';
import { useClient, useUpdateClient, useUpdateSite } from './queries';

type ToggleTarget = { kind: 'client'; client: ClientDto } | { kind: 'site'; site: ClientSiteDto };

/** `/clients/:id`: client info, a map of all its sites and the site list. */
export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { data: client, isPending, isError } = useClient(id);

  if (isPending) {
    return (
      <div className="grid grid-cols-1 gap-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (isError) return <p className="py-8 text-center text-sm text-destructive">Could not load the client.</p>;
  return <ClientDetail client={client} />;
}

const coords = (s: ClientSiteDto) => `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`;

function ClientDetail({ client }: { client: ClientDto }) {
  const actor = useCurrentUser();
  const editable = canEditClients(actor);
  const [toggleTarget, setToggleTarget] = useState<ToggleTarget | null>(null);
  const updateClient = useUpdateClient(client.id);
  const updateSite = useUpdateSite(client.id);
  const mapSites = useMemo(() => client.sites, [client.sites]);

  const onError = (err: unknown) => toast.error(err instanceof ApiError ? err.message : 'Could not update');
  const confirmToggle = () => {
    if (!toggleTarget) return;
    if (toggleTarget.kind === 'client') {
      const active = !toggleTarget.client.active;
      updateClient.mutate(
        { active },
        {
          onSuccess: (c) => toast.success(`${c.name} ${active ? 'activated' : 'deactivated'}`),
          onError,
          onSettled: () => setToggleTarget(null),
        },
      );
    } else {
      const active = !toggleTarget.site.active;
      updateSite.mutate(
        { siteId: toggleTarget.site.id, body: { active } },
        {
          onSuccess: (s) => toast.success(`${s.name} ${active ? 'activated' : 'deactivated'}`),
          onError,
          onSettled: () => setToggleTarget(null),
        },
      );
    }
  };
  const pending = updateClient.isPending || updateSite.isPending;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button asChild variant="ghost" size="icon-sm" aria-label="Back to clients">
            <Link to="/clients">
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{client.name}</h1>
          {client.code && <span className="font-mono text-sm text-muted-foreground">{client.code}</span>}
          <span data-testid="client-status">
            <ActiveBadge active={client.active} />
          </span>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setToggleTarget({ kind: 'client', client })}>
              {client.active ? 'Deactivate client' : 'Activate client'}
            </Button>
            <Button asChild>
              <Link to={`/clients/${client.id}/edit`}>
                <Pencil /> Edit client
              </Link>
            </Button>
          </div>
        )}
      </div>

      <Card className="gap-4 py-4">
        <CardContent className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Primary contact">
            {client.contactName}
            <div className="text-muted-foreground">{client.contactPhone}</div>
            {client.contactEmail && <div className="break-all text-muted-foreground">{client.contactEmail}</div>}
          </Info>
          <Info label="Billing email">{client.billingEmail ?? '—'}</Info>
          <Info label="Added by">{client.createdBy.name}</Info>
          {client.notes && (
            <Info label="Notes" className="sm:col-span-2 lg:col-span-3">
              <span className="whitespace-pre-wrap">{client.notes}</span>
            </Info>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <SitesMap sites={mapSites} className="h-72 lg:h-[28rem]" />
        <Card className="gap-3 py-4">
          <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
            <CardTitle>
              Sites ({client.activeSiteCount}/{client.siteCount} active)
            </CardTitle>
            {editable && (
              <Button asChild size="sm" variant="outline">
                <Link to={`/clients/${client.id}/edit?add=site`}>
                  <Plus /> Add site
                </Link>
              </Button>
            )}
          </CardHeader>
          <CardContent className="px-4">
            <ul className="grid grid-cols-1 gap-2">
              {client.sites.map((site) => (
                <li
                  key={site.id}
                  data-testid="site-item"
                  data-active={site.active}
                  className={cn('rounded-md border p-3', !site.active && 'text-muted-foreground opacity-60')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <MapPin className={cn('size-4', site.active ? 'text-blue-600' : 'text-neutral-400')} />
                        <span className="break-words">{site.name}</span>
                        {!site.active && <ActiveBadge active={false} />}
                      </div>
                      <div className="mt-1 text-sm break-words">{site.address}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {site.location.city}, {site.location.state}
                        {!site.location.active && ' (inactive city)'} · <span className="font-mono">{coords(site)}</span>
                      </div>
                      {(site.contactName || site.contactPhone) && (
                        <div className="mt-1 text-xs text-muted-foreground">
                          Contact: {[site.contactName, site.contactPhone].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    {editable && (
                      <div className="flex shrink-0 items-center gap-2">
                        <Switch
                          checked={site.active}
                          onCheckedChange={() => setToggleTarget({ kind: 'site', site })}
                          aria-label={`${site.active ? 'Deactivate' : 'Activate'} ${site.name}`}
                        />
                        <Button asChild variant="ghost" size="icon-sm" aria-label={`Edit ${site.name}`}>
                          <Link to={`/clients/${client.id}/edit?site=${site.id}`}>
                            <Pencil />
                          </Link>
                        </Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {editable && (
        <AlertDialog open={!!toggleTarget} onOpenChange={(o) => !o && setToggleTarget(null)}>
          <AlertDialogContent>
            {toggleTarget && <ToggleConfirm target={toggleTarget} pending={pending} onConfirm={confirmToggle} />}
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function ToggleConfirm({ target, pending, onConfirm }: { target: ToggleTarget; pending: boolean; onConfirm: () => void }) {
  const active = target.kind === 'client' ? target.client.active : target.site.active;
  const name = target.kind === 'client' ? target.client.name : target.site.name;
  const verb = active ? 'Deactivate' : 'Activate';
  const description =
    target.kind === 'client'
      ? active
        ? 'The client will no longer be offered in task forms. Its sites and history are kept.'
        : 'The client will be offered in task forms again.'
      : active
        ? 'The site will no longer be offered in task forms. A client needs at least one active site.'
        : 'The site will be offered in task forms again.';
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {verb} {name}?
        </AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction
          onClick={(e) => {
            e.preventDefault();
            onConfirm();
          }}
          disabled={pending}
        >
          {verb}
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

function Info({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="mt-0.5 break-words">{children}</div>
    </div>
  );
}
