"use client";

/**
 * Web port of frontend/lib/screens/export_screen.dart.
 * Same folder-name dialog gate (only shown when processedImagesPath is set),
 * same exporting/completed/failed sub-states, same QA report rows.
 */
import { useEffect, useRef, useState } from "react";
import { useNestingJobStore } from "@/lib/nestingJobStore";
import { saveExportedTiff } from "@/lib/exportFileSaver";
import { WorkflowStepper } from "./WorkflowStepper";
import { ViolationListTile } from "./ViolationListTile";
import type { NestingJob } from "@/types/nestingJob";

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function timestamp(): string {
  const now = new Date();
  return (
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}` +
    `_${pad2(now.getHours())}-${pad2(now.getMinutes())}-${pad2(now.getSeconds())}`
  );
}

export function ExportScreen({ onDone }: { onDone: () => void }) {
  const job = useNestingJobStore((s) => s.job);
  const exportProgressDone = useNestingJobStore((s) => s.exportProgressDone);
  const exportProgressTotal = useNestingJobStore((s) => s.exportProgressTotal);
  const exportProgressMessage = useNestingJobStore(
    (s) => s.exportProgressMessage,
  );
  const confirmAndExport = useNestingJobStore((s) => s.confirmAndExport);
  const downloadExportedFile = useNestingJobStore(
    (s) => s.downloadExportedFile,
  );
  const startNewJob = useNestingJobStore((s) => s.startNewJob);

  const [dialogOpen, setDialogOpen] = useState(false);
  const triggered = useRef(false);

  const runExport = (folderName?: string) => {
    void confirmAndExport(folderName);
  };

  useEffect(() => {
    if (triggered.current) return;
    if (job.stage !== "proofPreview") return;
    triggered.current = true;
    const hasProcessedPath = job.settings.processedImagesPath.trim().length > 0;
    if (hasProcessedPath) {
      setDialogOpen(true);
    } else {
      runExport(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveCopy = async () => {
    const bytes = job.exportedFileBytes;
    if (!bytes || bytes.length === 0) return;
    await saveExportedTiff(bytes, `sheet_layout_${Date.now()}.tiff`);
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <h1 className="flex-1 text-lg font-bold text-slate-900">
          التصدير والتحقق النهائي
        </h1>
      </header>

      <div className="px-5 pb-1 pt-3">
        <WorkflowStepper currentStage="completed" />
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        {job.stage === "exporting" && (
          <ExportingState
            done={exportProgressDone}
            total={exportProgressTotal}
            message={exportProgressMessage}
          />
        )}
        {job.stage === "completed" && (
          <CompletedState
            job={job}
            onSave={() => void handleSaveCopy()}
            onDownloadAgain={() => void downloadExportedFile()}
            onNew={() => {
              startNewJob();
              onDone();
            }}
          />
        )}
        {job.stage === "failed" && (
          <FailedState
            message={job.errorMessage ?? "حدث خطأ غير متوقع"}
            onRetry={() => {
              const hasProcessedPath =
                job.settings.processedImagesPath.trim().length > 0;
              if (hasProcessedPath) setDialogOpen(true);
              else runExport(undefined);
            }}
          />
        )}
        {job.stage !== "exporting" &&
          job.stage !== "completed" &&
          job.stage !== "failed" && (
            <ExportingState
              done={exportProgressDone}
              total={exportProgressTotal}
              message={exportProgressMessage}
            />
          )}
      </main>

      {dialogOpen && (
        <FolderNameDialog
          onCancel={() => {
            setDialogOpen(false);
            onDone();
          }}
          onConfirm={(name) => {
            setDialogOpen(false);
            runExport(name);
          }}
        />
      )}
    </div>
  );
}

function FolderNameDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const preview = () => {
    const trimmed = name.trim();
    const ts = timestamp();
    return trimmed.length === 0 ? ts : `${trimmed}_${ts}`;
  };

  const submit = () => {
    const trimmed = name.trim();
    if (/[/\\]/.test(trimmed)) {
      setError("الاسم لا يمكن أن يحتوي على / أو \\");
      return;
    }
    onConfirm(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-[380px] rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="text-base font-bold text-slate-900">اسم مجلد الصور</h2>
        <p className="mt-2 text-[13px] leading-[1.5] text-slate-600">
          اكتب اسمًا للمجلد اللي هيتحفظ فيه الصور.
          <br />
          التاريخ هيتضاف تلقائيًا بجانب الاسم.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          placeholder="مثال: طلبية_أحمد"
          className="mt-3.5 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
        <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          <p className="text-[11px] text-slate-500">اسم المجلد النهائي:</p>
          <p className="mt-[3px] font-mono text-[13px] font-bold text-primary">
            {preview()}
          </p>
          <p className="mt-1.5 whitespace-pre-line font-mono text-[11px] leading-[1.6] text-slate-500">
            {"placed/  ← الصور المرتبة\nunplaced/  ← الصور غير المرتبة"}
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600"
          >
            إلغاء
          </button>
          <button
            onClick={submit}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            تأكيد وتصدير
          </button>
        </div>
      </div>
    </div>
  );
}

function ExportingState({
  done,
  total,
  message,
}: {
  done: number | null;
  total: number | null;
  message: string | null;
}) {
  const hasFraction = done != null && total != null && total > 0;
  const fraction = hasFraction ? Math.min(1, Math.max(0, done / total)) : null;
  return (
    <div className="flex h-full items-center justify-center p-7">
      <div className="w-full max-w-[430px] text-center">
        {fraction == null ? (
          <div className="mx-auto h-[54px] w-[54px] animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
        ) : (
          <div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-primary transition-[width] duration-300"
                style={{ width: `${fraction * 100}%` }}
              />
            </div>
            <p className="mt-2 text-[13px] font-extrabold text-primary">
              {Math.round(fraction * 100)}%
            </p>
          </div>
        )}
        <h2 className="mt-[18px] text-base font-extrabold text-slate-900">
          جاري إنشاء TIFF وتشغيل الفحص النهائي
        </h2>
        <p className="mt-2 text-[12.2px] leading-[1.5] text-slate-500">
          {message ??
            "الباك إند يعيد فحص الـlayout قبل الراسترة ثم يتحقق من الأبعاد والـDPI والـICC والclearance."}
        </p>
      </div>
    </div>
  );
}

// Same static-scan fix as elsewhere: template literals like
// `bg-${statusColor}/[0.06]` are invisible to Tailwind's build-time class
// scanner and silently drop from the compiled CSS, so both full states this
// screen can show are spelled out here as whole literal class strings.
const COMPLETED_STATUS_STYLES = {
  success: {
    card: "border-success/[0.26] bg-success/[0.06]",
    iconWrap: "bg-success/[0.12] text-success",
    title: "text-success",
  },
  warning: {
    card: "border-warning/[0.26] bg-warning/[0.06]",
    iconWrap: "bg-warning/[0.12] text-warning",
    title: "text-warning",
  },
} as const;

function CompletedState({
  job,
  onSave,
  onDownloadAgain,
  onNew,
}: {
  job: NestingJob;
  onSave: () => void;
  onDownloadAgain: () => void;
  onNew: () => void;
}) {
  const report = job.qaReport;
  const accepted = report
    ? report.exportAccepted &&
      report.checkedDimension &&
      report.checkedDpi &&
      report.checkedIccAndMode &&
      report.checkedLayers &&
      report.violations.length === 0
    : false;
  const result = job.computeResult;
  const statusStyles = accepted
    ? COMPLETED_STATUS_STYLES.success
    : COMPLETED_STATUS_STYLES.warning;

  return (
    <div className="space-y-3.5 p-4.5">
      <div
        className={`rounded-[18px] border p-5.5 text-center ${statusStyles.card}`}
      >
        <div
          className={`mx-auto flex h-[66px] w-[66px] items-center justify-center rounded-full ${statusStyles.iconWrap}`}
        >
          {accepted ? <CheckGlyph /> : <WarnGlyph />}
        </div>
        <h2 className={`mt-3.5 text-lg font-black ${statusStyles.title}`}>
          {accepted ? "تم التصدير والتحقق بنجاح" : "تم التصدير مع ملاحظات"}
        </h2>
        <p className="mt-1.5 text-[12.5px] leading-[1.5] text-slate-600">
          {result?.layoutMessage ?? "اكتمل التصدير."}
        </p>
      </div>

      {result && (
        <div className="flex gap-2">
          <MiniResult
            value={String(result.placedParts.length)}
            label="مرتبة"
            color="success"
          />
          <MiniResult
            value={String(result.sheets.length)}
            label="ورقة TIFF"
            color="info"
          />
          <MiniResult
            value={`${report?.widthPx ?? 0}px`}
            label="عرض التصدير"
            color="info"
          />
        </div>
      )}

      {report && (
        <div>
          <p className="mb-2 text-sm font-extrabold text-slate-900">نتيجة QA</p>
          <QaRow label="الأبعاد" pass={report.checkedDimension} />
          <QaRow
            label={`DPI (${report.dpi.toFixed(0)})`}
            pass={report.checkedDpi}
          />
          <QaRow label="ICC / Color Mode" pass={report.checkedIccAndMode} />
          <QaRow
            label={`طبقات قابلة للتحرير (${report.layerCount})`}
            pass={report.checkedLayers}
          />
          <QaRow
            label="Clearance"
            pass={
              !report.violations.some(
                (v) =>
                  v.severity === "clearance_violation" ||
                  v.severity === "overlap",
              )
            }
          />
          {report.movedProcessedImagesCount > 0 && (
            <ArchiveNotice
              count={report.movedProcessedImagesCount}
              directory={report.processedImagesDirectory}
            />
          )}
        </div>
      )}

      {report && report.violations.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-extrabold text-danger">مخالفات QA</p>
          {report.violations.map((v, i) => (
            <ViolationListTile key={i} violation={v} />
          ))}
        </div>
      )}

      {job.errorMessage && <DownloadWarning message={job.errorMessage} />}

      <button
        onClick={job.exportedFileBytes == null ? onDownloadAgain : onSave}
        className="flex w-full items-center justify-center gap-2 rounded-[11px] bg-primary px-5 py-3.5 text-sm font-semibold text-white"
      >
        {job.exportedFileBytes == null
          ? "إعادة تنزيل ملف TIFF"
          : "حفظ ملف TIFF على الجهاز"}
      </button>
      <button
        onClick={onNew}
        className="w-full rounded-[11px] border border-slate-300 px-5 py-3.5 text-sm font-semibold text-slate-700"
      >
        بدء مهمة جديدة
      </button>
    </div>
  );
}

function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[34px] w-[34px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}
function WarnGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[34px] w-[34px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
      />
    </svg>
  );
}

const MINI_RESULT_STYLES = {
  success: "text-success",
  info: "text-info",
} as const;

function MiniResult({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: keyof typeof MINI_RESULT_STYLES;
}) {
  return (
    <div className="flex-1 rounded-2xl border border-slate-200 bg-white py-3 text-center">
      <p className={`text-[15px] font-black ${MINI_RESULT_STYLES[color]}`}>
        {value}
      </p>
      <p className="mt-[3px] text-[10.5px] text-slate-500">{label}</p>
    </div>
  );
}

function QaRow({ label, pass }: { label: string; pass: boolean }) {
  return (
    <div
      className={`mb-1.5 flex items-center gap-2 rounded-[10px] border px-3 py-2.5 ${
        pass
          ? "border-success/[0.16] bg-success/[0.045]"
          : "border-danger/[0.16] bg-danger/[0.06]"
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className={`h-[17px] w-[17px] shrink-0 ${pass ? "text-success" : "text-danger"}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        {pass ? (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
          />
        ) : (
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 6l12 12M18 6L6 18"
          />
        )}
      </svg>
      <p
        className={`text-[12.2px] font-bold ${pass ? "text-slate-700" : "text-danger"}`}
      >
        {label}
      </p>
    </div>
  );
}

function ArchiveNotice({
  count,
  directory,
}: {
  count: number;
  directory?: string;
}) {
  return (
    <div className="mt-2.5 flex items-center gap-2 rounded-[10px] border border-success/[0.2] bg-success/[0.06] p-3">
      <svg
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px] shrink-0 text-success"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 7h4l2-2h6l2 2h4v12H3V7z"
        />
      </svg>
      <p className="flex-1 text-[11.8px] leading-[1.4] text-slate-700">
        {!directory || directory.length === 0
          ? `تم نقل ${count} صورة أصلية بعد نجاح الفحص.`
          : `تم نقل ${count} صورة أصلية إلى: ${directory}`}
      </p>
    </div>
  );
}

function DownloadWarning({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-warning/[0.2] bg-warning/[0.07] p-3">
      <svg
        viewBox="0 0 24 24"
        className="h-[18px] w-[18px] shrink-0 text-warning"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 15a4 4 0 010-8 5 5 0 019.6-1.5A4.5 4.5 0 0118 15H3z"
        />
        <path strokeLinecap="round" d="M3 3l18 18" />
      </svg>
      <p className="flex-1 text-[11.8px] leading-[1.4] text-slate-700">
        {message}
      </p>
    </div>
  );
}

function FailedState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full items-center justify-center p-7">
      <div className="text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center text-danger">
          <svg
            viewBox="0 0 24 24"
            className="h-full w-full"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 8v5M12 16h.01" />
          </svg>
        </div>
        <p className="mt-3.5 text-[13px] leading-[1.5] text-slate-700">
          {message}
        </p>
        <button
          onClick={onRetry}
          className="mt-5 rounded-[11px] bg-primary px-5 py-3 text-sm font-semibold text-white"
        >
          إعادة التصدير
        </button>
      </div>
    </div>
  );
}
