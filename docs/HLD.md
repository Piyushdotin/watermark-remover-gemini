# HLD — High-Level Design: Browser Video Restoration Utility

> Scope: the full system. The watermark engine is an **independent local implementation** written in this project from the frozen mathematical model below.
> Product: `PRODUCT.md` · Visual: `DESIGN.md` · States: `UI-STATES.md` · Plan: `docs/IMPLEMENTATION-PLAN.md`
> Frozen model (technique description only — no originality claimed, not a fork or port of anything):
> `watermarked = alpha * logo + (1 - alpha) * original`, therefore
> `original = (watermarked - alpha * logo) / (1 - alpha)`.

## 1. System context

A single-page Next.js app running 100% in the browser. No backend, database, auth, storage, or API layer. Inputs: a local video `File`. Outputs: a restored video `Blob` download (+ optional PNG still). External actors: none at runtime — the browser's decoders/encoders (via libraries) and the user. The app must work after page load without any network round-trip for the job itself.

## 2. Architecture diagram

```
┌──────────────────────────────────────────────────────────────┐
│ Browser tab (single origin page)                            │
│                                                              │
│  ┌──────────┐   commands    ┌──────────────────────┐        │
│  │ React UI │ ────────────► │ ProcessingController │        │
│  │ (viewer  │ ◄──────────── │ (main-thread owner   │        │
│  │  + rail) │    events     │  of job state)        │        │
│  └──────────┘               └─────────┬────────────┘        │
│                                       │ postMessage         │
│                              ┌────────▼────────┐            │
│                              │ Dedicated Worker │            │
│                              │  ┌────────────┐  │            │
│                              │  │Media pipe  │  │            │
│                              │  │in/demux/dec│  │            │
│                              │  └─────┬──────┘  │            │
│                              │  ┌─────▼──────┐  │            │
│                              │  │Independent │  │            │
│                              │  │watermark   │  │            │
│                              │  │engine      │  │            │
│                              │  │profiles→   │  │            │
│                              │  │detect→     │  │            │
│                              │  │validate→  │  │            │
│                              │  │restore     │  │            │
│                              │  └─────┬──────┘  │            │
│                              │  ┌─────▼──────┐  │            │
│                              │  │Encoder/    │  │            │
│                              │  │muxer       │  │            │
│                              │  └────────────┘  │            │
│                              └──────────────────┘            │
│  Local File ──► never leaves the tab ──► Blob download      │
└──────────────────────────────────────────────────────────────┘
```

UI ↔ controller is synchronous calls + subscription. Controller ↔ worker is `postMessage` only. Inside the worker: media → engine → encoder run incrementally, one frame at a time.

## 3. Major components

1. **UI shell** (React): viewer + rail + transport + compare + export per `DESIGN.md`/`UI-STATES.md`.
2. **ProcessingController** (main thread): owns job lifecycle, worker lifetime, object URLs, throttled progress → UI state mapping.
3. **Pipeline worker** (Web Worker): demux → decode → detect → restore → encode → mux. All heavy work lives here so the UI stays responsive.
4. **Media pipeline**: input/demux, decoding, timestamps, frame orchestration, encoding, audio handling, muxing via the media library; exposes frames + timestamps + metadata, hides container details.
5. **Independent watermark engine**: our own profiles, detection, local anchor search, validation, and restoration, built from the frozen model. Receives geometry + pixels, returns verdicts + restored pixels.
6. **Output sink**: collects the muxed bytes → `Blob` → download URL.

## 4. Responsibilities of each component

- **UI shell**: render one state at a time; dispatch user intents (`select`, `restore`, `cancel`, `download`, `reset`); never touches pixels, frames, or engine math.
- **ProcessingController**: single owner of `ProcessingJob`; creates/terminates the worker; forwards commands; converts worker events to UI states; owns all object-URL lifetimes; enforces "one job at a time."
- **Pipeline worker**: executes phases `validate → analyze → restore → mux` sequentially; emits measured progress; honors cancellation promptly; releases frame memory per frame.
- **Media pipeline**: capability checks (`canEncodeVideo`-style probes), metadata extraction, sample iteration with decoder recovery, timestamp normalization, audio packet copy, encode + mux.
- **Watermark engine**: profile lookup (frames in → candidates out), detection + anchor refinement (samples in → report out), per-frame restore (validated ROI in → restored ROI out). No React, no DOM, no worker API imports, no media-library imports.
- **Output sink**: assembles final bytes only after encoder/muxer actually finalize; produces the only artifact the UI may offer for download.

## 5. Main data flow

`File` → probe metadata → sample frames (analysis) → detection report → user confirms (`READY`) → full decode → per-frame ROI restore → encode → mux (+ audio packet copy) → finalize → `Blob` → object URL → preview/compare → user-initiated download. Progress/counters flow backward on the same path as events. No stage caches the whole video.

## 6. Processing lifecycle

`EMPTY → FILE_SELECTED → VALIDATING → ANALYZING → READY → PROCESSING → COMPLETE`, with `ERROR / CANCELLED / UNSUPPORTED / NO_WATERMARK` exits. Controller maps: `FILE_SELECTED` (URLs + probe) → `VALIDATING` (worker: readability/container/codec) → `ANALYZING` (worker: sampled detection) → `READY` (await user) → `PROCESSING` (worker: full run) → `COMPLETE` (artifact published). Each transition is explicit, logged to the audit trail, and announced to assistive tech.

## 7. Browser/worker boundary

- **WHAT:** all decode/detect/restore/encode inside one dedicated Worker; main thread keeps React, controller, playback, compare.
- **WHY:** frame processing is CPU-heavy; keeping it off the main thread preserves transport/comparison responsiveness and honest progress rendering.
- **BOUNDARY:** structured-clone messages only (commands down, events up). Transferable `ArrayBuffer`s for frame payloads where beneficial. No shared mutable state, no DOM access from worker.
- **TRADEOFF:** message + serialization overhead per progress tick → throttle to ~10Hz; complexity of cancellation handshakes vs. a frozen UI — responsiveness wins.

## 8. Media pipeline

- **WHAT:** demux/decode with a browser media library (**mediabunny**: `Input`, `VideoSampleSink`, `Output`, `Mp4OutputFormat`, `EncodedPacketSink`), `OffscreenCanvas` for frame rasterization, sample-sink draw → 2d context → ROI `ImageData`.
- **WHY:** raw `<video>` + captureStream cannot give deterministic per-frame access with timestamps; a sample-sink model yields exact frames + `timestamp/duration` pairs needed for honest progress and A/V correctness.
- **BOUNDARY:** pipeline exposes `metadata`, `sample(i)`, `encode(frame)`; the engine sees only `ImageData` ROIs plus geometry. The pipeline never interprets watermark content; the engine never touches containers, codecs, or mux state.
- **TRADEOFF:** library dependency (~codec coverage limited to what the browser/library supports) vs. hand-rolled MSE/WebCodecs plumbing — library wins for v1 determinism.

## 9. Watermark-engine boundary

- **WHAT:** our own engine in `lib/watermark/` — profiles, detector, local anchor search, validator, restoration — implementing the frozen inverse-alpha model (`detect(samples) → report`, `restore(roi, geometry) → roi`).
- **WHY:** the engine must be owned by this project: no external source to drift, audit, or license-check at runtime; the mathematics is fixed, so a local implementation is fully specified and testable against that specification.
- **BOUNDARY:** engine receives pixels + geometry, returns pixels + verdict; it never sees `File`, `Blob`, React state, worker messaging, media-library objects, or DOM. UI never sees blend equations — only the `WatermarkDetectionResult` report.
- **TRADEOFF:** we own correctness proof (mathematical + fixture tests in Phase 1) instead of inheriting it — more upfront test work, zero runtime coupling.

## 10. Detection/reporting boundary

- **WHAT:** `ANALYZING` consumes N sampled frames and returns `WatermarkDetectionResult { profileMatch, anchorOffset, tier, scores }`. Tiers: confident / uncertain / none.
- **WHY:** full-video scan before consent wastes minutes; sampling bounds analysis cost while the report gates `READY` vs `NO_WATERMARK`.
- **BOUNDARY:** detector output is data, not pixels — the rail renders it verbatim; restoration consumes only a validated (confident/uncertain-acknowledged) report.
- **TRADEOFF:** sampling can miss edge cases → uncertain tier + `VERIFY EDGES` caution + full-run per-frame scoring as backstop.

## 11. UI communication boundary

Controller exposes `start(file)`, `restore()`, `cancel()`, `reset()` and subscribes UI to `ProcessingState` snapshots. Worker events carry monotonic sequence numbers; controller drops stale events after cancel/reset (guards against zombie-worker updates). Progress → UI is throttled; phase transitions bypass the throttle.

## 12. Error flow

Worker catches per-stage failures, classifies to `E-CODE`s (`E-UNSUPPORTED-CONTAINER/CODEC`, `E-DECODE-FAIL`, `E-INTERRUPTED`, `E-NO-WATERMARK-FOUND`, canvas-interference), freezes progress at the failure point, and ships `{ code, fileName, reason, detail, frame }`. Controller maps to `ERROR/UNSUPPORTED/NO_WATERMARK` rail blocks per `UI-STATES.md`. Viewer retains last good frame; source context is never discarded.

## 13. Cancellation flow

User `cancel` → controller posts `cancel` + sets a local `cancelled` generation flag → worker aborts between frames (never mid-ROI-write), closes encoder/sinks, frees canvases, replies `cancelled { atFrame }` → controller terminates worker, revokes partial URLs (keeps source), publishes `CANCELLED` with discard frame + no-resume statement. Late worker messages from the old generation are ignored.

## 14. Output generation

Encoder (AVC ~12 Mbps constant-bitrate, quality-latency, BT.709, keyframe interval ~2s) consumes restored frames in timestamp order; muxer interleaves copied audio packets; **finalize is explicit** — `COMPLETE` publishes only after mux close + byte-size > 0 verified. Optional PNG still is captured from the restored viewer frame, not re-processed.

## 15. Audio handling

Default: **encoded-packet copy** of the primary audio track when the output container supports its codec; otherwise omit audio with a stated `skipReason` (`no-audio-track`, `unsupported-audio-codec`, `no-audio-packets`, `disabled`). Never transcode audio in v1 (cost without product benefit); never desync — packets keep normalized timestamps relative to the same start as video.

## 16. Metadata/timestamp handling

Preserve per-sample `timestamp/duration` end-to-end; normalize to a common zero at mux. Never assume fixed FPS — use measured packet-rate average with fallback display value, and nullable total-frame estimates. Display dimensions come from the track (rotation-aware). Duration prefers container metadata, falls back to computed duration, else null (UI shows "unknown," never invents).

## 17. Memory-management strategy

Incremental: at most a small window of decoded frames alive (current + in-flight encode); ROI buffers allocated per frame and released per frame; canvases reused, not recreated; no full-video buffering (decoded or restored); object URLs tracked in a registry and revoked on reset/cancel/replace/unmount. Large/4K inputs therefore scale with duration, not with resolution² × frames.

## 18. Browser capability checks

At startup (and pre-restore): Worker availability, `OffscreenCanvas` (fallback: document canvas on main thread with degraded-performance notice), `canEncodeVideo`-style codec probe for the export profile, `postMessage` structured-clone of needed types. Failure → `ERROR`/`UNSUPPORTED` with the exact missing capability named. V1 uses no `SharedArrayBuffer` path, so no special headers are required.

## 19. Performance strategy

Worker-bound pipeline; ROI-only pixel work (never full-frame blends); reusable canvases/buffers; ~10Hz progress throttle; UI virtualization of audit lines (last 4); comparison streams reuse the two published blobs (no re-decode of the whole file for preview). Long videos and 4K are supported by the incremental design, with honest throughput display (`fps`, elapsed) instead of speed promises.

## 20. Privacy model

Data-flow guarantee: `File` bytes enter via picker/drop, are processed in-memory in the tab's worker, and leave only as a user-initiated download to disk. No `fetch`/XHR/WebSocket of media bytes anywhere in the job path; add a lint rule + code-review check banning network imports in `lib/media`, `lib/watermark`, `lib/processing`, `workers/`. UI copy "Stays on this device — nothing uploaded" is thus structurally true, not a claim.

## 21. Security considerations

Untrusted media parsing is the main attack surface: rely on the media library + browser decoders (never hand-parse containers); constrain worker to no-network, no-eval; revoke object URLs to avoid leaking local file handles; render filenames as text (middle-truncated), never as HTML; Canvas-interference extensions (fingerprint defenders) produce wrong pixels → detect anomaly via validation metrics and surface the dedicated error with the disable-extension fix.

## 22. Accessibility implications

Architecture must preserve: assertive announcements on phase/error changes, polite throttled counters, keyboard-operable wipe slider + tablist + transport, 44px targets, visible focus, reduced-motion freeze of indeterminate motion. Concretely: progress events carry `phase` + `announce` flag so the controller can drive live regions without sniffing pixels; no information is conveyed by color, motion, or sound alone.

## 23. Observability (local utility)

No telemetry/analytics of media. Observable surface = the on-screen audit trail (timestamped phase lines, counters, detection report, error codes) + structured `console.debug` lines in dev only. Failures include enough detail (stage, frame, codec string, anchor outcome) for a user to file a useful bug report without exposing file contents.

## 24. Constraints

- Browser codec/container support bounds the supported list (declare it; everything else → `UNSUPPORTED`).
- Single job at a time; no batch/queue.
- Main-thread decode fallback only with explicit degraded notice.
- No fixed-FPS assumption; nullable totals/ETAs.
- `COMPLETE` requires actual mux finalization.
- No external watermark-removal code under any path — enforced by code-origin scan (see §20 lint rule, extended to external watermark-removal packages).

## 25. Non-goals

No backend/DB/auth/storage/API; no batch; no enhancement/upscale/denoise-by-default (no model-based cleanup backends in v1 — heavy models + threading requirements, no product need); no audio transcoding; no general watermark removal; no extension/CLI/userscript surfaces in this app.

## 26. Future extension points

Bitrate/profile selector (iff our engine exposes alternatives); additional containers if the media library gains them; optional cleanup backends behind a capability flag; side-by-side export still; all without changing the engine facade or the UI↔controller contract.

---

## Research note (not a runtime dependency)

External watermark-removal repositories may be consulted as **research material** during development (to understand problem shape, e.g. catalog-style profiles or packet-copy audio patterns). They are never implementation dependencies: no source, assets, tests, fixtures, names, or packages flow into this project. No external repository is named in product architecture or product copy.
