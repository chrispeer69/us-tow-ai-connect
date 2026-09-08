import { ExtractJwt, Strategy } from 'passport-jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { UsTowSsoService } from './ustow-sso.service';

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
  constructor(private readonly sso: UsTowSsoService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: resolveJwtSecret(),
    });
  }

  async validate(payload: any) {
    // SSO: a token issued through "Sign in with US Tow" carries the SSO session
    // id. Back-channel logout revokes that id, and the 7-day session dies with it.
    if (payload.sid && (await this.sso.isSessionRevoked(payload.sid))) {
      throw new UnauthorizedException('You have been signed out of US Tow. Please sign in again.');
    }
    return {
      userId: payload.userId,
      email: payload.email,
      tenantId: payload.tenantId,
      role: payload.role,
      platformRole: payload.platformRole,
      sid: payload.sid,
    };
  }
}
