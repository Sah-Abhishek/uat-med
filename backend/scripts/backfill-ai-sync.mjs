#!/usr/bin/env node
/**
 * Backfill: forward previously-submitted chart_code_decisions to the AI gateway.
 *
 * WHY THIS EXISTS
 * ---------------
 * Code decisions are written locally (source of truth) and then best-effort
 * forwarded to the AI gateway (Qdrant golden dataset). Forwarding was failing
 * silently for a long window (gateway returning 502 "Gateway proxy error", and
 * earlier the DEPLOYMENT gate defaulting to "uat"), so ~1k decisions never
 * reached the AI. This script replays those un-forwarded decisions.
 *
 * It mirrors ChartsService.forwardToAiGateway exactly:
 *   ACCEPTED -> ACCEPT, REJECTED -> DELETE, EDITED -> EDIT, ADDED -> ADD
 * and persists the outcome back onto each local row: gateway_synced_at for
 * every successfully-forwarded row, plus gateway_correction_id for the
 * EDIT/DELETE/ADD rows that return one.
 *
 * SAFETY
 * ------
 *  - Only touches rows where gateway_synced_at IS NULL (never forwarded).
 *  - PREFLIGHT: probes the gateway corrections backend; ABORTS if it 502s
 *    (i.e. the same outage that caused this backlog) so we never hammer a
 *    broken endpoint.
 *  - DRY RUN by default. Pass --commit to actually POST to the gateway and
 *    write the sync markers back to Postgres.
 *  - Idempotent: ACCEPT produces no correction_id on the gateway (audit only),
 *    but we now stamp gateway_synced_at on success, so once an ACCEPT row is
 *    forwarded it won't be re-selected on a re-run. (Legacy ACCEPT rows that
 *    the live app forwarded before gateway_synced_at existed have a NULL
 *    timestamp, so the first backfill re-sends them once — harmless audit
 *    duplicate — and stamps them so later runs skip them.)
 *
 * USAGE
 *   node scripts/backfill-ai-sync.mjs              # dry run (no writes)
 *   node scripts/backfill-ai-sync.mjs --commit     # live
 *   node scripts/backfill-ai-sync.mjs --commit --limit-groups=5   # throttle
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMIT = process.argv.includes('--commit');
const limitArg = process.argv.find((a) => a.startsWith('--limit-groups='));
const LIMIT_GROUPS = limitArg ? Number(limitArg.split('=')[1]) : Infinity;

/* ── minimal .env loader (env/.env.production) ───────────────── */
function loadEnv() {
  const file = path.resolve(__dirname, '../env/.env.production');
  const out = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const env = loadEnv();
const BASE = (env.ICD_PREDICTOR_BASE_URL || '').replace(/\/$/, '');
const TOKEN = env.ICD_PREDICTOR_TOKEN || '';

/* ── mapping helpers (copied verbatim from charts.service.ts) ── */
function mapCodeType(t) {
  switch (t) {
    case 'PRIMARY':   return 'primary';
    case 'SECONDARY': return 'secondary';
    case 'PROCEDURE': return 'procedure';
    case 'EM_LEVEL':  return 'cpt';
    case 'MODIFIER':  return 'cpt';
    default:          return 'primary';
  }
}
function composeReason(dropdown, text) {
  const d = (dropdown ?? '').trim();
  const t = (text ?? '').trim();
  if (d && t) return `${d}: ${t}`;
  return d || t || undefined;
}
// `enrich` resolves a usable predicted_code_id (+ the gateway's own code_type)
// for a row whose stored predicted_code_id is missing or stale, by matching the
// gateway's CURRENT predicted codes for the encounter. Mirrors the live app's
// enrichment (charts.service.ts). Returns {id, type} or null.
function resolvePred(row, gwCodes, validIds) {
  // 1) stored id still valid on the gateway → keep it.
  if (row.predicted_code_id && validIds.has(row.predicted_code_id)) {
    return { id: row.predicted_code_id, type: mapCodeType(row.code_type) };
  }
  if (!gwCodes) return null;
  // 2) exact (gateway-type | code) match.
  const wantType = mapCodeType(row.code_type);
  const exact = gwCodes.find((c) => c.code_type === wantType && c.icd_code === row.code_value);
  if (exact) return { id: exact.id, type: exact.code_type };
  // 3) fall back to code-only match IF unambiguous (handles PROCEDURE↔cpt etc).
  const byVal = gwCodes.filter((c) => c.icd_code === row.code_value);
  if (byVal.length === 1) return { id: byVal[0].id, type: byVal[0].code_type };
  return null;
}

function buildAction(row, pred) {
  const reason = composeReason(row.reason_dropdown, row.reason_text);
  switch (row.decision) {
    case 'ACCEPTED':
      if (!pred) return null;
      return { action: 'ACCEPT', predicted_code_id: pred.id };
    case 'REJECTED':
      if (!pred) return null;
      return { action: 'DELETE', predicted_code_id: pred.id, code_type: pred.type, reason };
    case 'EDITED':
      if (!pred) return null;
      return {
        action: 'EDIT',
        predicted_code_id: pred.id,
        correct_code: (row.edited_code ?? row.code_value).trim(),
        correct_description: row.edited_description?.trim(),
        code_type: pred.type,
        reason,
      };
    case 'ADDED':
      return {
        action: 'ADD',
        correct_code: (row.edited_code ?? row.code_value).trim(),
        correct_description: row.edited_description?.trim(),
        code_type: mapCodeType(row.code_type),
        reason,
      };
    default:
      return null;
  }
}

/* ── gateway calls ───────────────────────────────────────────── */
async function gw(method, p, body) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = text; }
  return { status: res.status, ok: res.ok, json };
}

async function main() {
  if (!BASE || !TOKEN) {
    console.error('FATAL: ICD_PREDICTOR_BASE_URL / ICD_PREDICTOR_TOKEN missing from env/.env.production');
    process.exit(1);
  }
  console.log(`\n▶ AI-sync backfill  (${COMMIT ? 'LIVE / --commit' : 'DRY RUN'})`);
  console.log(`  gateway: ${BASE}\n`);

  /* PREFLIGHT — corrections backend must be healthy. In LIVE mode we abort if
   * it is down (so we never hammer a broken endpoint). In DRY RUN we only warn,
   * since no gateway writes happen and we still want to validate grouping. */
  const pre = await gw('GET', '/admin/corrections?limit=1').catch((e) => ({ status: 0, ok: false, json: String(e) }));
  if (!pre.ok) {
    const msg = `PREFLIGHT: GET /admin/corrections → ${pre.status} ${JSON.stringify(pre.json)}`;
    if (COMMIT) {
      console.error(`✖ ${msg}`);
      console.error('  The gateway corrections/submit backend is down (this is the outage that');
      console.error('  caused the backlog). Aborting so we do not hammer a broken endpoint.');
      console.error('  Re-run this script once the gateway returns 200 here.\n');
      process.exit(2);
    }
    console.warn(`⚠ ${msg}\n  (dry run — continuing to validate grouping; LIVE would abort here)\n`);
  } else {
    console.log('✓ preflight ok — gateway corrections backend is reachable\n');
  }

  const client = new pg.Client({
    host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USERNAME,
    password: env.DB_PASSWORD, database: env.DB_NAME,
    ssl: env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });
  await client.connect();

  // Pull every un-forwarded decision whose chart has an encounter and whose
  // coder is ACTIVE with a gateway public_id (the live forward's preconditions).
  const { rows } = await client.query(`
    SELECT d.id, d.chart_id, d.code_type, d.code_value, d.predicted_code_id,
           d.decision, d.edited_code, d.edited_description,
           d.reason_dropdown, d.reason_text,
           u.public_id AS coder_id,
           c.custom_fields->'aiPrediction'->>'encounterId' AS encounter_id
    FROM chart_code_decisions d
    JOIN users  u ON u.id = d.decided_by_user_id
    JOIN charts c ON c.id = d.chart_id
    WHERE d.gateway_synced_at IS NULL
      -- gateway_synced_at (not correction_id) is the "was forwarded" guard, so
      -- ACCEPT rows are included and stay idempotent: once forwarded we stamp
      -- the timestamp and they drop out of this set on the next run.
      AND u.status = 'ACTIVE'
      AND u.public_id IS NOT NULL
      AND c.custom_fields->'aiPrediction'->>'encounterId' IS NOT NULL
    ORDER BY d.chart_id, u.public_id, d.id
  `);

  // Group by (encounterId, coderId) — one submit call per group, like the app.
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.encounter_id}::${r.coder_id}`;
    if (!groups.has(key)) groups.set(key, { encounterId: r.encounter_id, coderId: r.coder_id, rows: [] });
    groups.get(key).rows.push(r);
  }
  console.log(`  ${rows.length} un-forwarded decisions across ${groups.size} (encounter, coder) groups\n`);

  let processed = 0, ok = 0, failed = 0, idsWritten = 0;
  for (const g of groups.values()) {
    if (processed >= LIMIT_GROUPS) { console.log(`  (stopped at --limit-groups=${LIMIT_GROUPS})`); break; }
    processed++;

    // Re-enrichment: fetch the gateway's CURRENT predicted codes for this
    // encounter once, so rows whose stored predicted_code_id is missing/stale
    // can be remapped by code (matches the live app's behaviour).
    let gwCodes = null, validIds = new Set();
    try {
      const cr = await gw('GET', `/api/review/encounter/${encodeURIComponent(g.encounterId)}/codes`);
      if (cr.ok && Array.isArray(cr.json)) {
        gwCodes = cr.json;
        validIds = new Set(gwCodes.map((c) => c.id));
      }
    } catch { /* leave gwCodes null → only rows with a valid stored id forward */ }

    const actions = [];
    const rowIds = []; // parallel to actions; gateway returns results in order
    const skipped = [];
    for (const r of g.rows) {
      const pred = r.decision === 'ADDED' ? {} : resolvePred(r, gwCodes, validIds);
      const a = buildAction(r, pred);
      if (!a) { skipped.push(r.id); continue; }
      actions.push(a); rowIds.push(r.id);
    }
    if (!actions.length) {
      if (skipped.length) console.log(`  - ${g.encounterId.slice(0,8)}… : ${skipped.length} rows unresolvable (no gateway code match) — ids ${skipped.join(',')}`);
      continue;
    }

    const label = `enc=${g.encounterId.slice(0, 8)}… coder=${g.coderId.slice(0, 8)}… (${actions.length} actions)`;
    if (!COMMIT) {
      console.log(`  [dry] would POST ${label}`);
      ok++; continue;
    }

    try {
      const res = await gw('POST', `/api/review/encounter/${encodeURIComponent(g.encounterId)}/submit`, {
        coder_id: g.coderId, actions,
      });
      if (!res.ok) { failed++; console.log(`  ✖ ${label} → ${res.status} ${JSON.stringify(res.json)}`); continue; }
      const results = Array.isArray(res.json?.results) ? res.json.results : [];
      for (let i = 0; i < results.length; i++) {
        const rowId = rowIds[i];
        if (rowId == null) continue;
        if (results[i]?.success === false) continue; // gateway rejected this action
        const cid = results[i]?.correction_id ?? null;
        // Stamp synced for every accepted action (ACCEPT has no correction_id);
        // additionally store the correction_id when the gateway returned one.
        await client.query(
          'UPDATE chart_code_decisions SET gateway_synced_at = now(), gateway_correction_id = COALESCE($1, gateway_correction_id) WHERE id = $2',
          [cid, rowId],
        );
        idsWritten++;
      }
      ok++;
      console.log(`  ✓ ${label} → written=${res.json?.corrections_written ?? '?'} qdrantFail=${res.json?.qdrant_sync_failures ?? '?'}`);
    } catch (e) {
      failed++; console.log(`  ✖ ${label} → ${e}`);
    }
  }

  await client.end();
  console.log(`\n── summary ──`);
  console.log(`  groups processed : ${processed}`);
  console.log(`  groups ok        : ${ok}`);
  console.log(`  groups failed    : ${failed}`);
  console.log(`  correction_ids written back: ${idsWritten}`);
  if (!COMMIT) console.log(`\n  DRY RUN — no data sent. Re-run with --commit to apply.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
