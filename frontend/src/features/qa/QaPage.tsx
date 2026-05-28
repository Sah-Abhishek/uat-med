import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Primitives';
import type { QaFilters } from '@/api/qa';
import { QaFilterBar } from './QaFilterBar';
import { SubmissionsTab } from './SubmissionsTab';
import { AccuracyTab } from './AccuracyTab';

type TabKey = 'submissions' | 'accuracy';

export function QaPage() {
  const [params, setParams] = useSearchParams();

  const tab: TabKey = (params.get('tab') as TabKey) || 'submissions';

  // Filters are entirely opt-in. No default date range — the page shows
  // every submission until the user narrows the scope.
  const filters: QaFilters = useMemo(
    () => ({
      clientId: params.get('clientId') ? Number(params.get('clientId')) : undefined,
      locationId: params.get('locationId') ? Number(params.get('locationId')) : undefined,
      specialityId: params.get('specialityId') ? Number(params.get('specialityId')) : undefined,
      worklistId: params.get('worklistId') ? Number(params.get('worklistId')) : undefined,
      coderId: params.get('coderId') ? Number(params.get('coderId')) : undefined,
      milestone: params.get('milestone') || undefined,
      from: params.get('from') || undefined,
      to: params.get('to') || undefined,
      q: params.get('q') || undefined,
    }),
    [params],
  );

  const updateFilters = (patch: Partial<QaFilters>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === null) {
        next.delete(k);
      } else {
        next.set(k, String(v));
      }
    }
    setParams(next, { replace: true });
  };

  const resetFilters = () => {
    const next = new URLSearchParams();
    if (tab !== 'submissions') next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const setTab = (k: TabKey) => {
    const next = new URLSearchParams(params);
    if (k === 'submissions') next.delete('tab');
    else next.set('tab', k);
    setParams(next, { replace: true });
  };

  return (
    <div className="p-8 max-w-[1600px] space-y-5">
      <PageHeader
        title="Quality Assurance"
        subtitle="AI accuracy and submission activity across charts."
      />

      <Card padding="none">
        <div className="px-6 pt-5">
          <Tabs
            tabs={[
              { key: 'submissions', label: 'Submissions' },
              { key: 'accuracy', label: 'AI Accuracy' },
            ]}
            value={tab}
            onChange={(k) => setTab(k as TabKey)}
          />
        </div>

        <div className="p-6 space-y-5">
          <QaFilterBar
            filters={filters}
            onChange={updateFilters}
            onReset={resetFilters}
          />
          {tab === 'submissions' ? (
            <SubmissionsTab filters={filters} onResetFilters={resetFilters} />
          ) : (
            <AccuracyTab filters={filters} />
          )}
        </div>
      </Card>
    </div>
  );
}
