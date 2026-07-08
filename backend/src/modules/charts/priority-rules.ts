import { Role } from '../../common/enums/roles.enum';

/**
 * Faithful implementation of the User Manual's role-specific chart-priority
 * buckets (§4.3 Coder, §4.4 Auditor, §4.5 Manager/Team-Lead).
 *
 * Priority is NOT stored — it is computed on read from four inputs:
 *   Milestone × Chart Status × QC Status × Received-Date (today vs not),
 * evaluated against the viewing user's role. `priorityBucketSql(role)` returns a
 * single SQL scalar expression yielding the chart's bucket
 * ('CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW') or NULL when the chart matches no
 * bucket for that role (→ hidden from that role, per the manual's "will not
 * view" tables). Everything else — the chip value, the tab filter, the tab
 * counts, and priority sort — derives from this one expression, so the matrix
 * lives in exactly one place.
 *
 * Precedence within a role: CRITICAL > HIGH > MEDIUM > LOW (first match wins).
 * A chart therefore surfaces under exactly one bucket (its highest); the manual
 * tolerates High/Medium overlap for managers, which we resolve to the highest
 * bucket for a clean single-chip / summing-count UX.
 *
 * CRITICAL is never a computed condition — it is the manual override
 * (`manual_priority_at IS NOT NULL` → the stored `priority`), which also carries
 * a manager's Modify-Charts HIGH/MEDIUM/LOW choice until the allocated user
 * touches the chart (§7.3, handled in ChartsService).
 *
 * All values below are compile-time code constants (enum strings), never user
 * input, so inlining them into SQL is safe.
 */

type Aliases = { chart?: string; worklist?: string };

// Sentinel inside a QC value list meaning "Blank" (QC not set): the persisted
// JSON is either absent (NULL) or the empty string.
const BLANK = '__BLANK__';

const EST = `'America/New_York'`;

/** The DB's calendar "today" in Eastern time (the manual's 00:00 EST boundary). */
export function estTodaySql(): string {
  return `(now() AT TIME ZONE ${EST})::date`;
}

function receivedToday(w: string): string {
  return `${w}.received_date = ${estTodaySql()}`;
}

// QC status is persisted by the chart-detail form under custom_fields._formDraft
// (coder in `qcStatus`, auditor in `auditorQcStatus`). The manager view reads
// the latest QC state (auditor's if set, else coder's).
function coderQc(c: string): string {
  return `${c}.custom_fields#>>'{_formDraft,qcStatus}'`;
}
function auditorQc(c: string): string {
  return `${c}.custom_fields#>>'{_formDraft,auditorQcStatus}'`;
}
function effectiveQc(c: string): string {
  return `COALESCE(NULLIF(${auditorQc(c)}, ''), NULLIF(${coderQc(c)}, ''))`;
}

function inList(expr: string, vals: string[]): string {
  return `${expr} IN (${vals.map((v) => `'${v}'`).join(', ')})`;
}

/** Match a QC expression against a set of values; BLANK expands to NULL/''. */
function qcIn(expr: string, vals: string[]): string {
  const concrete = vals.filter((v) => v !== BLANK);
  const parts: string[] = [];
  if (concrete.length) parts.push(inList(expr, concrete));
  if (vals.includes(BLANK)) parts.push(`(${expr} IS NULL OR ${expr} = '')`);
  return `(${parts.join(' OR ')})`;
}

const and = (...cs: string[]): string => `(${cs.join(' AND ')})`;

// --- Milestone / status enum strings (mirror common/enums) ---
const M = {
  READY_TO_ALLOCATE: 'READY_TO_ALLOCATE',
  READY_TO_CODE: 'READY_TO_CODE',
  CODING_IN_PROGRESS: 'CODING_IN_PROGRESS',
  CODING_DONE: 'CODING_DONE',
  READY_TO_AUDIT: 'READY_TO_AUDIT',
  AUDIT_IN_PROGRESS: 'AUDIT_IN_PROGRESS',
  AUDIT_DONE: 'AUDIT_DONE',
} as const;
const S = { OPEN: 'OPEN', COMPLETE: 'COMPLETE', INCOMPLETE: 'INCOMPLETE' } as const;
const QC = {
  AGREE: 'Agree',
  IMPLEMENTED: 'Feedback Implemented',
  REJECTED: 'Feedback Rejected',
  PROVIDED: 'Feedback Provided',
} as const;

/**
 * Returns { high, medium, low } SQL boolean conditions for the given role.
 * Each is a self-contained predicate over the milestone/status/QC/received
 * columns. A missing/"any" QC clause is simply omitted.
 */
function roleConditions(role: Role, c: string, w: string): { high: string; medium: string; low: string } {
  const ms = (vals: string[]) => inList(`${c}.milestone`, vals);
  const cs = (vals: string[]) => inList(`${c}.chart_status`, vals);
  const notToday = `NOT (${receivedToday(w)})`;
  const today = receivedToday(w);

  switch (role) {
    case Role.CODER: {
      const qc = coderQc(c);
      return {
        high: and(
          ms([M.READY_TO_CODE, M.CODING_IN_PROGRESS]),
          cs([S.INCOMPLETE, S.COMPLETE]),
          qcIn(qc, [QC.IMPLEMENTED, QC.REJECTED, QC.PROVIDED, QC.AGREE]),
        ),
        medium: and(
          ms([M.READY_TO_CODE, M.CODING_IN_PROGRESS, M.CODING_DONE]),
          cs([S.OPEN, S.INCOMPLETE]),
          qcIn(qc, [QC.AGREE, BLANK, QC.IMPLEMENTED]),
          notToday,
        ),
        low: and(
          ms([M.READY_TO_CODE, M.CODING_IN_PROGRESS]),
          cs([S.OPEN]),
          qcIn(qc, [BLANK]),
          today,
        ),
      };
    }
    case Role.AUDITOR: {
      const qc = auditorQc(c);
      return {
        high: and(
          ms([M.READY_TO_CODE, M.READY_TO_AUDIT, M.CODING_DONE, M.AUDIT_IN_PROGRESS, M.AUDIT_DONE]),
          cs([S.INCOMPLETE, S.COMPLETE]),
          qcIn(qc, [QC.IMPLEMENTED, QC.REJECTED, QC.PROVIDED]),
        ),
        medium: and(
          ms([M.READY_TO_AUDIT, M.AUDIT_IN_PROGRESS]),
          cs([S.INCOMPLETE, S.COMPLETE]),
          qcIn(qc, [BLANK]),
        ),
        low: and(
          ms([M.CODING_DONE, M.AUDIT_IN_PROGRESS, M.AUDIT_DONE]),
          cs([S.COMPLETE, S.INCOMPLETE]),
          qcIn(qc, [QC.AGREE, BLANK]),
        ),
      };
    }
    // MANAGER and TEAMLEAD share the §4.5 matrix. QC is "any" for High/Medium
    // (clause omitted); Low requires Blank.
    case Role.MANAGER:
    case Role.TEAMLEAD:
    default: {
      const qc = effectiveQc(c);
      return {
        high: and(
          ms([M.READY_TO_CODE, M.CODING_IN_PROGRESS, M.READY_TO_AUDIT, M.AUDIT_IN_PROGRESS]),
          cs([S.OPEN, S.INCOMPLETE, S.COMPLETE]),
        ),
        medium: and(
          ms([
            M.READY_TO_ALLOCATE, M.READY_TO_CODE, M.CODING_IN_PROGRESS, M.CODING_DONE,
            M.READY_TO_AUDIT, M.AUDIT_IN_PROGRESS, M.AUDIT_DONE,
          ]),
          cs([S.OPEN, S.INCOMPLETE]),
        ),
        low: and(
          ms([M.READY_TO_CODE, M.CODING_IN_PROGRESS, M.AUDIT_IN_PROGRESS]),
          cs([S.OPEN]),
          qcIn(qc, [BLANK]),
          today,
        ),
      };
    }
  }
}

/**
 * A single SQL scalar expression giving the chart's priority bucket for `role`
 * ('CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW') or NULL when it matches no bucket.
 * Requires the charts table aliased (default `c`) and its worklist joined
 * (default `worklist`).
 */
export function priorityBucketSql(role: Role, aliases: Aliases = {}): string {
  const c = aliases.chart ?? 'c';
  const w = aliases.worklist ?? 'worklist';
  const { high, medium, low } = roleConditions(role, c, w);
  return `CASE
    WHEN ${c}.manual_priority_at IS NOT NULL THEN ${c}.priority
    WHEN ${high} THEN 'HIGH'
    WHEN ${medium} THEN 'MEDIUM'
    WHEN ${low} THEN 'LOW'
    ELSE NULL
  END`;
}

/** Numeric rank of a chart's bucket for ORDER BY (CRITICAL first, no-bucket last). */
export function priorityRankSql(role: Role, aliases: Aliases = {}): string {
  const bucket = priorityBucketSql(role, aliases);
  return `CASE (${bucket})
    WHEN 'CRITICAL' THEN 0
    WHEN 'HIGH' THEN 1
    WHEN 'MEDIUM' THEN 2
    WHEN 'LOW' THEN 3
    ELSE 4
  END`;
}

/**
 * "Done today" (§4.6): the viewer started a timer on this chart during the
 * current Eastern-time day. Bind `:doneViewerId` to the viewer's user id.
 * Requires the charts table aliased (default `c`).
 */
export function touchedTodaySql(aliases: Aliases = {}): string {
  const c = aliases.chart ?? 'c';
  return `EXISTS (
    SELECT 1 FROM chart_time_logs t
    WHERE t.chart_id = ${c}.id
      AND t.user_id = :doneViewerId
      AND (t.started_at AT TIME ZONE ${EST})::date = ${estTodaySql()}
  )`;
}
