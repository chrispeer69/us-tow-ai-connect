import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';

/**
 * Roadside SSO (OpenID Connect, authorization code + PKCE).
 *
 * Stateless on purpose: the PKCE verifier and nonce travel in a short-lived
 * JWT that doubles as the OAuth `state` parameter, signed with the same key
 * as our session tokens. No cookie, no server-side session, no extra
 * dependency — Node's global fetch does the two HTTPS calls.
 *
 * Environment:
 *   ROADSIDE_SSO_ISSUER         https://roadside-sso-production.up.railway.app
 *   ROADSIDE_SSO_CLIENT_ID      ustowaiconnect
 *   ROADSIDE_SSO_CLIENT_SECRET  from Roadside → Platform → App catalog → Secret
 *   ROADSIDE_SSO_CALLBACK_URL   https://api.ustowaiconnect.com/v1/auth/roadside/callback
 */
export interface RoadsideClaims {
  sub: string;
  email: string;
  name: string;
  roles: string[];
  orgId?: string;
  orgSlug?: string;
  orgName?: string;
}

@Injectable()
export class RoadsideOidcService {
  private readonly logger = new Logger(RoadsideOidcService.name);

  constructor(private readonly jwtService: JwtService) {}

  get enabled(): boolean {
    return Boolean(this.issuer && this.clientSecret);
  }

  private get issuer(): string {
    return (process.env.ROADSIDE_SSO_ISSUER || '').trim().replace(/\/+$/, '');
  }
  private get clientId(): string {
    return (process.env.ROADSIDE_SSO_CLIENT_ID || 'ustowaiconnect').trim();
  }
  private get clientSecret(): string {
    return (process.env.ROADSIDE_SSO_CLIENT_SECRET || '').trim();
  }
  private get callbackUrl(): string {
    return (
      process.env.ROADSIDE_SSO_CALLBACK_URL ||
      `${process.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/v1/auth/roadside/callback`
    ).trim();
  }

  /** Build the redirect to Roadside. `next` is remembered inside the state. */
  authorizeUrl(next?: string, loginHint?: string): string {
    if (!this.enabled) throw new UnauthorizedException('Roadside SSO is not configured');
    const verifier = randomBytes(48).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const state = this.jwtService.sign(
      { kind: 'roadside_sso', cv: verifier, n: nonce, next: next && next.startsWith('/') ? next : undefined },
      { expiresIn: '10m' },
    );
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.callbackUrl,
      response_type: 'code',
      scope: 'openid profile email roadside',
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    if (loginHint) params.set('login_hint', loginHint);
    return `${this.issuer}/oauth/authorize?${params.toString()}`;
  }

  /** Exchange the callback for verified claims. Throws UnauthorizedException on any mismatch. */
  async handleCallback(query: Record<string, string | undefined>): Promise<{ claims: RoadsideClaims; next?: string }> {
    if (query.error) throw new UnauthorizedException(query.error_description || query.error);
    let saved: { kind?: string; cv?: string; n?: string; next?: string };
    try {
      saved = this.jwtService.verify(query.state || '');
    } catch {
      throw new UnauthorizedException('Sign-in session expired. Please try again.');
    }
    if (saved.kind !== 'roadside_sso' || !saved.cv || !saved.n || !query.code) {
      throw new UnauthorizedException('Invalid sign-in state.');
    }

    const basic = Buffer.from(`${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`).toString('base64');
    const tokenRes = await fetch(`${this.issuer}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', authorization: `Basic ${basic}` },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: this.callbackUrl,
        code_verifier: saved.cv,
      }),
    });
    if (!tokenRes.ok) {
      this.logger.warn(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
      throw new UnauthorizedException('Roadside SSO rejected the sign-in code.');
    }
    const tokens = (await tokenRes.json()) as { access_token: string; id_token: string };
    if (decodeJwtPayload(tokens.id_token).nonce !== saved.n) {
      throw new UnauthorizedException('Sign-in could not be verified.');
    }
    const infoRes = await fetch(`${this.issuer}/oauth/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
    });
    if (!infoRes.ok) throw new UnauthorizedException('Could not read the Roadside profile.');
    const info = (await infoRes.json()) as Record<string, any>;
    const email = String(info.email || '').trim().toLowerCase();
    if (!email) throw new UnauthorizedException('Roadside account has no email.');
    return {
      claims: {
        sub: String(info.sub),
        email,
        name: String(info.name || '').trim(),
        roles: Array.isArray(info.roles) ? info.roles.map(String) : [],
        orgId: info.org_id,
        orgSlug: info.org_slug,
        orgName: info.org_name,
      },
      next: saved.next,
    };
  }
}

function decodeJwtPayload(token: string): Record<string, any> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}
