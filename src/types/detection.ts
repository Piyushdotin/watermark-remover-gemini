// Project-level watermark detection contract (see docs/LLD.md §1).
// Dependency-free: this module imports nothing, so UI, controller, and
// worker code can share these shapes without touching engine internals.
// The engine implements these types; it does not extend them here.

/** Confidence tier assigned by the validator. Never inferred elsewhere. */
export type DetectionTier = "CONFIDENT" | "UNCERTAIN" | "NONE";

/** Known watermark geometry profile (local project data). */
export interface WatermarkProfile {
  readonly id: string;
  readonly size: number;
  readonly rightMargin: number;
  readonly bottomMargin: number;
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
