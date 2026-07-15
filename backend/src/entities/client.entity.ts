import { Column, CreateDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Location } from './location.entity';

@Entity('clients')
export class Client {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id: number;

  @Column({ type: 'varchar', length: 120, unique: true }) name: string;

  @Column({ type: 'varchar', length: 32, nullable: true, unique: true }) code?: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true }) isActive: boolean;

  // Relaxes the chart-number uniqueness rule for this client (see
  // ChartNumberService). Default false = a chart number may appear at most once
  // across the client's worklists. When true, the same chart number may repeat
  // as long as each occurrence carries a DIFFERENT date of service — the billing
  // pattern at clients that re-use an account number per encounter date. It is
  // never a licence to enter the exact same chart-#/DOS pair twice.
  @Column({ name: 'allow_duplicate_chart_numbers', type: 'boolean', default: false })
  allowDuplicateChartNumbers: boolean;

  @OneToMany(() => Location, l => l.client) locations: Location[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}
