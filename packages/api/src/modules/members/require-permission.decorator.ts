// Session 45 — route-level RBAC metadata.
//
// Usage: @RequirePermission('digital-dispatch.write') on a controller method
// (or class). The PermissionGuard reads this metadata via Reflector. Routes
// without it are not subject to RBAC enforcement.

import { SetMetadata } from '@nestjs/common';

export const REQUIRE_PERMISSION_KEY = 'rbac:required_permission';

export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, permission);
