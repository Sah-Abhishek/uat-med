import { get } from './client';

/** A single ICD-10-CM reference hit returned by the autocomplete endpoint. */
export interface IcdCodeHit {
  code: string;
  description: string;
  isBillable: boolean;
}

export interface SearchIcdCodesResponse {
  codes: IcdCodeHit[];
}

/**
 * Prefix-search ICD-10-CM codes for the "Add a code" typeahead. The backend
 * matches the prefix against the code with and without its decimal point, so
 * "E119" and "E11.9" both work. Fire only once the user has typed ≥2 chars.
 */
export const searchIcdCodes = (q: string, limit = 10) =>
  get<SearchIcdCodesResponse>('/icd-codes/search', { q, limit });
