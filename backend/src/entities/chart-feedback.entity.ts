import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Chart } from './chart.entity';
import { User } from './user.entity';

@Entity('chart_feedback')
export class ChartFeedback {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'chart_id', type: 'bigint' }) @Index() chartId: number;
  @ManyToOne(() => Chart, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chart_id' })
  chart: Chart;

  @Column({ name: 'auditor_id', type: 'bigint' }) auditorId: number;
  @ManyToOne(() => User) @JoinColumn({ name: 'auditor_id' }) auditor: User;

  @Column({ name: 'category_id', type: 'bigint', nullable: true }) categoryId?: number;
  @Column({ name: 'feedback_type_id', type: 'bigint', nullable: true }) feedbackTypeId?: number;

  @Column({ name: 'feedback_status', type: 'varchar', length: 40 })
  feedbackStatus: string;

  @Column({ type: 'varchar', length: 2000, nullable: true }) comments?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
