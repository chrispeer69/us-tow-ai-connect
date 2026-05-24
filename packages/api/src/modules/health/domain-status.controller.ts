import * as tls from 'node:tls';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { SuperAdminAuthGuard } from '../super-admin/super-admin-auth.guard';
import { resolveAllowedOrigins } from '../../common/utils/allowed-domains';

const PROBE_TIMEOUT_MS = 3000;
const CERT_WARN_DAYS = 30;

export interface CertProbe {
  host: string;
  port: number;
  ok: boolean;
  error?: string;
  /** Cert chain validated against the system trust store. */
  trusted?: boolean;
  protocol?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  /** SAN list covers the host we connected to. */
  sanCoversHost?: boolean;
  /**
   * Coarse self-assessed grade — NOT an SSL Labs grade (that needs their
   * external API). 'A' = trusted + >30 days + TLS≥1.2; 'B' = trusted but
   * a warning condition; 'F' = untrusted / expired / unreachable.
   */
  grade?: 'A' | 'B' | 'F';
}

/**
 * Best-effort TLS handshake to read the live leaf certificate. Capped at
 * PROBE_TIMEOUT_MS so a hung handshake can't stall the endpoint. We connect
 * with rejectUnauthorized:false so an invalid/expired cert still yields its
 * details (validity is then reported via `trusted`/`grade`, not by throwing).
 */
export function probeTls(host: string, port = 443): Promise<CertProbe> {
  return new Promise<CertProbe>((resolve) => {
    let settled = false;
    const done = (probe: CertProbe) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* already closed */
      }
      resolve(probe);
    };

    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: PROBE_TIMEOUT_MS },
      () => {
        const cert = socket.getPeerCertificate();
        if (!cert || Object.keys(cert).length === 0) {
          done({ host, port, ok: false, error: 'no peer certificate', grade: 'F' });
          return;
        }
        const validTo = cert.valid_to ? new Date(cert.valid_to) : undefined;
        const validFrom = cert.valid_from ? new Date(cert.valid_from) : undefined;
        const daysRemaining = validTo
          ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
          : undefined;
        const san = cert.subjectaltname ?? '';
        const sanCoversHost = san
          .split(',')
          .map((s) => s.trim().replace(/^DNS:/, ''))
          .some((entry) => entry === host || (entry.startsWith('*.') && host.endsWith(entry.slice(1))));
        const trusted = socket.authorized;
        const protocol = socket.getProtocol() ?? undefined;
        const issuerField = cert.issuer?.O ?? cert.issuer?.CN;
        const issuer = Array.isArray(issuerField) ? issuerField[0] : issuerField;

        let grade: CertProbe['grade'] = 'F';
        if (trusted && daysRemaining !== undefined && daysRemaining > 0 && sanCoversHost) {
          const tlsOk = !protocol || protocol >= 'TLSv1.2';
          grade = daysRemaining >= CERT_WARN_DAYS && tlsOk ? 'A' : 'B';
        }

        done({
          host,
          port,
          ok: true,
          trusted,
          protocol,
          issuer,
          validFrom: validFrom?.toISOString(),
          validTo: validTo?.toISOString(),
          daysRemaining,
          sanCoversHost,
          grade,
        });
      },
    );

    socket.on('timeout', () => done({ host, port, ok: false, error: 'handshake timed out', grade: 'F' }));
    socket.on('error', (err) =>
      done({ host, port, ok: false, error: err instanceof Error ? err.message : String(err), grade: 'F' }),
    );
  });
}

/** Pull the unique, publicly-routable HTTPS hosts worth probing. */
export function bindingHosts(origins: string[]): string[] {
  const hosts = new Set<string>();
  for (const origin of origins) {
    if (!origin.startsWith('https://')) continue; // skip localhost (http) + plain hosts
    if (origin.includes('*')) continue; // wildcards aren't a concrete host
    try {
      hosts.add(new URL(origin).hostname);
    } catch {
      /* malformed entry — ignore */
    }
  }
  return Array.from(hosts);
}

/**
 * /v1/system/domain-status — super-admin only (Session 46).
 *
 * Reports the current domain wiring (CORS allow-list + the absolute-URL env
 * vars) and a live TLS probe of each custom HTTPS host: cert issuer, validity
 * window, days remaining, SAN coverage, and a coarse self-grade. Operators use
 * it to confirm a custom-domain cutover landed without shelling into Railway.
 */
@Controller('v1/system')
@UseGuards(SuperAdminAuthGuard)
export class DomainStatusController {
  @Get('domain-status')
  async domainStatus() {
    const allowedOrigins = resolveAllowedOrigins(process.env);
    const bindings = {
      allowedOrigins,
      publicBaseUrl: process.env.PUBLIC_BASE_URL ?? null,
      webPublicUrl: process.env.WEB_PUBLIC_URL ?? null,
      allowedDomainsRaw: process.env.ALLOWED_DOMAINS ?? null,
    };

    const certificates = await Promise.all(bindingHosts(allowedOrigins).map((host) => probeTls(host)));

    const anyFailing = certificates.some((c) => !c.ok || c.grade === 'F');
    const anyExpiringSoon = certificates.some(
      (c) => c.ok && typeof c.daysRemaining === 'number' && c.daysRemaining < CERT_WARN_DAYS,
    );

    return {
      status: anyFailing ? 'attention' : anyExpiringSoon ? 'warning' : 'ok',
      bindings,
      certificates,
      checkedAt: new Date().toISOString(),
      note: 'grade is a coarse self-assessment, not SSL Labs; run scripts/domain/verify-domain.sh for the authoritative gate.',
    };
  }
}
