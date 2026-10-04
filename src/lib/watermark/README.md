# `src/lib/watermark` — Independent watermark engine (our own code)

Implemented from the frozen model
(`original = (watermarked - alpha * logo) / (1 - alpha)`).
No external watermark-removal source is imported or depended upon.

- `profiles.ts` — V1 profile table (A-96, B-48) + ROI prediction
- `types.ts` — shared engine types + `EngineError`
- `detector.ts` — pure-geometry candidate selection
- `anchor-search.ts` — bounded local refinement + luma helper
- `validator.ts` — CONFIDENT / UNCERTAIN / NONE tiers + restore gate
- `restoration.ts` — inverse-alpha ROI solve (fresh output, input immutable)
- `engine.ts` — stable facade (`detectFromSamples`, `restoreValidated`)

No React, no DOM, no worker or media-library imports.
Tests: `tests/watermark/` (built-in `node:test`, `npm run test:engine`).
