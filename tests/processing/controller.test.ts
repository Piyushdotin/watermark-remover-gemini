// Phase 5 tests: controller owns worker lifecycle, job identity, throttle,
// URLs, and cleanup. Browser globals are faked via injected factories.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createController,
  PROGRESS_FLUSH_MS,
} from "../../src/lib/processing/controller.js";
import type { WorkerPort } from "../../src/lib/processing/controller.js";
import type { WorkerEvent } from "../../src/types/protocol.js";
import type { ValidatedCandidate } from "../../src/lib/watermark/types.js";
import type { JobSnapshot } from "../../src/types/job.js";

class FakeWorker implements WorkerPort {
  posted: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  terminated = false;
  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(event: WorkerEvent): void {
    this.onmessage?.({ data: event });
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  const created: string[] = [];
  const revoked: string[] = [];
  const scheduled: Array<() => void> = [];
  const downloads: Array<{ url: string; fileName: string }> = [];
  let n = 0;
  const seen: JobSnapshot[] = [];
  const controller = createController({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    createId: () => `job-${++n}`,
    clock: () => 5000,
    schedule: (fn) => {
      scheduled.push(fn);
      return {
        cancel: () => {
          const i = scheduled.indexOf(fn);
          if (i >= 0) scheduled.splice(i, 1);
        },
      };
    },
    createObjectURL: (blob: Blob) => {
      void blob;
      const url = `blob:${created.length}`;
      created.push(url);
      return url;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
    downloadUrl: (url: string, fileName: string) => {
      downloads.push({ url, fileName });
      return true;
    },
  });
  controller.subscribe((snapshot) => {
    seen.push(snapshot);
  });
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
  return {
    controller,
    workers,
    created,
    revoked,
    scheduled,
    downloads,
    seen,
    blob,
    flush: () => {
      const fns = scheduled.splice(0);
      for (const fn of fns) fn();
    },
  };
}

function detectionEvent(seq: number): WorkerEvent {
  return {
    kind: "detection",
    jobId: "job-1",
    generation: 1,
    seq,
    result: {
      tier: "CONFIDENT",
      profileMatch: { id: "B-48", size: 48, rightMargin: 32, bottomMargin: 32 },
      anchorOffset: { dx: 0, dy: 0 },
      scores: [40],
      framesSampled: 1,
    },
  };
}

function validation(): ValidatedCandidate {
  return {
    profile: { id: "B-48", size: 48, rightMargin: 32, bottomMargin: 32 },
    roi: { x: 240, y: 160, width: 48, height: 48 },
    dx: 0,
    dy: 0,
    score: 40,
    frameWidth: 320,
    frameHeight: 240,
    tier: "CONFIDENT",
  };
}

describe("job start", () => {
  it("selects a file, creates a worker, and sends validate", () => {
    const h = setup();
    const snapshot = h.controller.select(h.blob, "clip.mp4", "video/mp4");
    assert.equal(snapshot.state, "VALIDATING");
    assert.equal(snapshot.jobId, "job-1");
    assert.equal(snapshot.generation, 1);
    assert.equal(snapshot.sourceUrl, "blob:0");
    assert.equal(h.workers.length, 1);
    assert.equal(h.workers[0].terminated, false);
    const posted = h.workers[0].posted[0] as Record<string, unknown>;
    assert.equal(posted["kind"], "validate");
    assert.equal(posted["jobId"], "job-1");
    assert.equal(posted["fileName"], "clip.mp4");
    assert.equal(posted["fileSizeBytes"], 3);
    const states = h.seen.map((s) => s.state);
    assert.deepEqual(states, ["FILE_SELECTED", "VALIDATING"]);
  });

  it("maps worker creation failure to ERROR/E-CAPABILITY", () => {
    const controller = createController({
      createWorker: () => {
        throw new Error("no workers here");
      },
      createId: () => "job-1",
      clock: () => 0,
    });
    const snapshot = controller.select(
      new Blob([new Uint8Array([1])]),
      "clip.mp4",
      "video/mp4",
    );
    assert.equal(snapshot.state, "ERROR");
    assert.equal(snapshot.error?.code, "E-CAPABILITY");
  });
});

describe("ownership and stale events", () => {
  it("replaces the active job: terminates, revokes, bumps generation", () => {
    const h = setup();
    h.controller.select(h.blob, "a.mp4", "video/mp4");
    h.controller.select(h.blob, "b.mp4", "video/mp4");
    assert.equal(h.workers[0].terminated, true);
    assert.deepEqual(h.revoked, ["blob:0"]);
    const snapshot = h.controller.getSnapshot();
    assert.equal(snapshot.generation, 2);
    assert.equal(snapshot.jobId, "job-2");
    assert.equal(snapshot.sourceUrl, "blob:1");
  });

  it("ignores events for old jobs and generations", () => {
    const h = setup();
    h.controller.select(h.blob, "a.mp4", "video/mp4");
    h.controller.select(h.blob, "b.mp4", "video/mp4");
    const before = h.seen.length;
    h.workers[0].emit(detectionEvent(9));
    h.workers[1].emit({
      ...detectionEvent(9),
      jobId: "job-2",
      generation: 99,
    });
    assert.equal(h.controller.getSnapshot().state, "VALIDATING");
    assert.equal(h.seen.length, before);
  });

  it("ignores malformed and late worker messages", () => {
    const h = setup();
    h.controller.select(h.blob, "a.mp4", "video/mp4");
    const before = h.seen.length;
    const w = h.workers[0];
    w.emit(null as unknown as WorkerEvent);
    w.emit({} as WorkerEvent);
    w.emit({ kind: "nope", jobId: "job-1", generation: 1 } as unknown as WorkerEvent);
    h.controller.cancel();
    w.emit(detectionEvent(10));
    assert.equal(h.controller.getSnapshot().state, "CANCELLED");
    assert.equal(h.seen.length, before + 1);
  });
});

describe("cancellation and reset", () => {
  it("cancels cleanly: terminated worker, source kept, no output", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    const snapshot = h.controller.cancel();
    assert.equal(snapshot.state, "CANCELLED");
    assert.equal(h.workers[0].terminated, true);
    assert.equal(snapshot.sourceUrl, "blob:0");
    assert.deepEqual(h.revoked, []);
    assert.equal(snapshot.outputUrl, null);
  });

  it("cancel is a no-op without a live job", () => {
    const h = setup();
    const snapshot = h.controller.cancel();
    assert.equal(snapshot.state, "EMPTY");
    assert.equal(h.seen.length, 0);
  });

  it("reset revokes everything and returns to EMPTY", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    h.controller.reset();
    const snapshot = h.controller.getSnapshot();
    assert.equal(snapshot.state, "EMPTY");
    assert.equal(snapshot.sourceUrl, null);
    assert.deepEqual(h.revoked, ["blob:0"]);
    assert.equal(h.workers[0].terminated, true);
  });

  it("dispose terminates, clears listeners, and locks the API", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    h.controller.dispose();
    assert.equal(h.workers[0].terminated, true);
    assert.deepEqual(h.revoked, ["blob:0"]);
    assert.throws(() => h.controller.select(h.blob, "x.mp4", "video/mp4"));
    assert.throws(() => h.controller.getSnapshot());
  });
});

describe("progress throttle", () => {
  function progress(seq: number, frames: number): WorkerEvent {
    return {
      kind: "progress",
      jobId: "job-1",
      generation: 1,
      seq,
      progress: {
        processedFrames: frames,
        totalFrames: null,
        fps: 30,
        elapsedMs: frames * 10,
        etaMs: null,
        determinate: false,
      },
    };
  }

  it("coalesces rapid progress to one notification per window", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    const base = h.seen.length;
    const w = h.workers[0];
    w.emit(progress(2, 1));
    w.emit(progress(3, 2));
    w.emit(progress(4, 3));
    assert.equal(h.seen.length, base);
    assert.equal(h.scheduled.length, 1);
    h.flush();
    assert.equal(h.seen.length, base + 1);
    assert.equal(h.controller.getSnapshot().progress.processedFrames, 3);
    assert.equal(h.scheduled.length, 0);
  });

  it("phase events bypass the throttle and flush pending progress", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    const w = h.workers[0];
    w.emit(progress(2, 9));
    const base = h.seen.length;
    w.emit({
      kind: "phase",
      jobId: "job-1",
      generation: 1,
      seq: 3,
      phase: "analyze",
      announce: true,
    });
    assert.equal(h.seen.length, base + 2);
    assert.equal(h.controller.getSnapshot().progress.processedFrames, 9);
  });

  it("never invents totals or ETA", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    const progress = h.controller.getSnapshot().progress;
    assert.equal(progress.totalFrames, null);
    assert.equal(progress.etaMs, null);
  });
});

describe("completion and failure", () => {
  function complete(seq: number): WorkerEvent {
    return {
      kind: "complete",
      jobId: "job-1",
      generation: 1,
      seq,
      result: {
        buffer: new ArrayBuffer(16),
        width: 1,
        height: 1,
        pixelsRestored: 1,
      },
    };
  }

  it("completes: output URL, terminated worker, late events ignored", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    h.workers[0].emit(detectionEvent(5));
    assert.equal(h.controller.getSnapshot().state, "READY");
    h.controller.restore({
      data: new Uint8ClampedArray(48 * 48 * 4),
      width: 48,
      height: 48,
      alpha: { size: 48, data: new Float32Array(48 * 48) },
      logo: 255,
      validation: validation(),
    });
    assert.equal(h.controller.getSnapshot().state, "PROCESSING");
    h.workers[0].emit(complete(9));
    const snapshot = h.controller.getSnapshot();
    assert.equal(snapshot.state, "COMPLETE");
    assert.equal(snapshot.outputUrl, "blob:1");
    assert.equal(snapshot.outputFileName, "restored-clip.mp4");
    assert.equal(h.workers[0].terminated, true);
    const before = h.seen.length;
    h.workers[0].emit(detectionEvent(10));
    assert.equal(h.seen.length, before);
    assert.equal(h.controller.download(), true);
    assert.deepEqual(h.downloads, [
      { url: "blob:1", fileName: "restored-clip.mp4" },
    ]);
  });

  it("replaces a completed job and revokes its output", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    h.workers[0].emit(complete(5));
    assert.equal(h.controller.getSnapshot().outputUrl, "blob:1");
    h.controller.select(h.blob, "next.mp4", "video/mp4");
    assert.deepEqual(h.revoked, ["blob:0", "blob:1"]);
  });

  it("maps failures to terminal states and keeps the source", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    h.workers[0].emit({
      kind: "failed",
      jobId: "job-1",
      generation: 1,
      seq: 5,
      code: "E-UNSUPPORTED-CONTAINER",
      reason: "nope.avi — container not supported",
    });
    const snapshot = h.controller.getSnapshot();
    assert.equal(snapshot.state, "UNSUPPORTED");
    assert.equal(snapshot.error?.code, "E-UNSUPPORTED-CONTAINER");
    assert.equal(snapshot.sourceUrl, "blob:0");
    assert.deepEqual(h.revoked, []);
    assert.equal(h.workers[0].terminated, true);
  });

  it("rejects out-of-order API calls", () => {
    const h = setup();
    assert.throws(() => h.controller.analyze([]));
    assert.throws(() =>
      h.controller.restore({
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
        alpha: { size: 1, data: new Float32Array([0.5]) },
        logo: 255,
        validation: validation(),
      }),
    );
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    h.controller.cancel();
    assert.throws(() => h.controller.analyze([]));
    assert.equal(h.controller.download(), false);
  });

  it("rejects a second restore while processing", () => {
    const h = setup();
    h.controller.select(h.blob, "clip.mp4", "video/mp4");
    h.workers[0].emit(detectionEvent(5));
    const payload = {
      data: new Uint8ClampedArray(48 * 48 * 4),
      width: 48,
      height: 48,
      alpha: { size: 48, data: new Float32Array(48 * 48) },
      logo: 255,
      validation: validation(),
    };
    h.controller.restore(payload);
    assert.throws(() => h.controller.restore(payload));
    const posted = h.workers[0].posted.filter(
      (m) => (m as { kind: string }).kind === "restore",
    );
    assert.equal(posted.length, 1);
  });
});

describe("processing module boundaries", () => {
  it("imports no UI frameworks and no watermark runtime code", () => {
    for (const name of ["controller.ts", "job.ts", "errors.ts"]) {
      const src = readFileSync(
        new URL(`../../src/lib/processing/${name}`, import.meta.url),
        "utf8",
      );
      assert.ok(!/from ["']react["']/.test(src), `${name}: no React`);
      assert.ok(!/from ["']next/.test(src), `${name}: no Next.js`);
      const watermarkImports = [
        ...src.matchAll(
          /import\s+(type\s+)?[\s\S]*?from\s+["']([^"']*watermark[^"']*)["']/g,
        ),
      ];
      for (const match of watermarkImports) {
        assert.ok(
          match[1] !== undefined,
          `${name}: watermark imports must be type-only: ${match[0].split("\n")[0]}`,
        );
      }
    }
  });
});
