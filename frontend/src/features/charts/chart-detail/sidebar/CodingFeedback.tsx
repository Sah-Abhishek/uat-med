import { Card } from '@/components/ui/Card';
import type { AiEncounterResult } from '@/api/types';

export interface CodingTip {
  tip: string;
  relatedCode?: string;
  potentialImpact?: string;
}

export interface ComplianceAlert {
  alert: string;
  severity?: 'High' | 'Medium' | 'Low';
  regulation?: string;
  recommendedAction?: string;
}

interface Props {
  prediction?: AiEncounterResult | null;
  /** Override extracted tips/alerts (used in tests/storybooks). */
  tips?: CodingTip[];
  alerts?: ComplianceAlert[];
}

export function CodingFeedback({ prediction, tips, alerts }: Props) {
  if (!prediction && !tips?.length && !alerts?.length) return null;

  const tipList = tips ?? extractTips(prediction);
  const alertList = alerts ?? extractAlerts(prediction);
  const auditNotes = prediction?.auditNotes?.trim() || '';

  return (
    <Card padding="default">
      <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold mb-3">
        Coding Feedback
      </p>

      {/* ── Coding Tips ── */}
      <div className="space-y-2 mb-3">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-info">Coding Tips</p>
        {tipList.length === 0 ? (
          <p className="text-xs text-ink-muted">No coding tips from AI.</p>
        ) : (
          tipList.map((t, i) => (
            <div key={i} className="rounded-md bg-info-soft p-2.5">
              <p className="text-xs text-ink mb-1">{t.tip}</p>
              {t.relatedCode && (
                <p className="text-[11px] text-ink-muted">
                  <span className="font-semibold">Related Code:</span>{' '}
                  <span className="font-mono">{t.relatedCode}</span>
                </p>
              )}
              {t.potentialImpact && (
                <p className="text-[11px] text-ink-muted">
                  <span className="font-semibold">Impact:</span> {t.potentialImpact}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Compliance / Clinical Alerts ── */}
      <div className="space-y-2 mb-3">
        <p className="text-[11px] uppercase tracking-wide font-semibold text-warn">
          Compliance Alerts
        </p>
        {alertList.length === 0 ? (
          <p className="text-xs text-ink-muted">No compliance alerts raised.</p>
        ) : (
          alertList.map((a, i) => (
            <div key={i} className="rounded-md bg-warn-soft p-2.5">
              <div className="flex items-start gap-2 mb-1">
                <p className="text-xs text-ink flex-1">{a.alert}</p>
                {a.severity && (
                  <span className="text-[10px] font-bold uppercase text-warn">{a.severity}</span>
                )}
              </div>
              {a.regulation && (
                <p className="text-[11px] text-ink-muted">
                  <span className="font-semibold">Regulation:</span> {a.regulation}
                </p>
              )}
              {a.recommendedAction && (
                <p className="text-[11px] text-ink-muted">
                  <span className="font-semibold">Action:</span> {a.recommendedAction}
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {/* ── Audit notes (free-form text returned by encounter) ── */}
      {auditNotes && (
        <div>
          <p className="text-[11px] uppercase tracking-wide font-semibold text-ink-muted mb-1">
            Auditor Notes
          </p>
          <p className="text-[11px] text-ink-muted leading-relaxed whitespace-pre-line">
            {auditNotes}
          </p>
        </div>
      )}
    </Card>
  );
}

function extractTips(prediction?: AiEncounterResult | null): CodingTip[] {
  if (!prediction) return [];
  if (prediction.codingTips?.length) {
    return prediction.codingTips
      .map((t) => ({
        tip: t.tip,
        relatedCode: t.relatedCode,
        potentialImpact: t.potentialImpact,
      }))
      .filter((t) => t.tip);
  }
  const raw = (prediction.clinicalSummary as Record<string, unknown> | undefined)?.coding_tips;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((t) => ({
      tip: String(t.tip ?? t.description ?? ''),
      relatedCode: t.related_code ? String(t.related_code) : undefined,
      potentialImpact: t.potential_impact ? String(t.potential_impact) : undefined,
    }))
    .filter((t) => t.tip);
}

function extractAlerts(prediction?: AiEncounterResult | null): ComplianceAlert[] {
  if (!prediction) return [];
  if (prediction.complianceAlerts?.length) {
    return prediction.complianceAlerts
      .map((a) => ({
        alert: a.alert,
        severity: (a.severity as ComplianceAlert['severity']) ?? undefined,
        regulation: a.regulation,
        recommendedAction: a.recommendedAction,
      }))
      .filter((a) => a.alert);
  }
  const raw = (prediction.clinicalSummary as Record<string, unknown> | undefined)?.compliance_alerts;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
    .map((a) => ({
      alert: String(a.alert ?? a.description ?? ''),
      severity: (a.severity as ComplianceAlert['severity']) ?? undefined,
      regulation: a.regulation ? String(a.regulation) : undefined,
      recommendedAction: a.recommended_action ? String(a.recommended_action) : undefined,
    }))
    .filter((a) => a.alert);
}
