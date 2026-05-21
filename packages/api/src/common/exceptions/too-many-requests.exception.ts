import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRequestsException extends HttpException {
  constructor() {
    super(
      { status: 'error', code: 'RATE_LIMITED', message: 'Too many requests' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
