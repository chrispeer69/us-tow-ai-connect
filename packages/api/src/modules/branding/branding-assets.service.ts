import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';

type StorageMode = 'local' | 'volume' | 's3';

const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']);
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

/**
 * Persists tenant logo + favicon uploads. Storage mode is selected by
 * PROD_FILE_STORAGE env:
 *   - "local" (default in dev): files live under ./data/branding/
 *   - "volume": files live under /data/branding (Railway Volume mount)
 *   - "s3": logs a "not implemented" warning and falls back to local. The
 *     S3 path would need @aws-sdk/client-s3 — deferred until ops actually
 *     provisions a bucket. See docs/BLOCKERS.md.
 */
@Injectable()
export class BrandingAssetsService {
  private readonly logger = new Logger(BrandingAssetsService.name);

  private get mode(): StorageMode {
    const raw = (process.env.PROD_FILE_STORAGE ?? 'local').toLowerCase();
    if (raw === 'volume' || raw === 's3') return raw;
    return 'local';
  }

  private get rootDir(): string {
    if (this.mode === 'volume') return '/data/branding';
    return resolve(process.cwd(), 'data/branding');
  }

  validate(file: { mimetype: string; size: number }) {
    if (file.size > MAX_BYTES) {
      throw new Error(`File too large (${file.size} bytes; max ${MAX_BYTES})`);
    }
    if (!ALLOWED_MIME.has(file.mimetype.toLowerCase())) {
      throw new Error(`Unsupported MIME type: ${file.mimetype}`);
    }
  }

  async save(args: {
    tenantId: string;
    kind: 'logo' | 'favicon';
    mimetype: string;
    buffer: Buffer;
  }): Promise<{ url: string; relPath: string }> {
    if (this.mode === 's3') {
      this.logger.warn('[branding] PROD_FILE_STORAGE=s3 requested but S3 client not implemented — falling back to local.');
    }
    const ext = extByMime(args.mimetype) || 'bin';
    const filename = `${args.kind}.${ext}`;
    const dir = join(this.rootDir, args.tenantId);
    await fs.mkdir(dir, { recursive: true });
    const full = join(dir, filename);
    await fs.writeFile(full, args.buffer);
    const base = process.env.PUBLIC_BASE_URL ?? 'http://localhost:3001';
    const url = `${base}/branding/${args.tenantId}/${filename}`;
    return { url, relPath: `${args.tenantId}/${filename}` };
  }

  async read(args: { tenantId: string; filename: string }): Promise<{ buffer: Buffer; mimetype: string } | null> {
    const full = join(this.rootDir, args.tenantId, args.filename);
    if (!existsSync(full)) return null;
    const buffer = await fs.readFile(full);
    const ext = extname(args.filename).slice(1).toLowerCase();
    const mimetype = mimeByExt(ext) ?? 'application/octet-stream';
    return { buffer, mimetype };
  }
}

function extByMime(m: string): string | null {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
  };
  return map[m.toLowerCase()] ?? null;
}

function mimeByExt(e: string): string | null {
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    ico: 'image/x-icon',
  };
  return map[e] ?? null;
}
