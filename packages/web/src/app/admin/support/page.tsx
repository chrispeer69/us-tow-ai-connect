'use client';

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: string;
  createdAt: string;
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);



  const loadTickets = async () => {
    try {
      const res = await api<{ data: SupportTicket[] }>('/v1/admin/support');
      setTickets(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTickets();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;

    setSubmitting(true);
    setMessage(null);
    try {
      await api('/v1/admin/support', {
        method: 'POST',
        json: { subject, description },
      });
      setMessage({ type: 'success', text: 'Your ticket has been submitted.' });
      setSubject('');
      setDescription('');
      await loadTickets();
    } catch (err) {
      setMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };



  return (
    <div className="space-y-6 max-w-4xl mx-auto py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">Support Tickets</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Report bugs or request support directly from our technical team.
        </p>
      </div>

      <div className="space-y-6">
          <Card className="bg-zinc-950 border-zinc-800">
            <CardHeader>
              <CardTitle>Submit a New Ticket</CardTitle>
            </CardHeader>
            <CardContent>
              {message && (
                <div className={`mb-4 p-3 rounded text-sm ${message.type === 'success' ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-800' : 'bg-rose-900/30 text-rose-400 border border-rose-800'}`}>
                  {message.text}
                </div>
              )}
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-1">Subject</label>
                  <Input
                    placeholder="Brief summary of the issue"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Description</label>
                  <Textarea
                    placeholder="Please describe the issue in detail..."
                    className="h-32"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" disabled={submitting}>
                  {submitting ? <Spinner className="mr-2 h-4 w-4" /> : null}
                  Submit Ticket
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card className="bg-zinc-950 border-zinc-800">
            <CardHeader>
              <CardTitle>Your Tickets</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="py-8 text-center"><Spinner className="mx-auto" /></div>
              ) : tickets.length === 0 ? (
                <div className="py-8 text-center text-zinc-500">No tickets found.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="border-zinc-800">
                      <TableHead className="text-zinc-400">Subject</TableHead>
                      <TableHead className="text-zinc-400">Status</TableHead>
                      <TableHead className="text-zinc-400 text-right">Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tickets.map((t) => (
                      <TableRow key={t.id} className="border-zinc-800 hover:bg-zinc-900">
                        <TableCell className="font-medium">{t.subject}</TableCell>
                        <TableCell>
                          <Badge variant={t.status === 'open' ? 'outline' : 'default'} className="capitalize">
                            {t.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-zinc-400 text-sm">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
      </div>
    </div>
  );
}
