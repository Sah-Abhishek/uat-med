import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Client for the Valerion AI gateway.
 *
 * Auth is a long-lived gateway-issued HS256 JWT (their `JWT_SECRET_KEY`),
 * carried in `ICD_PREDICTOR_TOKEN`. We use the same JWT for every endpoint:
 * upload, encounters, review, rules, billing, /admin/users. Per the gateway
 * doc (golden_dataset_api.pdf §1) the JWT is per-application (one per
 * hospital client), not per-coder — per-user identity is carried in request
 * bodies (`coder_id`, `created_by`) instead of in claims.
 *
 * Base URL is shared with the predictor (ICD_PREDICTOR_BASE_URL) — same
 * gateway, different routes.
 */
@Injectable()
export class AiGatewayClient {
  private readonly log = new Logger(AiGatewayClient.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(cfg: ConfigService) {
    this.baseUrl = (cfg.get<string>('ICD_PREDICTOR_BASE_URL') ?? '').replace(/\/$/, '');
    this.token = cfg.get<string>('ICD_PREDICTOR_TOKEN') ?? '';
  }

  /* ── /admin/users ────────────────────────────────────────── */

  /**
   * Register a coder/auditor/admin with the gateway and get back the UUID we
   * must send as `coder_id` on subsequent submit calls
   * (POST /api/review/{report|encounter}/{id}/submit).
   *
   * The gateway treats `email` as a globally-unique natural key (doc §1.4),
   * so a 409 here means "someone else already claimed this email" — there is
   * no lookup-by-email endpoint, so we surface it loudly rather than silently
   * trying to recover.
   */
  async registerUser(body: RegisterUserRequest): Promise<RegisteredUser> {
    return this.request<RegisteredUser>('POST', '/admin/users', body);
  }

  /* ── /admin/corrections ───────────────────────────────────── */

  /** Fetch one correction by its UUID (doc §5.1). Used by the admin
   * verification page to round-trip-check a locally-stored decision against
   * the golden dataset row the gateway wrote. 404 surfaces as a thrown
   * exception via the shared request() handler. */
  async getCorrection(correctionId: string): Promise<GatewayCorrection> {
    return this.request<GatewayCorrection>(
      'GET',
      `/admin/corrections/${encodeURIComponent(correctionId)}`,
    );
  }

  /** List corrections with optional filters (doc §5.2). Used by the admin
   * chart detail page to bulk-fetch every correction for one encounter in a
   * single round-trip, then join locally instead of N+1-ing through
   * getCorrection() per decision row. */
  async listCorrections(q: ListCorrectionsQuery = {}): Promise<ListCorrectionsResponse> {
    const params = new URLSearchParams();
    if (q.coder_id)     params.set('coder_id', q.coder_id);
    if (q.report_id)    params.set('report_id', q.report_id);
    if (q.encounter_id) params.set('encounter_id', q.encounter_id);
    if (q.action_type)  params.set('action_type', q.action_type);
    if (q.since)        params.set('since', q.since);
    if (q.limit  != null) params.set('limit',  String(q.limit));
    if (q.offset != null) params.set('offset', String(q.offset));
    const qs = params.toString();
    return this.request<ListCorrectionsResponse>(
      'GET',
      `/admin/corrections${qs ? `?${qs}` : ''}`,
    );
  }

  /* ── /api/review/encounter/{id}/codes ─────────────────────── */

  /** Predicted codes WITH the gateway's UUIDs. The `id` per code is the
   * value to pass back as `predicted_code_id` on ACCEPT/EDIT/DELETE.
   *
   * The gateway returns this as a plain top-level array (doc §2.2), not a
   * `{codes: [...]}` envelope — typing it as the raw array avoids the
   * empty-array trap when callers reach for `.codes`. */
  async getEncounterCodes(encounterId: string): Promise<PredictedCodeReviewItem[]> {
    return this.request<PredictedCodeReviewItem[]>(
      'GET',
      `/api/review/encounter/${encodeURIComponent(encounterId)}/codes`,
    );
  }

  /* ── /api/review/encounter/{id}/submit ────────────────────── */

  async submitEncounterReview(
    encounterId: string,
    body: SubmitEncounterReviewRequest,
  ): Promise<SubmitEncounterReviewResponse> {
    return this.request<SubmitEncounterReviewResponse>(
      'POST',
      `/api/review/encounter/${encodeURIComponent(encounterId)}/submit`,
      body,
    );
  }

  /* ── /api/rules ───────────────────────────────────────────── */

  async listRules(q: ListRulesQuery): Promise<ListRulesResponse> {
    const params = new URLSearchParams();
    if (q.priority) params.set('priority', q.priority);
    if (q.applies_to) params.set('applies_to', q.applies_to);
    if (q.include_inactive) params.set('include_inactive', 'true');
    const qs = params.toString();
    return this.request<ListRulesResponse>(
      'GET',
      `/api/rules${qs ? `?${qs}` : ''}`,
    );
  }

  async createRule(body: CreateRuleRequest): Promise<CoderRule> {
    return this.request<CoderRule>('POST', '/api/rules', body);
  }

  async deactivateRule(ruleId: string): Promise<DeactivateRuleResponse> {
    return this.request<DeactivateRuleResponse>(
      'PATCH',
      `/api/rules/${encodeURIComponent(ruleId)}/deactivate`,
    );
  }

  /* ── HTTP plumbing ────────────────────────────────────────── */

  private async request<T>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<T> {
    if (!this.baseUrl || !this.token) {
      throw new ServiceUnavailableException({
        error: { code: 'unavailable', message: 'AI gateway (ICD_PREDICTOR_BASE_URL/TOKEN) is not configured.' },
      });
    }
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30_000);

    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: payload, signal: ctrl.signal });
    } catch (err) {
      const e = err as Error;
      if (e.name === 'AbortError') {
        throw new ServiceUnavailableException({
          error: { code: 'timeout', message: `AI gateway ${method} ${path} timed out.` },
        });
      }
      throw new BadGatewayException({
        error: { code: 'network', message: `AI gateway ${method} ${path} network error: ${e.message}` },
      });
    } finally {
      clearTimeout(t);
    }

    const text = await res.text();
    if (!res.ok) {
      this.log.warn(`AI gateway ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
      // 409 on /admin/users means the email is already taken (doc §1.4).
      // Surface as Conflict so callers can branch on it without inspecting
      // the wrapped BadGateway body.
      if (res.status === 409) {
        throw new ConflictException({
          error: {
            code: 'gateway_conflict',
            message: `AI gateway ${method} ${path} returned 409`,
            body: safeJson(text),
          },
        });
      }
      throw new BadGatewayException({
        error: {
          code: 'ai_gateway_error',
          message: `AI gateway ${method} ${path} failed (${res.status})`,
          status: res.status,
          body: safeJson(text),
        },
      });
    }
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new BadGatewayException({
        error: { code: 'invalid_json', message: `AI gateway returned non-JSON for ${path}` },
      });
    }
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return text; }
}

/* ── Types ─────────────────────────────────────────────────── */

export interface RegisterUserRequest {
  name: string;
  email: string;
  /** Gateway accepts CODER | ADMIN | VIEWER. Their role enum doesn't have an
   * AUDITOR — we register auditors as CODER since the role field is purely
   * informational on the gateway side today (no behavior tied to it). */
  role?: 'CODER' | 'ADMIN' | 'VIEWER';
}

export interface RegisteredUser {
  id: string;
  name: string;
  email: string;
  role: 'CODER' | 'ADMIN' | 'VIEWER';
  active: boolean;
  created_at: string;
}

export interface PredictedCodeReviewItem {
  id: string;                    // UUID — this is predicted_code_id
  icd_code: string;
  description: string;
  confidence: number;
  code_type: string;             // 'primary' | 'secondary' | 'procedure' | 'cpt'
  sequence_pos: number | null;
  evidence_json: Record<string, unknown> | null;
  status: string;
}

export type ReviewActionType = 'ACCEPT' | 'EDIT' | 'DELETE' | 'ADD';

export interface ReviewActionPayload {
  action: ReviewActionType;
  predicted_code_id?: string;
  correct_code?: string;
  correct_description?: string;
  code_type?: 'primary' | 'secondary' | 'procedure' | 'cpt';
  sequence_pos?: number;
  reason?: string;
}

export interface SubmitEncounterReviewRequest {
  coder_id: string;
  actions: ReviewActionPayload[];
}

export interface ListCorrectionsQuery {
  coder_id?: string;
  report_id?: string;
  encounter_id?: string;
  action_type?: 'EDIT' | 'DELETE' | 'ADD';
  since?: string;
  limit?: number;
  offset?: number;
}

export interface ListCorrectionsResponse {
  items: GatewayCorrection[];
  total: number;
  limit: number;
  offset: number;
}

/** Shape of one row in the gateway's `coder_corrections` table (doc §5.1). */
export interface GatewayCorrection {
  id: string;
  report_id: string | null;
  encounter_id: string | null;
  action_type: 'EDIT' | 'DELETE' | 'ADD';
  wrong_code: string | null;
  wrong_code_description: string | null;
  correct_code: string | null;
  correct_description: string | null;
  code_type: string | null;
  sequence_pos: number | null;
  reason: string | null;
  confidence_was: number | null;
  coder_id: string;
  reviewed_at: string;
  ip_hash: string | null;
  synced_to_qdrant: boolean;
}

export interface ReviewActionResult {
  /** Echo of the predicted_code_id from the request. Absent on ADD (the gateway
   * mints a new one) — that's why this is optional. */
  predicted_code_id?: string;
  action: ReviewActionType;
  success: boolean;
  /** Set for EDIT / DELETE / ADD when the gateway wrote a row into
   * `coder_corrections`. The doc §5.1 uses this as the `correction_id` you'd
   * pass to GET /admin/corrections/{id} for verification. ACCEPT actions
   * skip the corrections table (see Appendix A) so this is absent there. */
  correction_id?: string;
  qdrant_synced?: boolean;
}

export interface SubmitEncounterReviewResponse {
  report_id?: string;
  encounter_id?: string;
  total_actions: number;
  accepted: number;
  edited: number;
  deleted: number;
  added: number;
  corrections_written: number;
  qdrant_sync_failures: number;
  results: ReviewActionResult[];
}

export type RulePriority = 'HIGH' | 'NORMAL';
export type RuleAppliesTo = 'ICD-CM' | 'ICD-PCS' | 'CPT' | 'ALL';

export interface ListRulesQuery {
  priority?: RulePriority;
  applies_to?: RuleAppliesTo;
  include_inactive?: boolean;
}

export interface CoderRule {
  id: string;
  rule_text: string;
  applies_to: RuleAppliesTo;
  priority: RulePriority;
  active: boolean;
  created_by: string;
  created_at: string;
  qdrant_synced?: boolean;
}

export interface ListRulesResponse {
  rules: CoderRule[];
  total: number;
  high_count: number;
  normal_count: number;
}

export interface CreateRuleRequest {
  rule_text: string;
  applies_to: RuleAppliesTo;
  priority: RulePriority;
  created_by: string;
}

export interface DeactivateRuleResponse {
  rule_id: string;
  active: boolean;
  qdrant_synced: boolean;
  message: string;
}
