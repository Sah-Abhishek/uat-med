import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { ChartMilestone, ChartStatus, Priority } from '../common/enums';
import { Worklist } from './worklist.entity';
import { ServiceLine } from './service-line.entity';

@Entity('charts')
@Unique(['worklistId', 'serialNo'])
@Index(['milestone', 'chartStatus'])
export class Chart {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'worklist_id', type: 'bigint' }) @Index() worklistId: number;

  @ManyToOne(() => Worklist, w => w.charts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'worklist_id' })
  worklist: Worklist;

  @Column({ name: 'serial_no', type: 'int' }) serialNo: number;

  @Column({ name: 'chart_no', type: 'varchar', length: 64, nullable: true }) @Index() chartNo?: string;
  @Column({ name: 'mr_number', type: 'varchar', length: 64, nullable: true }) @Index() mrNumber?: string;

  @Column({ type: 'date', nullable: true }) dos?: string;
  @Column({ name: 'admit_date', type: 'date', nullable: true }) admitDate?: string;
  @Column({ name: 'discharge_date', type: 'date', nullable: true }) dischargeDate?: string;

  @Column({ type: 'varchar', length: 40, default: ChartMilestone.READY_TO_ALLOCATE }) @Index()
  milestone: ChartMilestone;

  // Stamped only when `milestone` actually changes (via setMilestone). Distinct
  // from `updated_at`, which is touched by any save (priority bumps, AI prediction
  // writes, allocation churn) and therefore can't be used to answer "what
  // transitioned today?".
  @Column({ name: 'milestone_changed_at', type: 'timestamptz', nullable: true })
  milestoneChangedAt?: Date | null;

  @Column({ name: 'chart_status', type: 'varchar', length: 16, default: ChartStatus.OPEN }) @Index()
  chartStatus: ChartStatus;

  @Column({ name: 'chart_status_changed_at', type: 'timestamptz', nullable: true })
  chartStatusChangedAt?: Date | null;

  // Stamped when the chart's coding is finished — i.e. `milestone` reaches
  // CODING_DONE (via setMilestone). Unlike `milestoneChangedAt` (overwritten on
  // every later transition to audit/closed), this preserves the coding-completed
  // date so it can be filtered on. Re-stamped if a reworked chart is coded again.
  @Column({ name: 'coding_completed_at', type: 'timestamptz', nullable: true })
  @Index()
  codingCompletedAt?: Date | null;

  @Column({ type: 'varchar', length: 16, default: Priority.MEDIUM }) @Index()
  priority: Priority;

  @Column({ name: 'allocated_coder_id', type: 'bigint', nullable: true }) @Index() allocatedCoderId?: number;
  @Column({ name: 'allocated_auditor_id', type: 'bigint', nullable: true }) @Index() allocatedAuditorId?: number;
  @Column({ name: 'original_coder_id', type: 'bigint', nullable: true }) originalCoderId?: number;
  @Column({ name: 'original_auditor_id', type: 'bigint', nullable: true }) originalAuditorId?: number;

  // Timestamp of the MOST RECENT coder (re)allocation — re-stamped every time a
  // coder is assigned via any path (worklist allocate, bulk-modify, self-take).
  // Drives the auto priority buckets: allocated today → LOW, aged past today
  // without coding progress → MEDIUM (see ChartPriorityService). Distinct from
  // the response-only `coderAllocatedAt`, which is the FIRST allocation and is
  // derived from chart_allocations for the "Date of Coder Allocation" column.
  @Column({ name: 'last_coder_allocated_at', type: 'timestamptz', nullable: true }) @Index()
  lastCoderAllocatedAt?: Date | null;

  @Column({ name: 'primary_diagnosis', type: 'varchar', length: 16, nullable: true }) primaryDiagnosis?: string;
  @Column({ name: 'secondary_diagnoses', type: 'jsonb', nullable: true }) secondaryDiagnoses?: string[];
  @Column({ type: 'jsonb', nullable: true }) procedures?: Array<{ code: string; modifier?: string }>;
  @Column({ name: 'em_level', type: 'text', nullable: true }) emLevel?: string;
  @Column({ name: 'drg_value', type: 'numeric', precision: 12, scale: 2, nullable: true }) drgValue?: number;

  // Service line chosen at document upload (global lookup). Nullable: it's an
  // optional classification, so charts without one are fine. ON DELETE SET NULL
  // (see migration) keeps a chart valid if its service line is ever hard-deleted.
  @Column({ name: 'service_line_id', type: 'bigint', nullable: true }) @Index() serviceLineId?: number | null;

  @ManyToOne(() => ServiceLine, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'service_line_id' })
  serviceLine?: ServiceLine | null;

  @Column({ name: 'hold_reason_id', type: 'bigint', nullable: true }) holdReasonId?: number;
  @Column({ name: 'responsible_party_id', type: 'bigint', nullable: true }) responsiblePartyId?: number;
  @Column({ name: 'primary_health_plan_id', type: 'bigint', nullable: true }) primaryHealthPlanId?: number;

  @Column({ name: 'coder_comments_to_client', type: 'varchar', length: 2000, nullable: true }) coderCommentsToClient?: string;
  @Column({ name: 'rejection_denial_comments', type: 'varchar', length: 2000, nullable: true }) rejectionDenialComments?: string;
  @Column({ name: 'deficiency_comments', type: 'varchar', length: 2000, nullable: true }) deficiencyComments?: string;

  @Column({ name: 'custom_fields', type: 'jsonb', default: () => "'{}'" }) customFields: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' }) deletedAt?: Date;

  /** Mutates `milestone` and stamps `milestoneChangedAt` only on real change. */
  setMilestone(next: ChartMilestone): void {
    if (this.milestone !== next) {
      this.milestone = next;
      this.milestoneChangedAt = new Date();
      // Preserve the coding-completed date the moment coding finishes; keep it
      // stable as the chart advances. Re-stamps on re-completion after rework.
      if (next === ChartMilestone.CODING_DONE) this.codingCompletedAt = new Date();
    }
  }

  /** Mutates `chartStatus` and stamps `chartStatusChangedAt` only on real change. */
  setChartStatus(next: ChartStatus): void {
    if (this.chartStatus !== next) {
      this.chartStatus = next;
      this.chartStatusChangedAt = new Date();
    }
  }

  /**
   * Record a fresh coder (re)allocation: stamp `lastCoderAllocatedAt` and drop
   * the chart into the LOW priority bucket. Elevated/terminal buckets win — a
   * chart already HIGH (has auditor feedback), CRITICAL (manual), or FINALIZED
   * ("Done") keeps its priority. Authoritative rules live in ChartPriorityService.
   */
  markCoderAllocated(when: Date = new Date()): void {
    this.lastCoderAllocatedAt = when;
    if (this.priority === Priority.MEDIUM || this.priority === Priority.LOW) {
      this.priority = Priority.LOW;
    }
  }

  /**
   * Record that an auditor left feedback: move the chart into the HIGH priority
   * bucket unless it's CRITICAL (outranks HIGH) or FINALIZED (terminal).
   */
  markAuditorFeedback(): void {
    if (this.priority !== Priority.CRITICAL && this.priority !== Priority.FINALIZED) {
      this.priority = Priority.HIGH;
    }
  }
}
