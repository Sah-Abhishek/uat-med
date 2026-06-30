import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CodeAuditVerdict, CodeReviewType } from '../common/enums';
import { Chart } from './chart.entity';
import { ChartCodeDecision } from './chart-code-decision.entity';
import { User } from './user.entity';

/**
 * An auditor's per-code judgment of a coder's submitted decision. Layered on
 * top of `chart_code_decisions` — the coder's decisions are never mutated by
 * an audit, so the AI prediction, the coder edit and the audit verdict can all
 * be shown together in the Review & Edit modal. One audit per (chart, codeType,
 * codeValue); the submit upserts on that key (last write wins), mirroring
 * `chart_code_decisions`.
 */
@Entity('chart_code_audits')
@Index(['chartId', 'codeType', 'codeValue'], { unique: true })
@Index(['chartId', 'codeType'])
export class ChartCodeAudit {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'chart_id', type: 'bigint' }) @Index() chartId: number;
  @ManyToOne(() => Chart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chart_id' })
  chart: Chart;

  /** The coder decision row this audit judges. Informational linkage — the
   * denormalized codeType/codeValue below drive lookup and display, so this
   * stays nullable (e.g. legacy rows) and is not relied on for matching. */
  @Column({ name: 'chart_code_decision_id', type: 'bigint', nullable: true })
  chartCodeDecisionId?: number | null;
  @ManyToOne(() => ChartCodeDecision, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'chart_code_decision_id' })
  chartCodeDecision?: ChartCodeDecision | null;

  @Column({ name: 'code_type', type: 'varchar', length: 16 })
  codeType: CodeReviewType;

  /** The coder's final code value (their editedCode when edited/added, else the
   * original codeValue). What the auditor is judging. */
  @Column({ name: 'code_value', type: 'varchar', length: 32 }) codeValue: string;

  @Column({ name: 'verdict', type: 'varchar', length: 16 })
  verdict: CodeAuditVerdict;

  /** Selected feedback category — required on DISAGREE. Stored as a string (not
   * a FK) so editing/deleting a category in Settings doesn't break historical
   * audits, same rationale as chart_code_decisions.reason_dropdown. */
  @Column({ name: 'feedback_category', type: 'varchar', length: 255, nullable: true })
  feedbackCategory?: string | null;

  /** Free-text note — required (≥20 chars) on DISAGREE. */
  @Column({ name: 'feedback_text', type: 'varchar', length: 2000, nullable: true })
  feedbackText?: string | null;

  @Column({ name: 'audited_by_user_id', type: 'bigint' }) auditedByUserId: number;
  @ManyToOne(() => User) @JoinColumn({ name: 'audited_by_user_id' }) auditedBy: User;

  @Column({ name: 'audited_at', type: 'timestamptz' }) auditedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
