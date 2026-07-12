import { Role } from '../../common/enums/roles.enum';

/**
 * Faithful implementation of the User Manual's role-specific chart-priority
 * buckets (§4.3 Coder, §4.4 Auditor, §4.5 Manager/Team-Lead), the Done bucket
 * (§4.6) and the Finalized bucket (§4.7).
 *
 * Priority is NOT stored — it is computed on read from four inputs:
 *   Milestone × Chart Status × QC Status × Received-Date (today vs not),
 * evaluated against the viewing user's role.
 *
 * Two shapes are emitted from the same matrix:
 *   • priorityBucketSql(role)   — a single scalar ('CRITICAL'|'HIGH'|'MEDIUM'
 *     |'LOW'|NULL) giving the chart's *highest* bucket, used for the row chip
 *     and the priority sort (a row shows one chip / sorts at one rank).
 *   • bucketMembershipSql(role, bucket) — a boolean asking "does this chart
 *     belong to THIS bucket?", used by the tab filter and the tab counts. Per
 *     the manual, a chart may legitimately belong to two buckets at once
 *     (Auditor Medium+Low, Manager High+Medium); membership honours that, so a
 *     chart can surface under — and be counted in — both tabs.
 *
 * CRITICAL is never a computed condition — it is the manual override
 * (`manual_priority_at IS NOT NULL` → the stored `priority`), which also carries
 * a manager's Modify-Charts HIGH/MEDIUM/LOW choice until the allocated user
 * touches the chart (§7.3, handled in ChartsService). While a chart is manually
 * pinned it belongs ONLY to its pinned bucket; otherwise it belongs to every
 * computed bucket it satisfies (unless the role's exclusion rule hides it).
 *
 * All values below are compile-time code constants (enum strings), never user
 * input, so inlining them into SQL is safe.
 */

type Aliases = { chart?: string; worklist?: string };
export type ComputedBucket = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

// Sentinel inside a QC value list meaning "Blank" (QC not set): the persisted
// JSON is either absent (NULL) or the empty string.
const BLANK = '__BLANK__';

// All "today" boundaries use India business time (IST): the server, the users,
// and the imported `received_date` are all India-based, and the rest of the app
// (the dashboard "today") uses server-local midnight. The manual text says EST,
// but that is a US template — using EST dropped India's "today" charts out of
// the LOW/DONE buckets every morning until ~09:30 IST. (Product decision
// 2026-07-08: keep IST.)
const IST = `'Asia/Kolkata'`;

/** The DB's calendar "today" in India business time (IST). */
export function businessTodaySql(): string {
  return `(now() AT TIME ZONE ${IST})::date`;
}

/** Received on the current India-time (IST) day. */
function receivedToday(w: string): string {
  return `${w}.received_date = ${businessTodaySql()}`;
}

/** Received on any day other than today (a NULL received-date counts as "not
 * today" so it can still qualify for the "Not Today" buckets). */
function receivedNotToday(w: string): string {
  return `(${w}.received_date IS NULL OR ${w}.received_date <> ${businessTodaySql()})`;
}

// QC status is persisted by the chart-detail form under custom_fields._formDraft
// (coder in `qcStatus`, auditor in `auditorQcStatus`). The User Manual models a
// SINGLE "QC Status" per chart that different roles change to different values
// ("Only 'Feedback Provided'/'Agree' are available to the Auditor to change,
// whilst 'Feedback Implemented'/'Feedback Rejected' are available to the Coder").
// We keep the two role fields but pick the *effective* value as the one whose
// role changed it MOST RECENTLY (ChartsService.update() stamps `qcStatusAt` /
// `auditorQcStatusAt`): the coder's response supersedes the auditor's "Feedback
// Provided", and the auditor's later "Agree" supersedes in turn.
function coderQc(c: string): string {
  return `${c}.custom_fields#>>'{_formDraft,qcStatus}'`;
}
function auditorQc(c: string): string {
  return `${c}.custom_fields#>>'{_formDraft,auditorQcStatus}'`;
}
function coderQcAt(c: string): string {
  return `${c}.custom_fields#>>'{_formDraft,qcStatusAt}'`;
}
function auditorQcAt(c: string): string {
  return `${c}.custom_fields#>>'{_formDraft,auditorQcStatusAt}'`;
}
export function effectiveQc(c: string): string {
  const coder = `NULLIF(${coderQc(c)}, '')`;
  const auditor = `NULLIF(${auditorQc(c)}, '')`;
  // A missing timestamp sorts as "-infinity" so a newly-stamped value beats an
  // un-stamped legacy one; when neither is stamped we fall back to the previous
  // auditor-over-coder rule (legacy rows carry no timestamps).
  // Parenthesise the #>> extraction before ::timestamptz — the cast binds
  // tighter than #>>, so without parens it wrongly casts the JSON *path* literal.
  const coderAt = `COALESCE((${coderQcAt(c)})::timestamptz, '-infinity')`;
  const auditorAt = `COALESCE((${auditorQcAt(c)})::timestamptz, '-infinity')`;
  return `CASE
    WHEN ${coder} IS NOT NULL AND (${auditor} IS NULL OR ${coderAt} > ${auditorAt}) THEN ${coder}
    ELSE COALESCE(${auditor}, ${coder})
  END`;
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

// --- Milestone / status / QC enum strings (mirror common/enums) ---
const M = {
  READY_TO_ALLOCATE: 'READY_TO_ALLOCATE',
  READY_TO_CODE: 'READY_TO_CODE',
  CODING_IN_PROGRESS: 'CODING_IN_PROGRESS',
  CODING_DONE: 'CODING_DONE',
  READY_TO_AUDIT: 'READY_TO_AUDIT',
  AUDIT_IN_PROGRESS: 'AUDIT_IN_PROGRESS',
  AUDIT_DONE: 'AUDIT_DONE',
  CLOSED: 'CLOSED',
} as const;
const S = { OPEN: 'OPEN', COMPLETE: 'COMPLETE', INCOMPLETE: 'INCOMPLETE' } as const;
const QC = {
  AGREE: 'Agree',
  IMPLEMENTED: 'Feedback Implemented',
  REJECTED: 'Feedback Rejected',
  PROVIDED: 'Feedback Provided',
} as const;

type RoleConds = { high: string; medium: string; low: string; excluded: string };

/**
 * Returns the { high, medium, low } computed conditions plus the role's
 * `excluded` predicate (charts the manual says are never shown to this role in
 * any bucket). Each is a self-contained SQL boolean over the milestone / status
 * / QC / received-date columns. Managers/Team-Leads have no exclusions.
 */
function roleConditions(role: Role, c: string, w: string): RoleConds {
  const ms = (vals: string[]) => inList(`${c}.milestone`, vals);
  const cs = (vals: string[]) => inList(`${c}.chart_status`, vals);
  const qc = effectiveQc(c);

  switch (role) {
    // §4.3 Coder. (Visibility to the coder's own allocation is enforced in
    // ChartsService; audit-stage milestones never appear in these buckets.)
    case Role.CODER:
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
          receivedNotToday(w),
        ),
        low: and(
          ms([M.READY_TO_CODE, M.CODING_IN_PROGRESS]),
          cs([S.OPEN]),
          qcIn(qc, [BLANK]),
          receivedToday(w),
        ),
        // Coding Done + Complete + QC (Implemented/Agree/Blank) → never shown.
        excluded: and(
          ms([M.CODING_DONE]),
          cs([S.COMPLETE]),
          qcIn(qc, [QC.IMPLEMENTED, QC.AGREE, BLANK]),
        ),
      };

    // §4.4 Auditor. Auditors see all charts regardless of allocation.
    case Role.AUDITOR:
      return {
        high: and(
          ms([M.READY_TO_CODE, M.READY_TO_AUDIT, M.AUDIT_DONE, M.CODING_DONE, M.AUDIT_IN_PROGRESS]),
          cs([S.INCOMPLETE, S.COMPLETE]),
          qcIn(qc, [QC.IMPLEMENTED, QC.REJECTED, QC.PROVIDED]),
        ),
        medium: and(
          ms([M.READY_TO_AUDIT, M.AUDIT_IN_PROGRESS]),
          cs([S.INCOMPLETE, S.COMPLETE]),
          qcIn(qc, [BLANK]),
        ),
        low: and(
          ms([M.CODING_DONE, M.AUDIT_DONE, M.AUDIT_IN_PROGRESS]),
          cs([S.COMPLETE, S.INCOMPLETE]),
          qcIn(qc, [QC.AGREE, BLANK]),
        ),
        // Ready to Code + any status + QC (Agree/Blank) → never shown.
        excluded: and(
          ms([M.READY_TO_CODE]),
          cs([S.OPEN, S.INCOMPLETE, S.COMPLETE]),
          qcIn(qc, [QC.AGREE, BLANK]),
        ),
      };

    // §4.5 Manager / Team Lead share the matrix. QC is "any" for High/Medium
    // (the manual lists every QC value, so the clause is omitted); Low requires
    // Blank. No exclusions.
    //
    // READY_TO_ALLOCATE is deliberately absent from every bucket here: an
    // unallocated chart (imported, not yet handed to a coder) must not surface in
    // any role's priority backlog — Coder/Auditor already exclude it, so dropping
    // it from the Manager/Team-Lead Medium bucket hides it from all three. It
    // stays reachable via the worklist inventory view and a manual priority pin.
    case Role.MANAGER:
    case Role.TEAMLEAD:
    default:
      return {
        high: and(
          ms([M.READY_TO_CODE, M.CODING_IN_PROGRESS, M.READY_TO_AUDIT, M.AUDIT_IN_PROGRESS]),
          cs([S.OPEN, S.INCOMPLETE, S.COMPLETE]),
        ),
        medium: and(
          ms([
            M.READY_TO_CODE, M.CODING_IN_PROGRESS, M.CODING_DONE,
            M.READY_TO_AUDIT, M.AUDIT_IN_PROGRESS, M.AUDIT_DONE,
          ]),
          cs([S.OPEN, S.INCOMPLETE]),
        ),
        low: and(
          ms([M.READY_TO_CODE, M.CODING_IN_PROGRESS, M.AUDIT_IN_PROGRESS]),
          cs([S.OPEN]),
          qcIn(qc, [BLANK]),
          receivedToday(w),
        ),
        excluded: 'FALSE',
      };
  }
}

/**
 * A single SQL scalar expression giving the chart's *highest* priority bucket
 * for `role` ('CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW') or NULL when it matches no
 * bucket (→ hidden from that role's backlog). Used for the row chip and sort.
 * Requires the charts table aliased (default `c`) and its worklist joined
 * (default `worklist`).
 */
export function priorityBucketSql(role: Role, aliases: Aliases = {}): string {
  const c = aliases.chart ?? 'c';
  const w = aliases.worklist ?? 'worklist';
  const { high, medium, low, excluded } = roleConditions(role, c, w);
  return `CASE
    WHEN ${c}.manual_priority_at IS NOT NULL THEN ${c}.priority
    WHEN ${excluded} THEN NULL
    WHEN ${high} THEN 'HIGH'
    WHEN ${medium} THEN 'MEDIUM'
    WHEN ${low} THEN 'LOW'
    ELSE NULL
  END`;
}

/**
 * Boolean: does the chart belong to `bucket` for `role`? Unlike the scalar
 * above, this honours the manual's legitimate two-bucket overlap — a chart with
 * no manual pin belongs to EVERY computed bucket it satisfies. A manually
 * pinned chart (§7.3) belongs only to its pinned bucket. Used by the tab filter
 * and the per-bucket tab counts.
 *
 * A chart the viewer has finished-and-timed TODAY lives in the Done bucket
 * (§4.6) for that day and must NOT double up in an active priority tab — the
 * classic case is a Coding-Done + Incomplete chart, which the Coder Medium rule
 * still matches (so it can resurface in Medium the NEXT day) but which is "done"
 * today. So the COMPUTED branch also requires `NOT doneSql`: the chart shows only
 * under Done today, then falls back to its computed bucket once it's no longer
 * timed-today. A manual pin (CRITICAL / an explicit override) is deliberately
 * exempt — an explicit override wins over Done. Binds `:doneViewerId`.
 */
export function bucketMembershipSql(role: Role, bucket: ComputedBucket, aliases: Aliases = {}): string {
  const c = aliases.chart ?? 'c';
  const w = aliases.worklist ?? 'worklist';
  const pinned = `${c}.manual_priority_at IS NOT NULL`;
  if (bucket === 'CRITICAL') {
    // CRITICAL is only ever a manual pin.
    return `(${pinned} AND ${c}.priority = 'CRITICAL')`;
  }
  const { high, medium, low, excluded } = roleConditions(role, c, w);
  const cond = bucket === 'HIGH' ? high : bucket === 'MEDIUM' ? medium : low;
  return `(CASE
    WHEN ${pinned} THEN ${c}.priority = '${bucket}'
    ELSE (NOT (${excluded}) AND ${cond} AND NOT (${doneSql(role, aliases)}))
  END)`;
}

/** Numeric rank of a chart's highest bucket for ORDER BY (CRITICAL first). */
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
 * §4.7 Finalized bucket (Managers only): the chart has reached Coding Done or
 * Audit Done AND is Complete — fully done, no further work from anyone.
 * Requires the charts table aliased (default `c`).
 */
export function finalizedSql(aliases: Aliases = {}): string {
  const c = aliases.chart ?? 'c';
  return `(${inList(`${c}.milestone`, [M.CODING_DONE, M.AUDIT_DONE])} AND ${c}.chart_status = '${S.COMPLETE}')`;
}

/**
 * "Coding finished": the chart has reached Coding Done or any later
 * (audit-stage / closed) milestone — i.e. the coder's own work on it is over.
 *
 * These charts match no *active* CODER priority bucket (a freshly-finished chart
 * is Coding Done + Complete/Incomplete with a blank QC → the buckets return
 * NULL), so the backlog's `bucket IS NOT NULL` visibility test would hide them
 * entirely; the coder's only other surface, the "Done" tab (§4.6), lists just
 * charts they *timed today*, leaving older completed work unreachable. Callers
 * OR this into the coder's ALL-view visibility so a coder keeps seeing their own
 * completed charts. It deliberately carries no bucket, so the priority sort
 * ranks these charts last (rank 4) — below every piece of active work.
 * Requires the charts table aliased (default `c`).
 */
export function codingFinishedSql(aliases: Aliases = {}): string {
  const c = aliases.chart ?? 'c';
  return inList(`${c}.milestone`, [
    M.CODING_DONE,
    M.READY_TO_AUDIT,
    M.AUDIT_IN_PROGRESS,
    M.AUDIT_DONE,
    M.CLOSED,
  ]);
}

/**
 * §4.6 Done bucket (product override 2026-07-11): the viewer started a timer on
 * this chart during the current India-time (IST) day AND the chart has reached a
 * FINISHED milestone for their role — Coding Done or later for a Coder, Audit Done
 * or later for an Auditor. A chart still in progress (or reallocated back to a
 * "ready"/in-progress state) is NOT Done even if it was timed today. Team-leads /
 * managers act as coders here, so the coding-finished chain (Coding Done onward,
 * which already covers Audit Done / Closed) applies to them too.
 *
 * NOTE: this replaces the manual's original §4.6 rule ("timed today AND not back
 * in the ready milestone", which counted in-progress charts as Done).
 * Bind `:doneViewerId` to the viewer's user id.
 */
export function doneSql(role: Role, aliases: Aliases = {}): string {
  const c = aliases.chart ?? 'c';
  const doneMs =
    role === Role.AUDITOR
      ? [M.AUDIT_DONE, M.CLOSED]
      : /* CODER + MANAGER/TEAMLEAD (act in the coder capacity) */
        [M.CODING_DONE, M.READY_TO_AUDIT, M.AUDIT_IN_PROGRESS, M.AUDIT_DONE, M.CLOSED];
  return `(${touchedTodaySql(aliases)} AND ${c}.milestone IN (${doneMs.map((m) => `'${m}'`).join(', ')}))`;
}

/**
 * "Touched today": the viewer started a timer on this chart during the current
 * India-time (IST) day. Bind `:doneViewerId` to the viewer's user id.
 * Requires the charts table aliased (default `c`).
 */
export function touchedTodaySql(aliases: Aliases = {}): string {
  const c = aliases.chart ?? 'c';
  return `EXISTS (
    SELECT 1 FROM chart_time_logs t
    WHERE t.chart_id = ${c}.id
      AND t.user_id = :doneViewerId
      AND (t.started_at AT TIME ZONE ${IST})::date = ${businessTodaySql()}
  )`;
}
