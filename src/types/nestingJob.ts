/**
 * Ported field-for-field from frontend/lib/models/nesting_job.dart.
 */
import type { PlacedPart, UploadedPart } from "./sheetPart";

export type NestingJobStage =
  | "upload"
  | "computing"
  | "proofPreview"
  | "exporting"
  | "completed"
  | "failed";

export interface NestingViolation {
  severity: string;
  detail: string;
  partIdA?: string;
  partIdB?: string;
  expected?: string;
  actual?: string;
  measuredDistanceMm?: number;
}

export interface NestingSheetLayout {
  pageNumber: number;
  placedParts: PlacedPart[];
  collisionReportValid: boolean;
}

export interface NestingComputeResult {
  jobId: string;
  placedParts: PlacedPart[];
  sheets: NestingSheetLayout[];
  unplacedPartIds: string[];
  collisionViolations: NestingViolation[];
  allPlaced: boolean;
  collisionReportValid: boolean;
  readyToConfirm: boolean;
  sheetFull: boolean;
  processedCount: number;
  totalCount: number;
  layoutMessage: string;
}

export function sheetCount(result: NestingComputeResult): number {
  return result.sheets.length;
}
export function placedCount(result: NestingComputeResult): number {
  return result.sheets.reduce(
    (count, sheet) => count + sheet.placedParts.length,
    0,
  );
}
export function isPartial(result: NestingComputeResult): boolean {
  return !result.allPlaced;
}
export function isCollisionValid(result: NestingComputeResult): boolean {
  return result.collisionReportValid && result.collisionViolations.length === 0;
}
export function canExport(result: NestingComputeResult): boolean {
  return (
    result.readyToConfirm &&
    result.placedParts.length > 0 &&
    isCollisionValid(result)
  );
}

export interface QaReport {
  filePath: string;
  violations: NestingViolation[];
  checkedDimension: boolean;
  checkedDpi: boolean;
  checkedClearancePairs: number;
  checkedIccAndMode: boolean;
  checkedLayers: boolean;
  exportAccepted: boolean;
  widthPx: number;
  heightPx: number;
  dpi: number;
  layerCount: number;
  processedImagesDirectory?: string;
  movedProcessedImagesCount: number;
}

export function isQaReportValid(report: QaReport): boolean {
  return (
    report.exportAccepted &&
    report.checkedDimension &&
    report.checkedDpi &&
    report.checkedIccAndMode &&
    report.checkedLayers &&
    report.violations.length === 0
  );
}

export interface NestingJobSettings {
  sheetWidthMm: number;
  sheetHeightMm: number;
  sheetMarginMm: number;
  clearanceMm: number;
  dpi: number;
  exportMode: string;
  backgroundColor: string;
  processedImagesPath: string;
  packingAttempts: number;
}

export function defaultSettings(): NestingJobSettings {
  return {
    sheetWidthMm: 790.0,
    sheetHeightMm: 1190.0,
    sheetMarginMm: 5.0,
    clearanceMm: 4.1,
    dpi: 300.0,
    exportMode: "RGB",
    backgroundColor: "#FFFFFF",
    processedImagesPath: "",
    packingAttempts: 1,
  };
}

export interface NestingJob {
  stage: NestingJobStage;
  uploadedParts: UploadedPart[];
  settings: NestingJobSettings;
  computeResult?: NestingComputeResult;
  qaReport?: QaReport;
  /** The path the server returned after export (diagnostic only). */
  exportedFilePath?: string;
  exportedFileBytes?: Uint8Array;
  errorMessage?: string;
}

export function initialJob(): NestingJob {
  return {
    stage: "upload",
    uploadedParts: [],
    settings: defaultSettings(),
  };
}

export function validParts(job: NestingJob): UploadedPart[] {
  return job.uploadedParts.filter((p) => p.validationStatus === "valid");
}
export function rejectedParts(job: NestingJob): UploadedPart[] {
  return job.uploadedParts.filter((p) => p.validationStatus === "rejected");
}
export function hasPendingParts(job: NestingJob): boolean {
  return job.uploadedParts.some((p) => p.validationStatus === "pending");
}
export function canProceedToCompute(job: NestingJob): boolean {
  return (
    job.uploadedParts.length > 0 &&
    !hasPendingParts(job) &&
    validParts(job).length > 0
  );
}
// Note: absence of rejected images is intentionally NOT a precondition here —
// the backend (part_inputs_from_state in job_storage.py) already ignores
// rejected parts on its own and only orders the valid ones, so it would be
// inconsistent for the frontend to block progress over one rejected image
// sitting among a large batch of valid ones.
export function canConfirmExport(job: NestingJob): boolean {
  return job.computeResult ? canExport(job.computeResult) : false;
}
