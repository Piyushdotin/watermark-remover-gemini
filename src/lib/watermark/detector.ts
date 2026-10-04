// Pure-geometry candidate selection. No pixels are read or modified here.
import type { DetectionCandidate, Roi, WatermarkProfile } from "./types.js";
import { EngineError } from "./types.js";
import { PROFILES, predictRoi } from "./profiles.js";

function assertFrameSize(frameWidth: number, frameHeight: number): void {
  if (
    !Number.isInteger(frameWidth) ||
    !Number.isInteger(frameHeight) ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `frame dimensions must be positive integers, got ${frameWidth}x${frameHeight}`,
    );
  }
}

/**
 * Select every profile whose predicted ROI fits inside the frame.
 * Ordering is deterministic: largest profile first (stable table order).
 * Returns an empty array when nothing fits — never an invented candidate.
 */
export function selectCandidates(
  frameWidth: number,
  frameHeight: number,
): DetectionCandidate[] {
  assertFrameSize(frameWidth, frameHeight);
  const out: DetectionCandidate[] = [];
  for (const profile of PROFILES) {
    const roi = predictRoi(frameWidth, frameHeight, profile);
    if (roi !== null) out.push({ profile, roi });
  }
  return out;
}

/** True when the ROI lies fully inside a frame of the given size. */
export function isRoiInsideFrame(
  roi: Roi,
  frameWidth: number,
  frameHeight: number,
): boolean {
  return (
    Number.isInteger(roi.x) &&
    Number.isInteger(roi.y) &&
    Number.isInteger(roi.width) &&
    Number.isInteger(roi.height) &&
    roi.width > 0 &&
    roi.height > 0 &&
    roi.x >= 0 &&
    roi.y >= 0 &&
    roi.x + roi.width <= frameWidth &&
    roi.y + roi.height <= frameHeight
  );
}

/** Look up a candidate's profile in the V1 table. Null when unsupported. */
export function resolveCandidateProfile(size: number): WatermarkProfile | null {
  for (const profile of PROFILES) {
    if (profile.size === size) return profile;
  }
  return null;
}
