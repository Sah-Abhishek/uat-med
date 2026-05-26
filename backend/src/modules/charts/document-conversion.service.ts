import { Injectable, Logger, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Minimal shape shared by Multer uploads and the bulk ZIP-entry objects.
 * Using our own interface (rather than Express.Multer.File) keeps this service
 * usable from both the per-chart upload flow and the bulk extractor.
 */
export interface ConvertibleFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const WORD_EXT = /\.(docx?)$/i;
const WORD_MIME = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-word',
]);

/**
 * Converts Microsoft Word documents (.doc / .docx) to PDF before they are
 * stored or forwarded to the ICD Predictor gateway, which only ingests
 * PDF / image / text. Conversion is delegated to a headless LibreOffice
 * (`soffice`) process — the only engine on the box that handles both the
 * legacy binary .doc format and modern .docx with high fidelity.
 *
 * Non-Word files pass through untouched, so callers can hand the whole upload
 * batch to {@link toPdfMany} without pre-filtering.
 */
@Injectable()
export class DocumentConversionService {
  private readonly log = new Logger(DocumentConversionService.name);
  private readonly soffice: string;
  private readonly timeoutMs: number;

  constructor(cfg: ConfigService) {
    // Default to the binary on PATH; overridable for non-standard installs.
    this.soffice = cfg.get<string>('LIBREOFFICE_BIN') ?? 'soffice';
    this.timeoutMs = Number(cfg.get('WORD_TO_PDF_TIMEOUT_MS') ?? 120_000);
  }

  /** True when the file looks like a Word document by MIME type or extension. */
  isWord(filename: string, mimetype?: string): boolean {
    if (mimetype && WORD_MIME.has(mimetype.toLowerCase())) return true;
    return WORD_EXT.test(filename ?? '');
  }

  /**
   * Convert a single file to PDF if it is a Word document; otherwise return it
   * unchanged. The returned object's `originalname` is re-extensioned to `.pdf`
   * and `mimetype` is set to `application/pdf` so downstream storage/preview
   * and the gateway all agree on the format.
   */
  async toPdf(file: ConvertibleFile): Promise<ConvertibleFile> {
    if (!this.isWord(file.originalname, file.mimetype)) return file;

    const pdf = await this.convert(file.buffer, file.originalname);
    const pdfName = file.originalname.replace(WORD_EXT, '') + '.pdf';
    this.log.log(`Converted ${file.originalname} (${file.size}B) → ${pdfName} (${pdf.length}B)`);
    return {
      buffer: pdf,
      originalname: pdfName,
      mimetype: 'application/pdf',
      size: pdf.length,
    };
  }

  /** Convert every Word document in the batch to PDF, preserving order. */
  async toPdfMany(files: ConvertibleFile[]): Promise<ConvertibleFile[]> {
    const out: ConvertibleFile[] = [];
    for (const f of files) {
      out.push(await this.toPdf(f));
    }
    return out;
  }

  /**
   * Run the conversion in an isolated temp dir. Each invocation gets its own
   * LibreOffice user-profile (`-env:UserInstallation`) so concurrent
   * conversions don't deadlock on the shared single-instance profile lock.
   */
  private async convert(buffer: Buffer, originalname: string): Promise<Buffer> {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'word2pdf-'));
    const profile = path.join(work, 'profile');
    // Preserve the original extension so soffice selects the right import
    // filter (.doc → MS Word 97, .docx → Office Open XML).
    const ext = (path.extname(originalname) || '.docx').toLowerCase();
    const inPath = path.join(work, `source${ext}`);
    const outPath = path.join(work, 'source.pdf');

    try {
      await fs.writeFile(inPath, buffer);
      await this.runSoffice(profile, work, inPath);
      const pdf = await fs.readFile(outPath);
      if (!pdf.length) {
        throw new Error('LibreOffice produced an empty PDF');
      }
      return pdf;
    } catch (err) {
      const e = err as Error;
      this.log.error(`Word→PDF conversion failed for ${originalname}: ${e.message}`);
      throw new UnprocessableEntityException({
        error: {
          code: 'word_conversion_failed',
          message: `Could not convert "${originalname}" to PDF. Please upload a PDF instead.`,
        },
      });
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private runSoffice(profileDir: string, outDir: string, inPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const args = [
        '--headless',
        '--norestore',
        '--invisible',
        '--nologo',
        `-env:UserInstallation=file://${profileDir}`,
        '--convert-to',
        'pdf:writer_pdf_Export',
        '--outdir',
        outDir,
        inPath,
      ];
      const child = spawn(this.soffice, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr?.on('data', (d) => {
        stderr += d.toString();
      });

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`conversion timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      child.on('error', (err) => {
        clearTimeout(timer);
        // ENOENT here means the soffice binary is missing on the host.
        reject(err);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`soffice exited ${code}: ${stderr.trim() || 'no stderr'}`));
      });
    });
  }
}
