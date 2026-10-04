// Stable local engine facade. Later phases (worker, pipeline) consume only
// this module — never detector/validator/restoration internals directly.
// Framework-free: no React, Next.js, media-library, or worker imports.
import type {
  DetectionTier,
  FrameSample,
  RestorationRequest,
  RestorationResult,
  ValidatedCandidate,
  WatermarkDetectionResult,
} from "./types.js";
import { EngineError } from "./types.js";
import { isRoiInsideFrame, selectCandidates } from "./detector.js";
import { refineAnchor } from "./anchor-search.js";
import { assertRestorable, validateCandidate } from "./validator.js";
import { restoreRoi } from "./restoration.js";

function tierRank(tier: DetectionTier): number {
  if (tier === "CONFIDENT") return 2;
  if (tier === "UNCERTAIN") return 1;
  return 0;
}

function assertSample(sample: FrameSample, index: number): void {
  if (
    !Number.isInteger(sample.width) ||
    !Number.isInteger(sample.height) ||
    sample.width <= 0 ||
    sample.height <= 0 ||
    sample.luma.length !== sample.width * sample.height
  ) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `sample ${index} luma does not match its dimensions`,
    );
  }
}

/**
 * Run detection over luma samples. Returns the best validated result, or
 * null when nothing reaches UNCERTAIN or above (the pipeline maps null to
 * NO_WATERMARK: no modification, no output). A candidate that fails
 * geometric validation is skipped, never promoted. Deterministic for
 * identical inputs.
 */
export function detectFromSamples(
  samples: readonly FrameSample[],
): WatermarkDetectionResult | null {
  if (samples.length === 0) {
    throw new EngineError("INVALID_GEOMETRY", "detection needs ≥1 sample");
  }
  let best: ValidatedCandidate | null = null;
  const scores: number[] = [];
  for (let s = 0; s < samples.length; s++) {
    const sample = samples[s];
    assertSample(sample, s);
    for (const candidate of selectCandidates(sample.width, sample.height)) {
      if (
        !isRoiInsideFrame(candidate.roi, sample.width, sample.height)
      ) {
        continue;
      }
      let validated: ValidatedCandidate;
      try {
        const anchor = refineAnchor(
          sample.luma,
          sample.width,
          sample.height,
          candidate.roi,
        );
        validated = validateCandidate({
          ...candidate,
          dx: anchor.dx,
          dy: anchor.dy,
          score: anchor.score,
          frameWidth: sample.width,
          frameHeight: sample.height,
        });
      } catch (error) {
        if (error instanceof EngineError) continue;
        throw error;
      }
      scores.push(validated.score);
      if (
        best === null ||
        tierRank(validated.tier) > tierRank(best.tier) ||
        (validated.tier === best.tier && validated.score > best.score)
      ) {
        best = validated;
      }
    }
  }
  if (best === null || best.tier === "NONE") return null;
  return {
    tier: best.tier,
    profileMatch: best.profile,
    anchorOffset: { dx: best.dx, dy: best.dy },
    scores,
    framesSampled: samples.length,
    ...(best.note !== undefined ? { note: best.note } : {}),
  };
}

export interface ValidatedRestorationRequest extends RestorationRequest {
  readonly validation: ValidatedCandidate;
}

/**
 * Restore only a CONFIDENT-validated ROI. Anything else throws
 * NOT_VALIDATED — the caller maps that to review/NO_WATERMARK handling.
 * Also rejects requests whose dimensions disagree with the validation.
 */
export function restoreValidated(
  request: ValidatedRestorationRequest,
): RestorationResult {
  const validated = assertRestorable(request.validation);
  if (
    request.width !== validated.roi.width ||
    request.height !== validated.roi.height
  ) {
    throw new EngineError(
      "INVALID_GEOMETRY",
      `request ROI ${request.width}x${request.height} disagrees with validated ${validated.roi.width}x${validated.roi.height}`,
    );
  }
  return restoreRoi(request);
}
