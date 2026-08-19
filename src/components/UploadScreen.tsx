"use client";

/**
 * Web port of frontend/lib/screens/upload_screen.dart.
 */
import { useRef, useState } from "react";
import { useNestingJobStore } from "@/lib/nestingJobStore";
import { pickImageFolder } from "@/lib/imageFolderPicker";
import { WorkflowStepper } from "./WorkflowStepper";
import { SettingsSheet } from "./SettingsSheet";
import type { UploadedPart } from "@/types/sheetPart";

function fileToUploadedPart(
  file: File,
  bytes: Uint8Array,
  base: number,
  index: number,
): UploadedPart {
  return {
    id: `${base}_${index}_${file.name}`,
    fileName: file.name,
    filePath: "",
    bytes,
    validationStatus: "pending",
  };
}

async function readFilesAsParts(files: File[]): Promise<UploadedPart[]> {
  const base = Date.now();
  const parts: UploadedPart[] = [];
  for (let i = 0; i < files.length; i++) {
    const buffer = await files[i].arrayBuffer();
    parts.push(fileToUploadedPart(files[i], new Uint8Array(buffer), base, i));
  }
  return parts;
}

export function UploadScreen({ onProceed }: { onProceed: () => void }) {
  const job = useNestingJobStore((s) => s.job);
  const uploading = useNestingJobStore((s) => s.uploading);
  const uploadProgress = useNestingJobStore((s) => s.uploadProgress);
  const serverReachable = useNestingJobStore((s) => s.serverReachable);
  const hasResumableJob = useNestingJobStore((s) => s.hasResumableJob());
  const initializing = useNestingJobStore((s) => s.initializing);
  const addUploadedParts = useNestingJobStore((s) => s.addUploadedParts);
  const removeUploadedPart = useNestingJobStore((s) => s.removeUploadedPart);
  const clearAllParts = useNestingJobStore((s) => s.clearAllParts);
  const resumePendingUploads = useNestingJobStore(
    (s) => s.resumePendingUploads,
  );
  const refreshCurrentJob = useNestingJobStore((s) => s.refreshCurrentJob);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const valid = job.uploadedParts.filter(
    (p) => p.validationStatus === "valid",
  ).length;
  const rejected = job.uploadedParts.filter(
    (p) => p.validationStatus === "rejected",
  ).length;
  const pending = job.uploadedParts.filter(
    (p) => p.validationStatus === "pending",
  ).length;
  const canProceed = job.uploadedParts.length > 0 && pending === 0 && valid > 0;

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const parts = await readFilesAsParts(Array.from(files));
    await addUploadedParts(parts);
  };

  const handlePickFolder = async () => {
    const files = await pickImageFolder();
    if (files.length === 0) return;
    const parts = await readFilesAsParts(files);
    await addUploadedParts(parts);
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/walid_logo.jpg" alt="Walid Logo" className="h-8 w-8 rounded-[8px] object-cover shadow-sm" />
        <h1 className="flex-1 text-lg font-bold text-slate-900">وليد - تجهيز الصور</h1>
        <ServerBadge reachable={serverReachable} />
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          title="إعدادات الشيت"
        >
          <TuneIcon />
        </button>
      </header>

      <div className="px-5 pt-3 pb-1">
        <WorkflowStepper currentStage="upload" />
      </div>

      <main className="flex-1 overflow-y-auto px-4 pb-6 pt-2">
        <HeaderBlock
          total={job.uploadedParts.length}
          valid={valid}
          rejected={rejected}
          pending={pending}
        />

        {hasResumableJob && !initializing && (
          <ResumeBanner
            total={job.uploadedParts.length}
            pending={pending}
            uploading={uploading}
            onResume={resumePendingUploads}
          />
        )}

        <DropCard
          onPick={() => fileInputRef.current?.click()}
          onPickFolder={handlePickFolder}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleFilesSelected(e.target.files);
            e.target.value = "";
          }}
        />

        {uploading && <UploadProgressCard progress={uploadProgress} />}
        {job.errorMessage && <ErrorBanner message={job.errorMessage} />}
        {rejected > 0 && (
          <RejectedBanner count={rejected} onRecheck={refreshCurrentJob} />
        )}

        {job.uploadedParts.length > 0 && (
          <div className="mt-3.5">
            <div className="mb-1.5 flex items-center">
              <span className="flex-1 text-sm font-extrabold text-slate-900">
                الصور المحددة
              </span>
              <button
                onClick={() => clearAllParts()}
                disabled={uploading}
                className="flex items-center gap-1 text-xs font-semibold text-primary disabled:opacity-40"
              >
                مسح الكل
              </button>
            </div>
            <div className="space-y-2">
              {job.uploadedParts.map((part) => (
                <PartCard
                  key={part.id}
                  part={part}
                  onRemove={() => removeUploadedPart(part.id)}
                />
              ))}
            </div>
          </div>
        )}
      </main>

      <BottomBar
        total={job.uploadedParts.length}
        canProceed={canProceed}
        busy={uploading || pending > 0}
        onAddMore={() => fileInputRef.current?.click()}
        onProceed={onProceed}
      />

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function TuneIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4 6h10M4 12h16M4 18h10M18 4v4M10 10v4"
      />
    </svg>
  );
}

function ServerBadge({ reachable }: { reachable: boolean }) {
  const color = reachable ? "success" : "warning";
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-${color} border-${color}/25 bg-${color}/[0.08]`}
      title={reachable ? "الخادم متصل" : "الخادم غير متصل"}
    >
      <span className={`h-[7px] w-[7px] rounded-full bg-${color}`} />
      <span className="text-[11px] font-bold">
        {reachable ? "متصل" : "انتظار"}
      </span>
    </div>
  );
}

function HeaderBlock({
  total,
  valid,
  rejected,
  pending,
}: {
  total: number;
  valid: number;
  rejected: number;
  pending: number;
}) {
  return (
    <div className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-[0_1px_2px_var(--card-shadow)]">
      <h2 className="text-[19px] font-extrabold text-slate-900">
        يا وليد، جاهز لترتيب الشيت؟
      </h2>
      <p className="mt-[5px] text-[12.5px] leading-[1.5] text-slate-500">
        ارفع صورك بأي صيغة: PNG أو JPG أو JPEG أو WebP أو TIFF وغيرها. السيرفر
        يجهزها تلقائيًا ويحلل الـcontour قبل الترتيب.
      </p>
      <div className="mt-3.5 flex flex-wrap gap-2">
        <MetricChip label={`${total} صورة`} color="slate-700" />
        <MetricChip label={`${valid} صالحة`} color="success" />
        {pending > 0 && (
          <MetricChip label={`${pending} قيد الفحص`} color="info" />
        )}
        {rejected > 0 && (
          <MetricChip label={`${rejected} مرفوضة`} color="danger" />
        )}
      </div>
    </div>
  );
}

function MetricChip({ label, color }: { label: string; color: string }) {
  return (
    <span
      className={`rounded-[9px] border px-2.5 py-1.5 text-[11.5px] font-bold text-${color} border-${color}/[0.16] bg-${color}/[0.07]`}
    >
      {label}
    </span>
  );
}

function ResumeBanner({
  total,
  pending,
  uploading,
  onResume,
}: {
  total: number;
  pending: number;
  uploading: boolean;
  onResume: () => void;
}) {
  const done = total - pending;
  return (
    <div className="mt-3 flex items-start gap-[11px] rounded-[14px] bg-info/[0.06] p-3.5">
      <div className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-info/[0.12] text-info">
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-5M20 14a8 8 0 01-14 5"
          />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-[13px] font-extrabold text-slate-900">
          مهمة محفوظة — يمكن الاستكمال بأمان
        </p>
        <p className="mt-1 text-[11.5px] leading-[1.45] text-slate-600">
          {pending > 0
            ? `تم حفظ وتحليل ${done} من ${total} صورة. المتبقي ${pending} صورة، والاستكمال يتم من آخر نقطة محفوظة.`
            : "كل الصور محفوظة على السيرفر ويمكن متابعة الخطوة التالية بدون إعادة الرفع."}
        </p>
      </div>
      {pending > 0 && (
        <button
          onClick={() => void onResume()}
          disabled={uploading}
          className="shrink-0 rounded-[11px] bg-info/[0.15] px-3.5 py-2 text-[13px] font-semibold text-info disabled:opacity-50"
        >
          {uploading ? "جاري..." : "استكمال"}
        </button>
      )}
    </div>
  );
}

function DropCard({
  onPick,
  onPickFolder,
}: {
  onPick: () => void;
  onPickFolder: () => void;
}) {
  return (
    <button
      onClick={onPick}
      className="mt-3.5 flex w-full flex-col items-center rounded-[18px] border border-primary/[0.22] bg-primary/[0.035] px-5 py-6.5 text-center transition-colors hover:bg-primary/[0.06]"
    >
      <div className="flex h-[58px] w-[58px] items-center justify-center rounded-full bg-primary/[0.10] text-primary">
        <svg
          viewBox="0 0 24 24"
          className="h-7 w-7"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.6}
        >
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="9" cy="11" r="1.6" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 17l4.5-4 3.5 3 3-3L20 17"
          />
          <path strokeLinecap="round" d="M18 3v4M16 5h4" />
        </svg>
      </div>
      <p className="mt-3 text-[15px] font-extrabold text-slate-900">
        اختيار الصور
      </p>
      <p className="mt-[5px] text-xs text-slate-500">
        يمكنك اختيار عشرات الصور في دفعة واحدة
      </p>
      <div className="mt-3.5 flex flex-wrap justify-center gap-2">
        <span className="rounded-[11px] border border-slate-300 px-5 py-3.5 text-sm font-semibold text-slate-700">
          اختيار صور
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation();
            onPickFolder();
          }}
          className="rounded-[11px] border border-slate-300 px-5 py-3.5 text-sm font-semibold text-slate-700"
        >
          اختيار مجلد
        </span>
      </div>
    </button>
  );
}

function PartCard({
  part,
  onRemove,
}: {
  part: UploadedPart;
  onRemove: () => void;
}) {
  const statusColor =
    part.validationStatus === "valid"
      ? "success"
      : part.validationStatus === "rejected"
        ? "danger"
        : "info";
  const statusText =
    part.validationStatus === "valid"
      ? "تم التحقق — جاهزة للـnesting"
      : part.validationStatus === "rejected"
        ? (part.rejectionReason ?? "تم رفض الصورة")
        : "جاري إرسالها وتحليلها...";
  const thumbUrl = part.bytes
    ? URL.createObjectURL(new Blob([new Uint8Array(part.bytes)]))
    : null;

  return (
    <div className="flex items-center gap-2.5 rounded-[14px] border border-slate-200 bg-white p-2.5 shadow-[0_1px_2px_var(--card-shadow)]">
      <div className="h-[58px] w-[58px] shrink-0 overflow-hidden rounded-[11px] border border-slate-200 bg-slate-100">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={part.fileName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-400">
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x="3" y="5" width="18" height="14" rx="2" />
            </svg>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-bold text-slate-900">
          {part.fileName}
        </p>
        <p
          className={`mt-1 truncate text-[11.2px] font-semibold text-${statusColor}`}
        >
          {statusText}
        </p>
      </div>
      <button
        onClick={onRemove}
        className="shrink-0 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
        title="حذف الصورة"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 6l12 12M18 6L6 18"
          />
        </svg>
      </button>
    </div>
  );
}

function UploadProgressCard({ progress }: { progress: number }) {
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-[14px] bg-info/[0.05] p-3.5">
      <div className="h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-2 border-info border-t-transparent" />
      <p className="flex-1 text-[12.5px] font-bold text-slate-900">
        جاري رفع الصور وتجهيزها وتحليل الـcontour...
      </p>
      {progress > 0 && progress < 1 && (
        <span className="text-xs font-extrabold text-slate-900">
          {Math.round(progress * 100)}%
        </span>
      )}
    </div>
  );
}

function RejectedBanner({
  count,
  onRecheck,
}: {
  count: number;
  onRecheck: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-danger/[0.22] bg-danger/[0.06] p-3.5">
      <div className="flex items-center gap-2.5">
        <svg
          viewBox="0 0 24 24"
          className="h-[19px] w-[19px] shrink-0 text-danger"
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
        <p className="flex-1 text-xs font-bold text-danger">
          {count} صورة تحتاج إعادة فحص بعد التحديث.
        </p>
      </div>
      <button
        onClick={() => void onRecheck()}
        className="mt-1.5 text-[13px] font-semibold text-primary"
      >
        إعادة الفحص الآن
      </button>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-warning/[0.24] bg-warning/[0.07] p-3.5">
      <svg
        viewBox="0 0 24 24"
        className="h-[19px] w-[19px] shrink-0 text-warning"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <circle cx="12" cy="12" r="9" />
        <path strokeLinecap="round" d="M12 8v5M12 16h.01" />
      </svg>
      <p className="flex-1 text-[12.2px] leading-[1.45] text-slate-700">
        {message}
      </p>
    </div>
  );
}

function BottomBar({
  total,
  canProceed,
  busy,
  onAddMore,
  onProceed,
}: {
  total: number;
  canProceed: boolean;
  busy: boolean;
  onAddMore: () => void;
  onProceed: () => void;
}) {
  return (
    <div className="flex items-center gap-2.5 border-t border-slate-200 bg-slate-50 px-4 py-3 shadow-[0_-4px_14px_var(--card-shadow)]">
      <button
        onClick={onAddMore}
        disabled={busy}
        className="rounded-[11px] border border-slate-300 px-5 py-3.5 text-sm font-semibold text-slate-700 disabled:opacity-40"
      >
        إضافة
      </button>
      <button
        onClick={onProceed}
        disabled={!canProceed || busy}
        className="flex-1 rounded-[11px] bg-primary px-5 py-3.5 text-sm font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500"
      >
        {total > 0 ? `بدء ترتيب ${total} صورة` : "ابدأ بإضافة الصور"}
      </button>
    </div>
  );
}
