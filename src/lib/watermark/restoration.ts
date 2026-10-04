// Frozen inverse-alpha restoration, implemented from the specification:
//
//   watermarked = alpha * logo + (1 - alpha) * original
//   original    = (watermarked - alpha * logo) / (1 - alpha)
//
// Per-pixel, ROI-only, float intermediates, fresh output buffer.
// No denoising, inpainting, temporal cleanup, or post-processing.
import type {
  AlphaMap,
  RestorationRequest,
  RestorationResult,
} from "./types.js";
import { EngineError } from "./types.js";

/**
 * Guard for near-opaque alpha. When (1 - alpha) is at or below this, the
 * solve is numerically undefined, so the pixel passes through clamped
 * instead of producing Infinity/NaN. Value rationale: float32-clean with
 * six orders of magnitude below any plausible translucent alpha.
 */
export const ALPHA_SAFETY_EPSILON = 1e-6;

function assertRequest(request: RestorationRequest): void {
  const { data, width, height, alpha, logo } = request;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `ROI dimensions must be positive integers, got ${width}x${height}`,
    );
  }
  if (data.length !== width * height * 4) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `pixel length ${data.length} does not match ROI ${width}x${height}`,
    );
  }
  if (!Number.isInteger(alpha.size) || alpha.size <= 0) {
    throw new EngineError(
      "ALPHA_MISMATCH",
      `alpha size must be a positive integer, got ${alpha.size}`,
    );
  }
  if (alpha.data.length !== alpha.size * alpha.size) {
    throw new EngineError(
      "ALPHA_MISMATCH",
      `alpha data length ${alpha.data.length} does not match size ${alpha.size}`,
    );
  }
  if (width !== alpha.size || height !== alpha.size) {
    throw new EngineError(
      "ALPHA_MISMATCH",
      `ROI ${width}x${height} must match alpha profile size ${alpha.size}`,
    );
  }
  if (!Number.isFinite(logo) || logo < 0 || logo > 255) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `logo value must be within [0,255], got ${logo}`,
    );
  }
  for (let i = 0; i < alpha.data.length; i++) {
    const a = alpha.data[i];
    if (!Number.isFinite(a) || a < 0 || a > 1) {
      throw new EngineError(
        "ALPHA_MISMATCH",
        `alpha[${i}] must be within [0,1], got ${a}`,
      );
    }
  }
}

/**
 * Solve the frozen model per channel. Alpha channel passes through.
 * Returns a fresh buffer; the input is never written to.
 */
export function restoreRoi(request: RestorationRequest): RestorationResult {
  assertRequest(request);
  const { data, width, height, alpha, logo } = request;
  const out = new Uint8ClampedArray(data.length);
  let pixelsRestored = 0;
  for (let p = 0; p < width * height; p++) {
    const a = alpha.data[p];
    const denom = 1 - a;
    const base = p * 4;
    if (denom <= ALPHA_SAFETY_EPSILON) {
      out[base] = data[base];
      out[base + 1] = data[base + 1];
      out[base + 2] = data[base + 2];
      out[base + 3] = data[base + 3];
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const recovered = (data[base + c] - a * logo) / denom;
      out[base + c] = Math.round(Math.min(255, Math.max(0, recovered)));
    }
    out[base + 3] = data[base + 3];
    pixelsRestored++;
  }
  return { data: out, width, height, pixelsRestored };
}
