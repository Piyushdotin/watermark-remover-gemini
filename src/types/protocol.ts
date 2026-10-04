// Worker message contract (see docs/LLD.md §2, narrowed to the Phase 4
// worker layer: lifecycle + engine invocation; mux artifact shapes arrive
// with the Phase 6 media pipeline). Dependency-free: no imports.
import type {
  FrameSample,
  RestorationRequest,
  ValidatedCandidate,
  WatermarkDetectionResult,
} from "../lib/watermark/types.js";

/** Machine-readable worker failure modes. */
export type WorkerErrorCode =
  | "E-INVALID-COMMAND"
  | "E-JOB-BUSY"
  | "E-UNSUPPORTED-CONTAINER"
  | "E-NO-WATERMARK-FOUND"
  | "E-INTERRUPTED";

export type WorkerPhase = "validate" | "analyze" | "restore";

export interface RestorePayload extends RestorationRequest {
  readonly validation: ValidatedCandidate;
}

export type WorkerCommand =
  | {
      kind: "validate";
      jobId: string;
      generation: number;
      seq: number;
      fileName: string;
      fileSizeBytes: number;
      mimeType: string;
    }
  | {
      kind: "analyze";
      jobId: string;
      generation: number;
      seq: number;
      samples: FrameSample[];
    }
  | {
      kind: "restore";
      jobId: string;
      generation: number;
      seq: number;
      payload: RestorePayload;
    }
  | { kind: "cancel"; jobId: string; generation: number; seq: number };

export interface WorkerProgress {
  readonly processedFrames: number;
  readonly totalFrames: number | null;
  readonly fps: number | null;
  readonly elapsedMs: number;
  readonly etaMs: number | null;
  readonly determinate: boolean;
}

export interface RestoredRoi {
  /** Transferred copy of the restored ROI bytes (exact length). */
  readonly buffer: ArrayBuffer;
  readonly width: number;
  readonly height: number;
  readonly pixelsRestored: number;
}

export type WorkerEventBody =
  | {
      kind: "phase";
      phase: WorkerPhase;
      announce: true;
    }
  | {
      kind: "progress";
      progress: WorkerProgress;
    }
  | {
      kind: "detection";
      result: WatermarkDetectionResult;
    }
  | {
      kind: "complete";
      result: RestoredRoi;
    }
  | {
      kind: "failed";
      code: WorkerErrorCode;
      reason: string;
    }
  | {
      kind: "cancelled";
      hadActiveJob: boolean;
    };

export type WorkerEvent = WorkerEventBody & {
  jobId: string;
  generation: number;
  seq: number;
};
