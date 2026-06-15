import { useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Primitives';
import { Input } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { addChartFeedback, listChartFeedback } from '@/api/charts';
import type { Chart } from '@/api/types';
import { formatDateTime } from '@/lib/utils';

interface Props {
  chart: Chart;
  /** Source rule: input only enabled while the timer is running. Plumbed from page. */
  timerRunning: boolean;
}

const PAGE_SIZE = 5;

export function ConversationLog({ chart, timerRunning }: Props) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  // How many of the (newest-first) comments are shown. "Show more" reveals
  // another PAGE_SIZE; the button hides once everything is visible.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: messages = [] } = useQuery({
    queryKey: ['chart', chart.id, 'feedback'],
    queryFn: () => listChartFeedback(chart.id),
  });

  const visible = messages.slice(0, visibleCount);
  const remaining = messages.length - visible.length;

  const post = useMutation({
    mutationFn: () =>
      addChartFeedback(chart.id, {
        categoryId: 1,
        feedbackTypeId: 1,
        feedbackStatus: 'Feedback Provided',
        comments: text,
      }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['chart', chart.id, 'feedback'] });
    },
  });

  const canSend = timerRunning && text.trim().length > 0 && !post.isPending;
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && canSend) {
      e.preventDefault();
      post.mutate();
    }
  };

  return (
    <Card padding="default">
      <div className="mb-3">
        <p className="text-[11px] uppercase tracking-[0.1em] text-ink-muted font-semibold">
          Conversation Log
        </p>
        <p className="text-[11px] text-ink-subtle">Internal comments within the team</p>
      </div>

      <div className="max-h-[300px] overflow-y-auto space-y-3 mb-3 pr-1">
        {messages.length === 0 ? (
          <p className="text-[11px] text-ink-subtle">No comments yet.</p>
        ) : (
          <>
            {visible.map((m) => (
              <div key={m.id} className="flex items-start gap-2">
                <Avatar name={m.createdByUserName ?? 'Unknown'} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[12px] font-semibold text-ink truncate">
                      {m.createdByUserName ?? 'Unknown'}
                    </span>
                    <span className="text-[10px] text-ink-subtle">
                      {formatDateTime(m.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-ink-muted mt-0.5 break-words">{m.comments}</p>
                </div>
              </div>
            ))}
            {remaining > 0 && (
              <button
                type="button"
                onClick={() => setVisibleCount((n) => n + PAGE_SIZE)}
                className="w-full text-[11px] font-semibold text-info hover:underline py-1"
              >
                Show more ({remaining} more)
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex gap-1.5">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={timerRunning ? 'Type a comment…' : 'Start the timer to comment'}
          disabled={!timerRunning}
        />
        <Button
          size="sm"
          disabled={!canSend}
          loading={post.isPending}
          onClick={() => post.mutate()}
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </Card>
  );
}
