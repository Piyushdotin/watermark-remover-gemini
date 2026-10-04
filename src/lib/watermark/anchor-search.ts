// Local anchor refinement around a predicted ROI.
// Search window and scoring are explicit, small, and deterministic.
//
// Scoring rationale (documented initial metric): a semi-transparent light
// watermark raises local luma, so the ROI interior separates from its
// immediate surround. score(offset) = |mean(inner) - mean(ring)|, where
// `inner` is the ROI inset by INNER_INSET_PX and `ring` is a RING_WIDTH_PX
// border hugging the ROI. Both regions are clamped to the frame. Higher is
// a better fit. This metric is validated on synthetic fixtures in Phase 1;
// production tuning, if ever needed, requires measured rationale.
import type { Roi } from "./types.js";
import { EngineError } from "./types.js";

/** Half-extent of the square search window. Small by product contract. */
export const ANCHOR_SEARCH_RADIUS_PX = 8;
/** Width of the surround ring hugging the ROI. */
export const RING_WIDTH_PX = 4;
/** Inset of the measured interior from the ROI edge (avoids edge blend). */
export const INNER_INSET_PX = 2;

export interface AnchorResult {
  readonly dx: number;
  readonly dy: number;
  readonly score: number;
}

/** Rec.601 luma, float precision. Returns a fresh buffer. */
export function toLuma(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  if (rgba.length !== width * height * 4) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `RGBA length ${rgba.length} does not match ${width}x${height}`,
    );
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    out[i] = 0.299 * rgba[o] + 0.587 * rgba[o + 1] + 0.114 * rgba[o + 2];
  }
  return out;
}

function meanInRect(
  luma: Float32Array,
  frameWidth: number,
  frameHeight: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const ax = Math.max(0, x0);
  const ay = Math.max(0, y0);
  const bx = Math.min(frameWidth, x1);
  const by = Math.min(frameHeight, y1);
  if (bx <= ax || by <= ay) return 0;
  let sum = 0;
  for (let y = ay; y < by; y++) {
    const row = y * frameWidth;
    for (let x = ax; x < bx; x++) sum += luma[row + x];
  }
  return sum / ((bx - ax) * (by - ay));
}

function scoreAt(
  luma: Float32Array,
  frameWidth: number,
  frameHeight: number,
  roi: Roi,
): number {
  const inner = meanInRect(
    luma,
    frameWidth,
    frameHeight,
    roi.x + INNER_INSET_PX,
    roi.y + INNER_INSET_PX,
    roi.x + roi.width - INNER_INSET_PX,
    roi.y + roi.height - INNER_INSET_PX,
  );
  // Ring = outer rect minus inner rect, computed as four strips.
  const ox0 = roi.x - RING_WIDTH_PX;
  const oy0 = roi.y - RING_WIDTH_PX;
  const ox1 = roi.x + roi.width + RING_WIDTH_PX;
  const oy1 = roi.y + roi.height + RING_WIDTH_PX;
  const ix0 = roi.x;
  const iy0 = roi.y;
  const ix1 = roi.x + roi.width;
  const iy1 = roi.y + roi.height;
  const top = meanInRect(luma, frameWidth, frameHeight, ox0, oy0, ox1, iy0);
  const bottom = meanInRect(luma, frameWidth, frameHeight, ox0, iy1, ox1, oy1);
  const left = meanInRect(luma, frameWidth, frameHeight, ox0, iy0, ix0, iy1);
  const right = meanInRect(luma, frameWidth, frameHeight, ix1, iy0, ox1, iy1);
  return Math.abs(inner - (top + bottom + left + right) / 4);
}

/**
 * Refine a predicted ROI within ±radius px. Deterministic: fixed scan
 * order, higher score wins, ties resolve to the smallest (|dx|+|dy|),
 * then smallest dx, then smallest dy — (0,0) always wins exact ties.
 */
export function refineAnchor(
  luma: Float32Array,
  frameWidth: number,
  frameHeight: number,
  predicted: Roi,
  radius: number = ANCHOR_SEARCH_RADIUS_PX,
): AnchorResult {
  if (luma.length !== frameWidth * frameHeight) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `luma length ${luma.length} does not match ${frameWidth}x${frameHeight}`,
    );
  }
  if (!Number.isInteger(radius) || radius < 0) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `search radius must be a non-negative integer, got ${radius}`,
    );
  }
  let best: AnchorResult = {
    dx: 0,
    dy: 0,
    score: scoreAt(luma, frameWidth, frameHeight, predicted),
  };
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const score = scoreAt(
        luma,
        frameWidth,
        frameHeight,
        {
          x: predicted.x + dx,
          y: predicted.y + dy,
          width: predicted.width,
          height: predicted.height,
        },
      );
      const bestCost = Math.abs(best.dx) + Math.abs(best.dy);
      const cost = Math.abs(dx) + Math.abs(dy);
      if (
        score > best.score ||
        (score === best.score &&
          (cost < bestCost ||
            (cost === bestCost &&
              (dx < best.dx || (dx === best.dx && dy < best.dy)))))
      ) {
        best = { dx, dy, score };
      }
    }
  }
  return best;
}
