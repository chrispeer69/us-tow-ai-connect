import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { AuditLogService, type ActorType } from './audit-log.service';
import {
  AUDIT_ACTION_KEY,
  AUDIT_RESOURCE_TYPE_KEY,
  AUDIT_SKIP_KEY,
} from './audit-action.decorator';
import { sanitizeForAudit } from './audit-sanitizer';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const AUDITED_PREFIXES = ['/v1/admin/', '/v1/ai-connect/', '/v1/partner/'];

interface RequestWithAuth extends Request {
  tenant?: { id: string; apiKeyPrefix?: string };
  tenantId?: string;
  requestId?: string;
}

/**
 * Auto-audits every POST/PUT/PATCH/DELETE under /v1/admin/*,
 * /v1/ai-connect/*, /v1/partner/*. Writes a row AFTER the route handler
 * resolves so the response status is captured; on error, writes an
 * "*.failed" action with the exception message.
 *
 * Decorators (audit-action.decorator.ts) tweak the action name / resource
 * type; @SkipAudit() opts out entirely.
 *
 * Sanitization runs on the request body before it's stored — see
 * audit-sanitizer.ts for the redaction list.
 */
@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditLogInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLog: AuditLogService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<RequestWithAuth>();
    const method = (req.method ?? '').toUpperCase();
    const path = req.path ?? req.url ?? '';

    if (this.reflector.get<boolean>(AUDIT_SKIP_KEY, context.getHandler())) {
      return next.handle();
    }

    const isMutating = MUTATING_METHODS.has(method);
    const isAuditedPath = AUDITED_PREFIXES.some((p) => path.startsWith(p));
    if (!isMutating || !isAuditedPath) {
      return next.handle();
    }

    const decoratedAction = this.reflector.get<string>(AUDIT_ACTION_KEY, context.getHandler());
    const decoratedResource = this.reflector.get<string>(
      AUDIT_RESOURCE_TYPE_KEY,
      context.getHandler(),
    );

    const start = Date.now();
    const action = decoratedAction ?? `${method} ${path}`;
    const { actorType, actorId } = pickActor(req);
    const tenantId = req.tenant?.id ?? req.tenantId ?? null;
    const resourceId = pickResourceId(req);
    const requestBody = req.body ?? null;

    return next.handle().pipe(
      tap({
        next: (response: unknown) => {
          void this.auditLog.record({
            tenantId,
            actorType,
            actorId,
            action,
            resourceType: decoratedResource ?? null,
            resourceId,
            before: null,
            after: sanitizeForAudit(requestBody),
            metadata: {
              method,
              path,
              status: 'ok',
              durationMs: Date.now() - start,
              ip: pickIp(req),
              userAgent: req.headers['user-agent'],
              requestId: req.requestId,
              responseShape: shapeOf(response),
            },
          });
        },
        error: (err: Error) => {
          void this.auditLog.record({
            tenantId,
            actorType,
            actorId,
            action: `${action}.failed`,
            resourceType: decoratedResource ?? null,
            resourceId,
            before: null,
            after: sanitizeForAudit(requestBody),
            metadata: {
              method,
              path,
              status: 'error',
              error: err.message,
              durationMs: Date.now() - start,
              ip: pickIp(req),
              userAgent: req.headers['user-agent'],
              requestId: req.requestId,
            },
          });
        },
      }),
    );
  }
}

function pickActor(req: RequestWithAuth): { actorType: ActorType; actorId: string } {
  if (req.tenant?.apiKeyPrefix) {
    return { actorType: 'api_key', actorId: req.tenant.apiKeyPrefix };
  }
  const tenantHeader = req.headers['x-tenant-id'];
  const tenantId = Array.isArray(tenantHeader) ? tenantHeader[0] : tenantHeader;
  if (tenantId) return { actorType: 'user', actorId: tenantId };
  return { actorType: 'system', actorId: 'unknown' };
}

function pickResourceId(req: RequestWithAuth): string | null {
  const params = (req as unknown as { params?: Record<string, string> }).params ?? {};
  return params['id'] ?? params['jobId'] ?? params['ruleId'] ?? params['memberId'] ?? null;
}

function pickIp(req: RequestWithAuth): string {
  const xff = req.headers['x-forwarded-for'];
  const fwd = Array.isArray(xff) ? xff[0] : xff;
  return (fwd ?? req.ip ?? '').split(',')[0].trim();
}

function shapeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === 'object') return `object{${Object.keys(value).length}}`;
  return typeof value;
}
