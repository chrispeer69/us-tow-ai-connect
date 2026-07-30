'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Plus } from 'lucide-react';

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export default function SupportPage() {
  const router = useRouter();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [formMessage, setFormMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

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

  const openTicketsCount = tickets.filter(t => t.status === 'open' || t.status === 'in_progress').length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;

    setSubmitting(true);
    setFormMessage(null);
    try {
      const res = await api<{ data: SupportTicket }>('/v1/admin/support', {
        method: 'POST',
        json: { subject, description },
      });
      setFormMessage({ type: 'success', text: 'Your ticket has been submitted.' });
      setSubject('');
      setDescription('');
      await loadTickets();
      router.push(`/admin/support/${res.data.id}`);
    } catch (err) {
      setFormMessage({ type: 'error', text: (err as Error).message });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Support & Help</h1>
        <p className="text-muted-foreground">
          Submit a new ticket or view your past requests. You can have up to 3 open tickets at a time.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Open a New Ticket</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formMessage && (
              <div className={`p-3 rounded-md text-sm ${formMessage.type === 'error' ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>
                {formMessage.text}
              </div>
            )}
            {openTicketsCount >= 3 && (
               <div className="p-3 rounded-md text-sm bg-yellow-500/10 text-yellow-600 dark:text-yellow-500">
                  You have reached the maximum of 3 open tickets. Please wait for them to be resolved before opening a new one.
               </div>
            )}
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Subject</label>
              <Input
                placeholder="Brief summary of your issue"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                disabled={submitting || openTicketsCount >= 3}
                required
              />
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Textarea
                placeholder="Provide as much detail as possible..."
                className="h-32 resize-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={submitting || openTicketsCount >= 3}
                required
              />
            </div>

            <Button type="submit" disabled={submitting || openTicketsCount >= 3 || !subject.trim() || !description.trim()}>
              {submitting ? <Spinner className="mr-2 h-4 w-4" /> : <Plus className="mr-2 h-4 w-4" />}
              Submit Ticket
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4 pt-4">
        <h2 className="text-xl font-bold">Your Tickets</h2>
        {tickets.length === 0 ? (
          <div className="text-center py-12 bg-muted/20 rounded-lg border border-dashed">
            <MessageSquare className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-lg">No tickets yet</h3>
            <p className="text-muted-foreground">When you open a support ticket, it will appear here.</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {tickets.map(t => (
              <Card 
                key={t.id} 
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => router.push(`/admin/support/${t.id}`)}
              >
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="font-semibold truncate">{t.subject}</div>
                    <div className="text-sm text-muted-foreground truncate">{t.description}</div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge variant={t.status === 'open' ? 'outline' : t.status === 'in_progress' ? 'warning' : 'default'} className="capitalize">
                      {t.status.replace('_', ' ')}
                    </Badge>
                    <div className="text-xs text-muted-foreground">
                      {new Date(t.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
