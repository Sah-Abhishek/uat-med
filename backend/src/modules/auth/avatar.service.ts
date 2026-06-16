import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Captures a user's real Microsoft profile photo at SSO login.
 *
 * The Microsoft access token sent to /auth/sso/exchange carries the delegated
 * `User.Read` scope (already consented at login), so we can call Microsoft
 * Graph `/me/photo/$value` directly — no app-only permission, admin consent, or
 * client secret needed. The photo is stored in the same MinIO/S3 bucket as
 * clinical documents, with a public-read ACL, so the frontend can load it via a
 * plain `<img src>` (matching how uploaded documents are served).
 *
 * Everything here is best-effort: any failure (no photo, Graph error, storage
 * off) returns null and the caller keeps the user's existing avatar / initials.
 */
@Injectable()
export class AvatarService {
  private readonly log = new Logger(AvatarService.name);
  private readonly client: S3Client | null;
  private readonly endpoint: string;
  private readonly bucket: string;

  constructor(cfg: ConfigService) {
    this.endpoint = (cfg.get<string>('S3_ENDPOINT_URL') ?? '').replace(/\/$/, '');
    this.bucket = cfg.get<string>('S3_BUCKET_NAME') ?? '';
    const accessKey = cfg.get<string>('S3_ACCESS_KEY') ?? '';
    const secretKey = cfg.get<string>('S3_SECRET_KEY') ?? '';
    const region = cfg.get<string>('S3_REGION') ?? 'us-east-1';
    if (!this.endpoint || !this.bucket || !accessKey || !secretKey) {
      this.log.warn('S3 storage not configured — Microsoft avatars will not be captured.');
      this.client = null;
      return;
    }
    this.client = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      forcePathStyle: true,
    });
  }

  /**
   * Fetch the signed-in user's Graph photo with their own access token, store
   * it, and return a cache-busting public URL — or null if there's nothing to
   * store. Never throws.
   */
  async captureFromGraph(userId: number | string, msAccessToken: string): Promise<string | null> {
    if (!this.client || !msAccessToken) return null;

    let body: Buffer;
    let contentType = 'image/jpeg';
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
        headers: { Authorization: `Bearer ${msAccessToken}` },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      // 404 = the user simply has no photo set; not an error worth logging.
      if (res.status === 404) return null;
      if (!res.ok) {
        this.log.warn(`Graph photo fetch returned ${res.status} for user ${userId}.`);
        return null;
      }
      contentType = res.headers.get('content-type') || 'image/jpeg';
      body = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      this.log.warn(`Graph photo fetch failed for user ${userId}: ${(err as Error).message}`);
      return null;
    }
    if (!body.length) return null;

    // Stored under the clinical_documents/ prefix because that's the only path
    // the MinIO bucket serves publicly (per-object public-read ACLs aren't
    // honored elsewhere) — lets the frontend load avatars via a plain <img>.
    const key = `clinical_documents/avatars/${userId}.jpg`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ACL: 'public-read',
          CacheControl: 'public, max-age=86400',
        }),
      );
    } catch (err) {
      this.log.warn(`Avatar upload failed for user ${userId}: ${(err as Error).message}`);
      return null;
    }

    // ?v= busts the browser cache when the photo is re-captured on a later login.
    return `${this.endpoint}/${this.bucket}/${key}?v=${Date.now()}`;
  }
}
