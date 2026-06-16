import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export interface ActiveWorkItem {
  sessionId: number;
  userId: number;
  userName: string | null;
  userRole: string | null;
  avatarUrl: string | null;
  chartId: number;
  chartNo: string | null;
  serialNo: number | null;
  milestone: string | null;
  worklistId: number | null;
  worklistNumber: string | null;
  clientName: string | null;
  locationName: string | null;
  kind: 'CODING' | 'AUDIT';
  startedAt: string;
  /** Live elapsed since the timer started (ms). */
  elapsedMs: number;
}

/**
 * "Live Activity" for admins — which charts are being worked on RIGHT NOW.
 * Sourced from open (stopped_at IS NULL) chart_time_logs sessions, so it
 * reflects coders/auditors with a running timer this instant, enriched with
 * who, which chart, and which worklist/client/location.
 */
@Injectable()
export class AdminActiveWorkService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async listActiveWork() {
    const rows = await this.ds.query(`
      SELECT
        t.id          AS "sessionId",
        t.user_id     AS "userId",
        u.full_name   AS "userName",
        u.role        AS "userRole",
        u.avatar_url  AS "avatarUrl",
        t.chart_id    AS "chartId",
        c.chart_no    AS "chartNo",
        c.serial_no   AS "serialNo",
        c.milestone   AS "milestone",
        t.kind        AS "kind",
        t.started_at  AS "startedAt",
        EXTRACT(EPOCH FROM (now() - t.started_at)) * 1000 AS "elapsedMs",
        w.id              AS "worklistId",
        w.worklist_number AS "worklistNumber",
        cl.name           AS "clientName",
        loc.name          AS "locationName"
      FROM chart_time_logs t
      JOIN users     u   ON u.id  = t.user_id
      JOIN charts    c   ON c.id  = t.chart_id
      LEFT JOIN worklists w   ON w.id   = c.worklist_id
      LEFT JOIN clients   cl  ON cl.id  = w.client_id
      LEFT JOIN locations loc ON loc.id = w.location_id
      WHERE t.stopped_at IS NULL
      ORDER BY t.started_at ASC
    `);

    const items: ActiveWorkItem[] = rows.map((r: any) => ({
      sessionId: Number(r.sessionId),
      userId: Number(r.userId),
      userName: r.userName ?? null,
      userRole: r.userRole ?? null,
      avatarUrl: r.avatarUrl ?? null,
      chartId: Number(r.chartId),
      chartNo: r.chartNo ?? null,
      serialNo: r.serialNo != null ? Number(r.serialNo) : null,
      milestone: r.milestone ?? null,
      worklistId: r.worklistId != null ? Number(r.worklistId) : null,
      worklistNumber: r.worklistNumber ?? null,
      clientName: r.clientName ?? null,
      locationName: r.locationName ?? null,
      kind: r.kind,
      startedAt: r.startedAt,
      elapsedMs: Math.round(Number(r.elapsedMs ?? 0)),
    }));

    return {
      items,
      total: items.length,
      distinctUsers: new Set(items.map((i) => i.userId)).size,
      distinctCharts: new Set(items.map((i) => i.chartId)).size,
    };
  }
}
