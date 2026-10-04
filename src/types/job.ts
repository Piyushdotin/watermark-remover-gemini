// Controller-owned job snapshot contract (see docs/LLD.md, docs/UI-STATES.md).
// Dependency-free: imports shared shape types only. React components will
// consume these snapshots in Phase 7; the controller never imports React.
import type { WatermarkDetectionResult } from "./detection.js";
import type { WorkerProgress } from "./protocol.js";

/** Canonical session states (see UI-STATES.md). Owned here from Phase 5. */
export type UiState =
  | "EMPTY"
  | "FILE_SELECTED"
  | "VALIDATING"
  | "ANALYZING"
  | "READY"
  | "PROCESSING"
  | "COMPLETE"
  | "ERROR"
  | "CANCELLED"
  | "UNSUPPORTED"
  | "NO_WATERMARK";

export interface JobError {
  readonly code: string;
  readonly reason: string;
}

export interface AuditLine {
  readonly t: number;
  readonly message: string;
}

export interface JobSnapshot {
  readonly jobId: string | null;
  readonly generation: number;
  readonly state: UiState;
  readonly fileName: string | null;
  readonly fileSizeBytes: number;
  readonly mimeType: string;
  readonly sourceUrl: string | null;
  readonly outputUrl: string | null;
  readonly outputFileName: string | null;
  readonly detection: WatermarkDetectionResult | null;
  readonly progress: WorkerProgress;
  readonly error: JobError | null;
  readonly audit: readonly AuditLine[];
}

export type JobListener = (snapshot: JobSnapshot) => void;
