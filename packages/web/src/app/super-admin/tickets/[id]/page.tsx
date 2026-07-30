'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft } from 'lucide-react';
import { api } from '@/lib/utils';
import { toast } from 'sonner';


export default function SuperAdminTicketPage() {
  const { id } = useParams() as { id: string };
  const router = useRouter();
  
  const [ticket, setTicket] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [resolutionMessage, setResolutionMessage] = useState('');
  const [replying, setReplying] = useState(false);

  const loadTicket = async () => {
    try {
      const res = await api(`/v1/super-admin/tickets/${id}`);
      setTicket(res);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load ticket');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTicket();
  }, [id]);

  const handleReply = async (status: string) => {
    if (!resolutionMessage.trim() || !ticket) return;
    setReplying(true);
    try {
      await api(`/v1/super-admin/tickets/${ticket.id}/reply`, {
        method: 'POST',
        json: { message: resolutionMessage },
      });
      if (status && status !== ticket.status) {
         await api(`/v1/super-admin/tickets/${ticket.id}/status`, {
            method: 'PATCH',
            json: { status }
         });
      }
      setResolutionMessage('');
      await loadTicket();
    } catch(e) {
      toast.error((e as Error).message);
    } finally {
      setReplying(false);
    }
  };

  const handleClose = async () => {
    setReplying(true);
    try {
      await api(`/v1/super-admin/tickets/${ticket.id}/status`, {
        method: 'PATCH',
        json: { status: 'closed', resolutionMessage }
      });
      setResolutionMessage('');
      await loadTicket();
    } catch(e) {
      toast.error((e as Error).message);
    } finally {
      setReplying(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-screen bg-black">
        <Spinner className="w-8 h-8 text-white" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-screen bg-black text-white">
        <h2 className="text-xl font-bold mb-4">Ticket Not Found</h2>
        <Button onClick={() => router.push('/super-admin')} variant="outline">Back to Dashboard</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6 md:p-12">
      <div className="max-w-4xl mx-auto space-y-6 flex flex-col h-[calc(100vh-6rem)]">
        <div className="flex items-center gap-4">
          <Button variant="ghost" className="p-2" onClick={() => router.push('/super-admin')}>
            <ArrowLeft className="w-5 h-5 text-zinc-400 hover:text-white" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">{ticket.subject}</h1>
              <Badge variant={ticket.status === 'open' ? 'outline' : ticket.status === 'in_progress' ? 'warning' : 'default'} className="capitalize">
                {ticket.status.replace('_', ' ')}
              </Badge>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              From <span className="font-semibold text-zinc-300">{ticket.companyName}</span> • Opened on {new Date(ticket.createdAt).toLocaleString()}
            </p>
          </div>
        </div>

        <Card className="flex-1 flex flex-col min-h-0 bg-zinc-950 border-zinc-800">
          <ScrollArea className="flex-1 p-6">
            <div className="space-y-6">
              {/* Original Ticket Description */}
              <div className="flex gap-4">
                <div className="h-10 w-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 font-bold shrink-0 shadow-sm border border-zinc-700">
                  T
                </div>
                <div className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-5 text-sm shadow-sm">
                  <div className="font-semibold text-zinc-300 mb-2">Original Ticket</div>
                  <div className="whitespace-pre-wrap leading-relaxed text-zinc-100">{ticket.description}</div>
                </div>
              </div>

              {/* Messages Thread */}
              {ticket.messages && ticket.messages.map((msg: any) => {
                const isSuperAdmin = msg.senderType === 'super_admin';
                return (
                  <div key={msg.id} className={`flex gap-4 ${isSuperAdmin ? 'flex-row-reverse' : ''}`}>
                    <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold shrink-0 shadow-sm border ${isSuperAdmin ? 'bg-blue-900/50 text-blue-400 border-blue-900/50' : 'bg-zinc-800 text-zinc-400 border-zinc-700'}`}>
                      {isSuperAdmin ? 'U' : 'T'}
                    </div>
                    <div className={`flex-1 rounded-xl p-5 text-sm shadow-sm ${isSuperAdmin ? 'bg-blue-950/30 border border-blue-900/50' : 'bg-zinc-900 border border-zinc-800'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <span className="font-semibold text-xs text-zinc-400">
                          {isSuperAdmin ? msg.senderEmail : msg.senderEmail || 'Tenant'}
                        </span>
                        <span className="text-xs text-zinc-500">
                          {new Date(msg.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed text-zinc-100">{msg.message}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>

          <div className="p-6 border-t border-zinc-800 bg-zinc-950">
            {ticket.status !== 'closed' ? (
              <div className="space-y-4">
                <textarea
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all resize-none shadow-inner"
                  rows={4}
                  placeholder="Type a detailed reply to the tenant..."
                  value={resolutionMessage}
                  onChange={(e) => setResolutionMessage(e.target.value)}
                />
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={handleClose} disabled={replying} className="bg-transparent border-zinc-700 text-zinc-300 hover:bg-zinc-800 hover:text-white">
                    {replying && ticket.status !== 'closed' ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    Close Ticket
                  </Button>
                  <Button variant="secondary" onClick={() => handleReply('in_progress')} disabled={replying || !resolutionMessage.trim()} className="bg-zinc-800 text-white hover:bg-zinc-700">
                    {replying ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    Reply (In Progress)
                  </Button>
                  <Button onClick={() => handleReply('resolved')} disabled={replying || !resolutionMessage.trim()} className="bg-blue-600 hover:bg-blue-500 text-white font-medium">
                    {replying ? <Spinner className="mr-2 h-4 w-4" /> : null}
                    Reply & Resolve
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center text-zinc-500 p-4 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
                This ticket has been closed. Tenants have 3 days to reply and reopen it.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
