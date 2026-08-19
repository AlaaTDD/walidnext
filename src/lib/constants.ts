/**
 * Ported field-for-field from frontend/lib/core/constants/nesting_constants.dart.
 *
 * IMPORTANT: these are the UI's default *displayed* values only. The real
 * values actually used in computation must come from the backend itself
 * (once the app talks to the API), not from the number here — this keeps a
 * single source of truth for the real measurements.
 */
export const NestingConstants = {
  /** Default clearance between shapes in millimeters (matches CLEARANCE_MM in app/geometry/clearance.py). Editable from the settings screen; this is only the value shown when the app first opens. */
  defaultClearanceMm: 4.1,

  /** Default export resolution (matches Resolution(dpi=300) in app/geometry/units.py). Must match the actual DPI used at final export or the visual preview of dimensions becomes misleading. */
  defaultDpi: 300.0,

  /** Default sheet dimensions in millimeters: 790mm × 1190mm (79×119 cm). */
  defaultSheetWidthMm: 790.0,
  defaultSheetHeightMm: 1190.0,

  /** Default safety margin from the sheet edge (matches the default sheet_margin_mm in run_nesting). */
  defaultSheetMarginMm: 5.0,

  /** All 24 allowed rotation angles (integer multiples of 15°, matches LockedRotation in app/nesting/rotation.py). */
  lockedRotations: [
    0, 15, 30, 45, 60, 75, 90, 105, 120, 135, 150, 165, 180, 195, 210, 225, 240,
    255, 270, 285, 300, 315, 330, 345,
  ] as const,

  /** Single attempt only: the LNS optimizer handles global optimization (destroy/repair/compaction) instead of repeating multiple greedy attempts. See _PACKING_STRATEGIES in app/nesting/engine.py. */
  maxPackingAttempts: 1,

  /** Accepted color modes for the final export (matches tiff_export.py). */
  allowedExportModes: ["RGB", "RGBA"] as const,

  // Upload formats are not restricted client-side; the backend converts any
  // readable raster image to RGBA in memory and preserves the original source
  // untouched.
} as const;
