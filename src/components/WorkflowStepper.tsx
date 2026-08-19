"use client";

/**
 * Web port of frontend/lib/widgets/workflow_stepper.dart.
 * Same 3-step (رفع القطع / مراجعة الترتيب / التصدير) animated indicator.
 */
import type { NestingJobStage } from "@/types/nestingJob";

const LABELS = ["رفع القطع", "مراجعة الترتيب", "التصدير"];

function activeIndex(stage: NestingJobStage): number {
  switch (stage) {
    case "upload":
      return 0;
    case "computing":
    case "proofPreview":
      return 1;
    case "exporting":
    case "completed":
    case "failed":
      return 2;
  }
}

export function WorkflowStepper({
  currentStage,
}: {
  currentStage: NestingJobStage;
}) {
  const active = activeIndex(currentStage);
  return (
    <div className="flex items-center">
      {LABELS.map((label, index) => {
        const isDone = index < active;
        const isActive = index === active;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center">
              <div
                className={`flex items-center justify-center w-[30px] h-[30px] rounded-full border transition-all duration-base ease-standard ${
                  isDone
                    ? "bg-primary border-primary shadow-[0_0_10px_rgba(37,99,235,0.16)]"
                    : isActive
                      ? "bg-white border-primary shadow-[0_0_10px_2px_rgba(37,99,235,0.28)]"
                      : "bg-white border-slate-300"
                }`}
                style={{ borderWidth: isActive ? 2.5 : 1.6 }}
              >
                {isDone ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="w-[17px] h-[17px] text-white"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : isActive ? (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                ) : null}
              </div>
              <span
                className={`mt-[7px] text-[11px] transition-colors duration-base ease-standard ${
                  isActive
                    ? "font-bold text-slate-900"
                    : "font-medium text-slate-500"
                }`}
              >
                {label}
              </span>
            </div>
            {index < LABELS.length - 1 && (
              <div
                className={`flex-1 h-[2px] mx-2 -mt-6 transition-colors duration-base ease-standard ${
                  index < active ? "bg-primary" : "bg-slate-200"
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
