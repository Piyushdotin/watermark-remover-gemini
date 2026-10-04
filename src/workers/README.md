# `src/workers` — Dedicated pipeline worker(s)

Single-job lifecycle: validate → analyze → restore (+ mux in Phase 6).
- `pipeline.worker.ts` — thin `self` adapter (no logic).
- `runner.ts` — pure job runner; invokes only the `lib/watermark/engine.ts`
  facade plus `src/types/*`. No frame loop, no media pipeline yet.
Terminated after each job; all events carry jobId + generation + seq.
Tests: `tests/workers/` (`npm run test:worker`).
