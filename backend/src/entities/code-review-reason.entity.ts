import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { CodeReviewAction, CodeReviewType } from '../common/enums';

@Entity('code_review_reasons')
@Index(['clientId', 'locationId', 'codeType', 'action', 'text'], { unique: true })
@Index(['clientId', 'locationId', 'codeType', 'action', 'isActive'])
export class CodeReviewReason {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'client_id', type: 'bigint' }) clientId: number;
  @Column({ name: 'location_id', type: 'bigint' }) locationId: number;

  @Column({ name: 'code_type', type: 'varchar', length: 16 })
  codeType: CodeReviewType;

  @Column({ type: 'varchar', length: 8 })
  action: CodeReviewAction;

  @Column({ type: 'varchar', length: 255 }) text: string;

  @Column({ name: 'display_order', type: 'int', default: 0 }) displayOrder: number;
  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
