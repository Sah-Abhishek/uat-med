import { get } from './client';

/** A single PCS / DRG reference hit returned by the autocomplete endpoints. */
export interface ReferenceCodeHit {
  code: string;
  description: string;
}

export interface SearchReferenceCodesResponse {
  codes: ReferenceCodeHit[];
}

/**
 * Prefix-search ICD-10-PCS codes for the Chart Info "PCS codes" autocomplete.
 * The backend matches the typed prefix against the code only. Fire at ≥2 chars.
 */
export const searchPcsCodes = (q: string, limit = 15) =>
  get<SearchReferenceCodesResponse>('/pcs-codes/search', { q, limit });

/**
 * Prefix-search MS-DRG codes for the Chart Info "DRG Value" autocomplete.
 * The backend matches the typed prefix against the code only. Fire at ≥2 chars.
 */
export const searchDrgCodes = (q: string, limit = 15) =>
  get<SearchReferenceCodesResponse>('/drg-codes/search', { q, limit });
