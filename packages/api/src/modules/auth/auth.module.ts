import { Logger, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthEmailService } from './auth-email.service';
import { JwtStrategy } from './jwt.strategy';
import { LocalStrategy } from './local.strategy';
import { GoogleStrategy } from './google.strategy';

function resolveJwtSecret(): string {
  const secret = process.env.ENCRYPTION_KEY;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('FATAL: ENCRYPTION_KEY must be set in production');
  }
  // Dev/test fallback — log a loud warning so it doesn't slip into staging
  const fallback = 'dev-only-insecure-jwt-secret-do-not-use-in-prod';
  new Logger('AuthModule').warn(
    `ENCRYPTION_KEY is unset — using an insecure fallback. ` +
    `Set ENCRYPTION_KEY before deploying.`,
  );
  return fallback;
}

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: resolveJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, LocalStrategy, JwtStrategy, GoogleStrategy, AuthEmailService],
  exports: [AuthService],
})
export class AuthModule {}
