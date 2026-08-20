"use client";

/**
 * Web port of frontend/lib/widgets/sheet_layout_painter.dart (the
 * CustomPainter) plus the hit-testing logic from preview_screen.dart's
 * _CanvasPanel._hitTest. HTML5 Canvas replaces Flutter's CustomPaint;
 * geometry/scale math is identical.
 */
import { useEffect, useRef } from "react";
import type { PlacedPart } from "@/types/sheetPart";

interface SheetLayoutCanvasProps {
  sheetWidthMm: number;
  sheetHeightMm: number;
  sheetMarginMm: number;
  clearanceMm: number;
  placedParts: PlacedPart[];
  selectedPartId: string | null;
  showClearanceZones: boolean;
  onSelectPart: (partId: string | null) => void;
}

const COLORS = {
  sheetCanvas: "#ffffff",
  sheetBorder: "#cbd5e1",
  slate400: "rgba(148, 163, 184, 0.7)",
  clearanceZoneFill: "rgba(37, 99, 235, 0.10)",
  partFill: "rgba(51, 65, 85, 0.78)",
  partSelectedFill: "rgba(37, 99, 235, 0.88)",
  slate700: "#334155",
  primary: "#2563eb",
  selectedShadow: "rgba(37, 99, 235, 0.10)",
};

function computeScale(
  canvasWidth: number,
  canvasHeight: number,
  sheetWidthMm: number,
  sheetHeightMm: number,
): number {
  const x = canvasWidth / sheetWidthMm;
  const y = canvasHeight / sheetHeightMm;
  return Math.min(x, y);
}

// Exact point-in-polygon test (ray casting / even-odd rule) against the
// part's real contourMm, replacing the old axis-aligned-bbox hit test. Two
// touching parts whose bounding boxes overlap (very common for irregular,
// non-rectangular shapes -- an L-shape's bbox includes area the part itself
// never occupies) used to make a click in that shared bbox region resolve to
// whichever part happened to sit later in the array, regardless of which
// shape the point was actually inside. Iterating parts back-to-front still
// matches natural top-of-stack click behaviour for any parts whose real
// contours do overlap at that exact point.
function pointInPolygon(
  xMm: number,
  yMm: number,
  contour: { x: number; y: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
    const xi = contour[i].x;
    const yi = contour[i].y;
    const xj = contour[j].x;
    const yj = contour[j].y;
    const intersects =
      yi > yMm !== yj > yMm && xMm < ((xj - xi) * (yMm - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function hitTestPart(
  xMm: number,
  yMm: number,
  parts: PlacedPart[],
): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    // Cheap bbox rejection first: a point outside the bounding box is
    // provably outside the polygon it bounds, so this never changes the
    // result -- only skips the more expensive ray-casting loop for parts
    // that could not possibly contain the point.
    const [minX, minY, maxX, maxY] = part.boundsMm;
    if (xMm < minX || xMm > maxX || yMm < minY || yMm > maxY) continue;
    // contourMm always has at least 3 points when it came from the backend's
    // real exterior ring (see nestingJobStore.ts decodePlaced), and exactly
    // 4 for the legacy bbox-rectangle fallback -- either way a real ring to
    // test against, never the degenerate 0/1/2-point case pointInPolygon
    // cannot handle. bbox containment already passed for the fallback
    // rectangle case, so this reduces to the same accept it always gave.
    if (
      part.contourMm.length >= 3 &&
      pointInPolygon(xMm, yMm, part.contourMm)
    ) {
      return part.partId;
    }
  }
  return null;
}

export function SheetLayoutCanvas({
  sheetWidthMm,
  sheetHeightMm,
  sheetMarginMm,
  clearanceMm,
  placedParts,
  selectedPartId,
  showClearanceZones,
  onSelectPart,
}: SheetLayoutCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      const cssW = rect.width;
      const cssH = rect.height;
      if (cssW <= 0 || cssH <= 0) return;

      canvas.width = cssW * dpr;
      canvas.height = cssH * dpr;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const scale = computeScale(cssW, cssH, sheetWidthMm, sheetHeightMm);
      const renderedWidth = sheetWidthMm * scale;
      const renderedHeight = sheetHeightMm * scale;
      const offsetX = (cssW - renderedWidth) / 2;
      const offsetY = (cssH - renderedHeight) / 2;

      ctx.save();
      ctx.translate(offsetX, offsetY);

      // Sheet background + border.
      ctx.fillStyle = COLORS.sheetCanvas;
      ctx.fillRect(0, 0, renderedWidth, renderedHeight);
      ctx.strokeStyle = COLORS.sheetBorder;
      ctx.lineWidth = 1.4;
      ctx.strokeRect(0, 0, renderedWidth, renderedHeight);

      // Safety margin.
      if (sheetMarginMm > 0) {
        const mW = Math.max(
          0,
          Math.min(sheetWidthMm, sheetWidthMm - 2 * sheetMarginMm),
        );
        const mH = Math.max(
          0,
          Math.min(sheetHeightMm, sheetHeightMm - 2 * sheetMarginMm),
        );
        ctx.strokeStyle = COLORS.slate400;
        ctx.lineWidth = 1;
        ctx.strokeRect(
          sheetMarginMm * scale,
          sheetMarginMm * scale,
          mW * scale,
          mH * scale,
        );
      }

      // Clearance zones (drawn first, under the parts).
      if (showClearanceZones) {
        for (const part of placedParts) {
          const [minX, minY, maxX, maxY] = part.boundsMm;
          ctx.fillStyle = COLORS.clearanceZoneFill;
          ctx.fillRect(
            (minX - clearanceMm) * scale,
            (minY - clearanceMm) * scale,
            (maxX - minX + 2 * clearanceMm) * scale,
            (maxY - minY + 2 * clearanceMm) * scale,
          );
        }
      }

      // Parts.
      for (const part of placedParts) {
        if (part.contourMm.length === 0) continue;
        const selected = part.partId === selectedPartId;

        const path = new Path2D();
        const first = part.contourMm[0];
        path.moveTo(first.x * scale, first.y * scale);
        for (const point of part.contourMm.slice(1)) {
          path.lineTo(point.x * scale, point.y * scale);
        }
        path.closePath();

        if (selected) {
          ctx.save();
          ctx.translate(0, 2);
          ctx.fillStyle = COLORS.selectedShadow;
          ctx.fill(path);
          ctx.restore();
        }

        ctx.fillStyle = selected ? COLORS.partSelectedFill : COLORS.partFill;
        ctx.fill(path);

        ctx.strokeStyle = selected ? COLORS.primary : COLORS.slate700;
        ctx.lineWidth = selected ? 2.1 : 1.0;
        ctx.stroke(path);
      }

      ctx.restore();
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    return () => observer.disconnect();
  }, [
    sheetWidthMm,
    sheetHeightMm,
    sheetMarginMm,
    clearanceMm,
    placedParts,
    selectedPartId,
    showClearanceZones,
  ]);

  const handleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const scale = computeScale(cssW, cssH, sheetWidthMm, sheetHeightMm);
    const renderedWidth = sheetWidthMm * scale;
    const renderedHeight = sheetHeightMm * scale;
    const offsetX = (cssW - renderedWidth) / 2;
    const offsetY = (cssH - renderedHeight) / 2;

    const clickX = event.clientX - rect.left;
    const clickY = event.clientY - rect.top;
    const xMm = (clickX - offsetX) / scale;
    const yMm = (clickY - offsetY) / scale;

    const hit = hitTestPart(xMm, yMm, placedParts);
    onSelectPart(hit === selectedPartId ? null : hit);
  };

  return (
    <div ref={containerRef} className="w-full h-full">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        className="w-full h-full cursor-pointer"
      />
    </div>
  );
}
