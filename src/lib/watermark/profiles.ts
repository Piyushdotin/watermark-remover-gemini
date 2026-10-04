// Known watermark geometry profiles as immutable local data.
// Provenance: product requirement "known watermark size/position profiles".
// Only these two profiles exist in V1. Adding a profile is a data change
// that must ship with a fixture test — never an invented constant.
import type { Roi, WatermarkProfile } from "./types.js";
import { EngineError } from "./types.js";

export const PROFILE_A_96: WatermarkProfile = Object.freeze({
  id: "A-96",
  size: 96,
  rightMargin: 64,
  bottomMargin: 64,
});

export const PROFILE_B_48: WatermarkProfile = Object.freeze({
  id: "B-48",
  size: 48,
  rightMargin: 32,
  bottomMargin: 32,
});

/** The complete V1 profile table. Fixed length by product contract. */
export const PROFILES: readonly WatermarkProfile[] = Object.freeze([
  PROFILE_A_96,
  PROFILE_B_48,
]);

/** Look up a profile by watermark size. Returns null when unsupported. */
export function getProfileBySize(size: number): WatermarkProfile | null {
  for (const profile of PROFILES) {
    if (profile.size === size) return profile;
  }
  return null;
}

/**
 * Predict the watermark ROI for a profile on a frame of the given size.
 * Origin is top-left; the watermark sits `rightMargin` px from the right
 * edge and `bottomMargin` px from the bottom edge.
 * Returns null when the profile does not fit (never a negative coordinate).
 */
export function predictRoi(
  frameWidth: number,
  frameHeight: number,
  profile: WatermarkProfile,
): Roi | null {
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
  const x = frameWidth - profile.rightMargin - profile.size;
  const y = frameHeight - profile.bottomMargin - profile.size;
  if (x < 0 || y < 0) return null;
  return { x, y, width: profile.size, height: profile.size };
}
