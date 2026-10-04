// Main-thread job owner: worker lifetime, URL registry, event→snapshot
// mapping, progress throttle. Framework-agnostic: no React/Next imports;
// browser specifics (Worker, object URLs, download anchor) enter only
// through injectable factories, so Node tests drive every path.
//
// Cancellation model: cancel() terminates the worker immediately and
// publishes CANCELLED. Termination is total and deterministic (no timers,
// no hung states); the worker-side cancel handshake stays covered by the
// Phase 4 worker tests.
import type { FrameSample } from "../watermark/types.js";
import type {
  RestorePayload,
  WorkerCommand,
  WorkerEvent,
  WorkerProgress,
} from "../../types/protocol.js";
import type {
  JobListener,
  JobSnapshot,
  UiState,
} from "../../types/job.js";
import {
  canAnalyze,
  canCancel,
  canRestore,
  initialSnapshot,
} from "./job.js";
import { ControllerError, mapWorkerFailure } from "./errors.js";

/** Minimum ms between progress notifications (10 Hz per plan). */
export const PROGRESS_FLUSH_MS = 100;

/** Cap for the audit trail (UI renders the last few; the rest is history). */
export const AUDIT_CAP = 100;

export interface WorkerPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  terminate: () => void;
}

export interface ScheduledTask {
  cancel: () => void;
}

export interface ControllerDeps {
  createWorker: () => WorkerPort;
  createId?: () => string;
  clock?: () => number;
  schedule?: (fn: () => void, ms: number) => ScheduledTask;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  downloadUrl?: (url: string, fileName: string) => boolean;
}

function defaultCreateId(): string {
  const cryptoRef =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto
      : null;
  return cryptoRef !== null
    ? cryptoRef.randomUUID()
    : `job-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function defaultDownloadUrl(url: string, fileName: string): boolean {
  if (typeof document === "undefined") return false;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export interface ProcessingController {
  getSnapshot: () => JobSnapshot;
  subscribe: (listener: JobListener) => () => void;
  select: (source: Blob, fileName: string, mimeType: string) => JobSnapshot;
  analyze: (samples: FrameSample[]) => JobSnapshot;
  restore: (payload: RestorePayload) => JobSnapshot;
  cancel: () => JobSnapshot;
  reset: () => JobSnapshot;
  dispose: () => void;
  download: () => boolean;
}

export function createController(deps: ControllerDeps): ProcessingController {
  const createId = deps.createId ?? defaultCreateId;
  const clock = deps.clock ?? Date.now;
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const handle = setTimeout(fn, ms);
      return { cancel: () => clearTimeout(handle) };
    });
  const createObjectURL =
    deps.createObjectURL ??
    ((blob: Blob) => URL.createObjectURL(blob));
  const revokeObjectURL =
    deps.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
  const downloadUrl = deps.downloadUrl ?? defaultDownloadUrl;

  let snapshot: JobSnapshot = initialSnapshot(0);
  let listeners = new Set<JobListener>();
  let worker: WorkerPort | null = null;
  let workerAlive = false;
  let commandSeq = 0;
  let pendingProgress: WorkerProgress | null = null;
  let lastProgressPublishMs = 0;
  let scheduledFlush: ScheduledTask | null = null;
  let disposed = false;

  function copy(): JobSnapshot {
    return { ...snapshot, audit: [...snapshot.audit] };
  }

  function notify(): void {
    const current = copy();
    for (const listener of [...listeners]) listener(current);
  }

  function audit(message: string): void {
    const trail = [...snapshot.audit, { t: clock(), message }];
    snapshot = {
      ...snapshot,
      audit: trail.length > AUDIT_CAP ? trail.slice(-AUDIT_CAP) : trail,
    };
  }

  function setState(state: UiState, message: string): void {
    snapshot = { ...snapshot, state };
    audit(message);
  }

  function revoke(url: string | null): void {
    if (url !== null) {
      try {
        revokeObjectURL(url);
      } catch {
        // Revocation is best-effort cleanup; never fail the transition.
      }
    }
  }

  function terminateWorker(): void {
    workerAlive = false;
    if (worker !== null) {
      try {
        worker.onmessage = null;
        worker.terminate();
      } catch {
        // Termination is best-effort; the alive flag already guards events.
      }
      worker = null;
    }
    pendingProgress = null;
    if (scheduledFlush !== null) {
      scheduledFlush.cancel();
      scheduledFlush = null;
    }
  }

  function assertUsable(): void {
    if (disposed) throw new ControllerError("controller is disposed");
  }

  function flushProgress(): void {
    if (pendingProgress === null) return;
    snapshot = { ...snapshot, progress: pendingProgress };
    pendingProgress = null;
    lastProgressPublishMs = clock();
    if (scheduledFlush !== null) {
      scheduledFlush.cancel();
      scheduledFlush = null;
    }
    notify();
  }

  function noteProgress(value: WorkerProgress): void {
    pendingProgress = value;
    if (clock() - lastProgressPublishMs >= PROGRESS_FLUSH_MS) {
      flushProgress();
      return;
    }
    if (scheduledFlush === null) {
      const wait = Math.max(
        0,
        PROGRESS_FLUSH_MS - (clock() - lastProgressPublishMs),
      );
      scheduledFlush = schedule(() => {
        scheduledFlush = null;
        flushProgress();
      }, wait);
    }
  }

  function send(command: WorkerCommand): void {
    if (worker === null || !workerAlive) {
      throw new ControllerError("no live worker for command");
    }
    commandSeq += 1;
    worker.postMessage({ ...command, seq: commandSeq });
  }

  function startJob(source: Blob, fileName: string, mimeType: string): void {
    if (fileName.length === 0) {
      throw new ControllerError("fileName must not be empty");
    }
    terminateWorker();
    revoke(snapshot.sourceUrl);
    revoke(snapshot.outputUrl);
    const generation = snapshot.generation + 1;
    const jobId = createId();
    let port: WorkerPort;
    try {
      port = deps.createWorker();
    } catch {
      snapshot = {
        ...initialSnapshot(generation),
        state: "ERROR",
        fileName,
        fileSizeBytes: source.size,
        mimeType,
        error: { code: "E-CAPABILITY", reason: "worker could not start" },
      };
      audit(`select ${fileName}: worker unavailable`);
      notify();
      return;
    }
    const sourceUrl = createObjectURL(source);
    worker = port;
    workerAlive = true;
    commandSeq = 0;
    lastProgressPublishMs = clock();
    snapshot = {
      ...initialSnapshot(generation),
      jobId,
      state: "FILE_SELECTED",
      fileName,
      fileSizeBytes: source.size,
      mimeType,
      sourceUrl,
    };
    audit(`select ${fileName}`);
    notify();
    port.onmessage = (event: { data: unknown }) => onWorkerMessage(event.data);
    send({
      kind: "validate",
      jobId,
      generation,
      seq: 0,
      fileName,
      fileSizeBytes: source.size,
      mimeType,
    });
    setState("VALIDATING", "validate requested");
    notify();
  }

  function onWorkerMessage(raw: unknown): void {
    if (!workerAlive || worker === null) return;
    if (!isRecord(raw) || typeof raw["kind"] !== "string") return;
    const event = raw as WorkerEvent;
    if (
      typeof event.jobId !== "string" ||
      typeof event.generation !== "number" ||
      snapshot.jobId === null ||
      event.jobId !== snapshot.jobId ||
      event.generation !== snapshot.generation
    ) {
      return;
    }
    switch (event.kind) {
      case "phase":
        flushProgress();
        audit(`phase ${event.phase}`);
        notify();
        break;
      case "progress":
        noteProgress(event.progress);
        break;
      case "detection":
        flushProgress();
        snapshot = { ...snapshot, detection: event.result };
        setState("READY", `detected ${event.result.tier}`);
        notify();
        break;
      case "complete": {
        flushProgress();
        const bytes = event.result.buffer.slice(0);
        const blob = new Blob([bytes], { type: "video/mp4" });
        const outputUrl = createObjectURL(blob);
        const outputFileName = `restored-${snapshot.fileName ?? "video.mp4"}`;
        terminateWorker();
        snapshot = {
          ...snapshot,
          outputUrl,
          outputFileName,
          progress: {
            ...snapshot.progress,
            processedFrames: event.result.pixelsRestored,
          },
        };
        setState("COMPLETE", "output finalized");
        notify();
        break;
      }
      case "failed": {
        flushProgress();
        const state = mapWorkerFailure(event.code);
        terminateWorker();
        snapshot = {
          ...snapshot,
          error: { code: event.code, reason: event.reason },
        };
        setState(state, `failed ${event.code}`);
        notify();
        break;
      }
      case "cancelled":
        // Worker-side acknowledgement; controller termination (below in
        // cancel()) is authoritative, so late arrivals land here only if
        // the worker outlives the command — still honored, never an error.
        terminateWorker();
        snapshot = { ...snapshot };
        setState("CANCELLED", "cancel acknowledged");
        notify();
        break;
      default:
        break;
    }
  }

  const controller: ProcessingController = {
    getSnapshot: () => {
      assertUsable();
      return copy();
    },

    subscribe: (listener: JobListener) => {
      assertUsable();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    select: (source: Blob, fileName: string, mimeType: string) => {
      assertUsable();
      startJob(source, fileName, mimeType);
      return copy();
    },

    analyze: (samples: FrameSample[]) => {
      assertUsable();
      if (!canAnalyze(snapshot.state) || snapshot.jobId === null) {
        throw new ControllerError(
          `analyze requires VALIDATING, current state is ${snapshot.state}`,
        );
      }
      send({
        kind: "analyze",
        jobId: snapshot.jobId,
        generation: snapshot.generation,
        seq: 0,
        samples,
      });
      setState("ANALYZING", "analyze requested");
      notify();
      return copy();
    },

    restore: (payload: RestorePayload) => {
      assertUsable();
      if (!canRestore(snapshot.state) || snapshot.jobId === null) {
        throw new ControllerError(
          `restore requires READY, current state is ${snapshot.state}`,
        );
      }
      send({
        kind: "restore",
        jobId: snapshot.jobId,
        generation: snapshot.generation,
        seq: 0,
        payload,
      });
      setState("PROCESSING", "restore requested");
      notify();
      return copy();
    },

    cancel: () => {
      assertUsable();
      if (!canCancel(snapshot.state)) return copy();
      terminateWorker();
      revoke(snapshot.outputUrl);
      snapshot = { ...snapshot, outputUrl: null, outputFileName: null };
      setState("CANCELLED", "cancelled by user; partial output discarded");
      notify();
      return copy();
    },

    reset: () => {
      assertUsable();
      terminateWorker();
      revoke(snapshot.sourceUrl);
      revoke(snapshot.outputUrl);
      snapshot = initialSnapshot(snapshot.generation + 1);
      audit("reset");
      notify();
      return copy();
    },

    dispose: () => {
      if (disposed) return;
      terminateWorker();
      revoke(snapshot.sourceUrl);
      revoke(snapshot.outputUrl);
      listeners = new Set();
      disposed = true;
    },

    download: () => {
      assertUsable();
      if (snapshot.outputUrl === null || snapshot.outputFileName === null) {
        return false;
      }
      return downloadUrl(snapshot.outputUrl, snapshot.outputFileName);
    },
  };

  return controller;
}
