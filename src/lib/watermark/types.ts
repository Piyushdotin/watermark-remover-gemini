// Engine-wide shared types. Types only — no runtime code.
// The engine is framework-free: nothing here references React, Next.js,
// DOM, media libraries, or worker APIs.

/** Confidence tier assigned by the validator. Never inferred elsewhere. */
export type DetectionTier = "CONFIDENT" | "UNCERTAIN" | "NONE";

/** Machine-readable engine failure modes. */
export type EngineErrorCode =
  | "INVALID_GEOMETRY"
  | "ALPHA_MISMATCH"
  | "UNSUPPORTED_PROFILE"
  | "NOT_VALIDATED"
  | "NO_WATERMARK";

export class EngineError extends Error {
  readonly code: EngineErrorCode;
  constructor(code: EngineErrorCode, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

/** Known watermark geometry profile (local project data, see profiles.ts). */
export interface WatermarkProfile {
  readonly id: string;
  readonly size: number;
  readonly rightMargin: number;
  readonly bottomMargin: number;
}

/** Integer pixel rectangle, origin top-left. */
export interface Roi {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A profile resolved against concrete frame dimensions (geometry only). */
export interface DetectionCandidate {
  readonly profile: WatermarkProfile;
  readonly roi: Roi;
}

/** A candidate refined by the anchor search, awaiting validation. */
export interface ScoredCandidate extends DetectionCandidate {
  readonly dx: number;
  readonly dy: number;
  readonly score: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/** A candidate the validator has ruled on. */
export interface ValidatedCandidate extends ScoredCandidate {
  readonly tier: DetectionTier;
  readonly note?: string;
}

/** Report consumed by the pipeline and rendered verbatim by the UI. */
export interface WatermarkDetectionResult {
  readonly tier: DetectionTier;
  readonly profileMatch: WatermarkProfile;
  readonly anchorOffset: { readonly dx: number; readonly dy: number };
  readonly scores: readonly number[];
  readonly framesSampled: number;
  readonly note?: string;
}

/**
 * Calibrated alpha support for one profile size. Production calibration is
 * deferred: Phase 1 uses project-owned synthetic maps (see tests) that
 * implement this interface. `data` holds per-pixel alpha in [0,1],
 * row-major, `size * size` entries.
 */
export interface AlphaMap {
  readonly size: number;
  readonly data: Float32Array;
}

/** Input to the restoration solve. `data` is RGBA, row-major. */
export interface RestorationRequest {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  readonly alpha: AlphaMap;
  /** Scalar logo value in [0,255] applied to R, G, and B. */
  readonly logo: number;
}

/** Output of the restoration solve. Fresh buffer; input never mutated. */
export interface RestorationResult {
  readonly data: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
  /** Pixels where (1 - alpha) was safely solvable. */
  readonly pixelsRestored: number;
}

/** One luma sample for detection. Produced from decoded frames in later phases. */
export interface FrameSample {
  readonly luma: Float32Array;
  readonly width: number;
  readonly height: number;
}
