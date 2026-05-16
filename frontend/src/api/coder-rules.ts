import { get, patch, post } from './client';

export type RulePriority = 'HIGH' | 'NORMAL';
export type RuleAppliesTo = 'ICD-CM' | 'ICD-PCS' | 'CPT' | 'ALL';

export const RULE_PRIORITIES: RulePriority[] = ['HIGH', 'NORMAL'];
export const RULE_APPLIES_TO: RuleAppliesTo[] = ['ALL', 'ICD-CM', 'ICD-PCS', 'CPT'];

export interface CoderRule {
  id: string;
  rule_text: string;
  applies_to: RuleAppliesTo;
  priority: RulePriority;
  active: boolean;
  created_by: string;
  created_at: string;
  qdrant_synced?: boolean;
}

export interface ListRulesQuery {
  priority?: RulePriority;
  applies_to?: RuleAppliesTo;
  include_inactive?: boolean;
}

export interface ListRulesResponse {
  rules: CoderRule[];
  total: number;
  high_count: number;
  normal_count: number;
}

export interface CreateRuleDto {
  rule_text: string;
  applies_to: RuleAppliesTo;
  priority: RulePriority;
}

export const listCoderRules = (q: ListRulesQuery = {}) =>
  get<ListRulesResponse>('/coder-rules', q);

export const createCoderRule = (dto: CreateRuleDto) =>
  post<CoderRule>('/coder-rules', dto);

export const deactivateCoderRule = (id: string) =>
  patch<{ rule_id: string; active: boolean; qdrant_synced: boolean; message: string }>(
    `/coder-rules/${encodeURIComponent(id)}/deactivate`,
    {},
  );
