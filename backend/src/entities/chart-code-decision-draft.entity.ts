import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Chart } from './chart.entity';
import { User } from './user.entity';

/**
 * In-progress (pre-submission) Review & Edit board state, autosaved by the
 * modal so a page refresh / crash / device switch doesn't lose the coder's
 * accept/reject/edit/add work.
 *
 * One row per (chart, user). `payload` is an opaque, *versioned* JSON blob
 * owned by the frontend (see CodeDecisionDraftPayload in frontend
 * src/api/charts.ts) — the backend never interprets it beyond a size sanity
 * check, so the draft shape can evolve without a migration. Drafts are
 * scratch state, NOT audit data: they are deleted in the same transaction
 * that persists the final submit, and each user only ever sees their own.
 */
@Entity('chart_code_decision_drafts')
@Index(['chartId', 'userId'], { unique: true })
export class ChartCodeDecisionDraft {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'chart_id', type: 'bigint' }) @Index() chartId: number;
  @ManyToOne(() => Chart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chart_id' })
  chart: Chart;

  @Column({ name: 'user_id', type: 'bigint' }) userId: number;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'jsonb' }) payload: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
