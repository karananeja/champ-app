import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrentUser } from '@/lib/auth';
import { canInviteAny } from '@/lib/permissions';
import { InviteDialog } from '../invites/invite-dialog';
import { InvitesList } from '../invites/invites-list';
import { UsersList } from './users-list';

export function UsersPage() {
  const actor = useCurrentUser();
  const [inviteOpen, setInviteOpen] = useState(false);
  const inviter = canInviteAny(actor);

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            {actor.role === 'OE' ? 'You and your team.' : 'Everyone with access to Champ.'}
          </p>
        </div>
        {inviter && (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus /> Invite user
          </Button>
        )}
      </div>

      {inviter ? (
        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="invites">Invites</TabsTrigger>
          </TabsList>
          <TabsContent value="users" className="mt-4">
            <UsersList actor={actor} />
          </TabsContent>
          <TabsContent value="invites" className="mt-4">
            <InvitesList actor={actor} />
          </TabsContent>
        </Tabs>
      ) : (
        <UsersList actor={actor} />
      )}

      {inviter && <InviteDialog actor={actor} open={inviteOpen} onOpenChange={setInviteOpen} />}
    </div>
  );
}
