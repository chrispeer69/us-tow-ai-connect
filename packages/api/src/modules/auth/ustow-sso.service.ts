import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import type Redis from 'ioredis';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/**
 * US Tow SSO — "Sign in with US Tow" (OpenID Connect, authorization code +
 * PKCE, confidential client).
 *
 * The whole round-trip, end to end:
 *
 *   browser  GET  https://www.<domain>/auth/login          Next route -> 302 /api/v1/auth/sso
 *   api      GET  /v1/auth/sso                            -> 302 {issuer}/oauth/authorize
 *   SSO      302  https://www.<domain>/auth/callback?code&state   (the registered redirect URI)
 *   web      GET  /auth/callback                          Next route -> 302 /api/v1/auth/sso/callback
 *   api      GET  /v1/auth/sso/callback  exchanges the code (client_secret_basic),
 *            verifies the RS256 ID token against the SSO JWKS (iss, aud, nonce),
 *            reads /oauth/userinfo, maps the person to a local user + tenant,
 *            and hands the web app a session JWT in the URL fragment — the same
 *            contract the Google and Roadside flows already use.
 *
 * Stateless, like RoadsideOidcService: the PKCE verifier and nonce ride inside
 * a short-lived JWT that doubles as the OAuth `state`. Back-channel logout
 * revokes the SSO session id (`sid`) in Redis; JwtStrategy checks it.
 *
 * Environment (only SSO_CLIENT_SECRET is strictly required):
 *   SSO_ISSUER         default https://us-tow-sso-production.up.railway.app
 *   SSO_CLIENT_ID      default ustowaiconnect
 *   SSO_CLIENT_SECRET  set in Railway, never committed
 *   SSO_REDIRECT_URI   default https://www.ustowaiconnect.com/auth/callback in production
 */

export const DEFAULT_SSO_ISSUER = 'https://us-tow-sso-production.up.railway.app';
export const DEFAULT_SSO_CLIENT_ID = 'ustowaiconnect';
export const SSO_SCOPE = 'openid profile email ustow';
const PROD_WEB_ORIGIN = 'https://www.ustowaiconnect.com';
const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
/** Matches the 7d session token lifetime in AuthModule — a revoked sid outlives every token that carries it. */
const REVOKED_SID_TTL_SECONDS = 7 * 24 * 3600;

export interface UsTowSsoClaims {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  phone: string | null;
  orgId?: string;
  orgSlug?: string;
  orgName?: string;
  roles: string[];
  apps: string[];
  platformAdmin: boolean;
  sid?: string;
}

/** Normalise raw token / userinfo claims into a plain object (mirrors packages/auth/claims.js in the SSO repo). */
export function parseSsoClaims(raw: Record<string, unknown>): UsTowSsoClaims {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);
  return {
    sub: str(raw.sub),
    email: str(raw.email).toLowerCase(),
    emailVerified: raw.email_verified === true,
    name: str(raw.name),
    phone: str(raw.phone_number) || null,
    orgId: str(raw.org_id) || undefined,
    orgSlug: str(raw.org_slug).toLowerCase() || undefined,
    orgName: str(raw.org_name) || undefined,
    roles: list(raw.roles).map((r) => r.toLowerCase()),
    apps: list(raw.apps),
    platformAdmin: raw.platform_admin === true,
    sid: str(raw.sid) || undefined,
  };
}

/** The `apps` claim lists the app ids this person may open. Our client_id must be one of them. */
export function hasSsoApp(claims: Pick<UsTowSsoClaims, 'apps'>, appId: string): boolean {
  return claims.apps.includes(appId);
}

@Injectable()
export class UsTowSsoService {
  private readonly logger = new Logger(UsTowSsoService.name);
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  get enabled(): boolean {
    return Boolean(this.clientSecret);
  }

  get issuer(): string {
    return (process.env.SSO_ISSUER || DEFAULT_SSO_ISSUER).trim().replace(/\/+$/, '');
  }

  get clientId(): string {
    return (process.env.SSO_CLIENT_ID || DEFAULT_SSO_CLIENT_ID).trim();
  }

  private get clientSecret(): string {
    return (process.env.SSO_CLIENT_SECRET || '').trim();
  }

  /** The registered redirect URI — lives on the WEB origin, whose /auth/callback route forwards here. */
  get redirectUri(): string {
    const fromEnv = (process.env.SSO_REDIRECT_URI || '').trim();
    if (fromEnv) return fromEnv;
    const web =
      process.env.NODE_ENV === 'production'
        ? PROD_WEB_ORIGIN
        : process.env.WEB_PUBLIC_URL || 'http://localhost:3000';
    return `${web.replace(/\/+$/, '')}/auth/callback`;
  }

  /** Where session tokens and post-logout land. Derived from the redirect URI so the two can never disagree. */
  get webOrigin(): string {
    return new URL(this.redirectUri).origin;
  }

  /** Build the redirect to US Tow SSO. `next` (same-origin path) is remembered inside the state. */
  authorizeUrl(next?: string, loginHint?: string): string {
    if (!this.enabled) throw new UnauthorizedException('US Tow SSO is not configured');
    const verifier = randomBytes(48).toString('base64url');
    const nonce = randomBytes(16).toString('base64url');
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : undefined;
    const state = this.jwtService.sign(
      { kind: 'ustow_sso', cv: verifier, n: nonce, next: safeNext },
      { expiresIn: '10m' },
    );
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: SSO_SCOPE,
      state,
      nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    if (loginHint) params.set('login_hint', loginHint);
    return `${this.issuer}/oauth/authorize?${params.toString()}`;
  }

  /**
   * Exchange the callback for verified claims. Throws UnauthorizedException on
   * any mismatch. The ID token signature is checked against the SSO JWKS with
   * `iss` and `aud` pinned; userinfo is layered on top for the org/role claims.
   */
  async handleCallback(
    query: Record<string, string | undefined>,
  ): Promise<{ claims: UsTowSsoClaims; idToken: string; next?: string }> {
    if (query.error) throw new UnauthorizedException(query.error_description || query.error);

    let saved: { kind?: string; cv?: string; n?: string; next?: string };
    try {
      saved = this.jwtService.verify(query.state || '');
    } catch {
      throw new UnauthorizedException('Sign-in session expired. Please try again.');
    }
    if (saved.kind !== 'ustow_sso' || !saved.cv || !saved.n || !query.code) {
      throw new UnauthorizedException('Invalid sign-in state.');
    }

    const basic = Buffer.from(
      `${encodeURIComponent(this.clientId)}:${encodeURIComponent(this.clientSecret)}`,
    ).toString('base64');
    const tokenRes = await fetch(`${this.issuer}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        authorization: `Basic ${basic}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: query.code,
        redirect_uri: this.redirectUri,
        code_verifier: saved.cv,
      }),
    });
    if (!tokenRes.ok) {
      this.logger.warn(`token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
      throw new UnauthorizedException('US Tow SSO rejected the sign-in code.');
    }
    const tokens = (await tokenRes.json()) as { access_token?: string; id_token?: string };
    if (!tokens.id_token || !tokens.access_token) {
      throw new UnauthorizedException('US Tow SSO returned an incomplete token response.');
    }

    let idClaims: Record<string, unknown>;
    try {
      const { payload } = await jwtVerify(tokens.id_token, this.jwksSet(), {
        issuer: this.issuer,
        audience: this.clientId,
      });
      idClaims = payload as Record<string, unknown>;
    } catch (err: any) {
      this.logger.warn(`id_token verification failed: ${err?.message || err}`);
      throw new UnauthorizedException('Sign-in could not be verified.');
    }
    if (idClaims.nonce !== saved.n) {
      throw new UnauthorizedException('Sign-in could not be verified.');
    }

    // userinfo carries the same claims; it is layered on top so a token trimmed
    // for size still yields the org / roles / apps we authorise on.
    let info: Record<string, unknown> = {};
    const infoRes = await fetch(`${this.issuer}/oauth/userinfo`, {
      headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' },
    });
    if (infoRes.ok) {
      info = (await infoRes.json()) as Record<string, unknown>;
    } else {
      this.logger.warn(`userinfo failed: ${infoRes.status}; using id_token claims only`);
    }

    const claims = parseSsoClaims({ ...idClaims, ...info });
    if (!claims.email) throw new UnauthorizedException('US Tow account has no email.');
    if (!claims.sub) throw new UnauthorizedException('US Tow account has no subject.');
    return { claims, idToken: tokens.id_token, next: saved.next };
  }

  /** RP-initiated logout: end the SSO session, then land on the registered post-logout URI (the site root). */
  logoutUrl(idTokenHint?: string): string {
    const params = new URLSearchParams({ post_logout_redirect_uri: `${this.webOrigin}/` });
    if (idTokenHint) params.set('id_token_hint', idTokenHint);
    return `${this.issuer}/oauth/logout?${params.toString()}`;
  }

  /**
   * Back-channel logout: the SSO POSTs a `logout_token` (RS256, same iss/aud
   * as the ID token) when the person signs out anywhere. Returns the session
   * id to revoke. Throws on anything that is not a valid logout token.
   */
  async verifyLogoutToken(token: string | undefined): Promise<{ sid?: string; sub?: string }> {
    if (!token) throw new UnauthorizedException('logout_token is required');
    const { payload } = await jwtVerify(token, this.jwksSet(), {
      issuer: this.issuer,
      audience: this.clientId,
    });
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || !events[BACKCHANNEL_LOGOUT_EVENT]) {
      throw new UnauthorizedException('not a logout token');
    }
    return {
      sid: typeof payload.sid === 'string' ? payload.sid : undefined,
      sub: typeof payload.sub === 'string' ? payload.sub : undefined,
    };
  }

  async revokeSession(sid: string): Promise<void> {
    await this.redis.set(this.revokedKey(sid), '1', 'EX', REVOKED_SID_TTL_SECONDS);
  }

  /** Fail-open on a Redis hiccup: a transient cache outage must not lock every SSO user out. */
  async isSessionRevoked(sid: string): Promise<boolean> {
    try {
      return (await this.redis.exists(this.revokedKey(sid))) === 1;
    } catch (err: any) {
      this.logger.warn(`revocation check skipped (redis): ${err?.message || err}`);
      return false;
    }
  }

  private revokedKey(sid: string): string {
    return `sso:revoked:${sid}`;
  }

  private jwksSet() {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`));
    }
    return this.jwks;
  }
}
