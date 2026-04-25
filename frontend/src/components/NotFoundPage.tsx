import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';

export function NotFoundPage() {
  return (
    <div className="p-10 min-h-screen flex items-center">
      <div className="max-w-md">
        <p className="text-[11px] uppercase tracking-[0.2em] text-ink-muted mb-3 font-semibold">
          404
        </p>
        <h1 className="text-4xl font-bold text-ink tracking-tightish mb-4">
          Nothing here.
        </h1>
        <p className="text-sm text-ink-muted mb-8">
          The page you were looking for doesn't exist, or you don't have access to it.
        </p>
        <Link to="/">
          <Button>Back to dashboard</Button>
        </Link>
      </div>
    </div>
  );
}
