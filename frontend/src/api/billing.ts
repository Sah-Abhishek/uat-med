import { get, put } from './client';

export interface BillingFilters {
  clientId?: number;
  locationId?: number;
  days?: number;
  endsAt?: string;
}

export interface BillingSettings {
  ratePerDocument: number;
  currency: string;
  updatedAt: string | null;
}

export interface ClientBucket {
  clientId: number;
  clientName: string;
  charts: number;
  documents: number;
  revenue: number;
}

export interface LocationBucket {
  locationId: number;
  locationName: string;
  clientId: number;
  clientName: string;
  charts: number;
  documents: number;
  revenue: number;
}

export interface BillingSummary {
  ratePerDocument: number;
  currency: string;
  window: { startDate: string; endDate: string; days: number };
  totals: { charts: number; documents: number; revenue: number };
  byClient: ClientBucket[];
  byLocation: LocationBucket[];
  perDay: Array<{ date: string; documents: number; revenue: number }>;
}

export interface BillingChartRow {
  chartId: string;
  chartNo: string | null;
  worklistNumber: string | null;
  clientName: string | null;
  locationName: string | null;
  uploadedAt: string;
  documents: number;
  amount: number;
}

export interface BillingChartsResponse {
  page: number;
  pageSize: number;
  total: number;
  ratePerDocument: number;
  currency: string;
  items: BillingChartRow[];
}

export const getBillingSettings = () => get<BillingSettings>('/billing/settings');

export const updateBillingSettings = (dto: { ratePerDocument: number; currency?: string }) =>
  put<BillingSettings>('/billing/settings', dto);

export const getBillingSummary = (filters: BillingFilters = {}) =>
  get<BillingSummary>('/billing/summary', filters);

export const getBillingCharts = (
  filters: BillingFilters & { page?: number; pageSize?: number },
) => get<BillingChartsResponse>('/billing/charts', filters);
