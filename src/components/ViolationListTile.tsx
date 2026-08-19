"use client";

/**
 * Web port of frontend/lib/widgets/violation_list_tile.dart.
 */
import type { NestingViolation } from "@/types/nestingJob";

const SEVERITY_LABELS: Record<string, string> = {
  overlap: "تداخل هندسي",
  clearance_violation: "مسافة أمان غير كافية",
  out_of_bounds: "خارج حدود الشيت",
  dpi_mismatch: "عدم تطابق DPI",
  dimension_mismatch: "عدم تطابق الأبعاد",
  invalid_mode: "وضع ألوان غير صالح",
  missing_icc_profile: "ICC profile مفقود",
  file_unreadable: "الملف غير قابل للقراءة",
};

const DANGER_SEVERITIES = new Set([
  "overlap",
  "clearance_violation",
  "out_of_bounds",
  "dpi_mismatch",
  "dimension_mismatch",
  "invalid_mode",
  "file_unreadable",
]);

function colorFor(severity: string): {
  text: string;
  bg: string;
  border: string;
  iconBg: string;
} {
  const isDanger = DANGER_SEVERITIES.has(severity);
  return isDanger
    ? {
        text: "text-danger",
        bg: "bg-danger/[0.07]",
        border: "border-danger/[0.28]",
        iconBg: "bg-danger/[0.14]",
      }
    : {
        text: "text-warning",
        bg: "bg-warning/[0.07]",
        border: "border-warning/[0.28]",
        iconBg: "bg-warning/[0.14]",
      };
}

export function ViolationListTile({
  violation,
}: {
  violation: NestingViolation;
}) {
  const colors = colorFor(violation.severity);
  const label = SEVERITY_LABELS[violation.severity] ?? violation.severity;

  return (
    <div
      className={`flex items-start gap-[11px] rounded-[11px] border p-[13px] mb-2 ${colors.bg} ${colors.border}`}
    >
      <div
        className={`flex items-center justify-center w-[26px] h-[26px] shrink-0 rounded-full ${colors.iconBg}`}
      >
        <svg
          viewBox="0 0 24 24"
          className={`w-[15px] h-[15px] ${colors.text}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
        >
          <circle cx="12" cy="12" r="9" />
          <path strokeLinecap="round" d="M12 8v5" />
          <path strokeLinecap="round" d="M12 16h.01" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-[13px] font-bold tracking-[0.1px] ${colors.text}`}>
          {label}
        </p>
        <p className="mt-[3px] text-[12.5px] leading-[1.45] text-slate-700">
          {violation.detail}
        </p>
        {violation.measuredDistanceMm != null && (
          <span
            className={`mt-1.5 inline-block rounded-md px-2 py-[3px] text-[11.5px] font-bold ${colors.text} ${colors.iconBg}`}
          >
            المسافة المقاسة: {violation.measuredDistanceMm.toFixed(3)}mm
          </span>
        )}
      </div>
    </div>
  );
}
