# IMPLEMENTATION-PLAN — Build Order

> Frozen inputs: `PRODUCT.md`, `DESIGN.md`, `UI-STATES.md`, `docs/HLD.md`, `docs/LLD.md`, `docs/TECHNICAL-SPIKE.md`, `AGENTS.md`. Direction C selected.
> Frozen: browser-only; Next.js + TS + Tailwind; dedicated worker; mediabunny; vendored core + `WatermarkEnginePort`; no FFmpeg; no ONNX; incremental frames; real timestamps; MP4/AVC 12 Mbps CBR BT.709 2s-keyframes; audio copy-or-reason; BufferTarget; no size caps; capability probes; validated-evidence-only restoration.
> Trusted watermark math is FROZEN — never redesigned. This plan makes no architectural decisions; it sequences the frozen ones.

## Phase dependencies

```
0 → 1 → 2 → 3 → 4 → 5 → 6 ★ FIRST REAL SUCCESS
                6 → 7 → 9 → 10 → 11 → 12 → 13 ★★ BASIC UI MILESTONE
              8 → (9,10,11,12) styling track, parallel after 7 starts
                    13 → 14 → 15 → 16 → 17 ★★★ PRODUCTION UI MILESTONE
                    17 → 18 ★★★★ HARDENED + DEPLOYABLE
```
- 1 blocks everything touching pixels. 2 blocks 4. 3+4 block 5. 5 blocks 6. 6 blocks all UI truthfulness (7–13 show only real pipeline data). 8 may start once 7's state machine exists but must not invent tokens outside `DESIGN.md`. 14 runs per-phase (listed once, applied always); 15–18 are gates, not features.

## Milestones

- **M1 — First real success (end of Phase 6):** a small known MP4 enters the browser and yields a playable MP4 with the trusted engine applied, via a throwaway harness — no polished UI required.
- **M2 — Real pipeline + basic UI (end of Phase 13):** full state machine over the real pipeline with honest progress, comparison, download, and failure blocks; styling may be rough but tokens correct.
- **M3 — Production UI + state handling (end of Phase 17):** Direction C faithfully executed across all 11 states, responsive, keyboard-operable, reduced-motion-safe.
- **M4 — Hardened + deployable (end of Phase 18):** performance/compat evidence recorded, deploy checklist green.

---

## PHASE 0 — Repository preparation

- **Objective:** make the scaffold capable of holding the frozen architecture without touching product behavior.
- **Files/modules:** `tsconfig.json` (strict), `next.config.ts`, `.gitignore`, `src/**` skeleton dirs, lint rule stub location (ban list documented, enforced in Phase 1).
- **Prerequisites:** frozen docs listed above.
- **Deliverables:** `src/{app,components,lib/{media,watermark,processing},workers,types}/` skeleton with barrel READMEs; TS strict on; worker-compatible build config verified (`next dev` compiles a `new Worker()` stub).
- **Tests:** `tsc --noEmit` passes; dev server boots.
- **Acceptance:** empty skeleton builds; no runtime behavior changed.
- **Failure modes:** worker bundling misconfig (Next.js worker postfix) — resolve config before proceeding, do not restructure phases.
- **MUST NOT touch:** `app/page.tsx` product surface (may only re-export shell later), any upstream algorithm, dependency set.

## PHASE 1 — Vendor trusted engine subset

- **Objective:** pin the exact upstream files from `TECHNICAL-SPIKE.md` §3 at a recorded commit, with attribution, behind an import barrier.
- **Files/modules:** `src/vendor/watermark-core/**` (core subset + `videoWatermarkDetector/Catalog/Metadata/DecodeRecovery` helpers only), `src/vendor/NOTICE.md` (commit hash, file list, MIT holders © 2025 Jad / © 2024 AllenK), lint rule banning imports from `src/vendor` except via `lib/watermark/enginePort.ts`.
- **Prerequisites:** Phase 0.
- **Deliverables:** vendored files byte-identical to upstream commit; `NOTICE.md`; lint rule active; `tsc` passes over vendored JS (via `allowJs`/d.ts shim — no logic edits).
- **Tests:** checksum/file-list test vs recorded manifest; no-network-import scan of `src/vendor` + `src/lib` (fail on `node:`, `sharp`, `fetch`).
- **Acceptance:** manifest test green; zero logic diffs vs upstream (diff audit recorded).
- **Failure modes:** missing transitive core import (pipeline file pulling denoise chain) — vendor the missing pure file or shim the import, never stub math.
- **MUST NOT touch:** vendored file contents (formatting included); `src/sdk/video.js` (Node-only — never vendor).

## PHASE 2 — Media capability layer

- **Objective:** mediabunny-backed probing: metadata extraction + encoder/Worker/Canvas capability gates.
- **Files/modules:** `lib/media/metadata.ts`, `lib/media/capabilities.ts`, `types/media.ts`; mediabunny added as the sole media dependency (install happens at implementation time, not now).
- **Prerequisites:** Phase 0 (Phase 1 independent — may parallel).
- **Deliverables:** `probeFile(File) → VideoMetadata` (nullable-tolerant: duration → computed → null; fps fallback; nullable frame estimate); `checkCapabilities() → { worker, offscreenCanvas(+degraded flag), avcEncode: boolean, missing: string[] }`.
- **Tests:** unit tests on metadata fallbacks with fixture MP4s (small, with/without audio, portrait); capability test mocks (missing Worker, missing OffscreenCanvas, encode-probe false).
- **Acceptance:** real MP4 probes to correct dims/codec/duration on Chrome; missing-capability paths return named `E-CAPABILITY` inputs.
- **Failure modes:** `canEncodeVideo` false-positives on some browsers — treat probe as necessary-not-sufficient; encode failure still maps to named error downstream.
- **MUST NOT touch:** vendored core; UI; worker topology.

## PHASE 3 — Watermark engine adapter

- **Objective:** thin `WatermarkEnginePort` isolating trusted math behind the LLD interface; the only module allowed to import `src/vendor`.
- **Files/modules:** `lib/watermark/enginePort.ts`, `lib/watermark/types.ts` (re-export), `types/detection.ts`.
- **Prerequisites:** Phase 1.
- **Deliverables:** `detectFromSamples(frames) → WatermarkDetectionResult` (12-sample protocol, tiers CONFIDENT/UNCERTAIN/NONE); `restoreRoi(roi, geometry) → roi` (identical dims, ROI-only); `E-NO-WATERMARK-FOUND` mapping for tier NONE.
- **Tests:** parity tests vs reference outputs on still fixtures (ROI byte-compare within tolerance documented in test); tier-mapping tests; identical-dims assertion tests.
- **Acceptance:** parity green; adapter imports are the sole `src/vendor` consumers repo-wide (lint test).
- **Failure modes:** alpha-map variant mismatch (48/96/36-v2/outline) — surface as test failure, never patched with invented constants; re-check vendored manifest.
- **MUST NOT touch:** vendored contents; detection thresholds; any UI state.

## PHASE 4 — Video worker

- **Objective:** Dedicated Worker running `validate → analyze → restore → mux` per the LLD protocol, reusing the upstream pipeline shape on a worker thread.
- **Files/modules:** `workers/pipeline.worker.ts`, `lib/media/pipeline.ts` (worker-side demux/decode/encode/mux), `lib/media/timestamps.ts`, `lib/media/audio.ts`, `types/protocol.ts`.
- **Prerequisites:** Phases 2 + 3.
- **Deliverables:** command handler (`validate/analyze/restore/cancel`) with `jobId+generation+seq`; fixed export config (AVC 12 Mbps CBR, quality, BT.709, 2 s keyframes, `fastStart in-memory`); audio copy-or-`skipReason`; `BufferTarget` finalize + non-empty assertion; per-frame abort checks; `sample.close()` discipline.
- **Tests:** protocol tests (zombie-event drop, seq ordering, cancel handshake); timestamp-normalization unit tests incl. regression-timestamp clamp; audio-skip-reason matrix tests.
- **Acceptance:** worker processes a fixture MP4 to verified bytes with correct phase/progress event stream; cancel mid-run terminates cleanly.
- **Failure modes:** `OffscreenCanvas`/WebCodecs absence in some browsers — return `E-CAPABILITY`, never main-thread fallback without degraded notice (fallback itself is out of V1 scope).
- **MUST NOT touch:** engine math; export profile values; UI.

## PHASE 5 — Processing controller

- **Objective:** main-thread job owner: worker lifetime, URL registry, event→state mapping, throttle discipline.
- **Files/modules:** `lib/processing/controller.ts`, `lib/processing/job.ts`, `lib/processing/errors.ts`, `types/job.ts`.
- **Prerequisites:** Phase 4.
- **Deliverables:** `select/restore/cancel/reset/download`; single-job enforcement; one-worker-per-job + terminate; URL registry (revoke on remove/reset/replace/unmount); 10 Hz progress throttle with phase-transition bypass; `E-CODE` taxonomy mapping.
- **Tests:** controller unit tests (double-`restore` rejected; cancel → `CANCELLED` + partial URLs revoked + source kept; stale-event drop; reset empties registry — dev assert).
- **Acceptance:** all controller tests green; no React imports in `lib/processing`.
- **Failure modes:** leaked object URLs / zombie worker postMessage after terminate — covered by registry + generation tests before advancing.
- **MUST NOT touch:** worker internals; viewer/UI copy.

## PHASE 6 — Minimal end-to-end video pipeline ★ M1

- **Objective:** FIRST REAL SUCCESS — throwaway harness proving File → playable restored MP4 in-browser.
- **Files/modules:** `app/__pipeline-harness` (dev-only route or test page, deleted before M3) wiring controller + worker; no design system, no polish.
- **Prerequisites:** Phases 1–5.
- **Deliverables:** harness accepts a small known MP4, runs validate→analyze→restore→mux, offers raw download; logs phases/counters/audit lines to console + `<pre>`.
- **Tests:** M1 test — fixture MP4 in, mux-finalized MP4 out (`moov` present, duration ≈ source, size > 0, plays in `<video>`); `NO_WATERMARK` fixture yields no output + source intact.
- **Acceptance:** M1 green on Chrome with the fixed 12 Mbps profile; no UI polish required; no fake numbers (all values from pipeline events).
- **Failure modes:** encode-probe pass but runtime encode fail (browser quirk) — record as compat finding for Phase 16, keep `E-CODE` path honest.
- **MUST NOT touch:** `DESIGN.md` tokens (no styling decisions here); export profile; engine.

## PHASE 7 — UI state machine

- **Objective:** real 11-state machine over the controller — behavior before beauty.
- **Files/modules:** `app/page.tsx` composition, `lib/processing/useJob.ts` (React binding), state reducer mapping `ProcessingState → UiState`; unstyled-but-correct panels per `UI-STATES.md` field lists.
- **Prerequisites:** Phase 6 (real pipeline data only).
- **Deliverables:** all transitions implemented incl. `READY` gate (no auto-advance), cancel, `Start over`, failure blocks with file+reason+`E-CODE`+single recovery; assertive/polite live regions wired with correct cadence.
- **Tests:** statechart tests (every transition incl. all four failure exits; no `READY→PROCESSING` without user intent; no `COMPLETE→download` without click).
- **Acceptance:** full EMPTY→COMPLETE run + each failure state reachable in harness; screen-reader announcements verified manually.
- **Failure modes:** state explosion from combining pipeline + UI states — keep single `UiState` source of truth in controller snapshots.
- **MUST NOT touch:** visual tokens; pipeline behavior (report-only wiring).

## PHASE 8 — Design system implementation

- **Objective:** tokens + primitives of `DESIGN.md` as the only visual language.
- **Files/modules:** Tailwind `@theme` tokens (§4–§5), `components/ui/*` (Button, Tag, Hairline, ModuleTitle, DataRow, Stepper, ProgressBar, StateBlock shell), fonts via `next/font` (Space Grotesk + Inter + Geist Mono variables).
- **Prerequisites:** Phase 7 started (parallel track once state machine exists).
- **Deliverables:** token file + primitive set matching radius/shadow/type specs; contrast checks recorded.
- **Tests:** token snapshot test (hex values); contrast assertions; radius/shadow lint (no `rounded-2xl`, single card shadow).
- **Acceptance:** primitives render per spec at ≥1024px; pills exist only as tags.
- **Failure modes:** Tailwind v4 `@theme` syntax drift — pin to scaffold's existing pattern.
- **MUST NOT touch:** pipeline/controller; add no colors, fonts, or elevations beyond spec.

## PHASE 9 — Upload UX

- **Objective:** EMPTY + FILE_SELECTED per `DESIGN.md` §14 + `UI-STATES.md` §§1–2.
- **Files/modules:** `components/Dropzone.tsx`, `Header.tsx`, `FilePanel.tsx` (skeleton rows with `Reading…`).
- **Prerequisites:** Phases 7 + 8.
- **Deliverables:** dashed well (320/200px), drag-over binary state, `SUPPORTED`/`LIMITS` rail lists, local-only microcopy, middle-truncated file row + `Remove` with focus return.
- **Tests:** drag event tests; invalid-file → `UNSUPPORTED` naming property; keyboard-only select path test.
- **Acceptance:** empty page teaches without hero; no fake metadata (unresolved rows read `Reading…`).
- **Failure modes:** drag-over stuck states — reset on dragleave/drop verified by test.
- **MUST NOT touch:** validation logic (controller-owned); marketing surfaces (forbidden).

## PHASE 10 — Processing UX

- **Objective:** VALIDATING → ANALYZING → READY → PROCESSING per spec: one progress language, honest unknowns.
- **Files/modules:** `components/StatusPanel.tsx` (stepper + 3px bar + counters + last-4 audit + cancel), `Viewer.tsx` (states: CHECKING/ANALYZING/WORKING tags, scrub-lock note), `Transport.tsx`.
- **Prerequisites:** Phase 9.
- **Deliverables:** stepper + bar + `1,204 / 8,410 · 31 fps · 00:41` counters; indeterminate `Reading… N frames so far` mode; `Scrub locked during restore`; `Stop — discard partial`.
- **Tests:** progress-rendering tests (null totals → no %/ETA; ETA only when reliable); throttle test (≤10 Hz renders); audit-cap test (last 4).
- **Acceptance:** a minutes-long fixture run shows phase, frames/total-or-so-far, elapsed, and working cancel throughout.
- **Failure modes:** counter jitter (proportional figures) — enforce Geist Mono tabular in review.
- **MUST NOT touch:** progress math (pipeline-owned); invent no percentages.

## PHASE 11 — Comparison/result UX

- **Objective:** COMPLETE instrument: wipe + tabs + zoom + export.
- **Files/modules:** `components/Viewer.tsx` (wipe slider, `SYNCED` tag, Fit/100%), `components/ExportPanel.tsx`, still-capture util (restored viewer frame → PNG).
- **Prerequisites:** Phase 10.
- **Deliverables:** default wipe (2px divider, 28px handle, `role=slider`), `Original|Wipe|Restored` tablist + `C` flip, frame-locked streams, 120 ms cuts (never dissolves), output ledger + fixed-profile note + accent download + still + `Start over` + post-download line.
- **Tests:** slider keyboard tests (arrows/Shift/Home/End); `C`-flip test; side-by-side only ≥1280px test; export-preserves-comparison test.
- **Acceptance:** verification possible before download; 100 % zoom scrolls inside card; download confirmation keeps original.
- **Failure modes:** stream desync perception — `SYNCED` tag + frame-locked scrub required for sign-off.
- **MUST NOT touch:** encoder output (display-only); engine.

## PHASE 12 — Error/cancellation/unsupported UX

- **Objective:** first-class failure blocks per `UI-STATES.md` §§8–11.
- **Files/modules:** `components/StateBlock.tsx` variants (danger/warn/neutral), focus-management on block entry.
- **Prerequisites:** Phase 11.
- **Deliverables:** title + `E-CODE` + file-named cause + preservation line + exactly one primary recovery; canvas-interference fix line; `CANCELLED` discard-frame + no-resume; `UNSUPPORTED` inline supported list; `NO_WATERMARK` no-download + source-intact.
- **Tests:** one test per failure state incl. focus-move-once + assertive announcement; `NO_WATERMARK` asserts no output URL exists.
- **Acceptance:** each failure reachable with real trigger (bad file, killed worker, clean fixture) and correct copy.
- **Failure modes:** double-recovery buttons creeping in — single-primary audit per block.
- **MUST NOT touch:** error taxonomy (controller-owned); original `File`.

## PHASE 13 — Audio/metadata/result reporting

- **Objective:** ledgers state audio + export truthfully.
- **Files/modules:** `FilePanel.tsx` (final), `DetectionPanel.tsx` (catalog/anchor/tier + amber caution), `ExportPanel.tsx` ledger.
- **Prerequisites:** Phase 12.
- **Deliverables:** `Audio: copied (codec, packets)` or `omitted — <skipReason>`; detection rows verbatim incl. `TIER 3 — VERIFY EDGES`; export ledger (name, size, AVC 12 Mbps, dims, fps, duration, frames).
- **Tests:** ledger tests across fixtures (with/without audio, incompatible audio, uncertain tier).
- **Acceptance:** every reported value traceable to pipeline metadata; unknowns shown as unknown. ★★ **M2 CAB: full pipeline + basic UI runs end-to-end here.**
- **Failure modes:** invented encoder labels — ledger values restricted to measured enums.
- **MUST NOT touch:** audio pipeline (copy-only); detection verdicts (display-only).

## PHASE 14 — Testing

- **Objective:** lock the suite that guards every phase's contract.
- **Files/modules:** `tests/**` (manifest/parity, protocol, controller, statechart, rendering, a11y), CI config if present.
- **Prerequisites:** Phase 13 (but per-phase tests were written in their phases — this phase integrates + fills gaps).
- **Deliverables:** full `tsc + lint + test` green; network-import ban test; vendor-manifest test; parity fixtures documented.
- **Tests:** the suite itself; coverage focuses on boundaries (vendor barrier, worker protocol, URL registry, state exits).
- **Acceptance:** one command reproduces green; flaky worker-timing tests quarantined with fixed seeds/timeouts.
- **Failure modes:** long-video tests timing out in CI — mark extended, keep short fixtures in the default run.
- **MUST NOT touch:** product behavior to satisfy tests (fix code, not expectations, unless spec-cited).

## PHASE 15 — Performance testing

- **Objective:** evidence for duration/4K handling within the incremental design.
- **Files/modules:** harness scripts (dev-only, not shipped), performance log in `docs/` appendix if warranted.
- **Prerequisites:** Phase 14.
- **Deliverables:** measurements: 720p/1080p/4K short clips (wall time, fps, peak memory via devtools, output size); UI responsiveness note (transport/cancel latency during run).
- **Tests:** perf smoke (M1 fixture under time/memory ceiling recorded as regression tripwire, generous bounds).
- **Acceptance:** no full-video buffering signature (flat memory vs duration); progress honest on longest fixture; findings either confirm guidance copy or file Phase 13 copy updates.
- **Failure modes:** `fastStart in-memory` pressure on huge outputs — record, do not redesign in this phase (streaming target is a future extension).
- **MUST NOT touch:** export profile, frame flow, or guidance copy without evidence + approval.

## PHASE 16 — Browser compatibility testing

- **Objective:** prove the support contract (§6 matrix) on real browsers.
- **Files/modules:** compat matrix doc (test sheet), capability-probe verification.
- **Prerequisites:** Phase 15.
- **Deliverables:** Chrome/Edge current: full pass (MP4/H.264 in→out, audio copy, 4K short). Firefox/Safari: probe-gated results recorded (pass or named `E-CAPABILITY`/`UNSUPPORTED` — both are correct outcomes if truthful).
- **Tests:** manual matrix + automated probe unit tests; no UA-sniffing code.
- **Acceptance:** no claimed support beyond evidence; every unsupported path shows the specified block.
- **Failure modes:** Safari `OffscreenCanvas`/WebCodecs gaps — expected category; fix is truthful gating, not polyfill heroics (polyfills require approval).
- **MUST NOT touch:** allowlist wording without compat evidence.

## PHASE 17 — Final visual QA

- **Objective:** Direction C fidelity across states, viewports, inputs, and motion settings.
- **Files/modules:** all `components/*` + `app/*` (style-correctness pass only).
- **Prerequisites:** Phase 16.
- **Deliverables:** QA sheet: EMPTY/PROCESSING/COMPLETE + one failure at ≥1024px, tablet, <768px (sticky export only post-COMPLETE); keyboard map (tabs/slider/`C`/focus rings); `prefers-reduced-motion`; live-region cadence; single-card / no-pill-button / token audit. ★★★ **M3 CAB: production UI + state handling signed here.**
- **Tests:** visual regression snapshots if available; otherwise checklist with screenshots recorded.
- **Acceptance:** zero anti-pattern hits (no gradients/glow/glass/blobs/nested cards/feature grids/stats/illustrations/fake metrics).
- **Failure modes:** late "improvement" ideas (new colors, hero copy, pill restyle) — rejected by default; spec change requires written approval.
- **MUST NOT touch:** pipeline, controller, worker, or tokens beyond spec-compliant fixes.

## PHASE 18 — Deployment readiness

- **Objective:** static Next.js deploy with privacy guarantees intact.
- **Files/modules:** build config, headers (no COOP/COEP needed — V1 has no SharedArrayBuffer path), route hygiene (dev harness removed), `README` run instructions.
- **Prerequisites:** Phase 17.
- **Deliverables:** `next build` clean; no `node:` in client bundle (bundle scan); no media-byte network calls (request log during E2E run is download-only); dev harness deleted; rollback = previous static deploy. ★★★★ **M4 CAB.**
- **Tests:** production-build E2E (M1 fixture through real UI); bundle import scan test.
- **Acceptance:** deployed page completes a real job offline-after-load with zero media network traffic.
- **Failure modes:** worker chunking/CSP issues in production build — fix config, never inline the worker into the main thread silently.
- **MUST NOT touch:** anything after sign-off without a new phase entry.

---

## Implementation Invariants

1. Trusted math stays frozen: consume via `WatermarkEnginePort`; no threshold, constant, or algorithm edits; vendor diffs only by pinned upstream sync with recorded rationale.
2. One job, one worker, terminated after use; zombie-guard every worker event; single `UiState` source of truth; no auto-advance into `PROCESSING`, no auto-download from `COMPLETE`.
3. Incremental frames, ROI-only restoration, real timestamps, nullable totals/ETA; `COMPLETE` only after verified non-empty mux finalize; original `File` never mutated.
4. Fixed export profile (MP4/AVC 12 Mbps CBR, BT.709, 2 s keyframes) + audio copy-or-stated-reason; no bitrate UI, no FFmpeg, no ONNX in V1.
5. `DESIGN.md` is the only visual authority: one viewer card, flat rail, strict type roles, scoped accent/danger/amber, no new colors/elevations/hero/cards/pills-as-buttons.
6. Every number rendered is measured or labeled unknown; failures name file + reason + `E-CODE`, state preservation precisely, and offer exactly one primary recovery.
7. Local-only is structural: no backend/DB/auth/storage; no media-byte network traffic; capability failures resolve to named `E-CAPABILITY`/`UNSUPPORTED`, never silent degradation.
8. Small scoped changes per phase with checks green (`tsc`, lint incl. import bans, relevant tests) before advancing; never modify unrelated files or expand scope without written approval.
