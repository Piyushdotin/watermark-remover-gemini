// Validation as a separate stage: the detector proposes, the validator
// decides. Uncertain candidates are never silently promoted, and nothing
// below CONFIDENT may reach restoration (see assertRestorable).
import type {
  DetectionTier,
  ScoredCandidate,
  ValidatedCandidate,
} from "./types.js";
import { EngineError } from "./types.js";
import { isRoiInsideFrame, resolveCandidateProfile } from "./detector.js";

/**
 * Initial score cutoffs in luma units for the Phase 1 anchor metric
 * (|mean(inner) - mean(ring)|). Rationale: on synthetic fixtures a solid
 * watermark square separates from its surround by tens of luma levels,
 * while plain content/noise separates by low single digits. These are
 * starting values owned by this project; changing them requires fixture
 * evidence and a re-baseline note — never silent edits.
 */
export const CONFIDENT_SCORE_THRESHOLD = 12;
export const UNCERTAIN_SCORE_THRESHOLD = 4;

export const UNCERTAIN_NOTE = "TIER 3 — UNCERTAIN — VERIFY EDGES";

/** Assign a tier. Rejects impossible geometry and unknown profiles. */
export function validateCandidate(
  scored: ScoredCandidate,
): ValidatedCandidate {
  if (resolveCandidateProfile(scored.profile.size) === null) {
    throw new EngineError(
      "UNSUPPORTED_PROFILE",
      `watermark size ${scored.profile.size} is not a known V1 profile`,
    );
  }
  const roi = {
    x: scored.roi.x + scored.dx,
    y: scored.roi.y + scored.dy,
    width: scored.roi.width,
    height: scored.roi.height,
  };
  if (!isRoiInsideFrame(roi, scored.frameWidth, scored.frameHeight)) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `refined ROI (${roi.x},${roi.y} ${roi.width}x${roi.height}) escapes its ${scored.frameWidth}x${scored.frameHeight} frame`,
    );
  }
  if (!Number.isFinite(scored.score)) {
    throw new EngineError("INVALID_GEOMETRY", "candidate score is not finite");
  }
  let tier: DetectionTier = "NONE";
  let note: string | undefined;
  if (scored.score >= CONFIDENT_SCORE_THRESHOLD) {
    tier = "CONFIDENT";
  } else if (scored.score >= UNCERTAIN_SCORE_THRESHOLD) {
    tier = "UNCERTAIN";
    note = UNCERTAIN_NOTE;
  }
  return { ...scored, roi, tier, note };
}

/**
 * Gate restoration. Returns the candidate unchanged when CONFIDENT,
 * otherwise throws — the pipeline maps this to NO_WATERMARK handling
 * (NONE) or flagged review (UNCERTAIN), never to a silent restore.
 */
export function assertRestorable(
  validated: ValidatedCandidate,
): ValidatedCandidate {
  if (validated.tier !== "CONFIDENT") {
    throw new EngineError(
      "NOT_VALIDATED",
      `tier ${validated.tier} must never reach restoration as validated`,
    );
  }
  return validated;
}
