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

function validatePositive(
  text: string,
  maxValue?: number,
): { value?: number; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { error: "مطلوب" };
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: "رقم غير صالح" };
  if (value <= 0) return { error: "لازم يكون أكبر من صفر" };
  // Without an upper bound, a mistyped extra digit (e.g. 79000 instead of
  // 790 for sheet width) silently passes validation and reaches the backend
  // as a valid request, where it either fails confusingly deep in the
  // nesting engine or succeeds but produces an unusable result. maxValue is
  // deliberately generous per field (see each call site below) so it only
  // catches genuine input mistakes, never a legitimate real-world value.
  if (maxValue !== undefined && value > maxValue) {
    return { error: `لازم يكون أصغر من أو يساوي ${maxValue}` };
  }
  return { value };
}

// Same shape as validatePositive, but OPTIONAL -- an empty field is valid
// here (means "use the backend's own tiered default", see NestingJobSettings'
// lnsMaxIterationsLarge/lnsDestroyFractionLarge doc comment) rather than a
// required-field error. minValue/maxValue mirror the backend's own
// ComputeRequest Field(ge=.../le=...) bounds exactly, so a value rejected here
// would also be rejected server-side -- this is the same value, validated
// twice, not two different policies.
function validateOptionalBounded(
  text: string,
  minValue: number,
  maxValue: number,
): { value?: number; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0) return {};
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return { error: "رقم غير صالح" };
  if (value < minValue) {
    return { error: `لازم يكون ${minValue} على الأقل` };
  }
  if (value > maxValue) {
    // This is the "مبالغ فيه" ceiling itself -- values above this are
    // rejected here for the same reason the backend rejects them via
    // ComputeRequest's le=... bound: past this point destroy_fraction starts
    // rebuilding most of the layout every iteration instead of making a
    // targeted improvement, and max_iterations stops mattering once the time
    // budget (a separate, untouched setting) runs out first.
    return {
      error: `أقصى قيمة مسموحة ${maxValue} (أكتر من كده مبالغ فيه وممكن يبطّئ من غير فايدة إضافية)`,
    };
  }
  return { value };
}

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const settings = useNestingJobStore((s) => s.job.settings);
  const updateSettings = useNestingJobStore((s) => s.updateSettings);
  const currentServerUrl = useNestingJobStore((s) => s.baseUrl());
  const updateServerUrl = useNestingJobStore((s) => s.updateServerUrl);
  const serverReachable = useNestingJobStore((s) => s.serverReachable);

  const [serverUrl, setServerUrl] = useState(currentServerUrl);
  const [savingServerUrl, setSavingServerUrl] = useState(false);

  const [width, setWidth] = useState(settings.sheetWidthMm.toFixed(1));
  const [height, setHeight] = useState(settings.sheetHeightMm.toFixed(1));
  const [margin, setMargin] = useState(settings.sheetMarginMm.toFixed(1));
  const [clearance, setClearance] = useState(settings.clearanceMm.toFixed(2));
  const [dpi, setDpi] = useState(settings.dpi.toFixed(0));
  const [backgroundColor, setBackgroundColor] = useState(
    settings.backgroundColor,
  );
  const [exportMode, setExportMode] = useState(settings.exportMode);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  // Empty string means "unset / use backend default", matching
  // lnsMaxIterationsLarge/lnsDestroyFractionLarge being optional on
  // NestingJobSettings -- an untouched field must round-trip back to
  // undefined, not to some numeric placeholder.
  const [lnsMaxIterationsLarge, setLnsMaxIterationsLarge] = useState(
    settings.lnsMaxIterationsLarge?.toString() ?? "",
  );
  const [lnsDestroyFractionLarge, setLnsDestroyFractionLarge] = useState(
    settings.lnsDestroyFractionLarge?.toString() ?? "",
  );

  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSave = async () => {
    // Bounds are generous on purpose -- wide enough for any real print sheet,
    // margin, clearance, or export resolution, but tight enough to catch an
    // accidental extra digit or a unit mix-up before it reaches the backend.
    const widthResult = validatePositive(width, 10000);
    const heightResult = validatePositive(height, 10000);
    const marginResult = validatePositive(margin, 1000);
    const clearanceResult = validatePositive(clearance, 100);
    const dpiResult = validatePositive(dpi, 2400);
    // Bounds mirror ComputeRequest's own Field(ge=1, le=60) and
    // Field(gt=0, le=0.40) in schemas.py exactly -- see that field's doc
    // comment for why 60/0.40 specifically (both are the highest values this
    // codebase's own tests already exercise for the LNS pipeline).
    const lnsIterationsResult = validateOptionalBounded(
      lnsMaxIterationsLarge,
      1,
      60,
    );
    const lnsDestroyResult = validateOptionalBounded(
      lnsDestroyFractionLarge,
      0.01,
      0.4,
    );

    const nextErrors: Record<string, string> = {};
    if (widthResult.error) nextErrors.width = widthResult.error;
    if (heightResult.error) nextErrors.height = heightResult.error;
    if (marginResult.error) nextErrors.margin = marginResult.error;
    if (clearanceResult.error) nextErrors.clearance = clearanceResult.error;
    if (dpiResult.error) nextErrors.dpi = dpiResult.error;
    if (lnsIterationsResult.error)
      nextErrors.lnsMaxIterationsLarge = lnsIterationsResult.error;
    if (lnsDestroyResult.error)
      nextErrors.lnsDestroyFractionLarge = lnsDestroyResult.error;
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
      packingAttempts: NestingConstants.maxPackingAttempts,
      lnsMaxIterationsLarge: lnsIterationsResult.value,
      lnsDestroyFractionLarge: lnsDestroyResult.value,
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
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  serverReachable ? "bg-emerald-500" : "bg-danger"
                }`}
              />
              <span className="text-xs font-semibold text-slate-600">
                رابط الباك إند المحلي
              </span>
              <span
                className={`mr-auto text-[11px] font-semibold ${
                  serverReachable ? "text-emerald-600" : "text-danger"
                }`}
              >
                {serverReachable ? "متصل" : "غير متصل"}
              </span>
            </div>
            <input
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://127.0.0.1:8000"
              dir="ltr"
              className="mt-2 w-full rounded-[11px] border border-slate-300 bg-white px-3.5 py-3 text-left text-sm text-slate-900 outline-none focus:border-primary"
            />
            <p className="mt-1.5 text-xs leading-snug text-slate-500">
              الافتراضي هو <span dir="ltr">http://127.0.0.1:8000</span> عندما
              تكون الواجهة والـPython على نفس الجهاز. بهذا تظل الصور داخل
              الجهاز.
            </p>
            <button
              onClick={async () => {
                setSavingServerUrl(true);
                try {
                  await updateServerUrl(serverUrl);
                } finally {
                  setSavingServerUrl(false);
                }
              }}
              disabled={savingServerUrl || serverUrl.trim().length === 0}
              className="mt-2.5 w-full rounded-[11px] bg-primary py-2.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {savingServerUrl ? "جاري الاتصال..." : "حفظ والاتصال محليًا"}
            </button>
          </div>

          <div className="mt-3.5 flex gap-3">
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

          <div className="mt-5">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-right"
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold text-slate-900">
                  إعدادات التحسين المتقدمة (LNS)
                </p>
                <p className="mt-[3px] text-xs text-slate-500">
                  تأثر فقط لما يزيد عدد القطع عن 100 قطعة موضوعة -- اتركها فارغة
                  لو مش متأكد
                </p>
              </div>
              <svg
                viewBox="0 0 24 24"
                className={`h-5 w-5 shrink-0 text-slate-500 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 9l6 6 6-6"
                />
              </svg>
            </button>

            {advancedOpen && (
              <div className="mt-2.5 space-y-3 rounded-xl border border-slate-200 p-3.5">
                <NumberField
                  label="أقصى عدد تكرارات (max iterations)"
                  value={lnsMaxIterationsLarge}
                  onChange={setLnsMaxIterationsLarge}
                  error={errors.lnsMaxIterationsLarge}
                  // Matches LNS_MAX_ITERATIONS_LARGE's own default in main.py
                  // (_positive_env_int("NESTING_LNS_MAX_ITERATIONS_LARGE", 15)) --
                  // update both together if that default ever changes.
                  placeholder="الافتراضي: 15"
                  helper={
                    !errors.lnsMaxIterationsLarge
                      ? "من 1 إلى 60. سيبها فاضية عشان تستخدم قيمة السيرفر الافتراضية (15). رفعها بيدي الخوارزمية محاولات أكتر تلاقي ترتيب أحسن، لكن السقف الزمني للسيرفر (time budget) ممكن يوقفها قبل ما تكمل كل التكرارات."
                      : undefined
                  }
                />
                <NumberField
                  label="نسبة إعادة الترتيب (destroy fraction)"
                  value={lnsDestroyFractionLarge}
                  onChange={setLnsDestroyFractionLarge}
                  error={errors.lnsDestroyFractionLarge}
                  // Matches LNS_DESTROY_FRACTION_LARGE's own default in main.py
                  // (_positive_env_float("NESTING_LNS_DESTROY_FRACTION_LARGE", 0.15)) --
                  // update both together if that default ever changes.
                  placeholder="الافتراضي: 0.15"
                  helper={
                    !errors.lnsDestroyFractionLarge
                      ? "من 0.01 إلى 0.40 (مثال: 0.20). سيبها فاضية عشان تستخدم قيمة السيرفر الافتراضية (0.15). رفعها بيخلي كل تكرار يشيل ويعيد ترتيب نسبة أكبر من القطع، لكن رفعها كتير (فوق 0.40) بيبقى مبالغ فيه لأنه بيهد أغلب الترتيب بدل تحسين مستهدف."
                      : undefined
                  }
                />
              </div>
            )}
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
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  helper?: string;
  // Shown only while the field is empty -- used for the LNS advanced fields
  // to surface the backend's own tiered default (see _lns_pipeline_settings
  // in main.py) without writing an actual value into the input. An empty
  // field must still submit as undefined ("use backend default"), so this is
  // purely a visual hint, not a prefilled value.
  placeholder?: string;
}) {
  return (
    <label className="block flex-1">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-[11px] border bg-white px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-primary placeholder:text-slate-400 ${
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
