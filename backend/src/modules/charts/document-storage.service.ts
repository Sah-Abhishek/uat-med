import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import * as path from 'path';

export interface StoredDocument {
  key: string;
  url: string;
  bucket: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Persists uploaded clinical documents to the project's S3-compatible store
 * (MinIO at https://s3uat.icdcore.com in dev). Files are written with a
 * public-read ACL so the chart-detail viewer can iframe them directly via
 * `${endpoint}/${bucket}/${key}`.
 */
@Injectable()
export class DocumentStorageService {
  private readonly log = new Logger(DocumentStorageService.name);
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
      this.log.warn('S3 storage not configured — document uploads will fail.');
      this.client = null;
      return;
    }

    this.client = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      // forcePathStyle is required for MinIO and most non-AWS S3 backends —
      // without it the SDK rewrites the URL to bucket-as-subdomain.
      forcePathStyle: true,
    });
  }

  /**
   * Upload one file. Returns the public URL so callers can persist it on the
   * chart record and the frontend can preview the document inline.
   */
  async upload(file: { buffer: Buffer; originalname: string; mimetype: string; size: number }, chartId: string | number): Promise<StoredDocument> {
    if (!this.client) {
      throw new ServiceUnavailableException('Document storage (S3/MinIO) is not configured.');
    }
    const key = this.buildKey(chartId, file.originalname);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
          ACL: 'public-read',
          Metadata: {
            'original-filename': file.originalname,
            'chart-id': String(chartId),
          },
        }),
      );
    } catch (err) {
      const e = err as Error;
      this.log.error(`S3 upload failed for ${file.originalname}: ${e.message}`);
      throw new ServiceUnavailableException(`Failed to store document: ${e.message}`);
    }

    const url = `${this.endpoint}/${this.bucket}/${key}`;
    this.log.log(`Stored ${file.originalname} → ${key}`);
    return {
      key,
      url,
      bucket: this.bucket,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };
  }

  /**
   * Fetch a previously-uploaded file as a Buffer. Used by the bulk AI-trigger
   * flow to re-send already-stored documents to the gateway without forcing
   * the team lead to re-upload them.
   */
  async download(key: string): Promise<Buffer> {
    if (!this.client) {
      throw new ServiceUnavailableException('Document storage (S3/MinIO) is not configured.');
    }
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
    if (!body?.transformToByteArray) {
      throw new ServiceUnavailableException(`Could not stream S3 object ${key}.`);
    }
    const bytes = await body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async uploadMany(
    files: Array<{ buffer: Buffer; originalname: string; mimetype: string; size: number }>,
    chartId: string | number,
  ): Promise<StoredDocument[]> {
    // Sequential upload — keeps log output ordered and avoids overwhelming
    // the MinIO endpoint when a chart has many documents. Latency is fine
    // because the AI pipeline that follows takes 30–90s anyway.
    const out: StoredDocument[] = [];
    for (const f of files) {
      out.push(await this.upload(f, chartId));
    }
    return out;
  }

  /**
   * Object key layout: clinical_documents/<chartId>/<timestamp>_<safeName>
   * Mirrors the reference med-ex-b layout so existing tooling still works.
   */
  private buildKey(chartId: string | number, originalFilename: string): string {
    const ext = path.extname(originalFilename);
    const base = path.basename(originalFilename, ext).replace(/[^a-zA-Z0-9]/g, '_');
    const ts = Date.now();
    return `clinical_documents/${chartId}/${ts}_${base}${ext}`;
  }
}
