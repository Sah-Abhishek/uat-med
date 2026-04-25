import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  title: string;
  subtitle: string;
  endpoints?: string[];
}

export function ComingSoonPage({ title, subtitle, endpoints }: Props) {
  return (
    <div className="p-8 max-w-[1100px]">
      <PageHeader title={title} subtitle={subtitle} />

      <Card padding="lg" className="max-w-2xl">
        <div className="w-10 h-10 rounded-full bg-primary-soft flex items-center justify-center mb-4">
          <Sparkles className="w-4 h-4 text-primary-ink" />
        </div>
        <h3 className="font-semibold text-ink text-lg">Scaffolded, ready to build</h3>
        <p className="text-sm text-ink-muted mt-1 mb-5">
          This page is wired into routing and permissions. The full UI will be built in the
          next pass.
        </p>

        {endpoints && (
          <>
            <p className="text-[11px] uppercase tracking-[0.1em] text-ink-subtle font-semibold mb-2">
              Planned endpoints
            </p>
            <ul className="space-y-1 mb-6 bg-surface-sunken rounded-lg p-4">
              {endpoints.map((e) => (
                <li key={e} className="font-mono text-xs text-ink">
                  {e}
                </li>
              ))}
            </ul>
          </>
        )}

        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-primary-ink bg-primary-soft hover:bg-primary/30 transition px-3 py-1.5 rounded-pill"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to dashboard
        </Link>
      </Card>
    </div>
  );
}
