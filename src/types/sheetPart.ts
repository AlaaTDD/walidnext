/**
 * Ported field-for-field from frontend/lib/models/sheet_part.dart.
 * Every optional (?) below mirrors a nullable Dart field exactly — do not
 * widen or narrow nullability relative to the source.
 */

export type PartValidationStatus = "pending" | "valid" | "rejected";

export interface UploadedPart {
  id: string;
  fileName: string;
  filePath: string;
  /**
   * The user-selected local original. On web this is unused (browsers have no
   * durable local path); kept for schema parity with the desktop/mobile
   * Flutter client, which sends it to the backend for the post-success move
   * operation.
   */
  originalSourcePath?: string;
  /** Raw file bytes, held in memory for thumbnail + multipart upload (web always uses this path — kIsWeb branch in the Dart client). */
  bytes?: Uint8Array;
  /** Browser File object, kept to defer reading arrayBuffer until upload. */
  file?: File;
  backendPartId?: string;
  validationStatus: PartValidationStatus;
  rejectionReason?: string;
  widthPx?: number;
  heightPx?: number;
}

export function isValidPart(part: UploadedPart): boolean {
  return part.validationStatus === "valid";
}
export function isRejectedPart(part: UploadedPart): boolean {
  return part.validationStatus === "rejected";
}
export function isPendingPart(part: UploadedPart): boolean {
  return part.validationStatus === "pending";
}

/**
 * The rotation angle applied to a placed part, in whole degrees. Mirrors
 * LockedRotation in sheet_part.dart: any backend-chosen integer degree is
 * accepted (coarse 15° multiples or fine-refinement angles), not just a
 * closed enum — the frontend never uses this for geometry math, only display.
 */
export interface LockedRotation {
  degrees: number;
}
export function rotationFromDegrees(value: number): LockedRotation {
  return { degrees: value };
}

export interface ContourPointMm {
  x: number;
  y: number;
}

export interface PlacedPart {
  partId: string;
  rotation: LockedRotation;
  contourMm: ContourPointMm[];
  /** [minX, minY, maxX, maxY] — mirrors the Dart (double, double, double, double) record. */
  boundsMm: readonly [number, number, number, number];
  centroidMm: ContourPointMm;
  sourceThumbnail?: Uint8Array;
}
