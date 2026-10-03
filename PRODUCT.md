# PRODUCT.md — Video Restoration Utility

> Product definition, independent of implementation.
> Visual execution is defined in `DESIGN.md`. State-by-state behavior is defined in `UI-STATES.md`.
> Reference exploration: `docs/DESIGN-DIRECTIONS.md` (Direction C selected).

## 1. Product purpose

A browser-based utility that restores user-supplied videos carrying a supported visible watermark pattern, entirely on the user's device. It exists to perform one job — accept a video, remove the supported watermark deterministically, let the user verify the result against the original, and hand back a downloadable file — without uploads, accounts, or server processing.

## 2. Primary user workflow

```
EMPTY
→ FILE_SELECTED
→ VALIDATING
→ ANALYZING
→ READY
→ PROCESSING
→ COMPLETE
```

Alternative terminal / lateral states reachable from any pre-completion state:

```
ERROR / CANCELLED / UNSUPPORTED / NO_WATERMARK
```

The workflow is strictly linear forward; there is no branching feature tree, no queue, no batch mode. One file, one job, one result per session. Starting a new file resets the session.

## 3. Core user promise

- Your file never leaves this device.
- What the tool reports (frames, phases, detection outcome) is what it actually did.
- You verify before you download: original vs. restored comparison is always available at completion.
- If it cannot do the job, it says so plainly and never damages the original.

## 4. What the product does

- Accepts a user-selected local video file (supported containers/codecs as declared in the UI).
- Validates the file client-side (readability, container, codec, duration, dimensions).
- Analyzes the watermark region using the trusted existing restoration boundary (size-catalog lookup + anchor search + restoration validation). The UI consumes the engine's verdict; it does not re-implement it.
- Processes the video frame-by-frame locally and reports real phase, frame counters, throughput, and elapsed time.
- Produces a restored video artifact plus optional comparison still (PNG).
- Provides synchronized original-vs.-restored inspection (wipe, isolated tabs, optional wide-screen side-by-side, explicit zoom).
- Offers download of the restored file with stated export profile (container, codec, bitrate, size).
- Handles failure explicitly: unsupported input, decode failure, no watermark found, interruption, cancellation, Canvas-API interference.

## 5. What the product does NOT do

- Does not upload video to any server at any point.
- Does not remove invisible / steganographic marks (e.g., SynthID). This limitation is stated in the UI.
- Does not remove arbitrary third-party watermarks, logos, subtitles, or overlays. Only the supported visible pattern is in scope.
- Does not "enhance," upscale, recolor, denoise, or otherwise alter footage beyond the watermark restoration the engine performs.
- Does not invent progress, percentages, or detection confidence.
- Does not auto-download, auto-advance, auto-play with sound, or retain the user's file after the session.

## 6. Primary user goal

Arrive with one watermarked video, leave with one verified restored video — confident that nothing was uploaded and that the restoration is pixel-honest at the watermark region.

## 7. Product principles

1. **The tool is the page.** Input, progress, comparison, and download are the primary experience. Explanatory content is subordinate and adjacent, never a hero above the work.
2. **Show actual work, not theater.** Every number displayed is measured: file facts from probing, frame counts from the decoder, phases from the engine. Unknown values are labeled unknown.
3. **Comparison is the proof.** Completion without inspection is failure. The restored output earns trust only beside the original at the same frame and timestamp.
4. **Every state is designed.** `ERROR`, `CANCELLED`, `UNSUPPORTED`, and `NO_WATERMARK` are first-class outcomes with preserved context and a defined recovery, not dead ends.
5. **Restraint is functional.** No decoration except what clarifies hierarchy or workflow position (hairlines, step numerals, status tags).
6. **Technical metadata is UI.** Codec, container, resolution, frame rate, duration, size, detection outcome, and export profile are persistently visible — this is what makes it feel like post-production software.

## 8. Privacy / local-processing principles

- 100% client-side: selection, probing, analysis, restoration, muxing, and download all occur in the browser.
- No network transfer of video bytes. Any documentation site analytics (if ever added) must be disclosed separately and must never imply file upload.
- The local-only guarantee appears adjacent to every file action (drop field, restore, download), not buried in a footer or shown once.
- Instant local acceptance (no upload delay), no account wall, no gating of download.
- Error and cancellation copy always reaffirms preservation: "Nothing was uploaded; your file is untouched" (or precisely what was discarded for partial output).
- The tool must behave credibly offline after load: no step may require a server round-trip to proceed.

## 9. Supported workflow assumptions

- Input is a single local file the browser can address via file picker or drag-and-drop.
- Supported set is explicitly listed in the UI (containers, codecs, practical size/duration bounds). Anything outside it resolves to `UNSUPPORTED`, naming the offending property.
- Total frame count may be unknown until decode/indexing completes; the UI must handle "indexing, total unknown" honestly.
- Processing may take minutes; the UI must remain legible, cancellable, and truthful throughout (elapsed clock as proof of life even when throughput dips).
- Detection may return tiers (confident / uncertain / none). Uncertain never silently proceeds as confident; none resolves to `NO_WATERMARK`, never to a modified file.
- Export profile is the engine's calibrated default unless the engine exposes alternatives; the UI never invents encoder options.

## 10. Success criteria

- A first-time user can complete EMPTY → COMPLETE → download without instruction beyond what is on screen.
- During PROCESSING the user can state: current phase, frames done / total (or "total unknown, N so far"), elapsed time, and how to stop.
- At COMPLETE the user can inspect original vs. restored at the same timestamp (wipe + isolated views + explicit zoom) before downloading.
- Every failure produces: a plain title, a technical cause naming the file/reason, preserved context, and exactly one recommended recovery action.
- No session alters the user's original file; `NO_WATERMARK` and `CANCELLED` demonstrably return or retain the source untouched.
- The page never presents a marketing hero, fake metric, testimonial, or feature grid in place of the working apparatus.

## 11. Non-goals

- No landing/marketing site, pricing, accounts, testimonials, or growth surfaces.
- No batch/queue processing, cloud rendering, sharing links, or history library.
- No general watermark/logo/subtitle removal beyond the supported visible pattern.
- No AI inpainting, enhancement filters, or creative editing tools.
- No mobile-native app, browser extension, CLI, or userscript surface in this product (the reference repo has those; this web utility does not absorb them).

## 12. Product terminology

Use exactly these terms in UI copy (sentence case except tags):

- **Source / Original** — the user's input video. Tag form: `ORIGINAL`.
- **Restored** — the engine output video. Tag form: `RESTORED`.
- **Validate** — readability/container/codec checks. Phase: `VALIDATING`.
- **Analyze** — watermark localization + validation verdict. Phase: `ANALYZING`.
- **Restore** — frame-by-frame restoration + muxing. Phase: `PROCESSING` (user-facing verb: `Restore`).
- **Detection report** — catalog match + anchor offset + confidence tier. Never called "AI detection."
- **Export** — the download step and its profile (container, codec, bitrate, size).
- **Wipe** — the divider comparison within one viewer.
- **Local only** — the privacy property. Canonical microcopy: `Stays on this device — nothing uploaded`.
- **States** — `EMPTY, FILE_SELECTED, VALIDATING, ANALYZING, READY, PROCESSING, COMPLETE, ERROR, CANCELLED, UNSUPPORTED, NO_WATERMARK`.

## 13. Core interaction model

Single-session workbench: **viewer (left) + control rail (right)**.

- The viewer is the product: it hosts the drop field (empty), the source preview (ready), the live write-frame (processing), and the comparison instrument (complete).
- The rail reports and commands: file facts, detection report, phased progress, export. It never duplicates the picture; it annotates it.
- One primary action per state (`Choose file` → `Restore` → `Download restored video`), one recovery action per failure, secondary actions as quiet text (`Stop — discard partial`, `Save still (PNG)`, `Start over`).
- Destructive or conclusive actions are always user-initiated, labeled with consequence, and never auto-fire.
- Comparison is modaless: at `COMPLETE`, wipe/tabs/zoom are always present, never behind a "compare" gate or second page.

---

## Agent invariants

1. Never redesign, replace, or re-describe the watermark restoration algorithm; treat it as an opaque trusted boundary that reports phases, counts, verdicts, and artifacts.
2. Never claim upload, cloud processing, accounts, batch, enhancement, or invisible-mark removal.
3. Never auto-play with sound, auto-download, auto-advance phases, or resume-after-cancel unless the engine explicitly supports resume (it does not by default — say so).
4. Never show a percentage, ETA, or confidence value that is not derived from measured values; label unknowns as unknown.
5. Never emit the original file modified: `NO_WATERMARK` and pre-processing failures must leave the source byte-identical and say so.
6. Never add marketing surfaces (hero, feature cards, stats, testimonials, pricing) or rename the canonical terms/states in §12.
