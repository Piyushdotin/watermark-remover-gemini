# TECHNICAL-SPIKE — Technical Findings for Our Implementation

> Design-time analysis for the independent local watermark engine and its
> browser video pipeline. No application code written, no dependencies
> installed. This document describes technique and architecture directly.
> The watermark engine is implemented locally in this project; there is no
> external watermark-removal source dependency of any kind.

## 1. Browser-only architecture

Single-page Next.js app, 100% client-side: `File` in via picker/drop,
processing in-memory in a Dedicated Worker, restored `Blob` out via
user-initiated download. No backend, database, auth, storage, or API layer;
no network transfer of media bytes on the job path. The page must complete a
job after load with zero media network traffic.

## 2. Independent watermark engine

`lib/watermark/` owns detection, validation, and restoration, built from the
frozen model (technique description only — no originality claimed):

`watermarked = alpha * logo + (1 - alpha) * original`, therefore
`original = (watermarked - alpha * logo) / (1 - alpha)`.

Modules: `profiles`, `detector`, `anchor` (local search), `validator`,
`restoration`, `engine` (facade), `types`. The engine receives pixels +
geometry and returns verdicts + restored pixels; it never sees `File`,
`Blob`, React state, worker messaging, media-library objects, or DOM.

## 3. Local detector

Sampled-frame scoring against candidate geometries: resolve candidates from
display dimensions, score a bounded sample set (nominal: 12 timestamp-spread
frames), aggregate per-candidate scores. Sampling bounds analysis cost so
`ANALYZING` stays short; full-run per-frame scoring acts as backstop. Output
is data (`WatermarkDetectionResult`), never pixels — the rail renders it
verbatim and restoration consumes only validated geometry.

## 4. Local profiles

Known size/position profiles as local data with provenance notes (e.g.
96×96 @ +64/+64 for larger outputs, 48×48 @ +32/+32 for smaller). Profiles
are data, not code: adding or correcting a profile is a data change with a
fixture test, never an algorithm change. Unknown dimensions resolve to no
confident candidate rather than an invented one.

## 5. Local anchor search

Pixel-level refinement around each predicted region on sampled frames:
measure local fit (e.g. residual energy under the hypothesized alpha support),
keep the offset with the best aggregate score, and record the offset
(`dx`, `dy`) in the detection report so the UI can display it honestly.
Search windows stay small and bounded — refinement is local by design.

## 6. Local validation

Tier assignment gates everything downstream: CONFIDENT (proceed),
UNCERTAIN (proceed flagged with a `VERIFY EDGES` caution), NONE (→
`NO_WATERMARK`: no encode pass runs, no output artifact exists, the source
is byte-identical). Validation metrics also feed the canvas-interference
error path (wrong pixels from fingerprint-defending extensions surface as a
named error with the disable-extension fix, not as silent corruption).

## 7. Local inverse-alpha restoration

Per-pixel solve of the frozen model over the validated ROI only, identical
dimensions in/out, source `ImageData` never mutated (fresh output buffer).
Alpha edge cases (0, 1, out-of-range, degenerate geometry) are handled by
specification: clamp by rule, reject degenerate geometry in the validator
before this stage. Correctness is proven by mathematical tests (hand-computed
values) and synthetic fixtures (locally composited watermarked frames with
known alpha/logo restored against the known original within tolerance).

## 8. Mediabunny media pipeline

`File → demux → decoded frame → detection/analysis → restoration → encoded frame → mux → output`, using mediabunny as the sole media dependency
(`Input`, `BlobSource`, `VideoSampleSink`, `Output`, `Mp4OutputFormat`,
`BufferTarget`, `CanvasSource`, `EncodedAudioPacketSource`,
`EncodedPacketSink`, `canEncodeVideo`). The sample-sink model gives exact
frames plus `timestamp/duration` pairs — required for honest progress and
A/V correctness; raw `<video>` + captureStream cannot provide this. No
FFmpeg anywhere; WebCodecs under mediabunny run in workers.

## 9. Dedicated worker

All decode/detect/restore/encode work runs in one single-job Dedicated
Worker (`validate → analyze → restore → mux`); the main thread keeps React,
controller, playback, and compare. `postMessage` protocol with `jobId` +
generation + `seq` zombie guards; transferable `ArrayBuffer` for the final
bytes; progress throttled (~10 Hz) with phase transitions bypassing the
throttle. Workers are terminated after use, never reused. The worker path
requires `OffscreenCanvas` (capability-gated; no `document` in workers).

## 10. Codec capability probing

V1 contract — MP4/H.264 in → MP4/H.264 out; MOV/WebM and HEVC/VP9 are
best-effort behind probes, never promised:

| Direction | Contract | Runtime check | On failure |
|---|---|---|---|
| Input container | MP4 primary; MOV/WebM best-effort | `Input` open + video track present | `UNSUPPORTED` naming container |
| Input video | H.264/AVC primary; HEVC/VP9 best-effort | track codec + decode probe | `E-UNSUPPORTED-CODEC` naming codec |
| Output | MP4 + H.264/AVC only | `canEncodeVideo('avc', {w,h,bitrate,…})` pre-restore | `ERROR` with the missing capability named |
| Audio | copy-if-compatible, else omit + reason | container audio-codec support check | omit with `skipReason`, stated in ledger |

V1 targets current Chrome/Edge; other browsers are best-effort behind the
same probes. No universal-support claims in docs or UI.

## 11. Audio handling

Primary-track **encoded-packet copy** with start-timestamp normalization,
concurrent with video; skip reasons `no-audio-track /
unsupported-audio-codec / no-audio-packets / disabled`. No transcode, no
resample in V1. The export ledger states the outcome
(`Audio: copied (aac, 96 packets)` or `Audio: omitted — <reason>`); silent
and audio-less sources are both valid.

## 12. BufferTarget V1 output

Fixed export profile, no user selector in V1: codec `avc`, **12 000 000 bps
CBR**, `keyFrameInterval: 2`, `latencyMode: 'quality'`, `bitrateMode:
'constant'`, `hardwareAcceleration: 'no-preference'`, `contentHint:
'detail'`, `alpha: 'discard'`, BT.709 limited-range color
(`primaries/transfer/matrix: bt709, fullRange: false`),
`Mp4OutputFormat({ fastStart: 'in-memory' })`. Whole output accumulates in a
`BufferTarget`; `COMPLETE` publishes only after explicit mux finalize plus a
non-empty-bytes assertion (`new Blob([buffer], { type: 'video/mp4' })`).
Chunked/streaming output is a future extension behind the same transferable-
bytes `complete` event, not a V1 concern.

## 13. Memory strategy

Incremental by construction: bounded live frames (current + encoder
in-flight, never the whole video), ROI-only pixel work, reused canvases
(not reallocated per frame), per-frame sample close, object-URL registry
with revocation on reset/cancel/replace/unmount. Memory scales with
duration at fixed output size — not with resolution² × frames. Large-file
streaming targets remain architecturally open but unverified; V1 depends
only on `BufferTarget`.

## 14. Browser compatibility

Chrome/Edge current: full pass expected (MP4/H.264 in→out, audio copy,
short 4K). Firefox/Safari: probe-gated results recorded during Phase 16 —
pass or named `E-CAPABILITY`/`UNSUPPORTED` are both correct outcomes when
truthful. Known risk areas: Safari `OffscreenCanvas`/WebCodecs gaps and
HEVC/VP9 decode variance; both are handled by truthful gating, never
polyfill heroics without approval, and never UA sniffing. COOP/COEP headers
are not required (no `SharedArrayBuffer` path in V1).

## 15. Performance risks

- `fastStart: 'in-memory'` pressure on very large outputs — acceptable under
  guidance-only UX copy; revisit with a streaming target only on evidence.
- Long-video tab throttling/sleep → `E-INTERRUPTED` + retry-from-start (no
  resume claim); real-world timing data pending.
- 4K encode cost varies by hardware acceleration availability; the probe
  gates honestly, and throughput (`fps`, elapsed) is displayed instead of
  speed promises.
- Progress stays honest throughout: time-based when duration is known,
  frame-estimate-based otherwise, `N frames so far` when totals are unknown.

## 16. Denoise/ONNX excluded from V1

No model-based cleanup backends in V1: no `onnxruntime` dependency, no model
hosting, no WASM threading work. Restoration quality rests on the
inverse-alpha solve plus specified local cleanup at documented defaults;
heavily compressed or textured regions are covered by the UNCERTAIN tier +
`VERIFY EDGES` caution and close-inspection tooling (100% zoom,
frame-step), not by heavier models. Revisit only with side-by-side evidence.

## 17. Open risks that remain relevant

1. **Engine correctness ownership:** we prove it (math + synthetic +
   regression tests in Phase 1) instead of inheriting proof — more upfront
   test work, zero runtime coupling.
2. **Profile coverage:** real-world watermarks outside the local profile
   table resolve to UNCERTAIN/NONE rather than guessed geometry — correct
   but conservative; profile additions follow the data-change process.
3. **Safari worker/`OffscreenCanvas`/WebCodecs gaps** — capability probes +
   Chrome/Edge-first contract; device testing in Phase 16.
4. **HEVC/VP9 input variance** — probe-gated, allowlist-worded, never promised.
5. **Long-video interruption** — designed path exists; timing evidence pending.
6. **`fastStart: 'in-memory'`** on huge outputs — acceptable per §13/§15;
   streaming target only on evidence.

## 18. FROZEN decisions

- F1. The mathematical model is frozen as stated in §2; the engine is local
  code; UI ↔ engine communication is `WatermarkDetectionResult` + ROI
  pixels only.
- F2. No `node:`, `sharp`, CLI, userscript, or network media transfers in
  browser code — ever. No external watermark-removal code under any path.
- F3. No backend/database/auth/storage/API for the job path.
- F4. Export = MP4/AVC 12 Mbps CBR, BT.709, 2 s keyframes, `fastStart
  in-memory`; audio copy-or-skip-reason; no V1 bitrate setting.
- F5. Model-based denoise excluded from V1.
- F6. Incremental frame flow; ROI-only restoration; nullable totals/ETA stay
  null; `COMPLETE` only after verified non-empty mux finalize.
- F7. Single-job workers, terminated after use, zombie-guarded events;
  cancellation revokes partial URLs, keeps source, declares no-resume.
- F8. Support contract targets MP4/H.264 in → MP4/H.264 out,
  Chrome/Edge-first; everything else is probe-gated best-effort resolving
  to `UNSUPPORTED`/`E-CAPABILITY`.
- F9. No hard file-size/duration caps; guidance-only UX copy.
