// Worker-side job lifecycle runner. Pure lifecycle + stable-facade
// invocation — no frame loop, no demux/encode/mux (Phase 6), no DOM,
// no React. The thin `pipeline.worker.ts` adapter supplies `post` and
// forwards `self` messages here, which keeps this module unit-testable
// in Node with an injected post function.
//
// Cancellation model (honest): JavaScript runs to completion, so the flag
// is honored at command boundaries and between analyzed samples. Sync
// stretches stay bounded here because Phase 4 payloads are explicit and
// small; Phase 6 chunks frame work with yields for the same guarantee.
import type {
  RestorePayload,
  WorkerCommand,
  WorkerErrorCode,
  WorkerEvent,
  WorkerEventBody,
  WorkerPhase,
} from "../types/protocol.js";
import type { WatermarkDetectionResult } from "../lib/watermark/types.js";
import { EngineError } from "../lib/watermark/types.js";
import {
  detectFromSamples,
  NO_WATERMARK_FOUND_CODE,
  requireDetection,
  restoreValidated,
} from "../lib/watermark/engine.js";

/** Extensions accepted by the Phase 4 input gate (MIME must also be video/*). */
export const SUPPORTED_INPUT_EXTENSIONS = Object.freeze([
  "mp4",
  "mov",
  "webm",
]);

export interface RunnerPorts {
  post: (message: WorkerEvent, transfer?: Transferable[]) => void;
  now?: () => number;
}

interface ActiveJob {
  jobId: string;
  generation: number;
  cancelled: boolean;
  startedAtMs: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function jobOf(command: WorkerCommand): { jobId: string; generation: number } {
  return { jobId: command.jobId, generation: command.generation };
}

export function createJobRunner(ports: RunnerPorts): {
  handleCommand: (raw: unknown) => void;
} {
  const now = ports.now ?? Date.now;
  let seq = 0;
  let active: ActiveJob | null = null;

  function emit(
    jobId: string,
    generation: number,
    event: WorkerEventBody,
    transfer?: Transferable[],
  ): void {
    seq += 1;
    ports.post({ ...event, jobId, generation, seq }, transfer);
  }

  function fail(
    jobId: string,
    generation: number,
    code: WorkerErrorCode,
    reason: string,
  ): void {
    emit(jobId, generation, { kind: "failed", code, reason });
  }

  function phase(
    job: ActiveJob,
    step: WorkerPhase,
    processedFrames: number,
  ): void {
    emit(job.jobId, job.generation, {
      kind: "phase",
      phase: step,
      announce: true,
    });
    emit(job.jobId, job.generation, {
      kind: "progress",
      progress: {
        processedFrames,
        totalFrames: null,
        fps: null,
        elapsedMs: Math.max(0, now() - job.startedAtMs),
        etaMs: null,
        determinate: false,
      },
    });
  }

  function checkCancelled(job: ActiveJob): boolean {
    if (job.cancelled) {
      emit(job.jobId, job.generation, {
        kind: "cancelled",
        hadActiveJob: true,
      });
      if (active === job) active = null;
      return true;
    }
    return false;
  }

  function parseCommand(raw: unknown):
    | { ok: true; command: WorkerCommand }
    | { ok: false; jobId: string; generation: number; reason: string } {
    if (!isRecord(raw) || typeof raw["kind"] !== "string") {
      return { ok: false, jobId: "", generation: 0, reason: "unrecognized message shape" };
    }
    const kind = raw["kind"];
    if (
      typeof raw["jobId"] !== "string" ||
      typeof raw["generation"] !== "number" ||
      typeof raw["seq"] !== "number"
    ) {
      const jobId = typeof raw["jobId"] === "string" ? raw["jobId"] : "";
      const generation =
        typeof raw["generation"] === "number" ? raw["generation"] : 0;
      return {
        ok: false,
        jobId,
        generation,
        reason: `command "${kind}" is missing job routing (jobId/generation/seq)`,
      };
    }
    if (
      kind !== "validate" &&
      kind !== "analyze" &&
      kind !== "restore" &&
      kind !== "cancel"
    ) {
      return {
        ok: false,
        jobId: raw["jobId"],
        generation: raw["generation"],
        reason: `unsupported command "${kind}"`,
      };
    }
    return { ok: true, command: raw as WorkerCommand };
  }

  function inputExtension(fileName: string): string {
    const dot = fileName.lastIndexOf(".");
    return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
  }

  function handleValidate(command: Extract<WorkerCommand, { kind: "validate" }>): void {
    if (active !== null && active.jobId !== command.jobId) {
      fail(command.jobId, command.generation, "E-JOB-BUSY", "worker already owns a job");
      return;
    }
    active = {
      jobId: command.jobId,
      generation: command.generation,
      cancelled: false,
      startedAtMs: now(),
    };
    const job = active;
    if (checkCancelled(job)) return;
    phase(job, "validate", 0);
    const ext = inputExtension(command.fileName);
    const mimeOk =
      command.mimeType === "" || command.mimeType.startsWith("video/");
    if (
      !(SUPPORTED_INPUT_EXTENSIONS as readonly string[]).includes(ext) ||
      !mimeOk
    ) {
      active = null;
      fail(
        command.jobId,
        command.generation,
        "E-UNSUPPORTED-CONTAINER",
        `${command.fileName || "file"} — container not supported; use MP4, MOV, or WebM`,
      );
      return;
    }
    if (
      !Number.isFinite(command.fileSizeBytes) ||
      command.fileSizeBytes <= 0
    ) {
      active = null;
      fail(
        command.jobId,
        command.generation,
        "E-UNSUPPORTED-CONTAINER",
        `${command.fileName || "file"} — empty file`,
      );
      return;
    }
  }

  function handleAnalyze(command: Extract<WorkerCommand, { kind: "analyze" }>): void {
    if (active === null || active.jobId !== command.jobId) {
      fail(command.jobId, command.generation, "E-INVALID-COMMAND", "no active job for analyze");
      return;
    }
    const job = active;
    if (checkCancelled(job)) return;
    phase(job, "analyze", 0);
    if (!Array.isArray(command.samples)) {
      fail(command.jobId, command.generation, "E-INVALID-COMMAND", "analyze needs samples[]");
      return;
    }
    let result: WatermarkDetectionResult | null;
    try {
      // Cancellation is honored before and after the synchronous facade
      // call (see module note); the facade itself runs to completion.
      result = detectFromSamples(command.samples);
    } catch (error) {
      fail(
        command.jobId,
        command.generation,
        "E-INVALID-COMMAND",
        error instanceof EngineError ? error.message : "detection failed",
      );
      return;
    }
    if (checkCancelled(job)) return;
    try {
      const confirmed = requireDetection(result, job.jobId);
      emit(job.jobId, job.generation, { kind: "detection", result: confirmed });
    } catch (error) {
      if (error instanceof EngineError && error.code === NO_WATERMARK_FOUND_CODE) {
        fail(command.jobId, command.generation, "E-NO-WATERMARK-FOUND", error.message);
        return;
      }
      throw error;
    }
  }

  function toUint8Clamped(value: unknown): Uint8ClampedArray | null {
    if (value instanceof Uint8ClampedArray) return value;
    if (value instanceof ArrayBuffer) return new Uint8ClampedArray(value);
    return null;
  }

  function toFloat32(value: unknown): Float32Array | null {
    if (value instanceof Float32Array) return value;
    if (value instanceof ArrayBuffer) return new Float32Array(value);
    return null;
  }

  function isRestorePayload(value: unknown): value is RestorePayload {
    if (!isRecord(value)) return false;
    if (toUint8Clamped(value["data"]) === null) return false;
    if (
      typeof value["width"] !== "number" ||
      typeof value["height"] !== "number" ||
      typeof value["logo"] !== "number"
    ) {
      return false;
    }
    if (!isRecord(value["alpha"])) return false;
    const alphaData = toFloat32(value["alpha"]["data"]);
    if (typeof value["alpha"]["size"] !== "number" || alphaData === null) {
      return false;
    }
    return isRecord(value["validation"]);
  }

  function handleRestore(command: Extract<WorkerCommand, { kind: "restore" }>): void {
    if (active === null || active.jobId !== command.jobId) {
      fail(command.jobId, command.generation, "E-INVALID-COMMAND", "no active job for restore");
      return;
    }
    const job = active;
    if (checkCancelled(job)) return;
    phase(job, "restore", 0);
    if (!isRestorePayload(command.payload)) {
      fail(command.jobId, command.generation, "E-INVALID-COMMAND", "restore needs a valid ROI payload");
      return;
    }
    try {
      const raw = command.payload;
      const data = toUint8Clamped(raw.data);
      const alphaData = toFloat32(raw.alpha.data);
      if (data === null || alphaData === null) {
        fail(command.jobId, command.generation, "E-INVALID-COMMAND", "restore payload buffers are unusable");
        return;
      }
      const out = restoreValidated({
        data,
        width: raw.width,
        height: raw.height,
        alpha: { size: raw.alpha.size, data: alphaData },
        logo: raw.logo,
        validation: raw.validation,
      });
      const buffer = out.data.slice().buffer as ArrayBuffer;
      emit(
        job.jobId,
        job.generation,
        {
          kind: "complete",
          result: {
            buffer,
            width: out.width,
            height: out.height,
            pixelsRestored: out.pixelsRestored,
          },
        },
        [buffer],
      );
    } catch (error) {
      fail(
        command.jobId,
        command.generation,
        "E-INVALID-COMMAND",
        error instanceof EngineError ? error.message : "restoration failed",
      );
    }
  }

  function handleCancel(command: Extract<WorkerCommand, { kind: "cancel" }>): void {
    if (active !== null && active.jobId === command.jobId) {
      active.cancelled = true;
      const job = active;
      active = null;
      emit(job.jobId, job.generation, { kind: "cancelled", hadActiveJob: true });
      return;
    }
    emit(command.jobId, command.generation, {
      kind: "cancelled",
      hadActiveJob: false,
    });
  }

  function handleCommand(raw: unknown): void {
    try {
      const parsed = parseCommand(raw);
      if (!parsed.ok) {
        fail(parsed.jobId, parsed.generation, "E-INVALID-COMMAND", parsed.reason);
        return;
      }
      const command = parsed.command;
      switch (command.kind) {
        case "validate":
          handleValidate(command);
          break;
        case "analyze":
          handleAnalyze(command);
          break;
        case "restore":
          handleRestore(command);
          break;
        case "cancel":
          handleCancel(command);
          break;
      }
    } catch {
      const fallback = isRecord(raw) && typeof raw["jobId"] === "string" ? raw["jobId"] : "";
      const generation =
        isRecord(raw) && typeof raw["generation"] === "number" ? raw["generation"] : 0;
      fail(fallback, generation, "E-INTERRUPTED", "worker hit an unexpected fault");
    }
  }

  return { handleCommand };
}
