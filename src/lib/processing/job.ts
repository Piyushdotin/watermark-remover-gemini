// Job identity, initial state, and transition guards. Pure logic —
// no worker, no URLs, no clock. The controller owns sequencing.
import type { JobSnapshot, UiState } from "../../types/job.js";
import type { WorkerProgress } from "../../types/protocol.js";

export function initialProgress(): WorkerProgress {
  return {
    processedFrames: 0,
    totalFrames: null,
    fps: null,
    elapsedMs: 0,
    etaMs: null,
    determinate: false,
  };
}

export function initialSnapshot(generation: number): JobSnapshot {
  return {
    jobId: null,
    generation,
    state: "EMPTY",
    fileName: null,
    fileSizeBytes: 0,
    mimeType: "",
    sourceUrl: null,
    outputUrl: null,
    outputFileName: null,
    detection: null,
    progress: initialProgress(),
    error: null,
    audit: [],
  };
}

const TERMINAL: readonly UiState[] = [
  "COMPLETE",
  "ERROR",
  "CANCELLED",
  "UNSUPPORTED",
  "NO_WATERMARK",
];

/** Terminal states: no further worker-driven transitions are possible. */
export function isTerminal(state: UiState): boolean {
  return TERMINAL.includes(state);
}

/** analyze() is legal only while awaiting analysis input. */
export function canAnalyze(state: UiState): boolean {
  return state === "VALIDATING";
}

/** restore() is legal only after the user reviewed a detection. */
export function canRestore(state: UiState): boolean {
  return state === "READY";
}

/** cancel() acts only on live jobs; elsewhere it is a no-op. */
export function canCancel(state: UiState): boolean {
  return (
    state === "FILE_SELECTED" ||
    state === "VALIDATING" ||
    state === "ANALYZING" ||
    state === "READY" ||
    state === "PROCESSING"
  );
}
