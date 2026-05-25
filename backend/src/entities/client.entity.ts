import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Location } from './location.entity';

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ type: 'varchar', length: 120, unique: true }) name: string;

  @Column({ type: 'varchar', length: 32, nullable: true, unique: true }) code?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  @OneToMany(() => Location, l => l.client) locations: Location[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
