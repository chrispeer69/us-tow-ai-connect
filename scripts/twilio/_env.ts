/**
 * Shared env loader + arg parser for scripts/twilio/*.
 * Keeps each script tiny and consistent.
 */
import twilio, { type Twilio } from 'twilio';

export interface TwilioEnv {
  client: Twilio;
  accountSid: string;
  outboundNumber: string;
  inboundPublicNumber: string;
  transferNumber: string;
  registeredName: string;
}

export interface CliFlags {
  apply: boolean;
  dryRun: boolean;
  name?: string;
  to?: string;
  raw: Record<string, string | boolean>;
}

const REPLACE_ME = 'REPLACE_ME';

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.startsWith(REPLACE_ME)) {
    throw new Error(
      `Missing or placeholder env var ${key}. Set it in packages/api/.env or shell before running.`,
    );
  }
  return v;
}

function optionalEnv(key: string, fallback: string): string {
  const v = process.env[key];
  if (!v || v.startsWith(REPLACE_ME)) return fallback;
  return v;
}

export function loadTwilioEnv(): TwilioEnv {
  const accountSid = requireEnv('TWILIO_ACCOUNT_SID');
  const authToken = requireEnv('TWILIO_AUTH_TOKEN');
  const outboundNumber = optionalEnv('TWILIO_OUTBOUND_NUMBER', '+18783563281');
  const inboundPublicNumber = optionalEnv('TWILIO_INBOUND_PUBLIC_NUMBER', '+13803336411');
  const transferNumber = optionalEnv('TWILIO_TRANSFER_NUMBER', '+17408129489');
  const registeredName = optionalEnv('TWILIO_CNAM_REGISTERED_NAME', 'ROADSIDE TOWING');

  return {
    client: twilio(accountSid, authToken),
    accountSid,
    outboundNumber,
    inboundPublicNumber,
    transferNumber,
    registeredName,
  };
}

export function parseFlags(argv: string[]): CliFlags {
  const raw: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      raw[key] = next;
      i++;
    } else {
      raw[key] = true;
    }
  }
  const apply = raw.apply === true;
  return {
    apply,
    dryRun: !apply,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    to: typeof raw.to === 'string' ? raw.to : undefined,
    raw,
  };
}

export function banner(title: string): void {
  const bar = '='.repeat(72);
  process.stdout.write(`\n${bar}\n${title}\n${bar}\n`);
}

export function log(...parts: unknown[]): void {
  process.stdout.write(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ') + '\n');
}

export function fail(message: string, exitCode = 1): never {
  process.stderr.write(`ERROR: ${message}\n`);
  process.exit(exitCode);
}
