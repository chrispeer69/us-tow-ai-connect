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

const MIN_PASSWORD = 8;

export default function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [me, setMe] = useState<{ id: string; role: Role } | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Role>('VIEWER');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // id of the member whose password row is open, plus the value being typed
  const [pwTarget, setPwTarget] = useState<string | null>(null);
  const [pwValue, setPwValue] = useState('');
  const [pwSaving, setPwSaving] = useState(false);

  const isOwner = me?.role === 'OWNER';

  useEffect(() => {
    void fetchMembers();
  }, []);

  async function fetchMembers() {
    setLoading(true);
    try {
      const [data, meData] = await Promise.all([
        api<Member[]>('/v1/admin/members'),
        api<{ member: { id: string; role: Role } }>('/v1/admin/members/me')
      ]);
      setMembers(data);
      setMe(meData.member);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function invite() {
    const email = newEmail.trim();
    const password = newPassword.trim();
    if (!email) {
      setError('Email is required');
      return;
    }
    if (password && password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    setInviting(true);
    setError(null);
    setNotice(null);
    try {
      await api('/v1/admin/members', {
        method: 'POST',
        json: {
          email,
          name: newName.trim() || undefined,
          role: newRole,
          password: password || undefined,
        },
      });
      setNotice(
        password
          ? `${email} can sign in now with the password you set.`
          : `Invitation sent to ${email}.`,
      );
      setNewEmail('');
      setNewName('');
      setNewRole('VIEWER');
      setNewPassword('');
      await fetchMembers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setInviting(false);
    }
  }

  function openPasswordFor(id: string) {
    setError(null);
    setNotice(null);
    setPwTarget(id);
    setPwValue('');
  }

  function closePassword() {
    setPwTarget(null);
    setPwValue('');
  }

  async function savePassword(member: Member) {
    const password = pwValue.trim();
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters`);
      return;
    }
    setPwSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/v1/admin/members/${member.id}/password`, {
        method: 'POST',
        json: { password },
      });
      setNotice(`Password updated for ${member.email}.`);
      closePassword();
      await fetchMembers();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPwSaving(false);
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
          Add people to your account, manage their access roles, and set or reset
          their sign-in passwords.
        </p>
      </header>

      {error && <p className="text-sm text-red-400 break-words">{error}</p>}
      {notice && <p className="text-sm text-emerald-400 break-words">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle>Add a New Member</CardTitle>
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
          {isOwner && (
            <div className="space-y-1">
              <Input
                type="text"
                autoComplete="off"
                placeholder={`Password (optional, min ${MIN_PASSWORD} characters)`}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="md:max-w-sm"
              />
              <p className="text-xs text-zinc-500">
                Set a password to activate the account immediately and give it to
                them yourself. Leave it blank to email an invitation instead.
              </p>
            </div>
          )}
          <Button onClick={invite} disabled={inviting || !newEmail.trim()}>
            {inviting ? <Spinner className="mr-2" /> : null}
            {newPassword.trim() ? 'Create Member' : 'Send Invitation'}
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
                <li key={m.id} className="py-3">
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
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
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={m.status} />

                      {isOwner && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            pwTarget === m.id ? closePassword() : openPasswordFor(m.id)
                          }
                        >
                          {pwTarget === m.id ? 'Cancel' : 'Set Password'}
                        </Button>
                      )}

                      {isOwner && m.id !== me?.id && (
                        <>
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
                        </>
                      )}
                    </div>
                  </div>

                  {isOwner && pwTarget === m.id && (
                    <div className="mt-3 rounded-md border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          type="text"
                          autoComplete="off"
                          autoFocus
                          placeholder={`New password (min ${MIN_PASSWORD} characters)`}
                          value={pwValue}
                          onChange={(e) => setPwValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void savePassword(m);
                            if (e.key === 'Escape') closePassword();
                          }}
                          className="sm:max-w-sm"
                        />
                        <Button
                          size="sm"
                          onClick={() => void savePassword(m)}
                          disabled={pwSaving || pwValue.trim().length < MIN_PASSWORD}
                        >
                          {pwSaving ? <Spinner className="mr-2" /> : null}
                          Save Password
                        </Button>
                      </div>
                      <p className="text-xs text-zinc-500">
                        Takes effect immediately for {m.email}. Any pending
                        invitation link for them stops working. Write it down —
                        it can&apos;t be read back later.
                      </p>
                    </div>
                  )}
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
