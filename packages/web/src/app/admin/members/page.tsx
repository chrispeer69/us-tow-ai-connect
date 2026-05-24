'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/utils';

type Role = 'OWNER' | 'DISPATCHER' | 'DRIVER' | 'ACCOUNTING' | 'VIEWER';
type Status = 'ACTIVE' | 'INVITED' | 'SUSPENDED';

interface Member {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  status: Status;
  invitedAt: string;
  lastActiveAt: string | null;
}

const ROLES: Role[] = ['OWNER', 'DISPATCHER', 'DRIVER', 'ACCOUNTING', 'VIEWER'];

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>('VIEWER');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchMembers();
  }, []);

  async function fetchMembers() {
    setLoading(true);
    try {
      const data = await api<Member[]>('/v1/admin/members');
      setMembers(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function invite() {
    if (!newEmail.trim()) {
      setError('Email is required');
      return;
    }
    setInviting(true);
    setError(null);
    try {
      await api('/v1/admin/members', {
        method: 'POST',
        json: {
          email: newEmail.trim(),
          name: newName.trim() || undefined,
          role: newRole,
        },
      });
      setNewEmail('');
      setNewName('');
      setNewRole('VIEWER');
      await fetchMembers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  async function changeRole(id: string, role: Role) {
    setError(null);
    try {
      await api(`/v1/admin/members/${id}`, { method: 'PATCH', json: { role } });
      await fetchMembers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function remove(id: string) {
    setError(null);
    try {
      await api(`/v1/admin/members/${id}`, { method: 'DELETE' });
      await fetchMembers();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <header>
        <h1 className="text-3xl font-bold">Team Members</h1>
        <p className="text-zinc-400 mt-1">
          Invite people to your account and manage their access roles.
        </p>
      </header>

      {error && <p className="text-sm text-red-400 break-words">{error}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Invite a New Member</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Input
              type="email"
              placeholder="email@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
            <Input
              placeholder="Name (optional)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={invite} disabled={inviting || !newEmail.trim()}>
            {inviting ? <Spinner className="mr-2" /> : null}
            Send Invitation
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current Members</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-zinc-400">
              <Spinner /> Loading members...
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-zinc-400">
              No team members yet. Invite someone above to get started.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {members.map((m) => (
                <li
                  key={m.id}
                  className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {m.name || m.email}
                    </div>
                    <div className="text-sm text-zinc-400 font-mono truncate">
                      {m.email}
                    </div>
                    <div className="text-xs text-zinc-500 mt-1">
                      Invited {new Date(m.invitedAt).toLocaleDateString()}
                      {m.lastActiveAt
                        ? ` · Last active ${new Date(m.lastActiveAt).toLocaleDateString()}`
                        : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={m.status} />
                    <Select
                      value={m.role}
                      onValueChange={(v) => changeRole(m.id, v as Role)}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r}>
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => remove(m.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === 'ACTIVE') return <Badge variant="success">● Active</Badge>;
  if (status === 'INVITED') return <Badge variant="outline">● Invited</Badge>;
  return <Badge variant="destructive">● Suspended</Badge>;
}
