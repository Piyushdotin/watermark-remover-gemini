# LLD — Low-Level Design: Browser Video Restoration Utility

> Implements `docs/HLD.md`. Product: `PRODUCT.md` · Visual: `DESIGN.md` · States: `UI-STATES.md`.
> Conventions: strict TypeScript, `postMessage` worker protocol with sequence generations, incremental frame flow, measured-only progress.
> The watermark engine is implemented locally in `lib/watermark/` from the frozen model
> (`original = (watermarked - alpha * logo) / (1 - alpha)`). No external watermark-removal code exists in this project.

## 0. Module map

```
src/
  app/
    page.tsx            # workbench shell; composition only, no pipeline imports
    layout.tsx          # fonts, metadata (existing scaffold)
  components/
    Header.tsx          # 64px utilitarian header + LOCAL ONLY lozenge
    Dropzone.tsx        # EMPTY input well (picker + drag)
    Viewer.tsx          # video matte + mode tabs + wipe + zoom
    Transport.tsx       # play/step/scrub/timecode/mute/fullscreen
    StatusPanel.tsx     # stepper + bar + counters + audit + cancel
    FilePanel.tsx       # FILE facts
    DetectionPanel.tsx  # detection report + tier caution
    ExportPanel.tsx     # ledger + profile + download + still + reset
    StateBlock.tsx      # ERROR/CANCELLED/UNSUPPORTED/NO_WATERMARK blocks
  lib/
    processing/
      controller.ts     # ProcessingController: job + worker + URL lifetimes
      job.ts            # job state machine + generation guard
      errors.ts         # E-CODE taxonomy + mapping
      capabilities.ts   # Worker/OffscreenCanvas/canEncode probes
    media/
      pipeline.ts       # demux/decode/encode/mux orchestration (worker-side)
      metadata.ts       # probe → VideoMetadata (nullable-tolerant)
      audio.ts          # packet-copy policy + skip reasons
      timestamps.ts     # normalization, VFR helpers
    watermark/
      profiles.ts       # known size/position profiles (local data)
      detector.ts       # candidates → anchor search → scoring
      anchor.ts         # local anchor refinement
      validator.ts      # tier assignment + validation gates
      restoration.ts    # frozen inverse-alpha ROI solve
      engine.ts         # stable facade: detect → report, restore → ROI
      types.ts          # engine-internal types
  workers/
    pipeline.worker.ts  # dedicated worker: validate→analyze→restore→mux
  types/
    job.ts              # ProcessingJob/State/Progress/Error/Artifact
    media.ts            # VideoMetadata/AudioMetadata
    detection.ts        # WatermarkProfile/DetectionCandidate/Result
    protocol.ts         # WorkerCommand/WorkerEvent
```

**Dependency rules:** `app/components` → `lib/processing` only. `lib/processing` → `workers/*` via protocol only. `lib/media`, `lib/watermark` import nothing from React/DOM/Next and nothing from each other. `workers/pipeline.worker.ts` is the only module importing both `lib/media` and `lib/watermark`. No `node:*`, `sharp`, CLI, or userscript imports anywhere in `src/`. No external watermark-removal package exists in the dependency tree.

## 1. Core types

```ts
// types/job.ts
export type UiState =
  | 'EMPTY' | 'FILE_SELECTED' | 'VALIDATING' | 'ANALYZING' | 'READY'
  | 'PROCESSING' | 'COMPLETE' | 'ERROR' | 'CANCELLED' | 'UNSUPPORTED' | 'NO_WATERMARK';
export type Phase = 'validate' | 'analyze' | 'restore' | 'mux';
export type DetectionTier = 'CONFIDENT' | 'UNCERTAIN' | 'NONE';

export interface ProcessingJob {
  id: string;                 // crypto.randomUUID
  generation: number;         // bumped on cancel/reset; stale events dropped
  fileName: string; fileSize: number; mimeType: string;
  state: UiState; phase: Phase | null;
  sourceUrl: string | null;   // object URL, controller-owned
  outputUrl: string | null;   // set only after mux finalize verified
  detection: WatermarkDetectionResult | null;
  progress: ProcessingProgress;
  error: ProcessingError | null;
  startedAt: number | null; completedAt: number | null;
}
export interface ProcessingState extends ProcessingJob { audit: AuditLine[]; }
export interface AuditLine { t: number; phase: Phase | 'idle' | 'done'; message: string; }
export interface ProcessingProgress {
  processedFrames: number; totalFrames: number | null;
  fps: number | null; elapsedMs: number; etaMs: number | null; // ETA only when reliable
  determinate: boolean; // false → UI shows "N frames so far", no %
}
export interface ProcessingError {
  code: 'E-UNSUPPORTED-CONTAINER' | 'E-UNSUPPORTED-CODEC' | 'E-DECODE-FAIL'
    | 'E-NO-WATERMARK-FOUND' | 'E-INTERRUPTED' | 'E-CAPABILITY' | 'E-CANVAS-INTERFERENCE';
  fileName: string; reason: string; detail?: string; atFrame?: number;
}
export interface OutputArtifact {
  blob: Blob; url: string; fileName: string; sizeBytes: number;
  container: 'mp4'; videoCodec: string; bitrateBps: number;
  width: number; height: number; fps: number | null; durationSec: number | null;
  frameCount: number; audio: AudioMetadata;
}

// types/media.ts
export interface VideoMetadata {
  width: number; height: number; codec: string | null;
  durationSec: number | null; fps: number | null; frameCountEstimate: number | null;
  averageBitrateBps: number | null; hasAudio: boolean; firstTimestampSec: number;
}
export interface AudioMetadata {
  present: boolean; codec: string | null; copied: boolean; packetCount: number;
  skipReason: 'none' | 'no-audio-track' | 'unsupported-audio-codec' | 'no-audio-packets' | 'disabled';
}

// types/detection.ts
export interface WatermarkProfile { id: string; size: number; rightMargin: number; bottomMargin: number; }
export interface DetectionCandidate { profile: WatermarkProfile; x: number; y: number; score: number; }
export interface WatermarkDetectionResult {
  tier: DetectionTier; profileMatch: WatermarkProfile;
  anchorOffset: { dx: number; dy: number }; scores: number[];
  framesSampled: number; note?: string; // e.g. 'TIER 3 — UNCERTAIN — VERIFY EDGES'
}
export interface RestorationRequest { roi: ImageData; x: number; y: number; profile: WatermarkProfile; }
export interface RestorationResult { roi: ImageData; pixelsRestored: number; } // identical dims in/out
```

## 2. Worker protocol

```ts
// types/protocol.ts
export type WorkerCommand =
  | { kind: 'validate'; jobId: string; file: File }          // File cloned into worker
  | { kind: 'analyze'; jobId: string }
  | { kind: 'restore'; jobId: string; profileBps: number }    // calibrated default 12_000_000
  | { kind: 'cancel'; jobId: string };
export type WorkerEvent =
  | { kind: 'metadata'; jobId: string; seq: number; metadata: VideoMetadata }
  | { kind: 'phase'; jobId: string; seq: number; phase: Phase; message: string; announce: true }
  | { kind: 'progress'; jobId: string; seq: number; progress: ProcessingProgress }
  | { kind: 'detection'; jobId: string; seq: number; result: WatermarkDetectionResult }
  | { kind: 'preview-frame'; jobId: string; seq: number; frame: number } // write-frame hint only
  | { kind: 'complete'; jobId: string; seq: number; artifact: OutputArtifactMeta; buffer: ArrayBuffer }
  | { kind: 'failed'; jobId: string; seq: number; error: ProcessingError };
// OutputArtifactMeta = OutputArtifact minus blob/url (bytes travel as transferable buffer)
```

**Rules:** every event carries monotonically increasing `seq` per job; controller ignores `seq` ≤ last applied and any `jobId/generation` mismatch (zombie guard). `progress` throttled to ~10Hz in worker; `phase`/`detection`/`failed`/`complete` bypass throttle. `complete` transfers the muxed `ArrayBuffer` (transferable); controller builds the `Blob` + URL on receipt and verifies `byteLength > 0` before publishing `COMPLETE`.

## 3. Boundary data

| Boundary | Crosses |
|---|---|
| UI → Controller | intents: `select(File)`, `restore()`, `cancel()`, `download()`, `reset()`; controller returns state snapshots |
| Controller → Worker | `WorkerCommand` (File cloned once on `validate`; subsequent commands are dataless) |
| Worker → Controller | `WorkerEvent`s (§2); never DOM/React |
| Media → Engine | `RestorationRequest` (`ImageData` ROI + geometry + profile); back: `RestorationResult` of identical dims |
| Engine → Worker | `WatermarkDetectionResult` + per-frame success boolean |
| Worker → Controller (final) | transferable muxed bytes + `OutputArtifactMeta` |
| Controller → UI | `ProcessingState` snapshot + object URLs (source immediately, output only post-finalize) |

## 4. Detector pipeline

```
metadata → profile candidates → local anchor search → scoring → validation → detection result
```

1. **Profile candidates** (`profiles.ts` + `detector.ts`): resolve candidate geometries from display dimensions against the local profile table.
2. **Local anchor search** (`anchor.ts`): pixel-level refinement around each predicted region on sampled frames.
3. **Scoring** (`detector.ts`): per-sample, per-candidate scores aggregated across the sample set.
4. **Validation** (`validator.ts`): tier assignment — CONFIDENT (proceed), UNCERTAIN (proceed flagged with `VERIFY EDGES`), NONE (→ `NO_WATERMARK`, no encode pass, source untouched).
5. Restoration consumes only a validated result; the rail renders the report verbatim.

## 5. Restoration pipeline

```
validated detection → ROI → frozen inverse-alpha restoration → restored ROI
```

`restoration.ts` implements `original = (watermarked - alpha * logo) / (1 - alpha)` per pixel over the validated ROI only. Identical dimensions in/out; the source `ImageData` is never mutated (restoration writes a fresh buffer); division-by-zero and out-of-range alphas are clamped by specification, with degenerate geometry rejected by the validator before this stage runs.

## 6. Media pipeline

```
File → demux → decoded frame → detection/analysis → restoration → encoded frame → mux → output
```

Decode yields timestamped frames; analysis consumes sampled frames; restoration consumes validated ROIs frame-by-frame; the encoder consumes restored frames in timestamp order; the muxer interleaves copied audio packets and finalizes explicitly. The media layer never interprets watermark content; the engine never touches containers, codecs, or mux state.

## 7. Lifecycle specifications

1. **File lifecycle:** picker/drop → controller validates MIME/extension → `FILE_SELECTED`; `File` object held by controller, cloned once to worker. Original never mutated; all processing reads via the media library.
2. **Object URL lifecycle:** registry `Map<kind, url>` in controller. `sourceUrl` created on select, revoked on remove/reset/replace/unmount. `outputUrl` created only on verified `complete`, revoked on reset/replace. Partial-run bytes never get URLs.
3. **Worker lifecycle:** created on first `validate`, one job per worker, terminated on cancel/complete-handled/reset/unmount. No worker reuse across jobs (kills zombie state class).
4. **Worker cancellation:** `cancel` flag checked between frames + before mux writes; encoder/sinks closed; canvases freed; single `failed{code:'E-INTERRUPTED'}` or `cancelled` event; controller terminates worker regardless.
5. **Frame lifecycle:** decode → draw to reused canvas → extract ROI `ImageData` → engine restore → `putImageData` ROI → encode sample → release references. Max live frames: current + encoder-in-flight (bounded, never the whole video).
6. **Timestamps:** carry `(timestamp, duration)` per sample; normalize by subtracting run `startTimestamp`; encode in ascending order; mux audio packets on the same normalized clock.
7. **VFR handling:** no fixed-FPS assumption; progress denominator prefers measured packet-rate × duration, else null (indeterminate UI); encoder consumes actual per-sample timestamps.
8. **Audio passthrough:** primary audio track → if container supports codec, packet copy with normalized timestamps; else omit + `skipReason`. No transcode, no resample in v1.
9. **Video encoding:** AVC, ~12 Mbps constant-bitrate, quality-latency, BT.709 limited-range, keyframe ~2s; `canEncodeVideo`-style probe gates `restore()`; probe failure → `E-UNSUPPORTED-CODEC` naming the codec.
10. **Container/muxing:** MP4 output; header written first, samples interleaved, explicit `close()`/finalize; `COMPLETE` only after finalize + non-empty bytes verified. Any finalize throw → `E-DECODE-FAIL`-class `failed` with stage detail.
11. **Progress reporting:** `processedFrames` increments on encoded-frame commit (not on decode); `totalFrames` from estimate or null; `fps` = commits/elapsed window; `etaMs` only when `determinate && fps stable` (else null → UI omits ETA); UI throttles render to spec cadence.
12. **Error classification:** container/codec → `UNSUPPORTED`; unreadable/mid-decode/mux → `E-DECODE-FAIL` → `ERROR`; none-detected → `E-NO-WATERMARK-FOUND` → `NO_WATERMARK`; user stop → `CANCELLED`; missing Worker/Canvas/encoder → `E-CAPABILITY`; pixel-anomaly signature → `E-CANVAS-INTERFERENCE` with extension-disable fix.
13. **Recovery:** each terminal failure offers exactly one primary action (`Try again` re-runs same stage; `Choose a different file` resets to `EMPTY`); retry reuses the retained `File`, never a partial artifact.
14. **Memory cleanup:** per-frame ROI buffers eligible for GC after encode; canvases reused via fixed pool; worker termination frees library contexts; controller revokes dead URLs; `reset()` asserts registry empty (dev-only warn otherwise).
15. **Capability checks:** `capabilities.ts` runs at boot: `typeof Worker`, `OffscreenCanvas ?? document canvas` (fallback = degraded notice), encoder probe, `ImageData`/`structuredClone` sanity. Results cached; failures short-circuit to `ERROR(E-CAPABILITY)` with the missing item named.
16. **Unsupported codecs/formats:** declared allowlist (containers MP4/MOV/WebM inputs insofar as the media library demuxes them; video H.264/HEVC/VP9 subject to browser decode). Probe rejection maps to `UNSUPPORTED` naming the property (container vs codec), never a generic error.
17. **Large files:** no size-based rejection beyond a documented practical bound; streaming demux + incremental flow keeps memory flat; progress stays honest (elapsed + frames-so-far during indexing).
18. **Long videos:** same as §17 + audit-line cap + throttled progress; interruption (sleep/tab) → decode error path → `E-INTERRUPTED` with retry-from-start (no resume claim).
19. **4K/high-res:** ROI-only pixel work bounds cost to watermark area, not frame area; canvas reuse avoids realloc churn; if encode probe fails at 4K, surface `E-UNSUPPORTED-CODEC` with dims named.
20. **Portrait videos:** geometry from display width/height (rotation-aware); profile candidates resolved against display dims; viewer matte preserves native aspect (no stretch, no crop).
21. **With/without audio:** with → copy-or-skip-reason (§8 of lifecycle); without → `audio.present=false`, video-only MP4, ledger states `Audio: none (source has no audio track)`.
22. **No-watermark:** `tier:'NONE'` → worker emits `detection` then `failed{code:'E-NO-WATERMARK-FOUND'}` → controller publishes `NO_WATERMARK`; no encode pass runs; no output artifact exists; source byte-identical.
23. **Invalid files:** zero-byte/wrong-type/unreadable → `VALIDATING` rejects fast with `E-DECODE-FAIL` or `UNSUPPORTED` (container-gated first), offending name + reason stated.
24. **Corrupted media:** mid-stream decode throw → decoder-recovery iteration over limited spans, else `failed` at exact frame; progress freezes at failure point for the rail to quote.
25. **Browser/tab interruption:** `visibilitychange`/worker `error` → treat in-flight job as interrupted: terminate worker, emit `E-INTERRUPTED`, retain source, offer retry-from-start.
26. **Output download lifecycle:** `COMPLETE` → user clicks → anchor download of `outputUrl` with `restored-<name>.mp4`; confirmation line; re-download allowed; `Start over` revokes output + source URLs and terminates any worker.

## 8. Engine test strategy (no external references)

- **Mathematical correctness tests:** per-pixel solve verified against hand-computed values for the frozen model, including alpha edge cases (0, 1, clamping behavior as specified).
- **Synthetic fixture tests:** locally generated watermarked frames (our own compositor applying the forward model with known alpha/logo) restored and compared to the known original within a documented tolerance.
- **Detection fixture tests:** synthetic frames with known geometry resolve to the expected profile + anchor offset within tolerance; absent watermarks resolve to NONE.
- **Restoration regression tests:** fixed local fixtures with recorded expected outputs; any change in output fails loudly and requires explicit re-baselining with rationale.
- **No-mutation tests:** source `ImageData` byte-identical after every engine call.
- **Boundary tests:** engine isolation — no imports from React/DOM/Next, media library, worker APIs, or any external watermark-removal package.
- **Video integration tests:** small MP4 through worker → mux-finalized playable output; `NO_WATERMARK` fixture yields no output and an intact source.

---

## Agent invariants (LLD)

1. One frame at a time; never buffer decoded/restored video; ROI-only engine calls with identical-dims return.
2. Nullable totals/ETA propagate as null to the UI — never synthesize denominators.
3. Zombie-guard every worker event (`jobId` + `generation` + `seq`); terminate, never reuse, workers across jobs.
4. `COMPLETE` requires verified mux finalize + non-empty bytes; output URL exists only then.
5. `node:*`, `sharp`, CLI, userscript, network imports, and any external watermark-removal package are banned in `src/` (lint-enforced); media bytes never traverse `fetch`/XHR. The engine is local code only.
