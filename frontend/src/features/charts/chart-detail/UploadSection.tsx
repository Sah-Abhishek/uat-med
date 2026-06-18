import { useState, useRef, type DragEvent, type ChangeEvent } from 'react';
// Service Line feature commented out
// import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Upload,
  FileText,
  FileImage,
  ClipboardPaste,
  X,
  Layers,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Eye,
  ChevronDown,
  ChevronUp,
  Wifi,
  Trash2,
  RotateCw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
// Service Line feature commented out — Label, FancySelect no longer needed here
// import { Input, Label, FancySelect } from '@/components/ui/Field';
import { AiStatusChip } from '@/components/ui/Chip';
import { cn } from '@/lib/utils';
import {
  addChartDocuments,
  removeChartDocument,
  reprocessChartDocuments,
  // updateChart, // Service Line feature commented out
} from '@/api/charts';
// Service Line feature commented out
// import { listServiceLines } from '@/api/configurations';
import { deriveAiStatus } from '@/api/types';
import type { AiEncounterResult, AiReportType, UploadedDocument } from '@/api/types';

interface StagedDoc {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
}

interface ImageGroup {
  id: string;
  label: string;
  images: StagedDoc[];
}

interface TextEntry {
  id: string;
  text: string;
}

type Status = 'idle' | 'uploading' | 'success' | 'error';

interface Props {
  chartId: string;
  // Service Line feature commented out
  // /** Current service line id on the chart (null when unset). Owned by the
  //  *  parent so a refetch stays the source of truth; we keep a local mirror for
  //  *  instant feedback on change. */
  // serviceLineId?: string | number | null;
  /** Persisted list owned by the parent — server is source of truth, hydrated from chart.customFields.uploadedDocs. */
  uploadedDocs: UploadedDocument[];
  /**
   * Full customFields blob; we read pendingPrediction / aiPrediction /
   * aiPredictionError out of it to render the live AI status pill instead of
   * a hardcoded "Ready" label.
   */
  customFields?: Record<string, unknown> | null;
  onView: (docId: string) => void;
  /** Called once the ICD Predictor pipeline returns. */
  onProcessed?: (result: AiEncounterResult) => void;
  /** Called when the uploaded-docs list changes without a re-run (add / remove). */
  onDocsChanged?: (docs: UploadedDocument[]) => void;
  /** Re-fetch the chart from the server (used after a failed run so whatever
   *  did upload, plus any recorded error, shows up without a manual reload). */
  onRefetch?: () => void;
}

/**
 * Best-effort guess of the ICD gateway's report_type vocabulary from a file's
 * MIME type and filename. Server-side mapReportType() does the real work; this
 * lets us pass an explicit per-file hint when the name is informative.
 */
function inferReportType(name: string, mime: string): AiReportType {
  const fn = name.toLowerCase();
  if (mime === 'text/plain') return 'CLINIC_NOTE';
  if (fn.includes('h&p') || fn.includes('history')) return 'HP';
  if (fn.includes('discharge')) return 'DISCHARGE_SUMMARY';
  if (fn.includes('operative') || fn.includes('op note')) return 'OPERATIVE_NOTE';
  if (fn.includes('emergency') || fn.includes('ed note')) return 'ED_NOTE';
  if (fn.includes('lab')) return 'LAB';
  if (fn.includes('radiology') || fn.includes('imaging')) return 'RADIOLOGY';
  if (fn.includes('pathology')) return 'PATHOLOGY';
  return 'CLINIC_NOTE';
}

function formatSize(b: number) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

function fileTypeLabel(type: string) {
  if (type === 'application/pdf') return { label: 'PDF', tone: 'text-danger bg-danger-soft' };
  if (type.includes('word') || type.includes('doc')) return { label: 'DOC', tone: 'text-info bg-info-soft' };
  if (type.startsWith('image/')) return { label: 'IMG', tone: 'text-primary-ink dark:text-primary bg-primary-soft' };
  return { label: 'FILE', tone: 'text-ink-muted bg-surface-sunken' };
}

export function UploadSection({ chartId, uploadedDocs, customFields, onView, onProcessed, onDocsChanged, onRefetch }: Props) {
  const [open, setOpen] = useState(true);

  /* ── Service line (per-chart, optional) — feature commented out ──────────
  // Active lines only — the dropdown must never offer a deactivated line.
  const serviceLines = useQuery({
    queryKey: ['service-lines'],
    queryFn: () => listServiceLines(),
    staleTime: 5 * 60 * 1000,
  });
  // Local mirror so the trigger updates instantly; falls back to the prop
  // (server truth) until the user changes it.
  const [localServiceLine, setLocalServiceLine] = useState<string | null>(
    serviceLineId != null ? String(serviceLineId) : null,
  );
  const serviceLineValue = localServiceLine ?? (serviceLineId != null ? String(serviceLineId) : '');
  const saveServiceLine = useMutation({
    // Empty selection clears it (null); otherwise persist the numeric id.
    mutationFn: (next: string) =>
      updateChart(chartId, { serviceLineId: next ? Number(next) : null }),
  });
  function onServiceLineChange(next: string) {
    setLocalServiceLine(next || null);
    saveServiceLine.mutate(next);
  }
  ── end service line ── */
  const [docs, setDocs] = useState<StagedDoc[]>([]);
  const [imageGroups, setImageGroups] = useState<ImageGroup[]>([]);
  const [stagedImages, setStagedImages] = useState<StagedDoc[]>([]);
  const [groupLabel, setGroupLabel] = useState('');
  const [texts, setTexts] = useState<TextEntry[]>([]);
  const [textInput, setTextInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'uploading' | 'analyzing' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const docInput = useRef<HTMLInputElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);

  const hasStaged = docs.length > 0 || imageGroups.length > 0 || texts.length > 0;
  const hasUploaded = uploadedDocs.length > 0;

  const aiStatus = deriveAiStatus(customFields ?? undefined);
  // A run is in flight either locally (this tab kicked it off) or server-side
  // (the watcher is polling an encounter). Disable mutations until it settles.
  const busy =
    status === 'uploading' || aiStatus === 'QUEUED' || aiStatus === 'PROCESSING';

  function makeStaged(files: FileList | File[]): StagedDoc[] {
    return Array.from(files).map((f) => ({
      id: `${f.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      file: f,
      name: f.name,
      size: f.size,
      type: f.type,
    }));
  }

  function addDocs(files: FileList | File[]) {
    setDocs((prev) => [...prev, ...makeStaged(files)]);
  }
  function addStagedImages(files: FileList | File[]) {
    setStagedImages((prev) => [...prev, ...makeStaged(files)]);
  }
  function commitImageGroup() {
    if (!stagedImages.length) return;
    setImageGroups((prev) => [
      ...prev,
      { id: Date.now().toString(), label: groupLabel || `Group ${prev.length + 1}`, images: stagedImages },
    ]);
    setStagedImages([]);
    setGroupLabel('');
  }
  function addText() {
    if (!textInput.trim()) return;
    setTexts((prev) => [...prev, { id: Date.now().toString(), text: textInput }]);
    setTextInput('');
  }

  async function processDocuments() {
    setStatus('uploading');
    setProgress(0);
    setPhase('uploading');
    setErrorMsg(null);

    // Build a flat File[] in the order we'll send it to the gateway.
    // PDFs/Word docs first (one transaction each), then every image inside a
    // group, then any pasted clinical-text entries — same convention the
    // reference backend uses to keep transactionId mapping stable.
    type Outbound = { file: File; displayName: string; type: string; size: number; localId: string };
    const outbound: Outbound[] = [];

    docs.forEach((d) => outbound.push({ file: d.file, displayName: d.name, type: d.type, size: d.size, localId: d.id }));
    imageGroups.forEach((g) =>
      g.images.forEach((d) =>
        outbound.push({
          file: d.file,
          displayName: `${g.label}/${d.name}`,
          type: d.type,
          size: d.size,
          localId: d.id,
        }),
      ),
    );
    texts.forEach((t, i) => {
      const blob = new Blob([t.text], { type: 'text/plain' });
      const f = new File([blob], `clinical-text-${i + 1}.txt`, { type: 'text/plain' });
      outbound.push({
        file: f,
        displayName: `Clinical Text ${i + 1}`,
        type: 'text/plain',
        size: f.size,
        localId: t.id,
      });
    });

    if (outbound.length === 0) {
      setStatus('idle');
      setPhase(null);
      return;
    }

    const onProgress = (pct: number) => {
      setProgress(pct);
      // Once the upload finishes, the server is polling the gateway —
      // flip the label so the user knows we're not stalled.
      if (pct >= 100) setPhase('analyzing');
    };
    const payload = {
      files: outbound.map((o) => o.file),
      reportTypes: outbound.map((o) => inferReportType(o.displayName, o.type)),
    };

    try {
      // 1) Upload the staged files first (no AI yet) and commit them to the
      //    chart. Doing this before the pipeline runs means the uploaded list
      //    and Retry control appear immediately — and survive a mid-run failure
      //    (e.g. the orchestrator being down) instead of vanishing with the
      //    error banner.
      const { uploadedDocs: next } = await addChartDocuments(chartId, payload, onProgress);
      setDocs([]);
      setImageGroups([]);
      setStagedImages([]);
      setGroupLabel('');
      setTexts([]);
      onDocsChanged?.(next);

      // 2) Run the pipeline over the chart's FULL document set so the
      //    prediction reflects everything, not just the files added this round.
      setPhase('analyzing');
      const result = await reprocessChartDocuments(chartId);
      setStatus('success');
      setPhase(null);
      onProcessed?.(result);
    } catch (err) {
      console.error('Document processing failed', err);
      setStatus('error');
      setPhase(null);
      const e = err as { message?: string };
      setErrorMsg(e.message ?? 'Failed to process documents.');
      // Re-sync from the server so whatever DID upload (and any error the
      // watcher recorded) shows up — and the Retry control becomes available.
      onRefetch?.();
    }
  }

  /** Re-run the pipeline over the docs already on the chart — no re-upload. */
  async function retry() {
    setStatus('uploading');
    setPhase('analyzing');
    setProgress(100);
    setErrorMsg(null);
    try {
      const result = await reprocessChartDocuments(chartId);
      setStatus('success');
      setPhase(null);
      onProcessed?.(result);
    } catch (err) {
      console.error('Reprocess failed', err);
      setStatus('error');
      setPhase(null);
      const e = err as { message?: string };
      setErrorMsg(e.message ?? 'Failed to reprocess documents.');
      onRefetch?.();
    }
  }

  /** Remove one already-uploaded document (deletes it from S3 too). */
  async function removeUploaded(docId: string) {
    setRemovingId(docId);
    setErrorMsg(null);
    try {
      const { uploadedDocs: next } = await removeChartDocument(chartId, docId);
      onDocsChanged?.(next);
    } catch (err) {
      console.error('Remove document failed', err);
      const e = err as { message?: string };
      setErrorMsg(e.message ?? 'Failed to remove document.');
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-6 py-5 text-left hover:bg-surface-2/60 transition"
      >
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink">
            {hasUploaded ? 'Upload More Documents' : 'Upload Medical Documents'}
          </h3>
          <p className="text-xs text-ink-muted mt-0.5">
            {hasUploaded
              ? `${uploadedDocs.length} document${uploadedDocs.length === 1 ? '' : 's'} uploaded`
              : 'PDFs, images, or paste clinical text below'}
          </p>
        </div>
        <span className="w-7 h-7 rounded-full bg-surface-sunken flex items-center justify-center text-ink-muted">
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {open && (
        <div className="px-6 pb-6 pt-1 border-t border-line">
          {/* Service line feature commented out — classifies the chart; stored per-chart
              and (once the gateway accepts it) forwarded to the AI alongside the docs.
          <div className="pt-4 max-w-xs">
            <Label>Service Line</Label>
            <FancySelect
              value={serviceLineValue}
              onChange={onServiceLineChange}
              options={(serviceLines.data?.items ?? []).map((s) => ({
                value: String(s.id),
                label: s.name,
              }))}
              placeholder={serviceLines.isPending ? 'Loading…' : 'Select service line…'}
              searchable
              disabled={busy || saveServiceLine.isPending}
            />
          </div>
          */}

          {/* Single short row: Document Upload | Image Groups | (wider) Clinical Text */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_2fr] gap-3 pt-4 items-stretch">
            {/* ── Document Upload column ── */}
            <DropZone
              title="Document Upload"
              icon={<FileText className="w-7 h-7" />}
              hint="Drop PDF / DOC files here"
              accept=".pdf,.doc,.docx"
              inputRef={docInput}
              onFiles={addDocs}
            >
              {docs.length > 0 && (
                <div className="space-y-1.5 mt-3">
                  {docs.map((d) => (
                    <StagedRow key={d.id} doc={d} onRemove={() => setDocs(docs.filter((x) => x.id !== d.id))} />
                  ))}
                </div>
              )}
            </DropZone>

            {/* ── Image groups column ── */}
            <DropZone
              title="Image Groups"
              icon={<FileImage className="w-7 h-7" />}
              hint="Drop images for one group, label, then add"
              accept="image/jpeg,image/png,image/tiff,image/webp"
              inputRef={imgInput}
              onFiles={addStagedImages}
              multiple
            >
              {stagedImages.length > 0 && (
                <div className="space-y-2 mt-3">
                  <div className="grid grid-cols-4 gap-1.5">
                    {stagedImages.slice(0, 8).map((img) => (
                      <div
                        key={img.id}
                        className="relative aspect-square rounded-md bg-surface-sunken border border-line flex items-center justify-center overflow-hidden"
                      >
                        <FileImage className="w-4 h-4 text-ink-subtle" />
                        <button
                          type="button"
                          onClick={() => setStagedImages(stagedImages.filter((x) => x.id !== img.id))}
                          className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-danger text-white text-[10px] flex items-center justify-center"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                  <Input
                    placeholder="Group label (e.g. ER notes)"
                    value={groupLabel}
                    onChange={(e) => setGroupLabel(e.target.value)}
                  />
                  <Button size="sm" leftIcon={<Layers className="w-3.5 h-3.5" />} onClick={commitImageGroup} className="w-full">
                    Add Group ({stagedImages.length})
                  </Button>
                </div>
              )}
              {imageGroups.length > 0 && (
                <div className="space-y-1.5 mt-3 pt-3 border-t border-line">
                  <p className="text-[11px] text-ink-subtle uppercase tracking-wide font-semibold">
                    Groups ({imageGroups.length})
                  </p>
                  {imageGroups.map((g) => (
                    <div key={g.id} className="flex items-center justify-between text-xs bg-surface-sunken/60 rounded-md px-2.5 py-1.5">
                      <span className="font-semibold text-ink truncate">
                        {g.label} <span className="text-ink-muted font-normal">({g.images.length})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setImageGroups(imageGroups.filter((x) => x.id !== g.id))}
                        className="text-ink-subtle hover:text-danger"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </DropZone>

            {/* ── Clinical Text column (wider, horizontal: label left, input right) ── */}
            <div className="rounded-card border border-line bg-surface p-3">
              <div className="flex items-start gap-3">
                {/* left: heading */}
                <div className="shrink-0 w-28">
                  <div className="flex items-center gap-1.5 mb-1">
                    <ClipboardPaste className="w-5 h-5 text-ink-muted shrink-0" />
                    <h4 className="text-sm font-semibold text-ink">Clinical Text</h4>
                  </div>
                  <p className="text-[11px] text-ink-muted leading-tight">Paste clinical notes</p>
                </div>
                {/* right: textarea + Add Entry */}
                <div className="flex-1 min-w-0">
                  <textarea
                    rows={3}
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    placeholder="Paste here…"
                    className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <Button size="sm" disabled={!textInput.trim()} onClick={addText} className="w-full mt-2">
                    Add Entry
                  </Button>
                </div>
              </div>
              {texts.length > 0 && (
                <div className="space-y-1.5 mt-3">
                  {texts.map((t) => (
                    <div key={t.id} className="flex items-start gap-2 bg-surface-sunken/60 rounded-md px-2.5 py-1.5 text-xs">
                      <span className="flex-1 text-ink-muted truncate">{t.text}</span>
                      <button
                        type="button"
                        onClick={() => setTexts(texts.filter((x) => x.id !== t.id))}
                        className="text-ink-subtle hover:text-danger"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* ── Process button ── */}
          <Button
            className="w-full mt-5"
            disabled={!hasStaged || busy}
            loading={status === 'uploading'}
            leftIcon={<Upload className="w-4 h-4" />}
            onClick={processDocuments}
          >
            {status === 'uploading'
              ? 'Uploading…'
              : hasUploaded
              ? 'Add & Re-run AI'
              : 'Process Documents'}
          </Button>

          {/* ── Live progress ── */}
          {status === 'uploading' && (
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="flex items-center gap-1.5 text-primary-ink dark:text-primary font-semibold">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  {phase === 'analyzing'
                    ? 'AI analyzing documents…'
                    : `Uploading… ${progress}%`}
                </span>
                <span className="flex items-center gap-1 text-success text-[11px]">
                  <Wifi className="w-3 h-3" /> Connected
                </span>
              </div>
              <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
                <div
                  className={cn(
                    'h-full bg-primary transition-[width] duration-200',
                    phase === 'analyzing' && 'animate-pulse',
                  )}
                  style={{ width: phase === 'analyzing' ? '100%' : `${progress}%` }}
                />
              </div>
              {phase === 'analyzing' && (
                <p className="text-[11px] text-ink-muted mt-1.5">
                  This usually takes 30–90 seconds. Don't close this tab.
                </p>
              )}
            </div>
          )}

          {status === 'error' && errorMsg && (
            <div className="mt-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-danger mt-0.5 flex-shrink-0" />
              <div className="text-xs text-danger flex-1">
                <p className="font-semibold">Processing failed</p>
                <p className="mt-0.5">{errorMsg}</p>
              </div>
            </div>
          )}

          {/* ── AI status + uploaded list ── */}
          {hasUploaded && (() => {
            const errored = status === 'error' || aiStatus === 'ERRORED';
            const running = aiStatus === 'QUEUED' || aiStatus === 'PROCESSING';
            const Icon = errored ? AlertCircle : running ? Loader2 : CheckCircle2;
            const iconClass = errored
              ? 'w-4 h-4 text-danger'
              : running
              ? 'w-4 h-4 text-warn animate-spin'
              : 'w-4 h-4 text-success';
            return (
              <div className="mt-5 pt-5 border-t border-line">
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={iconClass} />
                  <span className="text-sm font-semibold text-ink">AI Status</span>
                  <AiStatusChip status={aiStatus} />
                  {/* Retry runs the pipeline over the current set — add/remove
                      docs above first to curate it, or retry as-is. */}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={busy || uploadedDocs.length === 0}
                    loading={status === 'uploading' && phase === 'analyzing'}
                    leftIcon={<RotateCw className="w-3.5 h-3.5" />}
                    onClick={retry}
                  >
                    Retry
                  </Button>
                </div>
                <div className="space-y-1.5">
                  {uploadedDocs.map((d) => {
                    const meta = fileTypeLabel(d.mimeType);
                    const removing = removingId === d.id;
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-surface-2/40 transition"
                      >
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', meta.tone)}>
                          {meta.label}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-ink truncate">{d.filename}</p>
                          <p className="text-[11px] text-ink-subtle">
                            {formatSize(d.size)} · {d.reportType}
                            {d.reportId ? ` · ${d.reportId.slice(0, 8)}` : ''}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onView(d.id)}
                          className="text-xs font-semibold text-primary-ink dark:text-primary bg-primary-soft hover:bg-primary/30 dark:hover:bg-primary/20 px-2 py-1 rounded-pill flex items-center gap-1"
                        >
                          <Eye className="w-3 h-3" /> View
                        </button>
                        <button
                          type="button"
                          onClick={() => removeUploaded(d.id)}
                          disabled={busy || removing}
                          title={busy ? 'Wait for the current run to finish' : 'Remove document'}
                          className="text-ink-subtle hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed p-1"
                        >
                          {removing ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

/* ── DropZone — drag-and-drop wrapper ────────────────────── */

function DropZone({
  title,
  icon,
  hint,
  accept,
  inputRef,
  onFiles,
  multiple,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  hint: string;
  accept: string;
  inputRef: React.RefObject<HTMLInputElement>;
  onFiles: (files: FileList) => void;
  multiple?: boolean;
  children?: React.ReactNode;
}) {
  const [active, setActive] = useState(false);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setActive(false);
    if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
  };
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setActive(true);
  };
  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) onFiles(e.target.files);
    e.target.value = '';
  };

  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setActive(false)}
      className={cn(
        'rounded-card border bg-surface p-3 transition flex flex-col',
        active ? 'border-primary bg-primary-soft/30' : 'border-line border-dashed',
      )}
    >
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="flex-1 min-h-0 w-full flex flex-col items-center justify-center gap-1.5 px-1 text-center"
      >
        <span className="text-ink-muted">{icon}</span>
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-[11px] text-ink-muted leading-tight">
          {hint} — <span className="text-primary-ink dark:text-primary font-semibold">browse</span>
        </span>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={onChange}
        className="hidden"
      />
      {children}
    </div>
  );
}

function StagedRow({ doc, onRemove }: { doc: StagedDoc; onRemove: () => void }) {
  const meta = fileTypeLabel(doc.type);
  return (
    <div className="flex items-center gap-2 rounded-md bg-surface-sunken/60 px-2.5 py-1.5">
      <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', meta.tone)}>
        {meta.label}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-ink truncate">{doc.name}</p>
        <p className="text-[10px] text-ink-subtle">{formatSize(doc.size)}</p>
      </div>
      <button type="button" onClick={onRemove} className="text-ink-subtle hover:text-danger">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
