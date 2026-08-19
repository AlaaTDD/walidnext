"use client";

/**
 * Web port of frontend/lib/screens/preview_screen.dart.
 * Same states (computing / failed / proofPreview), same canvas + summary
 * split layout, same sheet selector for multi-page results, same
 * highlight-on-select animation intent (implemented here as a CSS pulse
 * instead of an AnimationController, since React has no per-frame ticker
 * equivalent -- the visual effect and duration match AppMotion.slow).
 */
import { useEffect, useState } from "react";
import { useNestingJobStore } from "@/lib/nestingJobStore";
import { WorkflowStepper } from "./WorkflowStepper";
import { SheetLayoutCanvas } from "./SheetLayoutCanvas";
import { ViolationListTile } from "./ViolationListTile";
import type {
  NestingComputeResult,
  NestingJob,
  NestingSheetLayout,
} from "@/types/nestingJob";
import type { PlacedPart } from "@/types/sheetPart";

export function PreviewScreen({
  onBack,
  onProceed,
}: {
  onBack: () => void;
  onProceed: () => void;
}) {
  const job = useNestingJobStore((s) => s.job);
  const computeProgressDone = useNestingJobStore((s) => s.computeProgressDone);
  const computeProgressTotal = useNestingJobStore(
    (s) => s.computeProgressTotal,
  );
  const computeProgressMessage = useNestingJobStore(
    (s) => s.computeProgressMessage,
  );
  const computeLayout = useNestingJobStore((s) => s.computeLayout);
  const cancelCompute = useNestingJobStore((s) => s.cancelCompute);
  const backToUpload = useNestingJobStore((s) => s.backToUpload);

  const [selectedPartId, setSelectedPartId] = useState<string | null>(null);
  const [selectedSheetIndex, setSelectedSheetIndex] = useState(0);
  const [showClearanceZones, setShowClearanceZones] = useState(false);
  const [pulse, setPulse] = useState(false);

  // Mirrors preview_screen.dart's initState: trigger computeLayout() once on
  // arrival if no result is already cached (e.g. from server-state recovery).
  useEffect(() => {
    if (job.computeResult == null) void computeLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectPart = (id: string | null) => {
    setSelectedPartId(id);
    if (id != null) {
      setPulse(false);
      // Restart the CSS pulse animation on every new selection.
      requestAnimationFrame(() => setPulse(true));
    }
  };

  const selectSheet = (index: number) => {
    setSelectedSheetIndex(index);
    setSelectedPartId(null);
  };

  const handleBack = () => {
    if (job.stage === "computing") void cancelCompute();
    backToUpload();
    onBack();
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <button
          onClick={handleBack}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          title="رجوع"
        >
          <BackIcon />
        </button>
        <h1 className="flex-1 text-lg font-bold text-slate-900">
          معاينة الترتيب
        </h1>
        {job.stage === "proofPreview" && (
          <button
            onClick={() => void computeLayout()}
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
            title="إعادة الحساب"
          >
            <RefreshIcon />
          </button>
        )}
      </header>

      <div className="px-5 pb-1 pt-3">
        <WorkflowStepper currentStage="proofPreview" />
      </div>

      <div className="min-h-0 flex-1">
        <Body
          job={job}
          computeProgressDone={computeProgressDone}
          computeProgressTotal={computeProgressTotal}
          computeProgressMessage={computeProgressMessage}
          onCancelCompute={() => void cancelCompute()}
          onRetryCompute={() => void computeLayout()}
          selectedPartId={selectedPartId}
          selectedSheetIndex={selectedSheetIndex}
          showClearanceZones={showClearanceZones}
          onSelectPart={selectPart}
          onSelectSheet={selectSheet}
          onClearanceToggle={setShowClearanceZones}
          pulse={pulse}
        />
      </div>

      {job.stage === "proofPreview" && (
        <ConfirmBar
          job={job}
          onEditImages={handleBack}
          onConfirmExport={onProceed}
        />
      )}
    </div>
  );
}

function BackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-5 w-5"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}
function RefreshIcon() {
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
        d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-5M20 14a8 8 0 01-14 5"
      />
    </svg>
  );
}

function Body({
  job,
  computeProgressDone,
  computeProgressTotal,
  computeProgressMessage,
  onCancelCompute,
  onRetryCompute,
  selectedPartId,
  selectedSheetIndex,
  showClearanceZones,
  onSelectPart,
  onSelectSheet,
  onClearanceToggle,
  pulse,
}: {
  job: NestingJob;
  computeProgressDone: number | null;
  computeProgressTotal: number | null;
  computeProgressMessage: string | null;
  onCancelCompute: () => void;
  onRetryCompute: () => void;
  selectedPartId: string | null;
  selectedSheetIndex: number;
  showClearanceZones: boolean;
  onSelectPart: (id: string | null) => void;
  onSelectSheet: (index: number) => void;
  onClearanceToggle: (value: boolean) => void;
  pulse: boolean;
}) {
  if (job.stage === "computing") {
    const ratio =
      computeProgressDone != null &&
      computeProgressTotal != null &&
      computeProgressTotal > 0
        ? Math.min(1, computeProgressDone / computeProgressTotal)
        : null;
    return (
      <div className="flex h-full items-center justify-center p-7">
        <div className="w-full max-w-[460px] text-center">
          <div className="mx-auto flex h-[42px] w-[42px] items-center justify-center text-primary">
            <SparkleIcon />
          </div>
          <h2 className="mt-[18px] text-lg font-extrabold text-slate-900">
            جاري بناء أفضل ترتيب هندسي
          </h2>
          <p className="mt-2 text-[12.5px] leading-[1.5] text-slate-500">
            {computeProgressMessage ??
              "يتم تحليل المساحات واختبار الزوايا المتاحة..."}
          </p>
          <div className="mt-[18px] h-[7px] overflow-hidden rounded-[6px] bg-slate-200">
            <div
              className="h-full bg-primary transition-[width] duration-300"
              style={{ width: ratio != null ? `${ratio * 100}%` : "40%" }}
            />
          </div>
          {computeProgressDone != null && computeProgressTotal != null && (
            <p className="mt-2 text-xs font-bold text-slate-600">
              {computeProgressDone} / {computeProgressTotal} صورة
            </p>
          )}
          <button
            onClick={onCancelCompute}
            className="mt-5 rounded-[11px] border border-slate-300 px-5 py-3 text-sm font-semibold text-slate-700"
          >
            إلغاء الحساب
          </button>
        </div>
      </div>
    );
  }

  if (job.stage === "failed") {
    return (
      <div className="flex h-full items-center justify-center p-7">
        <div className="text-center">
          <div className="mx-auto flex h-[46px] w-[46px] items-center justify-center text-danger">
            <ErrorIcon />
          </div>
          <p className="mt-3.5 text-[13px] leading-[1.5] text-slate-700">
            {job.errorMessage ?? "حدث خطأ غير متوقع"}
          </p>
          <button
            onClick={onRetryCompute}
            className="mt-5 rounded-[11px] bg-primary px-5 py-3 text-sm font-semibold text-white"
          >
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }

  if (job.stage === "proofPreview" && job.computeResult) {
    const result = job.computeResult;
    const clampedIndex = Math.min(
      Math.max(0, selectedSheetIndex),
      Math.max(0, result.sheets.length - 1),
    );
    return (
      <ProofLayout
        job={job}
        result={result}
        selectedPartId={selectedPartId}
        selectedSheetIndex={clampedIndex}
        showClearanceZones={showClearanceZones}
        onSelectPart={onSelectPart}
        onSelectSheet={onSelectSheet}
        onClearanceToggle={onClearanceToggle}
        pulse={pulse}
      />
    );
  }

  return null;
}

function SparkleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6L12 3z" />
    </svg>
  );
}
function ErrorIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 8v5" />
      <path strokeLinecap="round" d="M12 16h.01" />
    </svg>
  );
}

function ProofLayout({
  job,
  result,
  selectedPartId,
  selectedSheetIndex,
  showClearanceZones,
  onSelectPart,
  onSelectSheet,
  onClearanceToggle,
  pulse,
}: {
  job: NestingJob;
  result: NestingComputeResult;
  selectedPartId: string | null;
  selectedSheetIndex: number;
  showClearanceZones: boolean;
  onSelectPart: (id: string | null) => void;
  onSelectSheet: (index: number) => void;
  onClearanceToggle: (value: boolean) => void;
  pulse: boolean;
}) {
  const sheet = result.sheets[selectedSheetIndex];
  return (
    <div className="flex h-full flex-col lg:flex-row">
      <div className="min-h-0 flex-[3]">
        <CanvasPanel
          job={job}
          result={result}
          sheet={sheet}
          selectedPartId={selectedPartId}
          showClearanceZones={showClearanceZones}
          onSelectPart={onSelectPart}
          onSelectSheet={onSelectSheet}
          onClearanceToggle={onClearanceToggle}
        />
      </div>
      <div className="h-px w-full bg-slate-200 lg:h-auto lg:w-px" />
      <div className="min-h-0 flex-[2] overflow-y-auto lg:w-[360px] lg:flex-none">
        <SummaryPanel
          result={result}
          sheet={sheet}
          selectedPartId={selectedPartId}
          onSelectPart={onSelectPart}
          pulse={pulse}
        />
      </div>
    </div>
  );
}

function CanvasPanel({
  job,
  result,
  sheet,
  selectedPartId,
  showClearanceZones,
  onSelectPart,
  onSelectSheet,
  onClearanceToggle,
}: {
  job: NestingJob;
  result: NestingComputeResult;
  sheet: NestingSheetLayout;
  selectedPartId: string | null;
  showClearanceZones: boolean;
  onSelectPart: (id: string | null) => void;
  onSelectSheet: (index: number) => void;
  onClearanceToggle: (value: boolean) => void;
}) {
  const sheetCount = result.sheets.length;
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3.5">
        <RulerIcon />
        <span className="text-[13px] font-extrabold text-slate-900">
          {job.settings.sheetWidthMm.toFixed(0)} ×{" "}
          {job.settings.sheetHeightMm.toFixed(0)} mm
        </span>
        <span className="text-[11.5px] text-slate-500">
          {job.settings.dpi.toFixed(0)} DPI
        </span>
        {sheetCount > 1 && (
          <select
            value={sheet.pageNumber - 1}
            onChange={(e) => onSelectSheet(Number(e.target.value))}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700"
          >
            {Array.from({ length: sheetCount }, (_, i) => (
              <option key={i} value={i}>
                ورقة {i + 1} / {sheetCount}
              </option>
            ))}
          </select>
        )}
        <div className="flex-1" />
        <button
          onClick={() => onClearanceToggle(!showClearanceZones)}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
            showClearanceZones
              ? "border-primary bg-primary/[0.1] text-primary"
              : "border-slate-300 text-slate-600"
          }`}
        >
          مسافات الأمان
        </button>
      </div>

      {result.unplacedPartIds.length > 0 && (
        <div className="px-4 pb-2">
          <CapacityBanner result={result} />
        </div>
      )}

      <div className="min-h-0 flex-1 p-4">
        <SheetLayoutCanvas
          sheetWidthMm={job.settings.sheetWidthMm}
          sheetHeightMm={job.settings.sheetHeightMm}
          sheetMarginMm={job.settings.sheetMarginMm}
          clearanceMm={job.settings.clearanceMm}
          placedParts={sheet.placedParts}
          selectedPartId={selectedPartId}
          showClearanceZones={showClearanceZones}
          onSelectPart={onSelectPart}
        />
      </div>
    </div>
  );
}

function RulerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[17px] w-[17px] text-slate-500"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <rect x="3" y="8" width="18" height="8" rx="1" />
      <path strokeLinecap="round" d="M7 8v3M11 8v3M15 8v3" />
    </svg>
  );
}

function CapacityBanner({ result }: { result: NestingComputeResult }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-warning/[0.24] bg-warning/[0.07] p-3">
      <svg
        viewBox="0 0 24 24"
        className="h-[19px] w-[19px] shrink-0 text-warning"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4M21 7v10l-9 4M3 12l9 4 9-4"
        />
      </svg>
      <p className="flex-1 text-xs font-bold leading-[1.4] text-slate-700">
        {result.layoutMessage}
      </p>
    </div>
  );
}

function SummaryPanel({
  result,
  sheet,
  selectedPartId,
  onSelectPart,
  pulse,
}: {
  result: NestingComputeResult;
  sheet: NestingSheetLayout;
  selectedPartId: string | null;
  onSelectPart: (id: string | null) => void;
  pulse: boolean;
}) {
  const sheetCount = result.sheets.length;
  return (
    <div className="space-y-2.5 px-3.5 pb-4.5 pt-3">
      <StatusCard result={result} sheetCount={sheetCount} />
      <div className="flex gap-2">
        <StatCard
          value={String(sheet.placedParts.length)}
          label="مرتبة"
          color="success"
        />
        <StatCard
          value={String(result.unplacedPartIds.length)}
          label="متبقية"
          color={result.unplacedPartIds.length === 0 ? "success" : "warning"}
        />
        <StatCard
          value={String(result.processedCount)}
          label="تمت معالجتها"
          color="info"
        />
      </div>

      <p className="text-[13.5px] font-extrabold text-slate-900">
        {sheetCount > 1
          ? `القطع في الورقة ${sheet.pageNumber}`
          : "القطع المرتبة"}
      </p>

      {sheet.placedParts.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-[12.5px] text-slate-500">
            لم يتم وضع أي قطعة. راجع أبعاد الشيت والقيود.
          </p>
        </div>
      )}

      {sheet.placedParts.map((part) => {
        const selected = part.partId === selectedPartId;
        return (
          <PlacedPartTile
            key={part.partId}
            part={part}
            selected={selected}
            pulse={selected && pulse}
            onClick={() => onSelectPart(selected ? null : part.partId)}
          />
        );
      })}

      {result.collisionViolations.length > 0 && (
        <>
          <p className="text-[13.5px] font-extrabold text-danger">
            مخالفات التحقق الهندسي
          </p>
          {result.collisionViolations.map((v, i) => (
            <ViolationListTile key={i} violation={v} />
          ))}
        </>
      )}
    </div>
  );
}

function StatusCard({
  result,
  sheetCount,
}: {
  result: NestingComputeResult;
  sheetCount: number;
}) {
  const valid =
    result.readyToConfirm &&
    result.placedParts.length > 0 &&
    result.collisionReportValid &&
    result.collisionViolations.length === 0;
  const partial = result.unplacedPartIds.length > 0;
  const isCollisionValid =
    result.collisionReportValid && result.collisionViolations.length === 0;
  const color = valid ? (partial ? "warning" : "success") : "danger";
  const title = !isCollisionValid
    ? "يوجد خلل هندسي"
    : partial
      ? "بعض الصور لا تلائم حتى ورقة فارغة"
      : sheetCount > 1
        ? `تم الترتيب على ${sheetCount} ورقة`
        : "كل الصور اتوضعت بنجاح";

  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-slate-200 bg-white p-3.5">
      <div
        className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-${color}/[0.1] text-${color}`}
      >
        {!valid ? <ErrorGlyph /> : partial ? <LayersGlyph /> : <CheckGlyph />}
      </div>
      <div className="min-w-0 flex-1">
        <p className={`text-[13px] font-extrabold text-${color}`}>{title}</p>
        <p className="mt-[3px] line-clamp-3 text-[11.4px] leading-[1.4] text-slate-500">
          {result.layoutMessage}
        </p>
      </div>
    </div>
  );
}

function ErrorGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M12 8v5M12 16h.01" />
    </svg>
  );
}
function LayersGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 3l9 5-9 5-9-5 9-5zM3 13l9 5 9-5"
      />
    </svg>
  );
}
function CheckGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[22px] w-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="9" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M8.5 12.5l2.5 2.5 5-5"
      />
    </svg>
  );
}

function StatCard({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex-1 rounded-2xl border border-slate-200 bg-white px-2.5 py-2.75 text-center">
      <div className={`mx-auto h-[17px] w-[17px] text-${color}`}>
        <DotIcon />
      </div>
      <p className="mt-1.5 text-[15px] font-black text-slate-900">{value}</p>
      <p className="mt-0.5 text-[10.5px] text-slate-500">{label}</p>
    </div>
  );
}

function DotIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <circle cx="12" cy="12" r="8" />
    </svg>
  );
}

function PlacedPartTile({
  part,
  selected,
  pulse,
  onClick,
}: {
  part: PlacedPart;
  selected: boolean;
  pulse: boolean;
  onClick: () => void;
}) {
  const [minX, minY, maxX, maxY] = part.boundsMm;
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[10px] border px-2.75 py-2.25 text-right transition-colors duration-fast ease-standard ${
        selected
          ? `border-primary bg-primary/[0.055] ${pulse ? "animate-pulse-ring" : ""}`
          : "border-slate-200 bg-white"
      }`}
      style={{ borderWidth: selected ? 1.4 : 1 }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11.8px] font-bold text-slate-900">
          {part.partId}
        </p>
        <p className="mt-0.5 text-[10.7px] text-slate-500">
          {(maxX - minX).toFixed(1)} × {(maxY - minY).toFixed(1)} mm
        </p>
      </div>
      <span className="shrink-0 rounded-md bg-slate-100 px-1.75 py-1 text-[10.5px] font-extrabold text-slate-900">
        {part.rotation.degrees}°
      </span>
    </button>
  );
}

function ConfirmBar({
  job,
  onEditImages,
  onConfirmExport,
}: {
  job: NestingJob;
  onEditImages: () => void;
  onConfirmExport: () => void;
}) {
  const canExport = job.computeResult
    ? job.computeResult.readyToConfirm &&
      job.computeResult.placedParts.length > 0 &&
      job.computeResult.collisionReportValid &&
      job.computeResult.collisionViolations.length === 0
    : false;
  const multiSheet = (job.computeResult?.sheets.length ?? 1) > 1;
  return (
    <div className="flex items-center gap-2.5 border-t border-slate-200 bg-white px-4 py-3">
      <button
        onClick={onEditImages}
        className="flex-1 rounded-[11px] border border-slate-300 px-5 py-3.5 text-sm font-semibold text-slate-700"
      >
        تعديل الصور
      </button>
      <button
        onClick={onConfirmExport}
        disabled={!canExport}
        className="flex-[2] rounded-[11px] bg-primary px-5 py-3.5 text-sm font-semibold text-white disabled:bg-slate-300 disabled:text-slate-500"
      >
        {multiSheet ? "تأكيد وتصدير كل الأوراق" : "تأكيد وتصدير"}
      </button>
    </div>
  );
}
