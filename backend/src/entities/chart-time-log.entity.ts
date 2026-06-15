import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Chart } from './chart.entity';
import { User } from './user.entity';

export type ChartTimerKind = 'CODING' | 'AUDIT';

/**
 * Coder/auditor work-timer sessions. Each row is one start→stop interval a
 * user spent reviewing a chart.
 *
 * Persisting these (instead of the old in-memory Map) means a running timer
 * SURVIVES a backend restart — activeTimer() restores the still-open session —
 * and the elapsed time per session is durably stored for productivity/QA
 * reporting. A row with `stoppedAt = null` is currently running; `elapsedMs`
 * is filled in when the session stops.
 *
 * The partial unique index `UQ_chart_time_logs_open_per_user` enforces, at the
 * DB level, that a user has at most one open (running) session at a time — the
 * single-active-chart rule the service also checks in code for a friendly 409.
 */
@Entity('chart_time_logs')
export class ChartTimeLog {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'chart_id', type: 'bigint' }) @Index() chartId: number;
  @ManyToOne(() => Chart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chart_id' })
  chart: Chart;

  @Column({ name: 'user_id', type: 'bigint' }) @Index() userId: number;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  /** Capacity the session was opened in, derived from the chart milestone. */
  @Column({ type: 'text', default: 'CODING' }) kind: ChartTimerKind;

  @Column({ name: 'started_at', type: 'timestamptz' }) startedAt: Date;

  /** Null while the timer is running; set when stopped. */
  @Column({ name: 'stopped_at', type: 'timestamptz', nullable: true })
  stoppedAt: Date | null;

  /** Wall-clock duration of this session in milliseconds; written together
   * with stoppedAt. bigint so a forgotten, long-running session can't overflow. */
  @Column({ name: 'elapsed_ms', type: 'bigint', nullable: true })
  elapsedMs: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
