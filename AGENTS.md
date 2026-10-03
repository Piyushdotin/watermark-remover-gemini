<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS — Implementation Contract: Browser Video Restoration Utility

Read before substantial changes: `PRODUCT.md`, `DESIGN.md`, `UI-STATES.md`, `docs/HLD.md`, `docs/LLD.md`, `docs/DESIGN-DIRECTIONS.md` (Direction C selected).

## PRODUCT RULES
- Preserve the linear workflow `EMPTY → FILE_SELECTED → VALIDATING → ANALYZING → READY → PROCESSING → COMPLETE` plus `ERROR / CANCELLED / UNSUPPORTED / NO_WATERMARK`. No auto-advance into `PROCESSING`, no auto-download from `COMPLETE`.
- One file, one job, one result per session. No batch/queue, no accounts/backend/database/storage, no sharing links, no enhancement features.
- Never touch the trusted watermark math: consume its report/artifacts through the engine port only.
- Never mutate the user's original `File`; `NO_WATERMARK`/failures leave the source byte-identical.

## DESIGN RULES
- `DESIGN.md` is the visual source of truth: warm paper `#F4F1EA`, ink `#1C1A16`, accent `#2F5D3A` (primary/progress only), danger/amber strictly scoped. No new colors without documented reason.
- Strict type roles: Space Grotesk (wordmark/step titles), Inter (UI), Geist Mono tabular (all data/counters/timecodes).
- Exactly one white viewer card; rail modules flat on paper. No nested cards, no pill buttons/steps/tabs, no hero, no feature grids, no stats/testimonials, no illustrations.
- No gradients, glow, glassmorphism, blobs, or shadows beyond `DESIGN.md` §10. No global visual changes for local requests.

## ARCHITECTURE RULES
- Preserve module boundaries: React ↔ controller ↔ worker-protocol ↔ media/engine. UI knows no watermark math; engine knows no React; media layer knows no UI state.
- `node:*`, `sharp`, CLI/userscript/extension code, and network sends of media bytes are banned in `src/` (keep the local-only guarantee structural).
- Incremental frame flow; ROI-only engine calls; nullable totals stay null. No full-video buffering, no invented FPS/ETA/percentages/confidence.
- Workers are single-job and terminated after use; zombie-guard all worker events (`jobId` + generation + `seq`).
- `COMPLETE` only after verified mux finalize with non-empty bytes. Cancellation revokes partial URLs, keeps source, states no-resume.

## CODE CHANGE RULES
- Inspect before editing (`read`/`grep` first); make scoped minimal changes; never modify unrelated files or silently change product behavior.
- Prefer small coherent commits; run typecheck/lint and relevant tests after changes; do not install dependencies or add new ones without explicit approval.
- Do not replace working architecture (media library, worker topology, engine port) without written justification + approval.

## TRUST / DATA RULES
- Never claim upload when local; never claim local if a change introduces any network transfer of media (that requires explicit re-approval of the privacy model).
- Never fabricate confidence, ETA, percentages, or technical metadata — unknowns render as unknowns per `UI-STATES.md`.
- Error/unsupported/no-watermark blocks name the file + reason (+ `E-CODE` where applicable), state preservation/discard precisely, and offer exactly one primary recovery.

## VISUAL QA RULES
- After UI changes: inspect rendered output; exercise `EMPTY`, `PROCESSING` (real counters), `COMPLETE` (wipe/tabs/zoom), and one failure state; check ≥1024px / tablet / <768px (sticky export only post-`COMPLETE`); verify keyboard (tabs, slider, `C` flip, focus rings), `prefers-reduced-motion`, and live-region announcements.
