export class SessionExpiredException extends Error {
  readonly code = 'SESSION_EXPIRED';

  constructor(message = 'Session expired') {
    super(message);
    this.name = 'SessionExpiredException';
  }
}
