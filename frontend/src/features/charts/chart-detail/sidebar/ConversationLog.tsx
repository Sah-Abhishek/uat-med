import { useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Pencil, Check, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Avatar } from '@/components/ui/Primitives';
import { Input, Textarea } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { addChartFeedback, listChartFeedback, updateChartFeedback } from '@/api/charts';
import type { Chart } from '@/api/types';
import { useAuth } from '@/auth/store';
import { formatDateTime } from '@/lib/utils';

interface Props {
  chart: Chart;
  /** Source rule: input only enabled while the timer is running. Plumbed from page. */
  timerRunning: boolean;
}

const PAGE_SIZE = 5;

export function ConversationLog({ chart, timerRunning }: Props) {
  const qc = useQueryClient();
  const currentUser = useAuth((s) => s.user);
  const [text, setText] = useState('');
  // How many of the (newest-first) comments are shown. "Show more" reveals
  // another PAGE_SIZE; the button hides once everything is visible.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Inline edit state — which comment is being edited, and its draft text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

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

  // Edit an existing comment. The backend restricts this to the comment's
  // author, so the pencil affordance is only shown on the viewer's own rows.
  const edit = useMutation({
    mutationFn: ({ id, comments }: { id: string; comments: string }) =>
      updateChartFeedback(id, { comments }),
    onSuccess: () => {
      setEditingId(null);
      setEditText('');
      qc.invalidateQueries({ queryKey: ['chart', chart.id, 'feedback'] });
    },
  });

  const startEdit = (id: string, comments: string | null) => {
    setEditingId(id);
    setEditText(comments ?? '');
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditText('');
  };
  const saveEdit = (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed || edit.isPending) return;
    edit.mutate({ id, comments: trimmed });
  };

  const canSend = timerRunning && text.trim().length > 0 && !post.isPending;
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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
            {visible.map((m) => {
              const isMine =
                currentUser != null &&
                m.createdByUserId != null &&
                String(currentUser.id) === m.createdByUserId;
              const isEditing = editingId === m.id;
              // On insert the backend sets created_at and updated_at to the exact
              // same instant, so any later edit (even milliseconds after) makes
              // them differ — a strict inequality reliably flags an edited comment.
              const wasEdited =
                new Date(m.updatedAt).getTime() !== new Date(m.createdAt).getTime();
              return (
                <div key={m.id} className="flex items-start gap-2">
                  <Avatar name={m.createdByUserName ?? 'Unknown'} src={m.createdByAvatarUrl ?? undefined} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[12px] font-semibold text-ink truncate">
                        {m.createdByUserName ?? 'Unknown'}
                      </span>
                      <span className="text-[10px] text-ink-subtle">
                        {formatDateTime(m.createdAt)}
                      </span>
                      {wasEdited && !isEditing && (
                        <span className="text-[10px] text-ink-subtle italic">(edited)</span>
                      )}
                      {isMine && !isEditing && (
                        <button
                          type="button"
                          onClick={() => startEdit(m.id, m.comments)}
                          className="ml-auto shrink-0 text-ink-subtle hover:text-primary transition"
                          title="Edit comment"
                          aria-label="Edit comment"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {isEditing ? (
                      <div className="mt-1 flex items-center gap-1.5">
                        <Input
                          value={editText}
                          autoFocus
                          onChange={(e) => setEditText(e.target.value)}
                          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              saveEdit(m.id);
                            } else if (e.key === 'Escape') {
                              cancelEdit();
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          variant="soft"
                          disabled={!editText.trim() || edit.isPending}
                          loading={edit.isPending && editingId === m.id}
                          onClick={() => saveEdit(m.id)}
                          title="Save"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit} title="Cancel">
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <p className="text-xs text-ink-muted mt-0.5 break-words">{m.comments}</p>
                    )}
                  </div>
                </div>
              );
            })}
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

      <div className="flex items-end gap-1.5">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          placeholder={timerRunning ? 'Type a comment…' : 'Start the timer to comment'}
          disabled={!timerRunning}
          className="resize-none"
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
