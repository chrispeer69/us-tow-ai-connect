'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/utils';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

interface SupportTicketMessage {
  id: string;
  senderType: string;
  senderEmail: string;
  message: string;
  createdAt: string;
}

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  messages: SupportTicketMessage[];
}

export default function TenantTicketPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyMessage, setReplyMessage] = useState('');
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState('');

  const loadTicket = async () => {
    try {
      const res = await api<{ data: SupportTicket }>(`/v1/admin/support/${id}`);
      setTicket(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load ticket');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTicket();
  }, [id]);

  const handleReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyMessage.trim() || !ticket) return;

    setReplying(true);
    setError('');
    try {
      await api(`/v1/admin/support/${ticket.id}/reply`, {
        method: 'POST',
        json: { message: replyMessage },
      });
      setReplyMessage('');
      await loadTicket();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setReplying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-12">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <h2 className="text-xl font-bold">Ticket Not Found</h2>
        <Button onClick={() => router.push('/admin/support')} variant="outline">Back to Support</Button>
      </div>
    );
  }

  // Determine if tenant can reply
  // 1. If closed, no replies allowed if 3 days have passed (backend handles the 3 days logic, but UI can just show it)
  // 2. Prevent consecutive replies to avoid spam (if last message is from tenant, or no messages yet)
  const isClosed = ticket.status === 'closed';
  const isResolved = ticket.status === 'resolved';
  const lastMessage = ticket.messages[ticket.messages.length - 1];
  const lastSenderWasTenant = lastMessage?.senderType === 'tenant';
  const hasNoMessages = ticket.messages.length === 0;

  const canReply = !hasNoMessages && !lastSenderWasTenant;

  return (
    <div className="max-w-4xl mx-auto flex flex-col h-[calc(100vh-6rem)]">
      <div className="flex items-center gap-4 mb-6 shrink-0">
        <Button variant="ghost" className="p-2" onClick={() => router.push('/admin/support')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{ticket.subject}</h1>
            <Badge variant={ticket.status === 'open' ? 'outline' : ticket.status === 'in_progress' ? 'warning' : 'default'} className="capitalize">
              {ticket.status.replace('_', ' ')}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Opened on {new Date(ticket.createdAt).toLocaleString()}
          </p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <ScrollArea className="flex-1 p-6">
          <div className="space-y-6">
            {/* Original Ticket */}
            <div className="flex gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary shrink-0">
                Me
              </div>
              <div className="flex-1 bg-muted/50 rounded-xl p-5 text-sm">
                <div className="font-semibold mb-2">Original Request</div>
                <div className="whitespace-pre-wrap">{ticket.description}</div>
              </div>
            </div>

            {/* Thread */}
            {ticket.messages.map((msg) => {
              const isTenant = msg.senderType === 'tenant';
              return (
                <div key={msg.id} className={`flex gap-4 ${isTenant ? '' : 'flex-row-reverse'}`}>
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold shrink-0 ${isTenant ? 'bg-primary/10 text-primary' : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'}`}>
                    {isTenant ? 'Me' : 'Support'}
                  </div>
                  <div className={`flex-1 rounded-xl p-5 text-sm ${isTenant ? 'bg-muted/50' : 'bg-blue-50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30'}`}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="font-semibold text-xs text-muted-foreground">
                        {isTenant ? 'Me' : 'Support Team'}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(msg.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="whitespace-pre-wrap">{msg.message}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <div className="p-6 border-t bg-muted/10">
          {(isClosed || isResolved) && (
            <div className="text-sm text-muted-foreground text-center mb-4 p-3 bg-muted rounded-md">
              This ticket is marked as {ticket.status}. You can reply to reopen it within 3 days of the last update.
            </div>
          )}

          {!canReply && ticket.status !== 'closed' && ticket.status !== 'resolved' ? (
            <div className="text-center p-6 bg-muted/30 rounded-xl border border-dashed text-muted-foreground">
              <p>Support will get back to solve your issue and ask questions to get more details if needed.</p>
            </div>
          ) : (
            <form onSubmit={handleReply} className="space-y-4">
              {error && <div className="text-sm text-red-500">{error}</div>}
              <Textarea
                className="w-full resize-none bg-background h-24"
                placeholder="Type your reply here..."
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                disabled={replying}
                required
              />
              <div className="flex justify-end">
                <Button type="submit" disabled={replying || !replyMessage.trim()}>
                  {replying ? <Spinner className="mr-2 h-4 w-4" /> : null}
                  Send Reply
                </Button>
              </div>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
