import {
  BadRequestException,
  Controller,
  HttpCode,
  Post,
  Body,
  UnauthorizedException,
  UseGuards,
  Request,
  Get,
  Res,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RoadsideOidcService } from './roadside-oidc.service';
import { hasSsoApp, UsTowSsoService } from './ustow-sso.service';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly roadside: RoadsideOidcService,
    private readonly ustow: UsTowSsoService,
  ) {}

  @Post('login')
  @UseGuards(AuthGuard('local'))
  async login(@Request() req: any) {
    return this.authService.login(req.user);
  }

  @Post('signup')
  async signup(@Body() body: any) {
    return this.authService.register(body);
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth(@Request() req: any) {
    // Guard redirects to google
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(@Request() req: any, @Res() res: any) {
    const { access_token } = await this.authService.login(req.user);
    // Redirect to frontend with token in URL fragment
    const frontendUrl = process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/auth-callback?token=${access_token}`);
  }

  /**
   * Roadside SSO — the multi-tenant identity portal every US Tow site shares.
   * GET /v1/auth/roadside starts the OpenID Connect round-trip; the callback
   * signs the person in (creating them on first visit) and hands the web app
   * a session token exactly like the Google flow does.
   */
  @Get('roadside')
  async roadsideAuth(@Query('next') next: string | undefined, @Query('login_hint') loginHint: string | undefined, @Res() res: any) {
    res.redirect(this.roadside.authorizeUrl(next, loginHint));
  }

  @Get('roadside/callback')
  async roadsideCallback(@Query() query: Record<string, string>, @Res() res: any) {
    const frontendUrl = process.env.FRONTEND_URL || process.env.PUBLIC_BASE_URL || 'http://localhost:3000';
    try {
      const { claims } = await this.roadside.handleCallback(query);
      const user = await this.authService.validateSsoLogin(claims.email, claims.name);
      const { access_token } = await this.authService.login(user);
      // Fragment, not query: the token never reaches server logs or Referer headers.
      res.redirect(`${frontendUrl}/auth-callback#token=${access_token}`);
    } catch (err: any) {
      const reason = encodeURIComponent(err?.message || 'sso_failed');
      res.redirect(`${frontendUrl}/sign-in?error=${reason}`);
    }
  }

  /**
   * SSO: "Sign in with US Tow" (see ustow-sso.service.ts for the full flow).
   *
   * The browser reaches these through the web app: www/auth/login -> /api/v1/auth/sso,
   * and the registered redirect URI www/auth/callback -> /api/v1/auth/sso/callback.
   */
  @Get('sso')
  async ustowSsoAuth(
    @Query('next') next: string | undefined,
    @Query('login_hint') loginHint: string | undefined,
    @Res() res: any,
  ) {
    if (!this.ustow.enabled) {
      return res.redirect(this.signInError('US Tow sign-in is not configured on this server.'));
    }
    res.redirect(this.ustow.authorizeUrl(next, loginHint));
  }

  @Get('sso/callback')
  async ustowSsoCallback(@Query() query: Record<string, string>, @Res() res: any) {
    try {
      const { claims, idToken, next } = await this.ustow.handleCallback(query);
      // Authorisation: the SSO lists which apps a person may open. Refuse
      // anyone whose dashboard does not include this one.
      if (!hasSsoApp(claims, this.ustow.clientId)) {
        throw new UnauthorizedException(
          'This app is not on your US Tow dashboard. Ask your US Tow administrator to add US Tow AI-Connect.',
        );
      }
      const user = await this.authService.validateUsTowSsoLogin(claims);
      const { access_token } = await this.authService.login(user, { sid: claims.sid });
      // Fragment, not query: the tokens never reach server logs or Referer headers.
      // `sso=ustow` + the id_token let the web app finish the SSO session on logout.
      const fragment = new URLSearchParams({ token: access_token, sso: 'ustow', id_token: idToken });
      const target = next ? `?next=${encodeURIComponent(next)}` : '';
      res.redirect(`${this.ustow.webOrigin}/auth-callback${target}#${fragment.toString()}`);
    } catch (err: any) {
      res.redirect(this.signInError(err?.message || 'sso_failed'));
    }
  }

  /** Site logout continues here when the session came from US Tow: end the SSO session, land on the site root. */
  @Get('sso/logout')
  async ustowSsoLogout(@Query('id_token_hint') idTokenHint: string | undefined, @Res() res: any) {
    res.redirect(this.ustow.logoutUrl(idTokenHint));
  }

  /**
   * OIDC back-channel logout. US Tow SSO POSTs `logout_token` (form field)
   * when the person signs out anywhere; the session id inside is revoked and
   * every dashboard token carrying it stops validating (JwtStrategy).
   */
  @Post('sso/backchannel-logout')
  @HttpCode(200)
  async ustowSsoBackchannelLogout(@Body() body: { logout_token?: string }) {
    let sid: string | undefined;
    try {
      ({ sid } = await this.ustow.verifyLogoutToken(body?.logout_token));
    } catch {
      throw new BadRequestException('invalid logout_token');
    }
    if (sid) await this.ustow.revokeSession(sid);
    return { ok: true };
  }

  private signInError(message: string): string {
    return `${this.ustow.webOrigin}/sign-in?error=${encodeURIComponent(message)}`;
  }

  @Post('forgot-password')
  async forgotPassword(@Body() body: { email: string }) {
    if (!body.email) {
      throw new Error('Email is required');
    }
    await this.authService.sendPasswordResetOtp(body.email);
    return { success: true };
  }

  @Post('reset-password')
  async resetPassword(@Body() body: { email: string; otp: string; newPassword: string }) {
    if (!body.email || !body.otp || !body.newPassword) {
      throw new Error('Email, OTP, and new password are required');
    }
    await this.authService.resetPasswordWithOtp(body.email, body.otp, body.newPassword);
    return { success: true };
  }

  /**
   * The tenants this login may switch into. Powers the UtilityBar switcher.
   */
  @Get('my-tenants')
  @UseGuards(AuthGuard('jwt'))
  async myTenants(@Request() req: any) {
    return this.authService.listSwitchableTenants(req.user);
  }

  /**
   * Re-issue the caller's token against another tenant they belong to.
   *
   * The body carries a tenant id and nothing else — the role is resolved
   * server-side from tenant_members. Accepting a role here would let anyone
   * POST {tenantId, role:'OWNER'} and own every tenant they can name.
   */
  @Post('switch-tenant')
  @UseGuards(AuthGuard('jwt'))
  async switchTenant(@Request() req: any, @Body() body: { tenantId?: string }) {
    if (!body?.tenantId) {
      throw new BadRequestException('tenantId is required');
    }
    return this.authService.switchTenant(req.user, body.tenantId);
  }

  @Post('impersonate')
  @UseGuards(AuthGuard('jwt'))
  async impersonate(@Request() req: any, @Body() body: { tenantId: string }) {
    if (!body.tenantId) {
      throw new Error('tenantId is required');
    }
    return this.authService.impersonateTenant(req.user, body.tenantId);
  }
}
