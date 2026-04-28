import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { ChartMilestone, ChartStatus, Priority } from '../common/enums';
import { Worklist } from './worklist.entity';

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

  @Column({ name: 'chart_status', type: 'varchar', length: 16, default: ChartStatus.OPEN }) @Index()
  chartStatus: ChartStatus;

  @Column({ type: 'varchar', length: 16, default: Priority.MEDIUM }) @Index()
  priority: Priority;

  @Column({ name: 'allocated_coder_id', type: 'bigint', nullable: true }) @Index() allocatedCoderId?: number;
  @Column({ name: 'allocated_auditor_id', type: 'bigint', nullable: true }) @Index() allocatedAuditorId?: number;
  @Column({ name: 'original_coder_id', type: 'bigint', nullable: true }) originalCoderId?: number;
  @Column({ name: 'original_auditor_id', type: 'bigint', nullable: true }) originalAuditorId?: number;

  @Column({ name: 'primary_diagnosis', type: 'varchar', length: 16, nullable: true }) primaryDiagnosis?: string;
  @Column({ name: 'secondary_diagnoses', type: 'jsonb', nullable: true }) secondaryDiagnoses?: string[];
  @Column({ type: 'jsonb', nullable: true }) procedures?: Array<{ code: string; modifier?: string }>;
  @Column({ name: 'em_level', type: 'varchar', length: 8, nullable: true }) emLevel?: string;
  @Column({ name: 'drg_value', type: 'numeric', precision: 12, scale: 2, nullable: true }) drgValue?: number;

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
}
