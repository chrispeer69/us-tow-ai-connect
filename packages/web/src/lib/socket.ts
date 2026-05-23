'use client';
import { io, type Socket } from 'socket.io-client';
import { DEFAULT_TENANT_ID, TENANT_HEADER } from './utils';

let socket: Socket | null = null;

export function getCommandCenterSocket(): Socket {
  if (socket) return socket;
  const wsBase = process.env.NEXT_PUBLIC_WS_URL || '';
  socket = io(wsBase, {
    path: '/ws/command-center',
    transports: ['websocket', 'polling'],
    extraHeaders: {
      [TENANT_HEADER]: DEFAULT_TENANT_ID,
    },
    query: {
      tenantId: DEFAULT_TENANT_ID,
    },
    autoConnect: true,
    reconnection: true,
  });
  return socket;
}
