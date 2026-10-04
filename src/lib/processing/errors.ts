// Error-code mapping for worker failures (see docs/LLD.md lifecycle §12).
// Reuses the existing taxonomy — no new machine-readable codes here;
// API misuse raises ControllerError (programmer error, never UI copy).
import type { WorkerErrorCode } from "../../types/protocol.js";
import type { UiState } from "../../types/job.js";

/** Map a worker failure code to its terminal UI state. */
export function mapWorkerFailure(code: WorkerErrorCode): UiState {
  if (code === "E-UNSUPPORTED-CONTAINER") return "UNSUPPORTED";
  if (code === "E-NO-WATERMARK-FOUND") return "NO_WATERMARK";
  return "ERROR";
}

export class ControllerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ControllerError";
  }
}
