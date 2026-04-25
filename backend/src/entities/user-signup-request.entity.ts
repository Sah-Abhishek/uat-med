import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('user_signup_requests')
export class UserSignupRequest {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ type: 'varchar', length: 255 }) @Index() email: string;

  @Column({ type: 'varchar', length: 16, default: 'PENDING' })
  status: 'PENDING' | 'APPROVED' | 'DECLINED';

  @Column({ name: 'processed_by', type: 'bigint', nullable: true }) processedBy?: number;
  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true }) processedAt?: Date;
  @Column({ name: 'decline_reason', type: 'varchar', length: 500, nullable: true }) declineReason?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
