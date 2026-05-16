import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CodeReviewDecision, CodeReviewType } from '../common/enums';
import { Chart } from './chart.entity';
import { User } from './user.entity';

@Entity('chart_code_decisions')
@Index(['chartId', 'codeType', 'codeValue'], { unique: true })
@Index(['chartId', 'codeType'])
export class ChartCodeDecision {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'chart_id', type: 'bigint' }) @Index() chartId: number;
  @ManyToOne(() => Chart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chart_id' })
  chart: Chart;

  @Column({ name: 'code_type', type: 'varchar', length: 16 })
  codeType: CodeReviewType;

  @Column({ name: 'code_value', type: 'varchar', length: 32 }) codeValue: string;

  /** UUID minted by the AI gateway for the AI-predicted code this decision
   * relates to. Optional — older decisions and any ADD-action rows leave it
   * null (ADD has no pre-existing predicted code). */
  @Column({ name: 'predicted_code_id', type: 'varchar', length: 64, nullable: true })
  predictedCodeId?: string;

  /** UUID of the row the gateway wrote into its `coder_corrections` table for
   * this decision. Filled in after a successful forward (matched positionally
   * against the gateway's results[] array). Null for: ACCEPT decisions
   * (gateway doesn't record corrections for ACCEPT, see Appendix A of the
   * golden_dataset_api doc); decisions submitted before this column existed;
   * any row whose forward failed. Use it to round-trip-verify a row via
   * GET /admin/corrections/{id} on the gateway. */
  @Column({ name: 'gateway_correction_id', type: 'uuid', nullable: true })
  @Index({ unique: true, where: '"gateway_correction_id" IS NOT NULL' })
  gatewayCorrectionId?: string | null;

  @Column({ name: 'original_description', type: 'varchar', length: 500, nullable: true })
  originalDescription?: string;

  @Column({ type: 'varchar', length: 16 })
  decision: CodeReviewDecision;

  @Column({ name: 'edited_code', type: 'varchar', length: 32, nullable: true }) editedCode?: string;
  @Column({ name: 'edited_description', type: 'varchar', length: 500, nullable: true }) editedDescription?: string;

  /** Stored as a string (not a FK) so disabling/deleting a reason in
   * Settings does not break historical decisions. */
  @Column({ name: 'reason_dropdown', type: 'varchar', length: 255, nullable: true })
  reasonDropdown?: string;

  @Column({ name: 'reason_text', type: 'varchar', length: 2000, nullable: true })
  reasonText?: string;

  @Column({ name: 'decided_by_user_id', type: 'bigint' }) decidedByUserId: number;
  @ManyToOne(() => User) @JoinColumn({ name: 'decided_by_user_id' }) decidedBy: User;

  @Column({ name: 'decided_at', type: 'timestamptz' }) decidedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
