import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { HccValidate } from '../common/enums';
import { User } from './user.entity';

@Entity('hcc_records')
@Index(['coderId', 'dos'])
export class HccRecord {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'member_id', type: 'varchar', length: 64 }) @Index() memberId: string;
  @Column({ name: 'member_name', type: 'varchar', length: 255 }) memberName: string;
  @Column({ name: 'medicare_no', type: 'varchar', length: 64, nullable: true }) medicareNo?: string;
  @Column({ type: 'date', nullable: true }) dob?: string;

  @Column({ name: 'coder_id', type: 'bigint', nullable: true }) coderId?: number;
  @ManyToOne(() => User, { nullable: true }) @JoinColumn({ name: 'coder_id' }) coder?: User;

  @Column({ type: 'varchar', length: 64, nullable: true }) payor?: string;
  @Column({ type: 'date', nullable: true }) @Index() dos?: string;
  @Column({ name: 'review_date', type: 'date', nullable: true }) reviewDate?: string;
  @Column({ name: 'received_date', type: 'date', nullable: true }) receivedDate?: string;

  @Column({ name: 'v24_icd', type: 'varchar', length: 16, nullable: true }) v24Icd?: string;
  @Column({ name: 'v24_icd_description', type: 'varchar', length: 500, nullable: true }) v24IcdDescription?: string;
  @Column({ name: 'v24_hcc_value', type: 'numeric', precision: 8, scale: 2, nullable: true }) v24HccValue?: number;

  @Column({ name: 'v28_icd', type: 'varchar', length: 16, nullable: true }) v28Icd?: string;
  @Column({ name: 'v28_icd_description', type: 'varchar', length: 500, nullable: true }) v28IcdDescription?: string;
  @Column({ name: 'v28_hcc_value', type: 'numeric', precision: 8, scale: 2, nullable: true }) v28HccValue?: number;

  @Column({ type: 'varchar', length: 8, nullable: true }) validate?: HccValidate;
  @Column({ name: 'reason_code', type: 'varchar', length: 64, nullable: true }) reasonCode?: string;
  @Column({ type: 'varchar', length: 64, nullable: true }) source?: string;
  @Column({ name: 'reviewer_note', type: 'varchar', length: 2000, nullable: true }) reviewerNote?: string;

  @Column({ name: 'custom_fields', type: 'jsonb', default: () => "'{}'" }) customFields: Record<string, any>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' }) deletedAt?: Date;
}
