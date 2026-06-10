import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ReportType =
  | 'HP'
  | 'DISCHARGE_SUMMARY'
  | 'OPERATIVE_NOTE'
  | 'LAB'
  | 'RADIOLOGY'
  | 'ED_NOTE'
  | 'CLINIC_NOTE'
  | 'PATHOLOGY';

export interface InboundFile {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  reportType: ReportType;
}

export interface EncounterChartInfo {
  mrn?: string;
  facility?: string;
  department?: string;
  /** YYYY-MM-DD or any parseable date string. */
  encounterDate?: string;
  /**
   * Primary speciality name (from the chart's worklist). Forwarded to the
   * gateway as `primary_speciality` so it can layer speciality-tuned coding
   * knowledge (RAG) onto the pipeline. Optional & additive: an empty/unknown
   * value just runs the normal flow. See encounter_primary_speciality_change.md.
   */
  primarySpeciality?: string;
  /**
   * Service line name (global lookup picked at upload). DEFERRED: the gateway
   * doesn't accept this field yet, so it's threaded through but NOT sent — see
   * the marked hook in startEncounter(). The value is persisted on the chart
   * regardless; forwarding is a one-line change once the gateway is ready.
   */
  serviceLine?: string;
}

export interface PredictedCode {
  code: string;
  description: string;
  confidence?: number;
  codeType?: 'primary' | 'secondary' | 'procedure' | 'cpt' | string;
  sequencePos?: number;
  justification?: string;
}

export interface UploadedDocument {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  /** S3/MinIO object key — needed to re-download (reprocess) or delete the doc.
   *  Optional for backwards-compat with docs persisted before this was stored. */
  key?: string;
  reportType: ReportType;
  reportId?: string;
}

export interface AiCodingTip {
  tip: string;
  relatedCode?: string;
  potentialImpact?: string;
}

export interface AiComplianceAlert {
  alert: string;
  severity?: string;
  regulation?: string;
  recommendedAction?: string;
}

export interface AiDocumentationGap {
  gap: string;
  impact?: string;
  priority?: string;
  suggestion?: string;
}

export interface AiPhysicianQuery {
  query: string;
  reason?: string;
  priority?: string;
  impactOnCoding?: string;
}

export interface AiEncounterResult {
  encounterId: string;
  reportIds: string[];
  status: string;
  reportCount: number;
  codes: PredictedCode[];
  primary: PredictedCode[];
  secondary: PredictedCode[];
  procedures: PredictedCode[];
  clinicalSummary?: Record<string, unknown>;
  auditNotes?: string;
  pipelineTiming?: Record<string, unknown>;
  uploadedDocs: UploadedDocument[];
  // Surfaced from final_codes_json.agent4_full.feedback so the chart-detail
  // sidebar can render coding tips, compliance alerts, gaps, and queries
  // without the FE having to dig through the raw gateway response.
  codingTips?: AiCodingTip[];
  complianceAlerts?: AiComplianceAlert[];
  documentationGaps?: AiDocumentationGap[];
  physicianQueries?: AiPhysicianQuery[];
}

export interface EncounterStartResult {
  encounterId: string;
  taskId: string;
  reportIds: string[];
}

export type EncounterRunStatus = 'PENDING' | 'STARTED' | 'SUCCESS' | 'FAILURE';

export interface EncounterStatus {
  status: EncounterRunStatus;
  error?: string;
}

/**
 * Talks to the ICD Predictor Gateway over HTTPS.
 *
 * Implements the multi-document Encounter flow described in
 * ICD_Predictor_Postman_Guide.pdf §B as three independent steps so the
 * caller can move polling out of a long-held HTTP request:
 *   startEncounter()    → B1 POST /api/encounters
 *                         B2 POST /api/upload/batch
 *                         B3 POST /api/encounters/{id}/run
 *   getEncounterStatus()→ B4 GET  /api/encounters/{id}/status/{task_id}
 *   finalizeEncounter() → B5 GET  /api/encounters/{id}
 *
 * Each call is sub-second, so reverse proxies can no longer 504 us out.
 */
@Injectable()
export class AiPredictorService {
  private readonly log = new Logger(AiPredictorService.name);

  private readonly baseUrl: string;
  private readonly token: string;
  private readonly encounterType: string;

  constructor(cfg: ConfigService) {
    this.baseUrl = (cfg.get<string>('ICD_PREDICTOR_BASE_URL') ?? '').replace(/\/$/, '');
    this.token = cfg.get<string>('ICD_PREDICTOR_TOKEN') ?? '';
    this.encounterType = cfg.get<string>('ICD_PREDICTOR_ENCOUNTER_TYPE') ?? 'OUTPATIENT';
  }

  async startEncounter(files: InboundFile[], chart: EncounterChartInfo): Promise<EncounterStartResult> {
    if (!this.baseUrl || !this.token) {
      throw new ServiceUnavailableException('ICD Predictor gateway is not configured.');
    }
    if (!files.length) {
      throw new ServiceUnavailableException('No files supplied to AI pipeline.');
    }

    // ── B1: create encounter ─────────────────────────────
    const encounterBody: Record<string, string> = {
      mrn: chart.mrn?.trim() || '00000000',
      encounter_type: this.encounterType,
    };
    const encDate = this.normalizeDate(chart.encounterDate);
    if (encDate) encounterBody.encounter_date = encDate;
    if (chart.facility?.trim()) encounterBody.facility = chart.facility.trim();
    if (chart.department?.trim()) encounterBody.department = chart.department.trim();
    // Primary speciality (exact key `primary_speciality` — British spelling,
    // snake_case). Optional & additive; the gateway routes speciality RAG off it.
    if (chart.primarySpeciality?.trim()) encounterBody.primary_speciality = chart.primarySpeciality.trim();
    // ── DEFERRED: service line forwarding ──────────────────
    // The ICD gateway does not accept a service_line field yet. The chart
    // already stores it (charts.service_line_id); when the gateway adds support,
    // uncomment the line below — no other change is needed.
    // if (chart.serviceLine?.trim()) encounterBody.service_line = chart.serviceLine.trim();

    this.log.log(`[B1] create encounter (mrn=${encounterBody.mrn}, files=${files.length})`);
    const encounter = await this.postJson<{ id?: string; encounter_id?: string }>('/api/encounters', encounterBody);
    const encounterId = encounter.id ?? encounter.encounter_id;
    if (!encounterId) throw new ServiceUnavailableException('ICD gateway did not return an encounter id.');
    this.log.log(`[B1] encounter ${encounterId} created`);

    // ── B2: batch upload ─────────────────────────────────
    const fd = new FormData();
    for (const f of files) {
      // Copy into a fresh ArrayBuffer so the TS Blob signature is satisfied —
      // Node's Buffer type uses ArrayBufferLike which doesn't widen to the
      // strict ArrayBuffer that lib.dom.d.ts's BlobPart expects.
      const ab = new ArrayBuffer(f.buffer.byteLength);
      new Uint8Array(ab).set(f.buffer);
      fd.append('files', new Blob([ab], { type: f.mimeType }), f.filename);
    }
    fd.append('encounter_type', this.encounterType);
    fd.append('encounter_id', encounterId);
    fd.append('report_types', files.map((f) => f.reportType).join(','));

    this.log.log(`[B2] batch upload ${files.length} file(s) to encounter ${encounterId}`);
    const batch = await this.postForm<{
      saved?: number;
      failed?: number;
      results?: Array<{ success: boolean; report_id?: string; filename?: string }>;
    }>('/api/upload/batch', fd);
    if (!batch.saved) throw new ServiceUnavailableException('All files failed to upload to ICD gateway.');
    const reportIds = (batch.results ?? []).filter((r) => r.success && r.report_id).map((r) => r.report_id!);
    this.log.log(`[B2] saved=${batch.saved} failed=${batch.failed ?? 0}`);

    // ── B3: trigger pipeline ────────────────────────────
    this.log.log(`[B3] trigger pipeline for ${encounterId}`);
    const run = await this.postJson<{ task_id?: string }>(`/api/encounters/${encounterId}/run`, {});
    const taskId = run.task_id;
    if (!taskId) throw new ServiceUnavailableException('ICD gateway did not return a task id.');

    return { encounterId, taskId, reportIds };
  }

  async getEncounterStatus(encounterId: string, taskId: string): Promise<EncounterStatus> {
    if (!this.baseUrl || !this.token) {
      throw new ServiceUnavailableException('ICD Predictor gateway is not configured.');
    }
    const data = await this.getJson<{ status?: string; error?: string; detail?: string }>(
      `/api/encounters/${encounterId}/status/${taskId}`,
    );
    const raw = String(data.status ?? '').toUpperCase();
    if (raw === 'SUCCESS' || raw === 'COMPLETE') return { status: 'SUCCESS' };
    if (raw === 'FAILURE' || raw === 'ERROR') {
      return { status: 'FAILURE', error: data.error ?? data.detail ?? 'unknown' };
    }
    if (raw === 'STARTED') return { status: 'STARTED' };
    return { status: 'PENDING' };
  }

  async finalizeEncounter(
    encounterId: string,
    reportIds: string[],
    fileCount: number,
  ): Promise<AiEncounterResult> {
    if (!this.baseUrl || !this.token) {
      throw new ServiceUnavailableException('ICD Predictor gateway is not configured.');
    }

    this.log.log(`[B5] fetch encounter ${encounterId}`);
    const final = await this.getJson<{
      id?: string;
      status?: string;
      report_count?: number;
      clinical_summary?: Record<string, unknown>;
      final_codes_json?: {
        codes?: any[];
        audit_notes?: string;
        agent4_full?: {
          audit_notes?: string;
          feedback?: {
            coding_tips?: any[];
            compliance_alerts?: any[];
            documentation_gaps?: any[];
            physician_queries_needed?: any[];
          };
        };
      };
      pipeline_timing?: Record<string, unknown>;
    }>(`/api/encounters/${encounterId}`);

    const rawCodes = final.final_codes_json?.codes ?? [];
    const codes = rawCodes.map<PredictedCode>((c) => ({
      code: c.code ?? c.icd_code ?? '',
      description: c.description ?? '',
      confidence: typeof c.confidence === 'number' ? c.confidence : undefined,
      codeType: c.code_type,
      sequencePos: typeof c.sequence_pos === 'number' ? c.sequence_pos : undefined,
      justification: c.justification ?? c.evidence_json?.justification ?? '',
    }));

    const bySeq = (a: PredictedCode, b: PredictedCode) => (a.sequencePos ?? 0) - (b.sequencePos ?? 0);
    const primary = codes.filter((c) => c.codeType === 'primary').sort(bySeq);
    const procedures = codes.filter((c) => c.codeType === 'procedure' || c.codeType === 'cpt').sort(bySeq);
    const secondary = codes
      .filter((c) => c.codeType !== 'primary' && c.codeType !== 'procedure' && c.codeType !== 'cpt')
      .sort(bySeq);

    const agent4 = final.final_codes_json?.agent4_full;
    const fb = agent4?.feedback;
    const codingTips = pickCodingTips(fb?.coding_tips);
    const complianceAlerts = pickComplianceAlerts(fb?.compliance_alerts);
    const documentationGaps = pickDocumentationGaps(fb?.documentation_gaps);
    const physicianQueries = pickPhysicianQueries(fb?.physician_queries_needed);

    return {
      encounterId,
      reportIds,
      status: final.status ?? 'COMPLETE',
      reportCount: final.report_count ?? fileCount,
      codes,
      primary,
      secondary,
      procedures,
      clinicalSummary: final.clinical_summary,
      // Prefer agent4_full's audit_notes (the more detailed narrative); fall
      // back to the top-level field for older gateway versions.
      auditNotes: agent4?.audit_notes ?? final.final_codes_json?.audit_notes,
      pipelineTiming: final.pipeline_timing,
      codingTips,
      complianceAlerts,
      documentationGaps,
      physicianQueries,
      // Filled in by the caller (charts.service) after S3 upload — the
      // predictor itself doesn't see the storage URLs.
      uploadedDocs: [],
    };
  }

  /**
   * Map a documentType + filename hint to the report_type vocabulary the ICD
   * gateway accepts. Falls back to CLINIC_NOTE.
   */
  mapReportType(documentType: string | undefined, filename = ''): ReportType {
    const map: Record<string, ReportType> = {
      hp: 'HP',
      'history-physical': 'HP',
      discharge: 'DISCHARGE_SUMMARY',
      'discharge-summary': 'DISCHARGE_SUMMARY',
      operative: 'OPERATIVE_NOTE',
      'operative-note': 'OPERATIVE_NOTE',
      lab: 'LAB',
      laboratory: 'LAB',
      radiology: 'RADIOLOGY',
      imaging: 'RADIOLOGY',
      'ed-note': 'ED_NOTE',
      emergency: 'ED_NOTE',
      'clinic-note': 'CLINIC_NOTE',
      'clinical-text': 'CLINIC_NOTE',
      pathology: 'PATHOLOGY',
    };
    const k = (documentType ?? '').toLowerCase().trim();
    if (map[k]) return map[k];

    const fn = filename.toLowerCase();
    if (fn.includes('h&p') || fn.includes(' hp ') || fn.includes('history')) return 'HP';
    if (fn.includes('operative') || fn.includes('op note') || fn.includes('_op')) return 'OPERATIVE_NOTE';
    if (fn.includes('discharge')) return 'DISCHARGE_SUMMARY';
    if (fn.includes('emergency') || fn.includes('ed note')) return 'ED_NOTE';
    if (fn.includes('lab')) return 'LAB';
    if (fn.includes('radiology') || fn.includes('imaging')) return 'RADIOLOGY';
    if (fn.includes('pathology')) return 'PATHOLOGY';
    return 'CLINIC_NOTE';
  }

  // ── HTTP helpers ──────────────────────────────────────

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private async getJson<T>(path: string): Promise<T> {
    return this.request<T>(path, { method: 'GET' });
  }

  private async postForm<T>(path: string, form: FormData): Promise<T> {
    // fetch sets the multipart Content-Type with boundary automatically.
    return this.request<T>(path, { method: 'POST', body: form });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(init.headers ?? {});
    headers.set('Authorization', `Bearer ${this.token}`);

    // Cap each gateway call so a hung TCP connection can't lock up the
    // background watcher tick or hold a request thread indefinitely.
    // Uploads (POST /api/upload/batch) need more headroom than reads.
    const isUpload = path.includes('/upload/');
    const timeoutMs = isUpload ? 120_000 : 30_000;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetch(url, { ...init, headers, signal: ctrl.signal });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        throw new ServiceUnavailableException(
          `ICD gateway ${init.method} ${path} timed out after ${timeoutMs}ms`,
        );
      }
      throw new ServiceUnavailableException(
        `ICD gateway ${init.method} ${path} network error: ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(t);
    }

    const text = await res.text();
    if (!res.ok) {
      this.log.error(`ICD gateway ${init.method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
      throw new ServiceUnavailableException(
        `ICD gateway ${init.method} ${path} failed (${res.status}): ${text.slice(0, 200)}`,
      );
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ServiceUnavailableException(`ICD gateway returned non-JSON for ${path}`);
    }
  }

  private normalizeDate(raw?: string): string | undefined {
    if (!raw) return undefined;
    const s = raw.trim();
    if (!s) return undefined;
    const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
    if (iso) return iso[1];
    const us = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    if (us) return `${us[3]}-${us[1]}-${us[2]}`;
    return undefined;
  }

}

/* ── agent4_full feedback shaping ────────────────────────── */

function objectsOf(arr: unknown): Record<string, unknown>[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null);
}

function str(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s ? s : undefined;
}

function pickCodingTips(raw: unknown): AiCodingTip[] | undefined {
  const items = objectsOf(raw)
    .map<AiCodingTip>((t) => ({
      tip: str(t.tip ?? t.description) ?? '',
      relatedCode: str(t.related_code ?? t.relatedCode),
      potentialImpact: str(t.potential_impact ?? t.potentialImpact),
    }))
    .filter((t) => t.tip);
  return items.length ? items : undefined;
}

function pickComplianceAlerts(raw: unknown): AiComplianceAlert[] | undefined {
  const items = objectsOf(raw)
    .map<AiComplianceAlert>((a) => ({
      alert: str(a.alert ?? a.description) ?? '',
      severity: str(a.severity),
      regulation: str(a.regulation),
      recommendedAction: str(a.recommended_action ?? a.recommendedAction),
    }))
    .filter((a) => a.alert);
  return items.length ? items : undefined;
}

function pickDocumentationGaps(raw: unknown): AiDocumentationGap[] | undefined {
  const items = objectsOf(raw)
    .map<AiDocumentationGap>((g) => ({
      gap: str(g.gap ?? g.description) ?? '',
      impact: str(g.impact),
      priority: str(g.priority),
      suggestion: str(g.suggestion ?? g.recommendation),
    }))
    .filter((g) => g.gap);
  return items.length ? items : undefined;
}

function pickPhysicianQueries(raw: unknown): AiPhysicianQuery[] | undefined {
  const items = objectsOf(raw)
    .map<AiPhysicianQuery>((q) => ({
      query: str(q.query ?? q.description) ?? '',
      reason: str(q.reason),
      priority: str(q.priority),
      impactOnCoding: str(q.impact_on_coding ?? q.impactOnCoding ?? q.coding_impact),
    }))
    .filter((q) => q.query);
  return items.length ? items : undefined;
}
