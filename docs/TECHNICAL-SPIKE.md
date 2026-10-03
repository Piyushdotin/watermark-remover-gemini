# TECHNICAL-SPIKE — Pre-Implementation Findings

> Read-only investigation. No application code written, no dependencies installed, no app files modified.
> Inspected: `~/Desktop/gemini-watermark-remover` (upstream, v1.0.46, MIT) and the current scaffold (`/Users/piyushkumar/watermark-remover-gemini`, no `src/` yet, no `mediabunny` in `package.json`).
> Note: upstream `node_modules` is absent, so installed-package surfaces (mediabunny typings) could not be enumerated — flagged where relevant.

## 1. Executive summary

- The trusted core (`src/core`) is **fully browser-safe pure JS** (only `ImageData`/`Float32Array` math + embedded base64 alpha maps); zero `node:` imports anywhere under `src/core`, `src/video`, `src/workers`, `src/shared`, `src/runtime`.
- The **only** `node:` imports in SDK-adjacent code are `src/sdk/node.js` and `src/sdk/video.js` (which is a **Node-only** module despite its name — preview server + Playwright harness). There is **no browser-safe video entry point** in the package exports; `src/sdk/video.js` must never be imported into the browser bundle.
- Video I/O is **mediabunny-only** (sole runtime dependency): `Input`/`BlobSource`/`ALL_FORMATS` in, `VideoSampleSink` frames, `CanvasSource` + AVC `Output`/`Mp4OutputFormat`/`BufferTarget` out, `EncodedAudioPacketSource`/`EncodedPacketSink` audio copy. No FFmpeg anywhere. Default export = **12 Mbps AVC CBR, quality-latency, BT.709, 2 s keyframes** — directly reproducible.
- Denoise/ONNX defaults to **off** (`DEFAULT_DENOISE_BACKEND = 'none'`); the normal path does not need it.
- Output is held via **`BufferTarget` (whole file in memory)** upstream; V1 keeps that model with a chunked/streaming migration path.
- Recommendation: **vendored pinned snapshot of the browser-safe subset + thin local adapter** (approach C), Chrome/Edge-first support contract, no bitrate selector, no size cap — practical guidance only.

## 2. Reference dependency graph

```
BROWSER-SAFE (no node:, no sharp, no onnxruntime-web import at module top-level)
├── src/core/  (~60 files: pure math over ImageData/Float32Array)
│   ├── blendModes.js                    ← reverse-alpha removeWatermark (per-frame primitive)
│   ├── watermarkEngine.js               ← WatermarkEngine (OffscreenCanvas first, document fallback)
│   ├── watermarkProcessor.js            ← processWatermarkImageData (imports core/* only)
│   ├── adaptiveDetector.js / candidateSelector.js / geminiSizeCatalog.js / restorationMetrics.js …
│   ├── embeddedAlphaMaps.js (+ embedded{,Dark}OutlineAlphaMap.js, base64 blobs)
│   └── multiPassRemoval.js / imageWatermarkPipeline*.js …
├── src/video/ (browser-safe, mediabunny + canvas)
│   ├── videoExport.js                   ← removeGeminiVideoWatermark (imports mediabunny)
│   ├── videoWatermarkDetector.js        ← 12-sample detect (imports core adaptiveDetector + catalog)
│   ├── videoWatermarkCatalog.js / veoTextWatermark*.js / videoMetadata.js
│   ├── videoDecodeRecovery.js / videoDenoiseRuntimePolicy.js / videoPresetPolicy.js
│   └── videoCleanupBackends.js          ← canvas cleanups inline; ONNX isolated (see §11)
├── src/workers/watermarkWorker.js       ← image-only worker (WatermarkEngine + createImageBitmap + canvasToBlob)
├── src/sdk/browser.js + src/sdk/image-data.js   ← browser-safe IMAGE entries (core only)
├── src/shared/imageProcessing.js + src/runtime/browser.js  ← browser-safe helpers
└── direct dep: mediabunny ^1.46.0 (Input/Output/Sinks/Formats/canEncodeVideo)

NODE-ONLY (must never enter the browser bundle)
├── src/sdk/video.js                     ← node:path, node:fs, node:http, node:url; preview server, Playwright
├── src/sdk/node.js                      ← node:path, node:fs/promises; sharp-injected decode/encode
├── src/cli/ (gwrCli.js, gwrRemoveCommand.js), bin/, scripts/, tests/, examples/
└── peer (optional): sharp ^0.34.5 || ^0.35.0 — CLI file codec only

OPTIONAL / HEAVY (browser-loadable but excluded from V1)
├── src/core/allenkFdncnnOnnxRuntime.js  ← `import * as wasmOrt from 'onnxruntime-web/wasm'`
├── src/core/allenkFdncnn*.js (denoise model code) + public/models/allenk-fdncnn/*.onnx
└── dev: onnxruntime-web, playwright, esbuild, sharp, typescript
```

Import-chain proof (representative): `videoExport.js` → `mediabunny` + `../core/blendModes.js` + `./videoWatermarkDetector.js` → `../core/{embeddedAlphaMaps,adaptiveDetector}.js` + `./videoWatermarkCatalog.js`. `watermarkEngine.js` → `embeddedAlphaMaps`, `multiPassRemoval`, `watermarkProcessor`, `adaptiveDetector`, `watermarkConfig` — all relative core files. `grep` for `node:` across `src/core src/video src/workers src/sdk src/shared src/runtime` returns hits **only** in `src/sdk/node.js` and `src/sdk/video.js`.

## 3. Trusted engine boundary

- **Files that ARE the boundary:** `src/core/blendModes.js` (`removeWatermark`), `src/core/watermarkEngine.js` (`WatermarkEngine`), `src/core/watermarkProcessor.js` (`processWatermarkImageData`), `src/core/adaptiveDetector.js`, `src/core/geminiSizeCatalog.js`, `src/core/embeddedAlphaMaps.js` (+ siblings), `src/video/videoWatermarkDetector.js`, `src/video/videoWatermarkCatalog.js`, `src/video/videoMetadata.js`, `src/video/videoDecodeRecovery.js`.
- **Existing browser-safe entry?** For **images**, yes: `./image-data` and `./browser` export subpaths. For **video**, **no** — `./video` maps to the Node-only `src/sdk/video.js`. So the video path has no consumable package entry; the video engine must be reached via vendored files (see §10), not via any export subpath.
- **Worker precedent:** `src/workers/watermarkWorker.js` proves the engine runs off-main-thread (image path: `createImageBitmap` + engine + `canvasToBlob`, transferable result buffer). Our pipeline worker extends this pattern to video.
- **Canvas fallback note:** `watermarkEngine.js:19-24` prefers `OffscreenCanvas`, falls back to `document.createElement('canvas')` — inside a Dedicated Worker `document` does not exist, so the worker path **requires** `OffscreenCanvas` (capability-gated; Chromium OK, Safari verified at runtime per §5).

## 4. Media pipeline

Traced `File → demux → frame → process → encode → audio → mux` in `src/video/videoExport.js` (`removeGeminiVideoWatermark`):

1. **Demux:** `new Input({ source: new BlobSource(file), formats: ALL_FORMATS })` (`videoExport.js:88-94`); `getVideoContext` yields `input` + primary `videoTrack`.
2. **Metadata:** `resolveVideoMetadata` (`videoMetadata.js`) — display w/h, first timestamp, codec, duration (metadata → computed → null), packet-stats average rate/bitrate, nullable `frameCountEstimate`.
3. **Detect:** `detectGeminiVideoWatermark` — candidate positions from `resolveVideoWatermarkCandidates(w, h)`, 12 timestamp-spread samples (`DEFAULT_SAMPLE_COUNT = 12`, `getSampleTargetTimestamps`), `VideoSampleSink` draws → ROI `ImageData` → async scoring (5 alpha-refinement rounds, thresholds 0.14/0.035); low confidence **throws** unless `allowLowConfidence` (maps to our `NO_WATERMARK`).
4. **Encode setup:** `createVideoExportEncodingConfig` → `canEncodeVideo('avc', …)` gate (failure = named Chrome/Edge error); `BufferTarget` + `Mp4OutputFormat({ fastStart: 'in-memory' })` + `CanvasSource(canvas, config)`; `output.addVideoTrack(source, { frameRate })`.
5. **Frame loop:** `iterateVideoSamplesWithDecoderRecovery(() => new VideoSampleSink(videoTrack))` → per sample: normalize timestamp vs `firstTimestamp`, clamp regressions with `fallbackDuration`, draw full frame, ROI `getImageData` → core restore → `putImageData` → `source.add(timestamp, duration)`; `sample.close()` in `finally`; `AbortSignal` checked per frame; progress = time-based if duration known else frame-estimate-based (`export` phase callback).
6. **Audio:** `prepareAudioPacketCopy` — primary audio track, MP4-compatible codec only, `EncodedAudioPacketSource` + `EncodedPacketSink` copy on the same normalized clock; runs concurrently (`copyAudioPackets`), failures fail the export; skip reasons recorded.
7. **Mux/finalize:** `source.close()` → await audio → `output.finalize()` → assert `target.buffer` non-empty → `new Blob([buffer], { type: 'video/mp4' })`; catch path cancels un-finalized output and disposes input.

**Required mediabunny APIs:** `Input, BlobSource, ALL_FORMATS, VideoSampleSink, Output, Mp4OutputFormat, BufferTarget, CanvasSource, EncodedAudioPacketSource, EncodedPacketSink, canEncodeVideo` (+ `getPrimaryAudioTrack/getDecoderConfig/computePacketStats` track methods).
**Worker-executable:** the entire chain is worker-safe in principle (WebCodecs `VideoDecoder/Encoder` under mediabunny run in workers; `OffscreenCanvas` + 2d context required; no DOM used in `videoExport.js` — `createRuntimeCanvas` prefers `OffscreenCanvas`). Upstream runs it on the page thread with `yieldToMainThread`; moving it into a Dedicated Worker is the HLD/LLD delta, gated on the §5 capability probe. `ffmpeg` is **not** needed — unanimously mediabunny + WebCodecs.

## 5. Browser/Worker boundary

- Main thread: React, controller, playback, compare, object URLs. Worker: demux → detect → restore → encode → mux; messages per `docs/LLD.md` protocol; transferable final bytes.
- Upstream precedent supports this: worker file exists (image path), video path is main-thread only upstream (`yieldToMainThread` option) but uses no main-thread-only APIs — migration risk is low, verification is runtime capability probing (`Worker`, `OffscreenCanvas`, `canEncodeVideo('avc', …)`), with `E-CAPABILITY` failure naming the missing piece.
- COOP/COEP headers are **not** required for V1 (only the excluded threaded-ONNX path needs `SharedArrayBuffer`).

## 6. Codec support matrix (V1 contract)

| Direction | Contract | Runtime check | On failure |
|---|---|---|---|
| Input container | MP4 primary; MOV/WebM best-effort (whatever mediabunny demuxes) | `Input` open + video track present | `UNSUPPORTED` naming container |
| Input video | H.264/AVC primary; HEVC/VP9 best-effort (browser decode) | track `getCodec()` + decode probe | `E-UNSUPPORTED-CODEC` naming codec |
| Output | MP4 + H.264/AVC only | `canEncodeVideo('avc', {w,h,bitrate,…})` pre-restore | `ERROR` quoting upstream message (use modern Chrome/Edge) |
| Audio | copy-if-compatible, else omit + reason | `getSupportedAudioCodecs().includes(codec)` | omit with `skipReason`, stated in ledger |

Primary target per brief: **MP4/H.264 in → MP4/H.264 out**. No universal-support claims; Safari/HEVC behavior is probe-determined at runtime, not asserted in docs or UI. Upstream's own encode-failure string is Chrome/Edge-first — our support statement matches: **V1 targets current Chrome/Edge; other browsers best-effort behind the same probes.**

## 7. Audio strategy

Unchanged from HLD/LLD, now repo-confirmed: primary-track **encoded-packet copy** with start-timestamp normalization, concurrent with video; skip reasons `no-audio-track / unsupported-audio-codec / no-audio-packets / disabled`; no transcode in V1; ledger states outcome (`Audio: copied (aac, 96 packets)` or `Audio: omitted — <reason>`). Silent and audio-less sources both valid.

## 8. Output strategy

V1 reproduces the calibrated profile exactly (values from `videoExport.js:44-64,125-138`): codec `avc`, **12 000 000 bps CBR** (`resolveVideoBitrate` fallback), `keyFrameInterval: 2`, `latencyMode: 'quality'`, `bitrateMode: 'constant'`, `hardwareAcceleration: 'no-preference'`, `contentHint: 'detail'`, `alpha: 'discard'`, decoder color-space override BT.709 limited-range (`primaries/transfer/matrix: bt709, fullRange: false`), `Mp4OutputFormat({ fastStart: 'in-memory' })`. **No bitrate selector in V1** (fixed constant; `resolveVideoBitrate` honors overrides only if a future caller passes one).

## 9. Memory strategy

- **Upstream model (A — whole output in memory):** `BufferTarget` accumulates the full MP4; final `Blob([buffer])`. Simple, proven, and the V1 choice: no extra APIs, deterministic finalize, matches reference byte-for-byte behavior.
- **B (chunked/progressive):** viable later (emit encoded chunks to controller for incremental assembly) but changes finalize semantics — deferred.
- **C (`FileSystemWritableFileStream`/OPFS):** cannot be confirmed from the repo (mediabunny typings unavailable offline — `node_modules` absent) and adds permission/persistence semantics; deferred pending implementation-time verification against installed mediabunny types.
- **V1:** (A) + existing guards (ROI-only work, reused canvas, per-frame `sample.close()`, bounded live frames, URL registry). Large-file path stays architecturally open via the transferable-bytes protocol (a future `StreamTarget` can replace `BufferTarget` behind the same `complete` event).

## 10. Reuse strategy comparison

| Criterion | A. npm dependency | B. vendored snapshot | C. adapter over vendored core (recommended) |
|---|---|---|---|
| Browser compat | Blocked: no video-safe entry (`./video` is Node-only); would import `node:http` into bundle | Full control; import only verified-safe files | Same as B, plus isolation |
| Behavioral equivalence | Version drift risk on every install | Exact — pinned files, reproducible bytes | Exact + adapter covered by parity tests |
| Maintenance | Upstream churn arrives unreviewed | Manual sync, deliberate + logged | Manual sync behind a stable port (fewer touch points) |
| Upstream updates | Automatic but unsafe | Conscious cherry-pick | Same as B; port absorbs API-shape drift |
| Bundle size | Whole package graph incl. Node shims risk | Only needed files (core subset + video pipeline) | Same as B; adapter is trivial |
| Dependency risk | `node:` poisoning, sharp/peer confusion | None beyond mediabunny | None beyond mediabunny |
| Reproducibility | Lockfile-dependent, entry-point-dependent | Commit-pinned, diffable | Commit-pinned + interface-frozen |
| Learning value | Low (black box) | High (boundary explicitly mapped) | Highest (port documents the contract) |
| License/attribution | MIT — preserve `LICENSE` notices (upstream © 2025 Jad, © 2024 AllenK/Kwyshell) + credit the port + doc source in HLD/LLD | Same obligations, easier to evidence (vendored `NOTICE`/`THIRD-PARTY` note) | Same as B |

**Recommendation for V1: C.** Vendor the §3 file set at a pinned upstream commit, wrap in `WatermarkEnginePort`, and forbid all other imports from vendored paths (lint rule). MIT obligations: retain upstream copyright notices, add attribution + commit hash in a vendored `README/NOTICE`.

## 11. Denoise/ONNX findings

- **Not on the normal path:** `DEFAULT_DENOISE_BACKEND = 'none'` (`videoCleanupBackends.js:15`); the async ONNX branch (`ALLENK_FDNCNN_BROWSER_SPIKE`, `applyVideoResidualCleanupAsync`) executes only when explicitly selected; default cleanup is inline canvas residual/texture work at `residualCleanupStrength 1.5`, `highQualityCleanup false`, `textureRepair false`.
- **V1 operates correctly without it:** detection (catalog + anchor + validation) and `removeWatermark` ROI restoration are ONNX-independent; the WASM module import lives only in `allenkFdncnnOnnxRuntime.js`, never imported by the default export path.
- **Where degradation could appear without ONNX:** heavy-compression or textured watermark footprints where the optional `canvas-edge-denoise / footprint-polish / temporal-stabilize` backends would otherwise smooth residual edges — visible only as marginally less-polished ROI edges on close 100 % inspection, never as job failure. Mitigation: ship canvas cleanups at their defaults; keep `TIER 3 — VERIFY EDGES` caution; revisit only with side-by-side evidence.
- **Stays disabled:** no `onnxruntime-web` dependency, no `.onnx` model hosting, no COOP/COEP work in V1.

## 12. Open risks

1. **Vendoring fidelity:** transcription/drift when snapshotting upstream files — mitigate with pinned commit + parity tests against reference outputs.
2. **Safari worker + `OffscreenCanvas`/WebCodecs gaps** — mitigated by capability probes + Chrome/Edge-first contract; needs device testing at implementation.
3. **HEVC/VP9 input variance** across browsers — probe-gated, allowlist-worded, never promised.
4. **mediabunny streaming-target API surface** unverified offline — V1 avoids dependence on it (`BufferTarget` only).
5. **Long-video tab throttling/sleep** — `E-INTERRUPTED` + retry-from-start path already designed; real-world timing data pending.
6. **`fastStart: 'in-memory'`** cost on very large outputs — acceptable under V1 guidance (§13); revisit with streaming target if evidence demands.

## 13. Final V1 technical recommendations

1. Vendored core snapshot + `WatermarkEnginePort` adapter (approach C), MIT attribution retained.
2. mediabunny as the sole media dependency; no FFmpeg; no ONNX/denoise backends.
3. Dedicated pipeline worker; `BufferTarget` whole-output model; transferable-bytes `complete` event.
4. Fixed 12 Mbps AVC/BT.709/2 s-keyframe export; audio copy-or-stated-skip; no bitrate UI.
5. Chrome/Edge-first contract; probes decide everything else; failures name the missing capability.
6. Practical UX guidance (not caps): short clips fly; multi-minute/4K works but takes minutes and peaks near output-size memory — progress stays honest throughout. No hard size/duration block.

## 14. FROZEN decisions

- F1. Trusted math is vendored, never rewritten; UI ↔ engine communication only via `WatermarkDetectionResult` + ROI pixels.
- F2. No `node:`, `sharp`, CLI, userscript, or network media transfers in browser code — ever.
- F3. No backend/database/auth/storage/API for the job path.
- F4. Export = MP4/AVC 12 Mbps CBR, BT.709, 2 s keyframes, `fastStart in-memory`; audio copy-or-skip-reason; no V1 bitrate setting.
- F5. Denoise/ONNX excluded from V1; default canvas cleanups only.
- F6. Incremental frame flow; ROI-only restoration; nullable totals/ETA stay null; `COMPLETE` only after verified non-empty mux finalize.
- F7. Single-job workers, terminated after use, zombie-guarded events; cancellation revokes partial URLs, keeps source, declares no-resume.
- F8. Support contract targets MP4/H.264 in → MP4/H.264 out, Chrome/Edge-first; everything else is probe-gated best-effort resolving to `UNSUPPORTED`/`E-CAPABILITY`.
- F9. No hard file-size/duration caps; guidance-only UX copy.
