import { Controller, Post, Body, UseGuards, Request, Get, Res } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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
}
