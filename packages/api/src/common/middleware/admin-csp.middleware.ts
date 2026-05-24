import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

/**
 * Stricter CSP for the admin / partner JSON surfaces (Session 26 §5).
 *
 * The API doesn't render HTML to admins — these endpoints return JSON —
 * so `default-src 'none'` is safe and gives defense-in-depth against an
 * accidental error page or HTML response leaking content. We also pin
 * `frame-ancestors 'none'` so an attacker can't iframe an authenticated
 * response into a phishing page.
 *
 * The web app (packages/web) sets its own CSP via Next.js headers — this
 * middleware does not touch /admin web routes.
 */
@Injectable()
export class AdminCspMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const path = req.path ?? '';
    if (
      path.startsWith('/v1/admin/') ||
      path.startsWith('/v1/partner/') ||
      path.startsWith('/v1/super-admin/') ||
      path.startsWith('/v1/system/')
    ) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
    }
    next();
  }
}
