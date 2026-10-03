# `src/workers` — Dedicated pipeline worker(s)

Single-job workers: validate → analyze → restore → mux.
The ONLY place that imports both `lib/media` and `lib/watermark`.
Terminated after each job; all events carry jobId + generation + seq.
