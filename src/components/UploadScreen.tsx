"use client";

/**
 * Web port of frontend/lib/screens/upload_screen.dart.
 *
 * Design language: Linear / Stripe — clean, restrained, functional.
 * No decorative gradients, no emojis, no glassmorphism. Just clean
 * typography, intentional whitespace, and subtle motion.
 */
import { useRef, useState, useEffect, useCallback, memo } from "react";
import { useNestingJobStore } from "@/lib/nestingJobStore";
import { isSupportedImageFile, pickImageFolder } from "@/lib/imageFolderPicker";
import { WorkflowStepper } from "./WorkflowStepper";
import { SettingsSheet } from "./SettingsSheet";
import type { UploadedPart } from "@/types/sheetPart";

function fileToUploadedPart(
  file: File,
  base: number,
  index: number,
): UploadedPart {
  return {
    id: `${base}_${index}_${file.name}`,
    fileName: file.name,
    filePath: "",
    file,

    validationStatus: "pending",
  };
}

async function readFilesAsParts(files: File[]): Promise<UploadedPart[]> {
  const base = Date.now();
  const parts: UploadedPart[] = [];
  for (let i = 0; i < files.length; i++) {
    parts.push(fileToUploadedPart(files[i], base, i));
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
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  // "مسح الكل" and each row's "حذف" both await a server round-trip
  // (deleteJob / deleteJobPart inside clearAllParts / removeUploadedPart in
  // the store) before the local state updates. With no visible feedback
  // during that await, the button looked completely dead the moment it was
  // clicked -- no spinner, no disabled state, nothing distinguishing "still
  // working" from "stuck". These two local flags drive a spinner + disabled
  // state on the buttons below for exactly the duration of that await, so a
  // slow delete now visibly *does something* instead of appearing frozen.
  const [clearingAll, setClearingAll] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

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
    // Mirrors the drag-drop and folder-picker paths below: the input's own
    // `accept` attribute is a browser-level hint, not a guarantee -- several
    // browsers still let the person pick "All Files" from the native dialog,
    // so a non-image file can reach here even with `accept` set. Filtering
    // through the same isSupportedImageFile check every other entry point
    // already uses keeps all three ways of adding files behaving identically
    // instead of only rejecting unsupported files after a full upload
    // round-trip to the backend.
    const imageFiles = Array.from(files).filter(isSupportedImageFile);
    if (imageFiles.length === 0) return;
    const parts = await readFilesAsParts(imageFiles);
    await addUploadedParts(parts);
  };

  const handlePickFolder = async () => {
    const files = await pickImageFolder();
    if (files.length === 0) return;
    const parts = await readFilesAsParts(files);
    await addUploadedParts(parts);
  };

  const handleClearAll = async () => {
    if (clearingAll) return;
    setClearingAll(true);
    try {
      await clearAllParts();
    } finally {
      setClearingAll(false);
    }
  };

  const handleRemovePart = async (localId: string) => {
    if (removingId != null) return;
    setRemovingId(localId);
    try {
      await removeUploadedPart(localId);
    } finally {
      setRemovingId(null);
    }
  };

  // Drag & drop support
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types.includes("Files")) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const imageFiles = Array.from(files).filter(isSupportedImageFile);
        if (imageFiles.length > 0) {
          const parts = await readFilesAsParts(imageFiles);
          await addUploadedParts(parts);
        }
      }
    },
    [addUploadedParts],
  );

  return (
    <div
      className="flex flex-col h-screen bg-white"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={(e) => void handleDrop(e)}
    >
      {/* ── Drag overlay ── */}
      {isDragging && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-primary/[0.04] backdrop-blur-[2px]">
          <div className="rounded-2xl border-2 border-dashed border-primary/40 bg-white px-12 py-10 text-center shadow-xl">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/[0.08]">
              <ArrowUpIcon className="h-6 w-6 text-primary" />
            </div>
            <p className="text-[15px] font-semibold text-slate-900">
              أفلت الصور هنا
            </p>
            <p className="mt-1 text-[12px] text-slate-500">
              PNG, JPG, TIFF, WebP وغيرها
            </p>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/walid_logo.jpg"
          alt="Walid Logo"
          className="h-8 w-8 rounded-lg object-cover"
        />
        <h1 className="flex-1 text-[16px] font-semibold text-slate-900">
          وليد
        </h1>
        <ServerBadge reachable={serverReachable} />
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
          title="إعدادات الشيت"
        >
          <SettingsIcon />
        </button>
      </header>

      {/* ── Stepper ── */}
      <div className="border-b border-slate-100 px-5 py-2.5">
        <WorkflowStepper currentStage="upload" />
      </div>

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-5 py-5">
          {/* Stats row */}
          {job.uploadedParts.length > 0 && (
            <div className="mb-4 flex items-center gap-4 text-[12px] text-slate-500">
              <span>
                <span className="font-semibold text-slate-900">
                  {job.uploadedParts.length}
                </span>{" "}
                صورة
              </span>
              {valid > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-success" />
                  <span className="font-semibold text-success">{valid}</span>{" "}
                  صالحة
                </span>
              )}
              {pending > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-info" />
                  <span className="font-semibold text-info">{pending}</span> قيد
                  الفحص
                </span>
              )}
              {rejected > 0 && (
                <span className="flex items-center gap-1">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />
                  <span className="font-semibold text-danger">{rejected}</span>{" "}
                  مرفوضة
                </span>
              )}
            </div>
          )}

          {hasResumableJob && !initializing && (
            <ResumeBanner
              total={job.uploadedParts.length}
              pending={pending}
              uploading={uploading}
              onResume={resumePendingUploads}
            />
          )}

          {/* Upload zone */}
          <DropZone
            onPick={() => fileInputRef.current?.click()}
            onPickFolder={handlePickFolder}
            hasImages={job.uploadedParts.length > 0}
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.avif,.bmp,.heic,.heif,.tif,.tiff,.webp"
            className="hidden"
            onChange={(e) => {
              void handleFilesSelected(e.target.files);
              e.target.value = "";
            }}
          />

          {uploading && <UploadProgressBar progress={uploadProgress} />}
          {job.errorMessage && <ErrorNotice message={job.errorMessage} />}
          {rejected > 0 && (
            <RejectedNotice count={rejected} onRecheck={refreshCurrentJob} />
          )}

          {/* File list */}
          {job.uploadedParts.length > 0 && (
            <div className="mt-5">
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-slate-900">
                  الملفات
                </h3>
                <button
                  onClick={() => void handleClearAll()}
                  disabled={uploading || clearingAll}
                  className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 transition-colors hover:text-danger disabled:opacity-30"
                >
                  {clearingAll && (
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-slate-300 border-t-danger" />
                  )}
                  {clearingAll ? "جاري المسح..." : "مسح الكل"}
                </button>
              </div>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {job.uploadedParts.map((part) => (
                  <PartRow
                    key={part.id}
                    part={part}
                    onRemove={handleRemovePart}
                    removing={removingId === part.id}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Bottom ── */}
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

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Icons                                                                */
/* ═══════════════════════════════════════════════════════════════════════ */

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <circle cx="10" cy="10" r="3" />
      <path
        d="M10 1.5v2M10 16.5v2M1.5 10h2M16.5 10h2M3.4 3.4l1.4 1.4M15.2 15.2l1.4 1.4M3.4 16.6l1.4-1.4M15.2 4.8l1.4-1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowUpIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 19V5m0 0l-6 6m6-6l6 6"
      />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Server Badge                                                         */
/* ═══════════════════════════════════════════════════════════════════════ */

// Tailwind's JIT compiler statically scans source for literal class strings
// at build time; a template literal like `text-${color}` is invisible to
// that scan unless the exact same string appears elsewhere verbatim, so the
// class silently gets dropped from the compiled CSS in production. Using a
// lookup object of pre-written literal strings keeps every class name whole
// and greppable, which is Tailwind's documented fix for this exact pattern.
const SERVER_BADGE_STYLES = {
  success: {
    wrap: "text-success border-success/25 bg-success/[0.08]",
    dot: "bg-success",
  },
  warning: {
    wrap: "text-warning border-warning/25 bg-warning/[0.08]",
    dot: "bg-warning",
  },
} as const;

function ServerBadge({ reachable }: { reachable: boolean }) {
  const styles = SERVER_BADGE_STYLES[reachable ? "success" : "warning"];
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 ${styles.wrap}`}
      title={reachable ? "الخادم متصل" : "الخادم غير متصل"}
    >
      <span className={`h-[7px] w-[7px] rounded-full ${styles.dot}`} />
      <span className="text-[11px] font-bold">
        {reachable ? "متصل" : "انتظار"}
      </span>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Resume Banner                                                        */
/* ═══════════════════════════════════════════════════════════════════════ */

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
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-info/20 bg-info/[0.04] p-3.5">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info">
        <svg
          viewBox="0 0 20 20"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 3v5h5M17 17v-5h-5M3 8a7 7 0 0112.3-4.3M17 12a7 7 0 01-12.3 4.3"
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-slate-900">
          مهمة محفوظة — يمكن الاستكمال
        </p>
        <p className="mt-0.5 text-[11px] text-slate-500">
          {pending > 0
            ? `تم ${done} من ${total}. المتبقي ${pending} صورة.`
            : "كل الصور محفوظة."}
        </p>
      </div>
      {pending > 0 && (
        <button
          onClick={() => void onResume()}
          disabled={uploading}
          className="shrink-0 rounded-lg bg-info px-3.5 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-info/90 disabled:opacity-50"
        >
          {uploading ? "جاري..." : "استكمال"}
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Drop Zone                                                            */
/* ═══════════════════════════════════════════════════════════════════════ */

function DropZone({
  onPick,
  onPickFolder,
  hasImages,
}: {
  onPick: () => void;
  onPickFolder: () => void;
  hasImages: boolean;
}) {
  if (hasImages) {
    // Compact version when images already exist
    return (
      <div className="flex gap-2">
        <button
          onClick={onPick}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 py-3 text-[12px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50"
        >
          <ArrowUpIcon className="h-3.5 w-3.5" />
          إضافة صور
        </button>
        <button
          onClick={onPickFolder}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 py-3 text-[12px] font-medium text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50"
        >
          <FolderIcon className="h-3.5 w-3.5" />
          إضافة مجلد
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-6 py-12 text-center transition-colors hover:border-slate-300 hover:bg-slate-50">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <ArrowUpIcon className="h-5 w-5" />
      </div>
      <p className="text-[14px] font-semibold text-slate-900">
        اسحب الصور هنا أو اختر من جهازك
      </p>
      <p className="mt-1.5 text-[12px] text-slate-400">
        PNG, JPG, TIFF, WebP وغيرها — تُنسخ محليًا إلى Python على هذا الجهاز فقط
      </p>
      <div className="mt-5 flex justify-center gap-3">
        <button
          onClick={onPick}
          className="rounded-lg bg-primary px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-primary-dark"
        >
          اختيار صور
        </button>
        <button
          onClick={onPickFolder}
          className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-[12.5px] font-semibold text-slate-700 transition-colors hover:bg-slate-50"
        >
          اختيار مجلد
        </button>
      </div>
    </div>
  );
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
    >
      <path d="M2 6a2 2 0 012-2h3.172a2 2 0 011.414.586l.828.828A2 2 0 0010.828 6H16a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Part Row                                                             */
/* ═══════════════════════════════════════════════════════════════════════ */

const PartRow = memo(function PartRow({
  part,
  onRemove,
  removing = false,
}: {
  part: UploadedPart;
  onRemove: (id: string) => void;
  removing?: boolean;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);

  useEffect(() => {
    let target: Blob | null = part.file ?? null;
    if (!target && part.bytes) {
      target = new Blob([new Uint8Array(part.bytes)]);
    }
    if (!target) {
      setThumbUrl(null);
      return;
    }
    const url = URL.createObjectURL(target);
    setThumbUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [part.bytes, part.file]);

  const statusEl =
    part.validationStatus === "valid" ? (
      <span className="flex items-center gap-1 text-[10.5px] font-medium text-success">
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 8.5l2.5 2.5L12 5"
          />
        </svg>
        جاهزة
      </span>
    ) : part.validationStatus === "rejected" ? (
      <span className="flex items-center gap-1 text-[10.5px] font-medium text-danger">
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" d="M5 5l6 6M11 5l-6 6" />
        </svg>
        {part.rejectionReason ?? "مرفوضة"}
      </span>
    ) : (
      <span className="flex items-center gap-1.5 text-[10.5px] font-medium text-slate-400">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-slate-300 border-t-primary" />
        جاري النسخ والفحص محليًا
      </span>
    );

  return (
    <div className="group flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-slate-50">
      {/* Thumbnail */}
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-slate-100">
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbUrl}
            alt={part.fileName}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-slate-300">
            <svg
              viewBox="0 0 20 20"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <rect x="3" y="4" width="14" height="12" rx="1.5" />
              <circle cx="7.5" cy="8.5" r="1.5" />
              <path strokeLinecap="round" d="M3 14l4-4 3 3 2.5-2.5L17 14" />
            </svg>
          </div>
        )}
      </div>

      {/* Name + status */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium text-slate-800">
          {part.fileName}
        </p>
        <div className="mt-0.5">{statusEl}</div>
      </div>

      {/* Remove */}
      <button
        onClick={() => {
          if (!removing) onRemove(part.id);
        }}
        disabled={removing}
        className={`shrink-0 rounded-md p-1 text-slate-300 transition-all hover:bg-slate-100 hover:text-slate-500 disabled:hover:bg-transparent ${
          removing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
        title={removing ? "جاري الحذف..." : "حذف"}
      >
        {removing ? (
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-slate-300 border-t-danger" />
        ) : (
          <svg
            viewBox="0 0 16 16"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" d="M4 4l8 8M12 4l-8 8" />
          </svg>
        )}
      </button>
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Upload Progress                                                      */
/* ═══════════════════════════════════════════════════════════════════════ */

function UploadProgressBar({ progress }: { progress: number }) {
  const pct = Math.round(progress * 100);
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-slate-500">
          جاري الرفع والتحليل...
        </span>
        <span className="text-[11px] font-semibold text-slate-700">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Notices                                                              */
/* ═══════════════════════════════════════════════════════════════════════ */

function RejectedNotice({
  count,
  onRecheck,
}: {
  count: number;
  onRecheck: () => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-danger/15 bg-danger/[0.03] px-3.5 py-2.5">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-danger" />
      <p className="flex-1 text-[11.5px] text-slate-700">
        <span className="font-semibold text-danger">{count}</span> صورة مرفوضة
      </p>
      <button
        onClick={() => void onRecheck()}
        className="text-[11px] font-semibold text-primary hover:underline"
      >
        إعادة الفحص
      </button>
    </div>
  );
}

function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-warning/15 bg-warning/[0.03] px-3.5 py-2.5">
      <span className="mt-0.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
      <p className="flex-1 text-[11.5px] leading-relaxed text-slate-600">
        {message}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════ */
/*  Bottom Bar                                                           */
/* ═══════════════════════════════════════════════════════════════════════ */

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
    <div className="flex items-center gap-3 border-t border-slate-200 bg-white px-5 py-3">
      <button
        onClick={onAddMore}
        disabled={busy}
        className="rounded-lg border border-slate-200 px-4 py-2.5 text-[12.5px] font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-30"
      >
        إضافة صور
      </button>
      <button
        onClick={onProceed}
        disabled={!canProceed || busy}
        className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-primary-dark disabled:bg-slate-200 disabled:text-slate-400"
      >
        {total > 0 ? `بدء ترتيب ${total} صورة` : "ابدأ بإضافة الصور"}
      </button>
    </div>
  );
}
