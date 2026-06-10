import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bulkPreviewCharts,
  bulkImportCharts,
  bulkUploadDocuments,
  assignStagedDocuments,
  downloadBulkTemplateUrl,
  type BulkImportPreview,
  type BulkImportResult,
  type BulkDocumentsResult,
  type AssignStagedRequest,
} from '@/api/worklists';
import { listCharts } from '@/api/charts';
// Service Line feature commented out
// import { listCharts, bulkModifyCharts } from '@/api/charts';
// import { listServiceLines } from '@/api/configurations';
import type { ApiErrorShape } from '@/api/types';
import { Modal, ModalFooter } from '@/components/ui/Primitives';
import { Button } from '@/components/ui/Button';
// Service Line feature commented out — FancySelect no longer used here
import { Select } from '@/components/ui/Field';
import { cn, formatNumber } from '@/lib/utils';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Download,
  File as FileIcon,
  FileSpreadsheet,
  FileText,
  Folder,
  GripVertical,
  HelpCircle,
  Image as ImageIcon,
  Inbox,
  Loader2,
  Search,
  Tag,
  Upload,
  X as XIcon,
} from 'lucide-react';

type Step = 1 | 2 | 3 | 4;

interface Props {
  open: boolean;
  onClose: () => void;
  worklistId: string;
  worklistNumber: string;
  /**
   * Total charts already present in the worklist. When > 0 the wizard skips
   * the Excel step entirely and opens directly on the documents step, since
   * the charts were already created at worklist creation time.
   */
  existingChartCount: number;
}

/**
 * Three-step bulk upload wizard for team leads.
 *
 *   1  Excel preview → import          (creates chart rows in the worklist)
 *   2  Documents upload → auto-match   (matches files to chartNo/MRN/folder)
 *   3  Review unmatched files           (manual assignment for stragglers)
 *   4  Done summary                    (counts + close)
 *
 * Spatially: header (stepper) → content → footer (back / primary).
 * Backdrop close is guarded once an upload is in flight or has succeeded;
 * the user must explicitly confirm to discard progress.
 */
export function BulkUploadWizard({ open, onClose, worklistId, worklistNumber, existingChartCount }: Props) {
  const qc = useQueryClient();
  // When the worklist already has charts, we're in documents-only mode and
  // start on step 2. `documentsOnly` also hides step 1 from the progress
  // indicator so the user doesn't think there's a back-path to it.
  const documentsOnly = existingChartCount > 0;
  const [step, setStep] = useState<Step>(documentsOnly ? 2 : 1);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Step 1 state
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BulkImportPreview | null>(null);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);

  // In documents-only mode, fetch existing charts so step 3's "assign to chart"
  // dropdown has options. Paginated up to 200 — same chunk size used elsewhere.
  const existingCharts = useQuery({
    queryKey: ['worklist', worklistId, 'charts-for-bulk-wizard'],
    queryFn: () =>
      listCharts({ worklistId, page: 1, pageSize: 200, sortBy: 'serialNo', sortDir: 'asc' }),
    enabled: open && documentsOnly,
  });
  const reviewCharts = useMemo<BulkImportResult['charts']>(() => {
    if (importResult) return importResult.charts;
    return (existingCharts.data?.items ?? []).map((c) => ({
      id: c.id,
      serialNo: c.serialNo,
      chartNo: c.chartNo ?? '',
      mrNumber: c.mrNumber ?? '',
    }));
  }, [importResult, existingCharts.data]);

  // Step 2 state
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [matchResult, setMatchResult] = useState<BulkDocumentsResult | null>(null);

  /* ── Batch service line (applies to every chart in this upload) — FEATURE COMMENTED OUT ──
  // Active lines only — the picker must never offer a deactivated line.
  const serviceLines = useQuery({
    queryKey: ['service-lines'],
    queryFn: () => listServiceLines(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
  });
  const [batchServiceLineId, setBatchServiceLineId] = useState<string>('');
  // Guard against re-applying the same (line, chart-count) on every memo churn.
  const appliedRef = useRef<string>('');
  const applyServiceLine = useMutation({
    mutationFn: (vars: { ids: number[]; serviceLineId: number }) =>
      bulkModifyCharts({ chartIds: vars.ids, serviceLineId: vars.serviceLineId }),
  });
  // Apply whenever a line is chosen AND charts exist (after Excel import, or
  // immediately in documents-only mode). If the user picks a line on step 1
  // before importing, this re-runs once reviewCharts populates.
  useEffect(() => {
    if (!batchServiceLineId) return;
    const ids = reviewCharts.map((c) => Number(c.id)).filter((n) => Number.isFinite(n) && n > 0);
    if (!ids.length) return;
    const key = `${batchServiceLineId}:${ids.length}`;
    if (appliedRef.current === key) return;
    appliedRef.current = key;
    applyServiceLine.mutate({ ids, serviceLineId: Number(batchServiceLineId) });
  }, [batchServiceLineId, reviewCharts]); // eslint-disable-line react-hooks/exhaustive-deps
  ── end batch service line ── */

  // Step 3 manages its own assignment state internally; nothing to lift.

  // Reset everything when the modal closes.
  useEffect(() => {
    if (!open) {
      setStep(documentsOnly ? 2 : 1);
      setExcelFile(null);
      setPreview(null);
      setImportResult(null);
      setDocFiles([]);
      setMatchResult(null);
      setConfirmDiscard(false);
      // Service Line feature commented out
      // setBatchServiceLineId('');
      // appliedRef.current = '';
    }
  }, [open, documentsOnly]);

  // Invalidate worklist + charts queries when we land on the summary step
  // so the surrounding pages refresh without a manual reload.
  useEffect(() => {
    if (step === 4) {
      qc.invalidateQueries({ queryKey: ['worklist', worklistId] });
      qc.invalidateQueries({ queryKey: ['charts'] });
      qc.invalidateQueries({ queryKey: ['worklists'] });
    }
  }, [step, qc, worklistId]);

  const hasUnsavedWork =
    (step === 1 && (excelFile !== null || preview !== null)) ||
    (step === 2 && docFiles.length > 0) ||
    step === 3;

  function handleClose() {
    if (hasUnsavedWork) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} size="xl">
      <div className="-mx-6 -mt-6 -mb-6 flex flex-col" style={{ minHeight: 540 }}>
        {/* Header: title + stepper */}
        <div className="px-6 pt-6 pb-5 border-b border-line">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-lg font-bold text-ink">
                {documentsOnly ? 'Upload Documents' : 'Bulk Upload Charts'}
              </h3>
              <p className="text-xs text-ink-muted mt-1">
                Worklist <span className="font-mono text-ink">{worklistNumber}</span> ·{' '}
                {documentsOnly
                  ? `Match documents to the ${formatNumber(existingChartCount)} chart${existingChartCount === 1 ? '' : 's'} already in this worklist.`
                  : 'Add charts from Excel, then upload their documents.'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label="Close"
              className="w-8 h-8 rounded-full flex items-center justify-center text-ink-muted hover:bg-surface-sunken transition shrink-0"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>

          <Stepper step={step} documentsOnly={documentsOnly} />
        </div>

        {/* Body */}
        <div className="px-6 py-6 overflow-y-auto flex-1">
          {/* Service line feature commented out — one value applied to every chart in this upload.
              Stored per-chart; (deferred) forwarded to the AI with the docs.
          {step !== 4 && (
            <div className="mb-5 flex items-center gap-3 rounded-xl border border-line bg-surface-sunken/40 px-4 py-3">
              <Tag className="w-4 h-4 text-ink-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">Service Line</p>
                <p className="text-[11px] text-ink-muted">Applied to all charts in this upload (optional).</p>
              </div>
              <div className="ml-auto w-60 shrink-0">
                <FancySelect
                  value={batchServiceLineId}
                  onChange={setBatchServiceLineId}
                  options={(serviceLines.data?.items ?? []).map((s) => ({ value: String(s.id), label: s.name }))}
                  placeholder={serviceLines.isPending ? 'Loading…' : 'Select service line…'}
                  searchable
                  disabled={applyServiceLine.isPending}
                />
              </div>
            </div>
          )}
          end service line */}
          {step === 1 && !documentsOnly && (
            <Step1ExcelUpload
              file={excelFile}
              setFile={setExcelFile}
              preview={preview}
              setPreview={setPreview}
              importResult={importResult}
              setImportResult={setImportResult}
              worklistId={worklistId}
              onContinue={() => setStep(2)}
            />
          )}
          {step === 2 && (
            <Step2DocumentUpload
              files={docFiles}
              setFiles={setDocFiles}
              matchResult={matchResult}
              setMatchResult={setMatchResult}
              worklistId={worklistId}
              importedCount={importResult?.inserted ?? existingChartCount}
              onContinue={() => setStep(matchResult && matchResult.unmatched.length > 0 ? 3 : 4)}
              onSkip={() => setStep(4)}
            />
          )}
          {step === 3 && matchResult && (
            <Step3DragDropAssign
              unmatched={matchResult.unmatched}
              charts={reviewCharts}
              worklistId={worklistId}
              onResolved={(assigned, stillUnmatched) => {
                // Lift assigned-files into the matched list so the summary
                // step reflects the final state of the upload session.
                setMatchResult((prev) => prev && {
                  ...prev,
                  matched: [
                    ...prev.matched,
                    ...assigned.map((a) => ({
                      chartId: a.chartId,
                      chartNo: '',
                      filename: a.filename,
                      matchedBy: 'manual' as const,
                      storedKey: a.stagedKey,
                    })),
                  ],
                  unmatched: stillUnmatched,
                });
                if (stillUnmatched.length === 0) setStep(4);
              }}
              onSkip={() => setStep(4)}
            />
          )}
          {step === 4 && (
            <Step4Summary
              importResult={importResult}
              matchResult={matchResult}
              onDone={onClose}
            />
          )}
        </div>

        {/* Backdrop discard confirm */}
        {confirmDiscard && (
          <DiscardConfirm
            onCancel={() => setConfirmDiscard(false)}
            onConfirm={() => {
              setConfirmDiscard(false);
              onClose();
            }}
          />
        )}
      </div>
    </Modal>
  );
}

/* ═════════════════════════════════════════════════════════════
   Stepper
   ═════════════════════════════════════════════════════════════ */
function Stepper({ step, documentsOnly }: { step: Step; documentsOnly: boolean }) {
  const items: Array<{ key: Step; label: string }> = documentsOnly
    ? [
        { key: 2, label: 'Documents' },
        { key: 3, label: 'Review' },
        { key: 4, label: 'Done' },
      ]
    : [
        { key: 1, label: 'Charts (Excel)' },
        { key: 2, label: 'Documents' },
        { key: 3, label: 'Review' },
        { key: 4, label: 'Done' },
      ];
  return (
    <ol
      className="flex items-center gap-2 mt-5 text-[12px] font-semibold"
      role="list"
      aria-label="Bulk upload progress"
    >
      {items.map((it, i) => {
        const isDone = step > it.key;
        const isActive = step === it.key;
        return (
          <li key={it.key} className="flex items-center gap-2 min-w-0">
            <span
              className={cn(
                'inline-flex items-center justify-center w-6 h-6 rounded-full transition',
                isDone
                  ? 'bg-success text-white'
                  : isActive
                    ? 'bg-primary text-primary-ink ring-4 ring-primary-soft'
                    : 'bg-surface-sunken text-ink-subtle',
              )}
              aria-current={isActive ? 'step' : undefined}
            >
              {isDone ? <Check className="w-3.5 h-3.5" /> : it.key}
            </span>
            <span
              className={cn(
                'truncate',
                isActive ? 'text-ink' : isDone ? 'text-ink-muted' : 'text-ink-subtle',
              )}
            >
              {it.label}
            </span>
            {i < items.length - 1 && (
              <span
                className={cn(
                  'mx-1 h-px w-8 sm:w-12',
                  isDone ? 'bg-success/60' : 'bg-line',
                )}
                aria-hidden
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ═════════════════════════════════════════════════════════════
   Step 1 — Excel upload + preview
   ═════════════════════════════════════════════════════════════ */
function Step1ExcelUpload({
  file,
  setFile,
  preview,
  setPreview,
  importResult,
  setImportResult,
  worklistId,
  onContinue,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  preview: BulkImportPreview | null;
  setPreview: (p: BulkImportPreview | null) => void;
  importResult: BulkImportResult | null;
  setImportResult: (r: BulkImportResult | null) => void;
  worklistId: string;
  onContinue: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const previewMut = useMutation({
    mutationFn: (f: File) => bulkPreviewCharts(worklistId, f),
    onSuccess: (p) => {
      setPreview(p);
      setServerError(null);
    },
    onError: (err) => setServerError((err as unknown as ApiErrorShape).message),
  });

  const importMut = useMutation({
    mutationFn: (f: File) => bulkImportCharts(worklistId, f),
    onSuccess: (r) => {
      setImportResult(r);
      setServerError(null);
      onContinue();
    },
    onError: (err) => setServerError((err as unknown as ApiErrorShape).message),
  });

  function pickFile(f: File | null) {
    setFile(f);
    setPreview(null);
    setImportResult(null);
    setServerError(null);
    if (f) previewMut.mutate(f);
  }

  if (importResult) {
    // Already imported; show summary and let user move on (auto already did).
    return (
      <SuccessNudge
        title="Excel imported"
        body={`${formatNumber(importResult.inserted)} chart${importResult.inserted === 1 ? '' : 's'} added to the worklist.`}
      />
    );
  }

  return (
    <div className="space-y-5">
      {/* Header band: instructions + template download */}
      <div className="flex items-start justify-between gap-4 p-4 rounded-card bg-info-soft/40 border border-info/20">
        <div className="flex gap-3 min-w-0">
          <FileSpreadsheet className="w-5 h-5 text-info shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Upload your charts list</p>
            <p className="text-[13px] text-ink-muted mt-1 leading-relaxed">
              The Excel must have these exact headers in row 1:{' '}
              <code className="font-mono text-[12px] bg-surface px-1.5 py-0.5 rounded">A/C, MRN, DOS, ADM, DSC</code>.
              Dates accept <span className="font-mono">M/D/YYYY</span> or <span className="font-mono">YYYY-MM-DD</span>.
            </p>
          </div>
        </div>
        <a
          href={downloadBulkTemplateUrl()}
          className="btn btn-soft inline-flex items-center gap-1.5 shrink-0"
          aria-label="Download Excel template"
        >
          <Download className="w-3.5 h-3.5" />
          Template
        </a>
      </div>

      {/* File picker */}
      <FilePickerCard
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        multiple={false}
        file={file}
        loading={previewMut.isPending}
        onPick={(files) => pickFile(files[0] ?? null)}
        emptyHint="Drop your .xlsx file here or click to browse"
        icon={<FileSpreadsheet className="w-6 h-6 text-info" />}
      />

      {serverError && <ErrorBanner message={serverError} />}

      {/* Preview */}
      {preview && (
        <PreviewTable preview={preview} />
      )}

      <WizardFooter
        right={
          <Button
            onClick={() => file && importMut.mutate(file)}
            loading={importMut.isPending}
            disabled={!preview || preview.validRows === 0}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Import {preview ? `${preview.validRows} chart${preview.validRows === 1 ? '' : 's'}` : 'Charts'}
          </Button>
        }
      />
    </div>
  );
}

function PreviewTable({ preview }: { preview: BulkImportPreview }) {
  const ok = preview.validRows;
  const bad = preview.totalRows - preview.validRows;
  return (
    <div>
      <div className="flex items-center gap-3 mb-3 text-[13px]">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-success-soft text-success font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5" /> {ok} valid
        </span>
        {bad > 0 && (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill bg-danger-soft text-danger font-semibold">
            <AlertCircle className="w-3.5 h-3.5" /> {bad} need attention
          </span>
        )}
        <span className="text-ink-muted text-xs ml-auto">
          Showing first {Math.min(preview.rows.length, 8)} of {preview.totalRows}
        </span>
      </div>

      <div className="rounded-card border border-line overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-surface-sunken/60">
              <th className="table-head">Row</th>
              <th className="table-head">A/C</th>
              <th className="table-head">MRN</th>
              <th className="table-head">DOS</th>
              <th className="table-head">ADM</th>
              <th className="table-head">DSC</th>
              <th className="table-head">Issues</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.slice(0, 8).map((r) => (
              <tr
                key={r.row}
                className={cn(
                  'border-b border-line/60 last:border-0',
                  r.errors.length > 0 && 'bg-danger-soft/30',
                )}
              >
                <td className="table-cell font-mono text-xs text-ink-muted">{r.row}</td>
                <td className="table-cell font-mono text-xs">{r.chartNo || '—'}</td>
                <td className="table-cell font-mono text-xs">{r.mrNumber || '—'}</td>
                <td className="table-cell text-xs">{r.dos || '—'}</td>
                <td className="table-cell text-xs">{r.admitDate || '—'}</td>
                <td className="table-cell text-xs">{r.dischargeDate || '—'}</td>
                <td className="table-cell text-xs">
                  {r.errors.length === 0 ? (
                    <span className="text-success inline-flex items-center gap-1">
                      <Check className="w-3 h-3" /> OK
                    </span>
                  ) : (
                    <span className="text-danger" title={r.errors.join(' · ')}>
                      {r.errors[0]}
                      {r.errors.length > 1 && ` (+${r.errors.length - 1})`}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.errors.some((e) => e.row === 1) && (
        <p className="text-xs text-danger mt-3" role="alert">
          {preview.errors.find((e) => e.row === 1)!.message}
        </p>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Step 2 — Document upload + match counts
   ═════════════════════════════════════════════════════════════ */
function Step2DocumentUpload({
  files,
  setFiles,
  matchResult,
  setMatchResult,
  worklistId,
  importedCount,
  onContinue,
  onSkip,
}: {
  files: File[];
  setFiles: (f: File[]) => void;
  matchResult: BulkDocumentsResult | null;
  setMatchResult: (r: BulkDocumentsResult | null) => void;
  worklistId: string;
  importedCount: number;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);

  const uploadMut = useMutation({
    mutationFn: () => bulkUploadDocuments(worklistId, files, []),
    onSuccess: (r) => {
      setMatchResult(r);
      setServerError(null);
    },
    onError: (err) => setServerError((err as unknown as ApiErrorShape).message),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-4 rounded-card bg-info-soft/40 border border-info/20">
        <Folder className="w-5 h-5 text-info shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-ink">Upload documents for these charts</p>
          <p className="text-[13px] text-ink-muted mt-1 leading-relaxed">
            Drop a <span className="font-semibold">ZIP</span> where each folder is named after the A/C
            number, or loose files containing the A/C or MRN in the filename. We'll match them
            automatically. You can also skip this step and upload documents per-chart later.
          </p>
        </div>
      </div>

      <FilePickerCard
        accept=".zip,application/zip,application/x-zip-compressed,application/pdf,image/*"
        multiple={true}
        files={files}
        loading={uploadMut.isPending}
        onPick={(picked) => {
          setFiles(picked);
          setMatchResult(null);
        }}
        emptyHint="Drop a ZIP or multiple files here, or click to browse"
        icon={<Upload className="w-6 h-6 text-info" />}
      />

      {serverError && <ErrorBanner message={serverError} />}

      {matchResult && <MatchSummary matchResult={matchResult} totalCharts={importedCount} />}

      <WizardFooter
        left={
          <Button variant="ghost" onClick={onSkip}>
            Skip — no documents yet
          </Button>
        }
        right={
          matchResult ? (
            <Button onClick={onContinue} rightIcon={<ArrowRight className="w-3.5 h-3.5" />}>
              {matchResult.unmatched.length > 0
                ? `Review ${matchResult.unmatched.length} unmatched`
                : 'Continue'}
            </Button>
          ) : (
            <Button
              onClick={() => uploadMut.mutate()}
              loading={uploadMut.isPending}
              disabled={files.length === 0}
              rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
            >
              Upload &amp; Match
            </Button>
          )
        }
      />
    </div>
  );
}

function MatchSummary({
  matchResult,
  totalCharts,
}: {
  matchResult: BulkDocumentsResult;
  totalCharts: number;
}) {
  const chartsWithDocs = useMemo(() => {
    const ids = new Set(matchResult.matched.map((m) => m.chartId));
    return ids.size;
  }, [matchResult]);
  const matchedByFolder = matchResult.matched.filter((m) => m.matchedBy === 'folder').length;
  const matchedByChartNo = matchResult.matched.filter((m) => m.matchedBy === 'chartNo').length;
  const matchedByMrn = matchResult.matched.filter((m) => m.matchedBy === 'mrNumber').length;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3" aria-live="polite">
      <SummaryStat
        label="Charts with documents"
        value={`${chartsWithDocs} / ${totalCharts}`}
        tone="success"
        icon={<CheckCircle2 className="w-4 h-4" />}
      />
      <SummaryStat
        label="Files matched"
        value={String(matchResult.matched.length)}
        tone="info"
        icon={<FileText className="w-4 h-4" />}
        detail={[
          matchedByFolder ? `${matchedByFolder} via folder` : '',
          matchedByChartNo ? `${matchedByChartNo} via A/C` : '',
          matchedByMrn ? `${matchedByMrn} via MRN` : '',
        ]
          .filter(Boolean)
          .join(' · ')}
      />
      <SummaryStat
        label="Files unmatched"
        value={String(matchResult.unmatched.length)}
        tone={matchResult.unmatched.length > 0 ? 'warn' : 'muted'}
        icon={<HelpCircle className="w-4 h-4" />}
      />
    </div>
  );
}

function SummaryStat({
  label,
  value,
  tone,
  icon,
  detail,
}: {
  label: string;
  value: string;
  tone: 'success' | 'info' | 'warn' | 'muted';
  icon: React.ReactNode;
  detail?: string;
}) {
  const toneCard = {
    success: 'border-success/30 bg-success-soft/40',
    info: 'border-info/30 bg-info-soft/40',
    warn: 'border-warn/30 bg-warn-soft/40',
    muted: 'border-line bg-surface-sunken/40',
  }[tone];
  const toneIcon = {
    success: 'text-success',
    info: 'text-info',
    warn: 'text-warn',
    muted: 'text-ink-muted',
  }[tone];
  return (
    <div className={cn('rounded-card border p-4', toneCard)}>
      <div className={cn('flex items-center gap-2 text-xs font-semibold uppercase tracking-wide', toneIcon)}>
        {icon}
        {label}
      </div>
      <p className="text-2xl font-bold text-ink tracking-tightish mt-1.5 tabular-nums">{value}</p>
      {detail && <p className="text-[11px] text-ink-muted mt-1">{detail}</p>}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Step 3 — Drag-and-drop file assignment
   ═════════════════════════════════════════════════════════════ */
type UnmatchedFile = BulkDocumentsResult['unmatched'][number];
type WorklistChart = BulkImportResult['charts'][number];

function Step3DragDropAssign({
  unmatched,
  charts,
  worklistId,
  onResolved,
  onSkip,
}: {
  unmatched: UnmatchedFile[];
  charts: WorklistChart[];
  worklistId: string;
  /** Called after the assign-staged API commits. */
  onResolved: (assigned: Array<{ chartId: string; filename: string; stagedKey: string }>, stillUnmatched: UnmatchedFile[]) => void;
  onSkip: () => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  // Local-only state until the user clicks "Save". Maps stagedKey → chartId.
  const [pending, setPending] = useState<Record<string, string>>({});
  // Selection for bulk actions / multi-drag.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Drag UX
  const [dragOverChart, setDragOverChart] = useState<string | null>(null);
  // Filters
  const [fileQuery, setFileQuery] = useState('');
  const [chartQuery, setChartQuery] = useState('');

  const filteredUnmatched = useMemo(
    () => unmatched.filter((u) => u.filename.toLowerCase().includes(fileQuery.toLowerCase())),
    [unmatched, fileQuery],
  );
  const filteredCharts = useMemo(() => {
    const q = chartQuery.toLowerCase().trim();
    if (!q) return charts;
    return charts.filter((c) =>
      [String(c.serialNo), c.chartNo, c.mrNumber]
        .map((v) => String(v).toLowerCase())
        .some((v) => v.includes(q)),
    );
  }, [charts, chartQuery]);

  const filesByChart = useMemo(() => {
    const m = new Map<string, UnmatchedFile[]>();
    for (const u of unmatched) {
      const cid = pending[u.stagedKey];
      if (!cid) continue;
      const list = m.get(cid) ?? [];
      list.push(u);
      m.set(cid, list);
    }
    return m;
  }, [unmatched, pending]);

  const unassignedFiles = filteredUnmatched.filter((u) => !pending[u.stagedKey]);
  const assignedCount = Object.keys(pending).length;

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function clearSelection() { setSelected(new Set()); }

  function assignKeys(keys: string[], chartId: string) {
    setPending((prev) => {
      const next = { ...prev };
      for (const k of keys) next[k] = chartId;
      return next;
    });
    setSelected(new Set());
  }
  function unassign(key: string) {
    setPending((prev) => {
      const { [key]: _drop, ...rest } = prev;
      return rest;
    });
  }

  function onFileDragStart(e: React.DragEvent, key: string) {
    // If the dragged item is in the selection, transfer the whole set;
    // otherwise reduce the selection to just this one so the drop matches.
    const keys = selected.has(key) ? Array.from(selected) : [key];
    e.dataTransfer.setData('application/x-staged-keys', JSON.stringify(keys));
    e.dataTransfer.effectAllowed = 'move';
    if (!selected.has(key)) setSelected(new Set([key]));
  }
  function onChartDrop(e: React.DragEvent, chartId: string) {
    e.preventDefault();
    setDragOverChart(null);
    const raw = e.dataTransfer.getData('application/x-staged-keys');
    if (!raw) return;
    try {
      const keys = JSON.parse(raw) as string[];
      if (Array.isArray(keys) && keys.length > 0) assignKeys(keys, chartId);
    } catch {
      /* ignore */
    }
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      const assignments: AssignStagedRequest[] = [];
      for (const u of unmatched) {
        const cid = pending[u.stagedKey];
        if (!cid) continue;
        assignments.push({
          stagedKey: u.stagedKey,
          stagedUrl: u.stagedUrl,
          filename: u.filename,
          mimeType: u.mimeType,
          size: u.size,
          chartId: cid,
        });
      }
      return assignStagedDocuments(worklistId, assignments);
    },
    onSuccess: () => {
      setServerError(null);
      const assigned = unmatched
        .filter((u) => pending[u.stagedKey])
        .map((u) => ({ chartId: pending[u.stagedKey], filename: u.filename, stagedKey: u.stagedKey }));
      const stillUnmatched = unmatched.filter((u) => !pending[u.stagedKey]);
      onResolved(assigned, stillUnmatched);
    },
    onError: (err) => setServerError((err as unknown as ApiErrorShape).message),
  });

  return (
    <div className="space-y-4">
      {/* Top banner */}
      <div className="flex items-start gap-3 p-3.5 rounded-card bg-warn-soft/40 border border-warn/30">
        <HelpCircle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">
            {unmatched.length} file{unmatched.length === 1 ? '' : 's'} need a chart
          </p>
          <p className="text-[13px] text-ink-muted mt-0.5 leading-relaxed">
            Drag files onto a chart on the right, or select a few and use{' '}
            <span className="font-semibold text-ink">Assign to…</span> The files are already uploaded;
            saving just attaches them.
          </p>
        </div>
      </div>

      {/* Bulk-action toolbar — visible only when selection is non-empty */}
      {selected.size > 0 && (
        <BulkActionBar
          selectedCount={selected.size}
          charts={charts}
          onAssign={(chartId) => assignKeys(Array.from(selected), chartId)}
          onClear={clearSelection}
        />
      )}

      {/* Two-panel grid: files | charts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" style={{ minHeight: 360 }}>
        {/* LEFT — files */}
        <FilesPanel
          files={unassignedFiles}
          totalUnmatched={unmatched.length}
          fileQuery={fileQuery}
          setFileQuery={setFileQuery}
          selected={selected}
          toggleSelect={toggleSelect}
          onDragStart={onFileDragStart}
        />

        {/* RIGHT — charts */}
        <ChartsPanel
          charts={filteredCharts}
          chartQuery={chartQuery}
          setChartQuery={setChartQuery}
          filesByChart={filesByChart}
          dragOverChart={dragOverChart}
          setDragOverChart={setDragOverChart}
          onDrop={onChartDrop}
          onUnassign={unassign}
        />
      </div>

      {serverError && <ErrorBanner message={serverError} />}

      <WizardFooter
        left={
          <Button variant="ghost" onClick={onSkip}>
            Skip remaining
          </Button>
        }
        right={
          <Button
            onClick={() => saveMut.mutate()}
            loading={saveMut.isPending}
            disabled={assignedCount === 0}
            rightIcon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            Save {assignedCount} assignment{assignedCount === 1 ? '' : 's'}
          </Button>
        }
      />
    </div>
  );
}

function FilesPanel({
  files,
  totalUnmatched,
  fileQuery,
  setFileQuery,
  selected,
  toggleSelect,
  onDragStart,
}: {
  files: UnmatchedFile[];
  totalUnmatched: number;
  fileQuery: string;
  setFileQuery: (s: string) => void;
  selected: Set<string>;
  toggleSelect: (key: string) => void;
  onDragStart: (e: React.DragEvent, key: string) => void;
}) {
  return (
    <div className="rounded-card border border-line bg-surface flex flex-col overflow-hidden">
      <div className="px-3.5 py-3 border-b border-line">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">Unassigned files</p>
          <span className="text-[11px] text-ink-subtle tabular-nums">
            {files.length} / {totalUnmatched}
          </span>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            placeholder="Filter by filename…"
            value={fileQuery}
            onChange={(e) => setFileQuery(e.target.value)}
            className="w-full h-8 pl-7 pr-2 rounded-pill border border-line bg-surface-sunken/60 text-xs focus:outline-none focus:border-primary"
            aria-label="Filter files"
          />
        </div>
      </div>
      <div className="overflow-y-auto flex-1 p-2 space-y-1.5" style={{ maxHeight: 360 }}>
        {files.length === 0 ? (
          <EmptyState
            icon={<Inbox className="w-5 h-5" />}
            label={
              totalUnmatched === 0
                ? 'All files are assigned'
                : fileQuery
                  ? 'No files match this filter'
                  : 'Every unmatched file has been routed'
            }
          />
        ) : (
          files.map((f) => (
            <FileChip
              key={f.stagedKey}
              file={f}
              isSelected={selected.has(f.stagedKey)}
              onToggle={() => toggleSelect(f.stagedKey)}
              onDragStart={(e) => onDragStart(e, f.stagedKey)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FileChip({
  file,
  isSelected,
  onToggle,
  onDragStart,
}: {
  file: UnmatchedFile;
  isSelected: boolean;
  onToggle: () => void;
  onDragStart: (e: React.DragEvent) => void;
}) {
  const Icon = fileIcon(file.filename);
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onToggle();
        }
      }}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      aria-label={`${file.filename}, ${isSelected ? 'selected' : 'not selected'}`}
      className={cn(
        'group flex items-center gap-2.5 px-3 py-2 rounded-lg border transition cursor-grab active:cursor-grabbing',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        isSelected
          ? 'border-primary bg-primary-soft/40'
          : 'border-line hover:border-line-strong hover:bg-surface-sunken/40',
      )}
    >
      <GripVertical className="w-3.5 h-3.5 text-ink-subtle shrink-0 group-hover:text-ink-muted" />
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => {}}
        onClick={(e) => e.stopPropagation()}
        className="checkbox shrink-0"
        aria-label="Select file"
        tabIndex={-1}
      />
      <Icon className="w-3.5 h-3.5 text-ink-muted shrink-0" />
      <span className="flex-1 min-w-0 text-xs font-mono text-ink truncate">{file.filename}</span>
      <span className="text-[10px] text-ink-subtle tabular-nums shrink-0">
        {(file.size / 1024).toFixed(0)} KB
      </span>
    </div>
  );
}

function ChartsPanel({
  charts,
  chartQuery,
  setChartQuery,
  filesByChart,
  dragOverChart,
  setDragOverChart,
  onDrop,
  onUnassign,
}: {
  charts: WorklistChart[];
  chartQuery: string;
  setChartQuery: (s: string) => void;
  filesByChart: Map<string, UnmatchedFile[]>;
  dragOverChart: string | null;
  setDragOverChart: (id: string | null) => void;
  onDrop: (e: React.DragEvent, chartId: string) => void;
  onUnassign: (stagedKey: string) => void;
}) {
  return (
    <div className="rounded-card border border-line bg-surface flex flex-col overflow-hidden">
      <div className="px-3.5 py-3 border-b border-line">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">Charts in worklist</p>
          <span className="text-[11px] text-ink-subtle tabular-nums">{charts.length}</span>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted" />
          <input
            type="text"
            placeholder="Search by serial, A/C, or MRN…"
            value={chartQuery}
            onChange={(e) => setChartQuery(e.target.value)}
            className="w-full h-8 pl-7 pr-2 rounded-pill border border-line bg-surface-sunken/60 text-xs focus:outline-none focus:border-primary"
            aria-label="Search charts"
          />
        </div>
      </div>
      <div className="overflow-y-auto flex-1 p-2 space-y-1.5" style={{ maxHeight: 360 }}>
        {charts.map((c) => (
          <ChartDropTarget
            key={c.id}
            chart={c}
            assigned={filesByChart.get(c.id) ?? []}
            isDragOver={dragOverChart === c.id}
            setDragOver={(over) => setDragOverChart(over ? c.id : null)}
            onDrop={(e) => onDrop(e, c.id)}
            onUnassign={onUnassign}
          />
        ))}
        {charts.length === 0 && (
          <EmptyState icon={<Search className="w-5 h-5" />} label="No charts match this search" />
        )}
      </div>
    </div>
  );
}

function ChartDropTarget({
  chart,
  assigned,
  isDragOver,
  setDragOver,
  onDrop,
  onUnassign,
}: {
  chart: WorklistChart;
  assigned: UnmatchedFile[];
  isDragOver: boolean;
  setDragOver: (over: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  onUnassign: (stagedKey: string) => void;
}) {
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (!isDragOver) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={cn(
        'rounded-lg border transition px-3 py-2.5',
        isDragOver
          ? 'border-primary bg-primary-soft/40 ring-2 ring-primary/40'
          : assigned.length > 0
            ? 'border-success/40 bg-success-soft/20'
            : 'border-line hover:border-line-strong',
      )}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-[11px] text-ink-subtle shrink-0">#{chart.serialNo}</span>
        <span className="font-mono text-xs font-semibold text-ink truncate">{chart.chartNo || '—'}</span>
        <span className="text-[11px] text-ink-muted shrink-0">·</span>
        <span className="text-[11px] text-ink-muted font-mono truncate">MRN {chart.mrNumber || '—'}</span>
        {assigned.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded-pill bg-success-soft text-success text-[10px] font-bold shrink-0">
            <CheckCircle2 className="w-3 h-3" />
            {assigned.length}
          </span>
        )}
      </div>
      {assigned.length > 0 && (
        <ul className="mt-2 space-y-1 pl-1">
          {assigned.map((f) => {
            const Icon = fileIcon(f.filename);
            return (
              <li
                key={f.stagedKey}
                className="flex items-center gap-1.5 text-[11px] text-ink-muted bg-surface rounded px-1.5 py-1 border border-line/60"
              >
                <Icon className="w-3 h-3 shrink-0" />
                <span className="flex-1 font-mono truncate">{f.filename}</span>
                <button
                  type="button"
                  onClick={() => onUnassign(f.stagedKey)}
                  className="w-5 h-5 rounded-full hover:bg-surface-sunken flex items-center justify-center shrink-0"
                  aria-label={`Remove ${f.filename} from this chart`}
                >
                  <XIcon className="w-2.5 h-2.5 text-ink-muted" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function BulkActionBar({
  selectedCount,
  charts,
  onAssign,
  onClear,
}: {
  selectedCount: number;
  charts: WorklistChart[];
  onAssign: (chartId: string) => void;
  onClear: () => void;
}) {
  return (
    <div
      role="region"
      aria-label="Bulk action bar"
      className="flex items-center gap-3 px-3.5 py-2 rounded-card border border-primary/30 bg-primary-soft/40"
    >
      <span className="text-xs font-semibold text-ink">
        {selectedCount} file{selectedCount === 1 ? '' : 's'} selected
      </span>
      <Select
        defaultValue=""
        onChange={(e) => {
          if (e.target.value) {
            onAssign(e.target.value);
            e.target.value = '';
          }
        }}
        className="!h-8 !py-0 text-xs max-w-xs"
        aria-label="Assign selected files to a chart"
      >
        <option value="">Assign to…</option>
        {charts.map((c) => (
          <option key={c.id} value={c.id}>
            #{c.serialNo} · {c.chartNo} · MRN {c.mrNumber}
          </option>
        ))}
      </Select>
      <button
        type="button"
        onClick={onClear}
        className="ml-auto text-[11px] text-ink-muted hover:text-ink"
      >
        Clear selection
      </button>
    </div>
  );
}

function EmptyState({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-8 text-ink-muted text-xs">
      <span className="text-ink-subtle">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function fileIcon(filename: string) {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (['png', 'jpg', 'jpeg', 'tif', 'tiff'].includes(ext)) return ImageIcon;
  if (ext === 'pdf') return FileText;
  return FileIcon;
}

/* ═════════════════════════════════════════════════════════════
   Step 4 — Done summary
   ═════════════════════════════════════════════════════════════ */
function Step4Summary({
  importResult,
  matchResult,
  onDone,
}: {
  importResult: BulkImportResult | null;
  matchResult: BulkDocumentsResult | null;
  onDone: () => void;
}) {
  const inserted = importResult?.inserted ?? 0;
  const matched = matchResult?.matched.length ?? 0;
  const unmatched = matchResult?.unmatched.length ?? 0;
  return (
    <div className="text-center py-8 space-y-5">
      <div className="w-16 h-16 rounded-full bg-success-soft text-success flex items-center justify-center mx-auto">
        <Check className="w-7 h-7" />
      </div>
      <div>
        <h4 className="text-xl font-bold text-ink">All set</h4>
        <p className="text-sm text-ink-muted mt-1">
          {inserted > 0 && <>{formatNumber(inserted)} chart{inserted === 1 ? '' : 's'} added. </>}
          {matched > 0 && <>{formatNumber(matched)} document{matched === 1 ? '' : 's'} attached. </>}
          {unmatched > 0 && <>{formatNumber(unmatched)} skipped.</>}
          {inserted === 0 && matched === 0 && unmatched === 0 && 'Nothing to do.'}
        </p>
      </div>
      <Button onClick={onDone}>Close</Button>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════
   Shared bits
   ═════════════════════════════════════════════════════════════ */
function FilePickerCard({
  accept,
  multiple,
  file,
  files,
  loading,
  onPick,
  emptyHint,
  icon,
}: {
  accept: string;
  multiple: boolean;
  file?: File | null;
  files?: File[];
  loading: boolean;
  onPick: (files: File[]) => void;
  emptyHint: string;
  icon: React.ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOver, setIsOver] = useState(false);
  const list = files ?? (file ? [file] : []);

  function handleFiles(fl: FileList | null) {
    if (!fl || fl.length === 0) return;
    onPick(multiple ? Array.from(fl) : [fl[0]]);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsOver(false);
        handleFiles(e.dataTransfer.files);
      }}
      className={cn(
        'relative rounded-card border-2 border-dashed transition-colors px-6 py-8 cursor-pointer',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        'focus-visible:ring-offset-surface',
        isOver
          ? 'border-primary bg-primary-soft/30'
          : list.length > 0
            ? 'border-success/40 bg-success-soft/20'
            : 'border-line hover:border-primary/40 hover:bg-surface-sunken/40',
      )}
      aria-label={emptyHint}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {loading ? (
        <div className="flex flex-col items-center gap-2 text-ink-muted">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          <p className="text-sm">Processing…</p>
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 text-center">
          {icon}
          <p className="text-sm font-semibold text-ink">{emptyHint}</p>
          <p className="text-xs text-ink-muted">Up to 50&nbsp;MB per file.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-ink">
            <CheckCircle2 className="w-4 h-4 text-success" />
            <span className="font-semibold">
              {list.length === 1
                ? list[0].name
                : `${list.length} files selected`}
            </span>
          </div>
          {list.length > 1 && (
            <ul className="text-xs text-ink-muted max-h-20 overflow-y-auto w-full max-w-md space-y-0.5">
              {list.slice(0, 6).map((f) => (
                <li key={f.name} className="flex items-center gap-1.5 font-mono truncate">
                  <Tag className="w-3 h-3 shrink-0" />
                  <span className="truncate">{f.name}</span>
                </li>
              ))}
              {list.length > 6 && <li className="text-ink-subtle">… and {list.length - 6} more</li>}
            </ul>
          )}
          <p className="text-xs text-ink-muted">
            Click or drag in to {multiple ? 'change selection' : 'replace file'}.
          </p>
        </div>
      )}
    </div>
  );
}

function WizardFooter({ left, right }: { left?: React.ReactNode; right: React.ReactNode }) {
  return (
    <ModalFooter>
      <div className="flex-1">{left}</div>
      {right}
    </ModalFooter>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-danger-soft text-danger border border-danger/30 text-xs"
    >
      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function SuccessNudge({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-card bg-success-soft/40 border border-success/30">
      <CheckCircle2 className="w-5 h-5 text-success shrink-0 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-[13px] text-ink-muted mt-1">{body}</p>
      </div>
    </div>
  );
}

function DiscardConfirm({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm rounded-[20px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-surface rounded-card shadow-pop dark:shadow-pop-dark p-6 max-w-sm w-full mx-4">
        <h4 className="text-base font-bold text-ink mb-1">Discard upload?</h4>
        <p className="text-sm text-ink-muted">
          You have unsaved work in this wizard. Closing now will lose progress for the current step.
        </p>
        <ModalFooter>
          <Button variant="ghost" onClick={onCancel} leftIcon={<ArrowLeft className="w-3.5 h-3.5" />}>
            Keep working
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            Discard
          </Button>
        </ModalFooter>
      </div>
    </div>
  );
}
