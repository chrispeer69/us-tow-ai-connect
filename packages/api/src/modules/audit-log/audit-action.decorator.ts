import { SetMetadata } from '@nestjs/common';

export const AUDIT_ACTION_KEY = 'audit:action';
export const AUDIT_RESOURCE_TYPE_KEY = 'audit:resource_type';

/**
 * Annotate a controller method with the action name + optional resource
 * type that the global AuditLogInterceptor will use when writing the row.
 *
 *   @AuditAction('credential.update', 'tenant_credentials')
 *   @Post('credentials')
 *   saveCredentials(...) { ... }
 *
 * If a method isn't decorated, the interceptor derives the action from the
 * HTTP method + path (`POST:/v1/admin/credentials` → "POST /v1/admin/credentials").
 * Decorating is preferred but optional.
 */
export function AuditAction(action: string, resourceType?: string): MethodDecorator {
  return (target, key, descriptor) => {
    SetMetadata(AUDIT_ACTION_KEY, action)(target, key, descriptor);
    if (resourceType) {
      SetMetadata(AUDIT_RESOURCE_TYPE_KEY, resourceType)(target, key, descriptor);
    }
    return descriptor;
  };
}

/**
 * Marker — opts a method OUT of the auto-audit interceptor. Use sparingly:
 * health probes, no-mutation reads under /v1/admin/* that you want clean
 * audit history for.
 */
export const AUDIT_SKIP_KEY = 'audit:skip';
export const SkipAudit = (): MethodDecorator => SetMetadata(AUDIT_SKIP_KEY, true);
