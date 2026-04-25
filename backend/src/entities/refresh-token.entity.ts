import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from './user.entity';

@Entity('refresh_tokens')
export class RefreshToken {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ name: 'user_id', type: 'bigint' }) @Index() userId: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'token_hash', type: 'varchar', length: 128, unique: true }) tokenHash: string;

  @Column({ name: 'device_label', type: 'varchar', length: 120, nullable: true }) deviceLabel?: string;

  @Column({ name: 'issued_at', type: 'timestamptz' }) issuedAt: Date;
  @Column({ name: 'expires_at', type: 'timestamptz' }) @Index() expiresAt: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt?: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}
