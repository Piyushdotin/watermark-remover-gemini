// Phase 4 tests: worker protocol contract + job lifecycle, driven through
// the pure runner with a captured post function. Fixtures are local.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createJobRunner } from "../../src/workers/runner.js";
import { toLuma } from "../../src/lib/watermark/anchor-search.js";
import { validateCandidate } from "../../src/lib/watermark/validator.js";
import type {
  WorkerCommand,
  WorkerEvent,
} from "../../src/types/protocol.js";

function flatRgba(w: number, h: number, v: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function paintSquare(
  rgba: Uint8ClampedArray,
  frameW: number,
  x: number,
  y: number,
  size: number,
  v: number,
): void {
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = ((y + j) * frameW + (x + i)) * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
    }
  }
}

function lumaSample(bg: number, square: number | null) {
  const rgba = flatRgba(320, 240, bg);
  if (square !== null) paintSquare(rgba, 320, 240, 160, 48, square);
  return { luma: toLuma(rgba, 320, 240), width: 320, height: 240 };
}

function uniformAlpha(size: number, a: number) {
  return { size, data: new Float32Array(size * size).fill(a) };
}

interface Harness {
  events: WorkerEvent[];
  transfers: Transferable[][];
  send: (command: WorkerCommand) => void;
}

function harness(): Harness {
  const events: WorkerEvent[] = [];
  const transfers: Transferable[][] = [];
  const runner = createJobRunner({
    post: (message, transfer) => {
      events.push(message);
      transfers.push(transfer ?? []);
    },
    now: () => 1000,
  });
  return { events, transfers, send: (command) => runner.handleCommand(command) };
}

function validateCmd(seq: number, overrides = {}) {
  return {
    kind: "validate",
    jobId: "job-1",
    generation: 7,
    seq,
    fileName: "clip.mp4",
    fileSizeBytes: 1024,
    mimeType: "video/mp4",
    ...overrides,
  } as WorkerCommand;
}

describe("happy path", () => {
  it("runs validate → analyze → restore → complete with seq + generation", () => {
    const h = harness();
    h.send(validateCmd(1));
    h.send({
      kind: "analyze",
      jobId: "job-1",
      generation: 7,
      seq: 2,
      samples: [lumaSample(100, 140)],
    });
    const detection = h.events.find((e) => e.kind === "detection");
    assert.ok(detection && detection.kind === "detection");
    assert.equal(detection.result.tier, "CONFIDENT");
    const validated = validateCandidate({
      profile: detection.result.profileMatch,
      roi: { x: 240, y: 160, width: 48, height: 48 },
      dx: detection.result.anchorOffset.dx,
      dy: detection.result.anchorOffset.dy,
      score: Math.max(...detection.result.scores),
      frameWidth: 320,
      frameHeight: 240,
    });
    h.send({
      kind: "restore",
      jobId: "job-1",
      generation: 7,
      seq: 3,
      payload: {
        data: flatRgba(48, 48, 140),
        width: 48,
        height: 48,
        alpha: uniformAlpha(48, 0.5),
        logo: 255,
        validation: validated,
      },
    });
    const complete = h.events.find((e) => e.kind === "complete");
    assert.ok(complete && complete.kind === "complete");
    assert.equal(complete.result.width, 48);
    assert.equal(complete.result.pixelsRestored, 48 * 48);
    // seq strictly increases; generation echoes the command generation.
    const seqs = h.events.map((e) => e.seq);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
    assert.ok(new Set(seqs).size === seqs.length);
    for (const e of h.events) {
      assert.equal(e.jobId, "job-1");
      assert.equal(e.generation, 7);
    }
    // Restored bytes travel as a transferred buffer of exact length.
    const idx = h.events.indexOf(complete);
    const transferred = h.transfers[idx];
    assert.equal(transferred.length, 1);
    assert.ok(transferred[0] instanceof ArrayBuffer);
    assert.equal((transferred[0] as ArrayBuffer).byteLength, 48 * 48 * 4);
    const view = new Uint8ClampedArray(transferred[0] as ArrayBuffer);
    assert.ok(view[0] <= 255 && view[3] === 255);
  });
});

describe("malformed input fails safely", () => {
  it("never throws; every bad message becomes failed", () => {
    const h = harness();
    const bad: unknown[] = [
      null,
      42,
      "validate",
      {},
      { kind: "bogus", jobId: "job-1", generation: 1, seq: 1 },
      { kind: "validate", jobId: "job-1" },
      { kind: "analyze", jobId: "job-1", generation: 1, seq: 2 },
      {
        kind: "restore",
        jobId: "job-1",
        generation: 1,
        seq: 3,
        payload: { nonsense: true },
      },
    ];
    for (const raw of bad) h.send(raw as WorkerCommand);
    assert.equal(h.events.length, bad.length);
    for (const e of h.events) {
      assert.equal(e.kind, "failed");
      assert.ok(e.kind === "failed" && typeof e.code === "string");
      assert.ok(e.kind === "failed" && e.reason.length > 0);
    }
  });

  it("rejects unsupported containers and empty files at validate", () => {
    const h = harness();
    h.send(validateCmd(1, { fileName: "clip.avi", mimeType: "video/avi" }));
    h.send(validateCmd(2, { fileName: "clip.mp4", fileSizeBytes: 0 }));
    const failed = h.events.filter((e) => e.kind === "failed");
    assert.equal(failed.length, 2);
    for (const e of failed) {
      assert.ok(e.kind === "failed" && e.code === "E-UNSUPPORTED-CONTAINER");
    }
  });

  it("maps clean samples to E-NO-WATERMARK-FOUND", () => {
    const h = harness();
    h.send(validateCmd(1));
    h.send({
      kind: "analyze",
      jobId: "job-1",
      generation: 7,
      seq: 2,
      samples: [lumaSample(100, null)],
    });
    const failed = h.events.find((e) => e.kind === "failed");
    assert.ok(failed && failed.kind === "failed");
    assert.equal(failed.code, "E-NO-WATERMARK-FOUND");
  });
});

describe("cancellation", () => {
  it("cancels an active job and blocks further steps", () => {
    const h = harness();
    h.send(validateCmd(1));
    h.send({ kind: "cancel", jobId: "job-1", generation: 7, seq: 2 });
    const cancelled = h.events.find((e) => e.kind === "cancelled");
    assert.ok(cancelled && cancelled.kind === "cancelled");
    assert.equal(cancelled.hadActiveJob, true);
    h.send({
      kind: "analyze",
      jobId: "job-1",
      generation: 7,
      seq: 3,
      samples: [lumaSample(100, 140)],
    });
    const last = h.events[h.events.length - 1];
    assert.ok(last.kind === "failed");
  });

  it("acks cancel with no active job instead of erroring", () => {
    const h = harness();
    h.send({ kind: "cancel", jobId: "ghost", generation: 1, seq: 1 });
    assert.equal(h.events.length, 1);
    const only = h.events[0];
    assert.ok(only.kind === "cancelled" && only.hadActiveJob === false);
  });

  it("refuses a second concurrent job", () => {
    const h = harness();
    h.send(validateCmd(1));
    h.send(validateCmd(2, { jobId: "job-2" }));
    const last = h.events[h.events.length - 1];
    assert.ok(last.kind === "failed" && last.code === "E-JOB-BUSY");
  });
});

describe("worker boundary", () => {
  it("worker sources use only the facade plus protocol/types", () => {
    for (const name of ["runner.ts", "pipeline.worker.ts"]) {
      const src = readFileSync(
        new URL(`../../src/workers/${name}`, import.meta.url),
        "utf8",
      );
      const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(
        (m) => m[1],
      );
      assert.ok(imports.length > 0, `${name} has imports`);
      for (const spec of imports) {
        assert.ok(
          spec === "./runner.js" ||
            spec === "../lib/watermark/engine.js" ||
            spec === "../lib/watermark/types.js" ||
            spec === "../types/protocol.js",
          `${name}: unexpected dependency ${spec}`,
        );
      }
      assert.ok(!/from ["'](react|next|mediabunny)/.test(src), `${name} clean`);
    }
  });
});
