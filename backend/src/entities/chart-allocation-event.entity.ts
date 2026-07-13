import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Chart } from './chart.entity';
import { User } from './user.entity';

/**
 * Append-only audit trail of coder/auditor allocation changes. Written on EVERY
 * allocation path (detail save, bulk modify, worklist allocate, self-allocate,
 * audit reallocation) so a chart's ownership history — who it moved FROM/TO, who
 * did it, and how — is always reconstructable. Unlike `chart_allocations` (which
 * only some paths populate and which dashboards read for counts), this table is
 * the single source of truth for "who reallocated what, when, and how".
 */
@Entity('chart_allocation_events')
export class ChartAllocationEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'chart_id', type: 'bigint' }) @Index() chartId: number;
  @ManyToOne(() => Chart) @JoinColumn({ name: 'chart_id' }) chart: Chart;

  @Column({ type: 'varchar', length: 16 }) role: 'CODER' | 'AUDITOR';

  /** Previous holder of the slot (null = was unassigned). */
  @Column({ name: 'from_user_id', type: 'bigint', nullable: true }) fromUserId?: number | null;
  @ManyToOne(() => User) @JoinColumn({ name: 'from_user_id' }) fromUser?: User;

  /** New holder of the slot (null = cleared). */
  @Column({ name: 'to_user_id', type: 'bigint', nullable: true }) toUserId?: number | null;
  @ManyToOne(() => User) @JoinColumn({ name: 'to_user_id' }) toUser?: User;

  /** Who performed the change (null = system / unknown actor). */
  @Column({ name: 'changed_by_id', type: 'bigint', nullable: true }) @Index() changedById?: number | null;
  @ManyToOne(() => User) @JoinColumn({ name: 'changed_by_id' }) changedBy?: User;

  /** How the change happened: DETAIL_SAVE, BULK_ALLOCATE_CODING, … (see AllocationSource). */
  @Column({ type: 'varchar', length: 40 }) source: string;

  /** Chart state captured at the moment of the change (for context). */
  @Column({ type: 'varchar', length: 40, nullable: true }) milestone?: string | null;
  @Column({ name: 'chart_status', type: 'varchar', length: 16, nullable: true }) chartStatus?: string | null;
  @Column({ name: 'worklist_id', type: 'bigint', nullable: true }) worklistId?: number | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) @Index() createdAt: Date;
}
