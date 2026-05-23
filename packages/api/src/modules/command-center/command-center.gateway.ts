import { Injectable, Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';

const DEFAULT_TENANT_ID =
  process.env.DEFAULT_ADMIN_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';

function room(tenantId: string): string {
  return `tenant:${tenantId}`;
}

/**
 * Real-time bus for the Command Center UI. Tenants are isolated by room.
 * Auth uses the same placeholder header scheme as the admin REST guard —
 * `x-tenant-id` in handshake headers OR a `tenantId` query param. Real JWT
 * auth is flagged in docs/ASSUMPTIONS.md.
 */
@Injectable()
@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/ws/command-center',
  transports: ['websocket', 'polling'],
})
export class CommandCenterGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CommandCenterGateway.name);

  @WebSocketServer()
  private server!: Server;

  afterInit() {
    this.logger.log('Command Center websocket gateway ready');
  }

  handleConnection(client: Socket) {
    const tenantId =
      (client.handshake.headers['x-tenant-id'] as string | undefined) ||
      (client.handshake.query?.tenantId as string | undefined) ||
      DEFAULT_TENANT_ID;
    if (!tenantId) {
      client.disconnect(true);
      return;
    }
    client.data.tenantId = tenantId;
    void client.join(room(tenantId));
    client.emit('connected', { tenantId });
  }

  handleDisconnect(_client: Socket) {
    // No-op; rooms clean up automatically.
  }

  broadcast(tenantId: string, event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(room(tenantId)).emit(event, payload);
  }
}
