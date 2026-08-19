"use client";

/**
 * Web port of frontend/lib/screens/settings_sheet.dart.
 */
import { useState } from "react";
import { useNestingJobStore } from "@/lib/nestingJobStore";
import { NestingConstants } from "@/lib/constants";
import type { NestingJobSettings } from "@/types/nestingJob";

const PALETTE = [
  "#FFFFFF",
  "#F2F2F2",
  "#808080",
  "#000000",
  "#FBE9E7",
  "#FFCDD2",
  "#D32F2F",
  "#FFF3E0",
  "#FFB300",
  "#FFFDE7",
  "#FFEB3B",
  "#E8F5E9",
  "#43A047",
  "#E3F2FD",
  "#1E88E5",
  "#EDE7F6",
  "#5E35B1",
  "#FCE4EC",
  "#D81B60",
];

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.trim().replace("#", "");
  if (/^[0-9A-Fa-f]{6}$/.test(normalized)) {
    const value = parseInt(normalized, 16);
    return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
  }
  return [255, 255, 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const value = ((r << 16) | (g << 8) | b)
    .toString(16)
    .padStart(6, "0")
    .toUpperCase();
  return `#${value}`;
}

function validatePositive(text: string): { value?: number; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { error: "مطلوب" };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: "رقم غير صالح" };
  if (value <= 0) return { error: "لازم يكون أكبر من صفر" };
  return { value };
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useNestingJobStore((s) => s.job.settings);
  const updateSettings = useNestingJobStore((s) => s.updateSettings);

  const [width, setWidth] = useState(settings.sheetWidthMm.toFixed(1));
  const [height, setHeight] = useState(settings.sheetHeightMm.toFixed(1));
  const [margin, setMargin] = useState(settings.sheetMarginMm.toFixed(1));
  const [clearance, setClearance] = useState(settings.clearanceMm.toFixed(2));
  const [dpi, setDpi] = useState(settings.dpi.toFixed(0));
  const [processedPath, setProcessedPath] = useState(
    settings.processedImagesPath,
  );
  const [backgroundColor, setBackgroundColor] = useState(
    settings.backgroundColor,
  );
  const [exportMode, setExportMode] = useState(settings.exportMode);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSave = async () => {
    const widthResult = validatePositive(width);
    const heightResult = validatePositive(height);
    const marginResult = validatePositive(margin);
    const clearanceResult = validatePositive(clearance);
    const dpiResult = validatePositive(dpi);

    const nextErrors: Record<string, string> = {};
    if (widthResult.error) nextErrors.width = widthResult.error;
    if (heightResult.error) nextErrors.height = heightResult.error;
    if (marginResult.error) nextErrors.margin = marginResult.error;
    if (clearanceResult.error) nextErrors.clearance = clearanceResult.error;
    if (dpiResult.error) nextErrors.dpi = dpiResult.error;
    setErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) return;

    const newSettings: NestingJobSettings = {
      sheetWidthMm: widthResult.value!,
      sheetHeightMm: heightResult.value!,
      sheetMarginMm: marginResult.value!,
      clearanceMm: clearanceResult.value!,
      dpi: dpiResult.value!,
      exportMode,
      backgroundColor,
      processedImagesPath: processedPath.trim(),
      packingAttempts: NestingConstants.maxPackingAttempts,
    };
    await updateSettings(newSettings);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-[22px] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-slate-300" />
        <div className="flex items-center gap-2 px-5 pb-2.5 pt-4">
          <h2 className="flex-1 text-[17px] font-bold text-slate-900">
            إعدادات الشيت
          </h2>
          <button
            onClick={onClose}
            className="rounded-[9px] bg-slate-100 p-2 text-slate-600"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
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
        <div className="border-t border-slate-200" />

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex gap-3">
            <NumberField
              label="عرض الشيت (mm)"
              value={width}
              onChange={setWidth}
              error={errors.width}
            />
            <NumberField
              label="ارتفاع الشيت (mm)"
              value={height}
              onChange={setHeight}
              error={errors.height}
            />
          </div>
          <div className="mt-3.5">
            <NumberField
              label="هامش الأمان من حرف الشيت (mm)"
              value={margin}
              onChange={setMargin}
              error={errors.margin}
            />
          </div>
          <div className="mt-3.5">
            <NumberField
              label="المسافة بين القطع (clearance, mm)"
              value={clearance}
              onChange={setClearance}
              error={errors.clearance}
              helper={
                !errors.clearance
                  ? "القيمة الافتراضية الموثقة في الـ backend: 4.10mm"
                  : undefined
              }
            />
          </div>
          <div className="mt-3.5">
            <NumberField
              label="دقة التصدير (DPI)"
              value={dpi}
              onChange={setDpi}
              error={errors.dpi}
            />
          </div>

          <div className="mt-3.5">
            <button
              onClick={() => setColorPickerOpen(true)}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-right"
            >
              <div
                className="h-[46px] w-[46px] shrink-0 rounded-[10px] border border-slate-300"
                style={{ backgroundColor }}
              />
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900">لون خلفية TIFF</p>
                <p className="mt-[3px] text-xs text-slate-500">
                  {backgroundColor} — اضغط لاختيار اللون
                </p>
              </div>
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5 shrink-0 text-primary"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <circle cx="13.5" cy="6.5" r=".5" />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 2a10 10 0 100 20 3 3 0 003-3 2 2 0 012-2h.5a2.5 2.5 0 002.5-2.5C20 6.6 16.4 2 12 2z"
                />
              </svg>
            </button>
          </div>

          <div className="mt-3.5">
            <NumberField
              label="مسار حفظ الصور المعالجة"
              value={processedPath}
              onChange={setProcessedPath}
              helper="على نفس جهاز الـbackend. بعد نجاح TIFF فقط تُنقل الصور المرتبة إلى مجلد بتاريخ العملية."
            />
          </div>

          <p className="mt-5 text-[13.5px] font-semibold text-slate-900">
            وضع الألوان للتصدير
          </p>
          <div className="mt-2 flex gap-2.5">
            <ModeOption
              label="RGB"
              subtitle="آمن لمعظم خطوط الطباعة"
              selected={exportMode === "RGB"}
              onClick={() => setExportMode("RGB")}
            />
            <ModeOption
              label="RGBA"
              subtitle="يحفظ الشفافية"
              selected={exportMode === "RGBA"}
              onClick={() => setExportMode("RGBA")}
            />
          </div>
        </div>

        <div className="px-5 pb-5 pt-2">
          <button
            onClick={() => void handleSave()}
            className="w-full rounded-[11px] bg-primary py-3.5 text-sm font-semibold text-white"
          >
            حفظ
          </button>
        </div>
      </div>

      {colorPickerOpen && (
        <ColorPickerDialog
          initialColor={backgroundColor}
          onCancel={() => setColorPickerOpen(false)}
          onApply={(hex) => {
            setBackgroundColor(hex);
            setColorPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  error,
  helper,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
}) {
  return (
    <label className="block flex-1">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-[11px] border bg-white px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-primary ${
          error ? "border-danger" : "border-slate-300"
        }`}
      />
      {error && <span className="mt-1 block text-xs text-danger">{error}</span>}
      {!error && helper && (
        <span className="mt-1 block text-xs leading-snug text-slate-500">
          {helper}
        </span>
      )}
    </label>
  );
}

function ModeOption({
  label,
  subtitle,
  selected,
  onClick,
}: {
  label: string;
  subtitle: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-[11px] border p-3.5 text-right transition-colors ${
        selected
          ? "border-primary bg-primary/[0.07]"
          : "border-slate-200 bg-slate-50"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`text-[13.5px] font-bold ${selected ? "text-primary" : "text-slate-900"}`}
        >
          {label}
        </span>
        {selected && (
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-primary"
            fill="currentColor"
          >
            <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.5 14.5l-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4-7 7z" />
          </svg>
        )}
      </div>
      <p className="mt-[3px] text-[11px] text-slate-500">{subtitle}</p>
    </button>
  );
}

function ColorPickerDialog({
  initialColor,
  onCancel,
  onApply,
}: {
  initialColor: string;
  onCancel: () => void;
  onApply: (hex: string) => void;
}) {
  const [r, setR] = useState(() => hexToRgb(initialColor)[0]);
  const [g, setG] = useState(() => hexToRgb(initialColor)[1]);
  const [b, setB] = useState(() => hexToRgb(initialColor)[2]);
  const hex = rgbToHex(r, g, b);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-[380px] rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-base font-bold text-slate-900">
          اختيار لون الخلفية
        </h3>
        <div
          className="flex h-[72px] w-full items-center justify-center rounded-xl border border-slate-300"
          style={{ backgroundColor: hex }}
        >
          <span
            className="text-base font-extrabold"
            style={{
              color:
                (r * 299 + g * 587 + b * 114) / 1000 > 145
                  ? "#000000"
                  : "#ffffff",
            }}
          >
            {hex}
          </span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {PALETTE.map((color) => (
            <button
              key={color}
              onClick={() => {
                const [pr, pg, pb] = hexToRgb(color);
                setR(pr);
                setG(pg);
                setB(pb);
              }}
              className="h-8 w-8 rounded-full border-2"
              style={{
                backgroundColor: color,
                borderColor:
                  color.toUpperCase() === hex
                    ? "var(--primary)"
                    : "var(--slate-300)",
              }}
            />
          ))}
        </div>

        <div className="mt-4 space-y-2">
          <ColorChannelSlider
            label="أحمر"
            value={r}
            onChange={setR}
            accent="#dc2626"
          />
          <ColorChannelSlider
            label="أخضر"
            value={g}
            onChange={setG}
            accent="#16a34a"
          />
          <ColorChannelSlider
            label="أزرق"
            value={b}
            onChange={setB}
            accent="#2563eb"
          />
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-semibold text-primary"
          >
            إلغاء
          </button>
          <button
            onClick={() => onApply(hex)}
            className="rounded-[11px] bg-primary px-4 py-2 text-sm font-semibold text-white"
          >
            تطبيق اللون
          </button>
        </div>
      </div>
    </div>
  );
}

function ColorChannelSlider({
  label,
  value,
  onChange,
  accent,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  accent: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[42px] text-xs text-slate-700">{label}</span>
      <input
        type="range"
        min={0}
        max={255}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1"
        style={{ accentColor: accent }}
      />
      <span className="w-[30px] text-right text-xs text-slate-700">
        {value}
      </span>
    </div>
  );
}
