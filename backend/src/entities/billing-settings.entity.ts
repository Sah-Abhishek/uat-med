import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

// Single-row settings table: ratePerDocument is the global price applied to
// every uploaded document, across all clients and locations. The Billing page
// reads this to compute revenue = documents × rate. Only one row ever exists
// (id = 1); updates overwrite it in place.
@Entity('billing_settings')
export class BillingSettings {
  @PrimaryColumn({ type: 'int' }) id: number;

  @Column({ name: 'rate_per_document', type: 'numeric', precision: 12, scale: 2, default: 0 })
  ratePerDocument: string;

  @Column({ name: 'currency', type: 'varchar', length: 8, default: 'USD' })
  currency: string;

  @Column({ name: 'updated_by_user_id', type: 'bigint', nullable: true })
  updatedByUserId?: number | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
