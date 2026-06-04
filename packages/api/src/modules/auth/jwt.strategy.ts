import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger } from '@nestjs/common';

function resolveJwtSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: ENCRYPTION_KEY must be set in production');
  }
  const fallback = 'dev-only-insecure-jwt-secret-do-not-use-in-prod';
  new Logger('JwtStrategy').warn('ENCRYPTION_KEY unset — using insecure dev fallback');
  return fallback;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  async validate(payload: any) {
    return { userId: payload.userId, email: payload.email, tenantId: payload.tenantId, role: payload.role };
  }
}
