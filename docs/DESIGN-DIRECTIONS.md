# Video Restoration Utility — Design Directions

**Project:** Browser-based video restoration utility (local, client-side processing).
**Reference algorithm:** Reverse Alpha Blending implementation from the technical reference implementation studied during research — trusted, do not redesign.
**Stack observed:** Next.js 16.3.8 (App Router) + React 19 + Tailwind CSS v4 (`@import "tailwindcss"`, `@theme inline`), Geist / Geist Mono via `next/font`, single-route tool (`app/page.tsx`, `app/layout.tsx`, `app/globals.css`). No application UI exists yet — clean scaffold.
**Workflow (from reference repo):** select compatible video → validate locally → auto-detect watermark (size-catalog lookup + anchor search + restoration validation) → process frame-by-frame in browser (nothing uploaded) → show deterministic progress → produce restored file → compare original vs. restored → download. Failure modes are real: unsupported codec/container, corrupt file, no detectable watermark, processing interruption, fingerprint-defender / Canvas-API interference.
**Status of this document:** Exploration only. No implementation. No application files modified.

---

## 1. Product design principles

These principles apply regardless of which direction is chosen. They are derived from the workflow, not from taste.

### 1.1 The tool is the page

The application surface — file input, progress, comparison, download — is the primary experience. There is no marketing funnel. Any explanatory content (what it does, local-only guarantee, supported formats, limitations) is subordinate and placed below or beside the working area, never above it. The empty state must already show the working apparatus (drop target, format constraints, privacy note), not a headline plus CTA.

### 1.2 Show actual work, not theater

Processing is long, local, and frame-indexed. The UI must report what is verifiably true: file name, byte size, container/codec, duration, resolution, frames processed / total frames, current phase (`VALIDATING`, `ANALYZING`, `PROCESSING`, encoding/muxing), throughput (fps), elapsed time. No indeterminate spinners as the sole indicator. No invented percentages. If frame count is unknown until decode, say so and show elapsed frames + elapsed time instead of a fake bar.

### 1.3 Comparison is the proof

The complete state lives or dies on original-vs.-restored inspection. Comparison must be pixel-honest: same frame, same timestamp, synchronized playback, no color shifts introduced by the chrome, 1:1 or fit-to-width with explicit zoom state. Labels `ORIGINAL` and `RESTORED` are persistent, not hover-only.

### 1.4 Local-first must be legible

"100% local" is a structural claim, not a badge. The UI earns trust by behaving locally: instant file acceptance without upload delay, no account wall, offline-capable posture, explicit "nothing leaves this device" microcopy adjacent to the drop target, and file metadata rendered immediately from client-side probing.

### 1.5 Every state is designed

The state machine is the product:

```
EMPTY → FILE_SELECTED → VALIDATING → ANALYZING → READY
  → PROCESSING → COMPLETE
  → ERROR / CANCELLED / UNSUPPORTED (from any pre-completion state)
```

`ERROR`, `CANCELLED`, and `UNSUPPORTED` are first-class screens with distinct copy, distinct actions (retry, choose different file, resume is NOT promised unless the engine supports it), and preserved context (the rejected file's name and reason are shown, not discarded). `CANCELLED` explicitly states what was discarded and what was kept.

### 1.6 Restraint is functional

Per the anti-vibe-code constraints: no purple/blue gradients, neon glow, glassmorphism, glowing blobs, nested cards, giant pill buttons, SaaS hero, fake stats/testimonials, feature grids, decorative 3D, or emoji-as-decoration. Decoration is permitted only when it clarifies hierarchy or workflow position (e.g., a hairline that separates input from output, a numeral that marks step order).

### 1.7 Technical metadata is UI, not footnote

Codec, container, resolution, frame rate, duration, file size, watermark-detection outcome (catalog match + anchor offset + confidence tier), and export profile (e.g., calibrated AVC bitrate) are displayed in a consistent metadata register throughout the session. This is what makes the product feel like post-production software rather than a demo.

---

## 2. Direction A — Swiss Technical Editorial

### A1. Core visual concept

The page reads as a printed technical specification that happens to execute. A strict left-aligned column system, oversized section numerals (`01 — Input`, `02 — Process`, `03 — Compare`), tabular metadata, and hairline rules carry the structure. The video rectangles sit inside this document grid as figures (`Fig. 01`), captioned with file facts. Color is near-absent; meaning is carried by position, weight, and rule lines.

### A2. Product personality

Archival, exact, institutional. The tone of a calibration lab or broadcast-standards document. It promises: nothing here is approximated. Copy is terse, imperative, lower-case labels with uppercase micro-headers (`FILE / 248 MB / MP4 / H.264`).

### A3. Layout grammar

Rule-based stacking: header rule → step numeral + title → content block → hairline → next step. Asymmetry comes from a 2:1 editorial split — a narrow left rail (steps, specs, status ledger) against a wide right field (video, progress ledger). Whitespace between steps is large (64–96 px desktop) to enforce reading order. No floating panels; everything is anchored to the grid.

### A4. Grid system

12-column grid, 24 px gutters, max-width 1200 px, left edge holds a persistent 200 px index column (desktop) listing `01 INPUT / 02 INSPECT / 03 RESTORE / 04 EXPORT` with the active row marked by a filled square bullet, not a pill. Content never centers; optical left alignment is the law. Baseline grid 4 px; all vertical rhythm in multiples of 8.

### A5. Desktop composition

Top: 56 px masthead — wordmark left, `LOCAL ONLY / v1.0 / ENGINE: REVERSE ALPHA` ledger right, separated by a 1 px rule. Below: left index column (sticky) + right working column. Empty state shows the drop field as a full-width ruled rectangle (dashed 1 px border, no fill) with a left-aligned instruction block and a right-aligned format table. Processing state keeps the source monitor at fixed aspect in the right field with a ledger of frame counters beneath it. Complete state splits right field into two stacked figures with synchronized transport.

### A6. Tablet behavior (768–1024 px)

Index column collapses to a horizontal step strip (numeral + short label, 4 cells, hairline dividers, horizontally scrollable if needed). Working column goes full width. Metadata register switches from 4-column row to 2×2 definition list. Comparison stacks vertically (original above, restored below) with linked scrub — side-by-side is abandoned below 900 px because letterboxed video becomes illegible.

### A7. Mobile behavior (<768 px)

Single column, steps become an accordion ledger: only the active step is expanded; completed steps collapse to one-line summaries (`01 INPUT — clip.mp4 ✓`). Drop target becomes a full-width 160 px tall tap field (file picker, not drag). Transport controls enlarge to 44 px targets. Metadata becomes a single-column definition list. No hover-dependent comparison; the before/after control is a full-width segmented toggle plus a swipe slider with a 2 px divider handle.

### A8. Typography

Grotesk + mono split. Headings set tight and large only for step titles; body is small and dense. Tabular numerals everywhere numbers appear (frame counts, sizes, timecodes). Uppercase micro-labels at 11 px with 0.08 em tracking for field names.

### A9. Font pairing recommendations

- **Primary:** `Archivo` (or `Inter Tight`) for step titles and UI — weights 500/600/700 only. Chosen for its narrow apertures and strong capitals at display sizes.
- **Mono:** `IBM Plex Mono` (or `JetBrains Mono`) for all metadata, timecodes, buttons, status — 12–13 px, tabular. Chosen because timecode and `frame 1,204 / 8,410` must not jitter as digits change.
- **Fallbacks:** `Archivo → Inter, system-ui, sans-serif`; `Plex Mono → ui-monospace, SFMono-Regular, Menlo, monospace`.
- **Scale (desktop):** step numeral 13 px mono / step title 28–32 px grotesk 600, −0.02 em / body 14 px, 1.55 / micro-label 11 px uppercase / metadata 12.5 px mono.
- Implementation note for this repo: load via `next/font/google`, assign to CSS variables, map in Tailwind v4 `@theme` (`--font-sans`, `--font-mono` already exist in `globals.css`).

### A10. Color roles

Paper `#FAFAF8`, ink `#111310`, muted `#6B6F6A`, hairline `#E2E1DC`, field fill `#F1F0EB`. One functional accent: signal red-orange `#C93A1B` reserved exclusively for destructive/attention states (error, cancel, unsupported) and the active-step square. Success is ink (a filled square + the word `COMPLETE`), not green — green is withheld to avoid "dashboard" connotations. Focus ring is 2 px ink offset, never accent glow.

### A11. Surface treatment

Flat matte paper. No gradients, no translucency, no texture. Video rectangles are pure black fields (`#000`) so letterboxing is invisible. Drop field is paper with dashed ink-40% border — the only dashed element on the page, marking it as an input affordance.

### A12. Border treatment

Hairlines do the compositional work: 1 px `#E2E1DC` between sections, 1 px ink-15% around video frames and the drop field. No double borders, no outlined buttons with thick strokes. Dividers are full-bleed within their column, never inset-rounded.

### A13. Radius system

`0 px` for video frames, metadata tables, ledger rows, and the drop field (sharp = instrument). `3 px` maximum for small controls (buttons, toggles) so they read as operable without softening the system. Explicitly no `rounded-2xl` surfaces.

### A14. Shadow/elevation system

None. Depth is expressed by rules and order, not lift. The single permitted elevation is a 1 px ink border on the primary action (`RESTORE` / `DOWNLOAD`) to give it mass. Sticky index column uses a top/bottom hairline, not a shadow, when it pins.

### A15. Upload experience

A ruled rectangle labeled `01 — INPUT` with three zones in one row: left instruction (`Drop video or browse files`), center affordance (small square `+` button, 40 px, 1 px ink border), right format table (`MP4 · MOV · WEBM / ≤ [limit] / H.264 · HEVC · VP9`). Drag-over state inverts the rectangle (ink fill, paper text) — a binary state change, no animated glow. Rejected files never enter the ledger; they trigger the `UNSUPPORTED` block in place with the offending extension named.

### A16. Video presentation

Video is a captioned figure, not a hero. Black rectangle at native aspect (default 16:9 placeholder with `NO SIGNAL — AWAITING INPUT` mono caption in EMPTY). Caption line beneath in mono 12 px: `FIG.01 — SOURCE / clip.mp4 / 1920×1080 / 29.97 FPS / 00:42`. Controls are a thin transport bar (play, time, scrub, mute, fullscreen) in a 40 px strip with hairline top border — styled like lab equipment, not a consumer player.

### A17. Processing state

Processing is a ledger, not a spectacle. Fixed rows update in place: `PHASE: RESTORING FRAMES`, `FRAME 1,204 / 8,410`, `THROUGHPUT 31 FPS`, `ELAPSED 00:41`, plus a thin 2 px linear rule that fills left-to-right in ink. The source monitor shows the current frame being written (muted, no audio) with a persistent `WORKING` tag. Cancel is a text button (`ABORT — DISCARD PARTIAL OUTPUT`) with red-ink treatment, placed away from primary alignment to prevent mis-clicks.

### A18. Progress visualization

Single 2 px horizontal rule + tabular counter. No circular dials, no shimmer, no percentage without a denominator. If total frames are unknown (decode in progress), the bar is replaced by an accumulating frame counter and elapsed clock with the explicit label `INDEXING — TOTAL UNKNOWN`. Phase transitions (`VALIDATING → ANALYZING → PROCESSING → MUXING`) are logged as timestamped ledger lines, giving a verifiable audit trail.

### A19. Before/after comparison

Two stacked figures (`FIG.01 SOURCE`, `FIG.02 RESTORED`) with linked transport: one playhead drives both. A `SYNC` indicator (mono tag) confirms lock; desync (buffering) is stated explicitly. A third mode — split wipe within a single frame — is offered as a toggle (`SPLIT / STACKED`), with the wipe divider a 1 px ink line + 24 px square handle. No magnifier gimmicks; zoom is a discrete `FIT / 100%` switch with the current mode labeled.

### A20. Result/download state

`04 — EXPORT` block: restored figure + export ledger (`RESTORED.MP4 / 246 MB / AVC 12 MBPS / 8,410 FRAMES / CHECKSUM [short]`), then a solid-ink primary button `DOWNLOAD RESTORED VIDEO` (full label, no icon-only). Secondary text actions: `DOWNLOAD SIDE-BY-SIDE STILL (PNG)`, `START NEW FILE` (resets ledger, keeps no residue). The original file reference is retained in the ledger so the user can verify what was transformed.

### A21. Error states

Errors are ruled blocks with a red square bullet + mono error code (`E-UNSUPPORTED-CONTAINER`, `E-DECODE-FAIL`, `E-NO-WATERMARK-FOUND`, `E-INTERRUPTED`). Each block contains: what happened (one sentence), what was preserved (`SOURCE FILE UNCHANGED — NOTHING UPLOADED`), and exactly one primary recovery action. `CANCELLED` uses the same block in ink (not red) with copy `DISCARDED PARTIAL OUTPUT AT FRAME N — SOURCE RETAINED`. Technical detail (codec string, anchor-search outcome) is shown in a collapsible mono line for diagnosability.

### A22. Motion principles

Motion is limited to state changes: 120 ms linear fades for ledger updates, instant inversion on drop-target hover, no easing curves, no entrance choreography. Progress rule advances in stepped increments tied to actual frame commits (no smoothed animation that could imply false precision). `prefers-reduced-motion` disables even these; counters still update as text.

### A23. Accessibility

Contrast: ink-on-paper exceeds 12:1; muted text held at ≥4.6:1. All status is text, never color-only (red square is always paired with the word `ERROR`). Focus order follows step order; the comparison wipe handle is keyboard-operable (arrow keys move 1%/10% with shift). Live regions: `aria-live="polite"` on frame counter throttled to 1 Hz (screen readers are not spammed per frame), `aria-live="assertive"` on phase changes and errors. Transport buttons are real `<button>`s with labels; timecode has a text alternative.

### A24. Information density

High. Four to six facts visible per step without scrolling on desktop (file facts, detection facts, progress facts, export facts). Density is managed by the ledger format (aligned label/value columns, generous line-height) rather than by hiding content behind tooltips. Mobile deliberately reduces to one fact-group per viewport.

### A25. What makes the direction distinctive

The numeral + hairline + ledger system. Nothing else on the page looks designed in the decorative sense — authority comes from alignment discipline, tabular numbers, and the audit-trail processing log. It reads as the printed manual for its own engine.

### A26. What would make it look AI-generated

Centering anything; adding a gradient wash behind the masthead; rounding the video frame; replacing the ledger with three "feature cards" (`Fast / Secure / Free`); adding a large headline like "Restore your videos in seconds"; inventing throughput statistics or testimonial quotes.

### A27. Specific anti-patterns to avoid

- Do not use pills for steps — squares and numerals only.
- Do not put the video in a card with padding and shadow — it must sit edge-to-edge in its figure frame.
- Do not combine red and green status dots — status is words (`WORKING / COMPLETE / ERROR`), not dots.
- Do not animate numerals with swooshes — tabular update only.
- Do not add a footer sitemap or newsletter row — a single colophon line (`ENGINE: REVERSE ALPHA BLENDING · LOCAL ONLY · [VERSION]`) suffices.

---

## 3. Direction B — Cinematic Video Workspace

### B1. Core visual concept

The video image is the interface. A near-black workspace holds one large monitor at all times; chrome retreats to hair-thin rails and collapses during playback. The product feels like a grading bay reduced to a single purpose: the footage fills the eye, and every control answers "what am I looking at, and what is happening to it?"

### B2. Product personality

Quiet, dark-room professionalism. Confident enough to stay out of the way. Copy is minimal and present-tense (`Processing frame 1,204`, `Compare`, `Export`). It promises craft, not cleverness — the seriousness comes from how footage is treated, not from how much text surrounds it.

### B3. Layout grammar

Monitor-first hierarchy: one dominant rectangle (60–70% of viewport height on desktop), flanked by a slim right rail (320 px) for input/status/export and a thin bottom transport strip. Background and chrome share the same near-black so the only luminous object is the picture. Panels are separated by 1 px seams, not gaps — the workspace reads as one instrument bench.

### B4. Grid system

Full-bleed 16 px-seam grid, no page max-width; the monitor defines the column. Right rail is fixed 320 px (desktop ≥1280 px), monitor flexes. Below 1280 px the rail docks beneath the monitor. Vertical rhythm is driven by the 16:9 frame: transport (48 px) + metadata strip (32 px) lock to the monitor width so the whole assembly scales as one unit.

### B5. Desktop composition

Top: 48 px low-contrast bar — compact wordmark left, `LOCAL PROCESSING ●` indicator + engine tag right (12 px, neutral). Center: source/restored monitor with persistent `ORIGINAL` / `RESTORED` corner tags and letterbox-safe timecode burn-in (bottom-right, mono, 70% opacity). Right rail stacks: Input → Status → Export, only the relevant module expanded. Empty state shows the monitor as a dark field with a centered, restrained drop well (dashed 1 px neutral-700 border, single instruction line, format line beneath) — the emptiness itself signals "load footage."

### B6. Tablet behavior (768–1024 px)

Monitor remains full-width and first. Right rail reflows into a two-column strip beneath (Status + Export side by side). Transport stays attached to the monitor. Comparison defaults to wipe mode (single monitor) rather than side-by-side, preserving frame size. Rail modules become disclosure rows to control vertical length.

### B7. Mobile behavior (<768 px)

Single monitor, full-bleed edge-to-edge (no page padding around the frame). Transport is thumb-sized (48 px targets, scrub full-width beneath the frame). Input becomes a bottom-sheet-style block with a large tap target; status condenses to phase + bar + cancel. Comparison is wipe-only with a bottom segmented control (`ORIGINAL / WIPE / RESTORED`). Metadata collapses to two lines (name + `1080p · 29.97 · 00:42`).

### B8. Typography

One grotesk for everything UI, one mono for timecode/data. Type is small and dim — it must never compete with the picture. Sentence case throughout (no uppercase shouting near footage).

### B9. Font pairing recommendations

- **Primary:** `Inter` (weights 400/500/600) — chosen for legibility at 12–13 px on dark grounds and its neutral capitals that do not stylize the workspace.
- **Mono:** `Geist Mono` (already in this repo) or `IBM Plex Mono` for timecode, frame counts, status — tabular lining figures mandatory so `00:00:41:12` does not shift.
- **Scale:** chrome labels 12 px / 1.4, transport timecode 12 px mono, section titles 13 px 600, empty-state instruction 15 px 500, helper 12.5 px muted. Nothing above 20 px except the empty-monitor prompt — restraint near the image is the point.
- Note: keeping Geist Mono avoids adding a third family to this scaffold and pairs cleanly with Inter.

### B10. Color roles

Ground `#0C0D0E`, panel `#131516`, seam `#232627`, text `#E8E9E7`, muted `#9BA0A0`, faint `#5C6262`. Accent is a single desaturated warm amber `#D8A24A` used only for: active phase marker, progress fill, wipe handle, and the Export button fill (with black text). Red `#D95B4B` appears solely for error blocks and destructive cancel. No blue, no green traffic lights; success is stated in words (`Restored — ready to compare`).

### B11. Surface treatment

Matte, non-reflective. Panels are flat fills one step above ground; no blur, no translucency over video (controls over the picture use a solid 80%-black strip, never glass). The monitor bezel is 1 px seam + 8 px black matte so the decoded frame edge is unambiguous.

### B12. Border treatment

1 px seams (`#232627`) define modules; the monitor gets a 1 px `#000` inner edge plus the seam outer edge (double edge = "this is picture"). Drop-well uses a 1 px dashed `#3A3F3F` border. Focus rings are 2 px amber outline offset 2 px — visible on black without glow.

### B13. Radius system

`6 px` for rail modules and buttons, `4 px` for tags and inputs, `0 px` for the monitor itself and the scrub track. The small radii keep chrome tactile without softening the picture rectangle — the frame must stay razor-sharp.

### B14. Shadow/elevation system

Effectively flat. One sanctioned shadow: the transport strip over the picture (linear black scrim, picture-safe, text-legible) — functional, not decorative. Rail modules have no shadow; separation is by seam and fill-step. Modal errors (decode failure) use a solid panel with a 1 px seam, no blur backdrop.

### B15. Upload experience

Drag anywhere over the monitor: a 1 px amber dashed inset frame + dimmed picture + centered line `Release to load — stays on this device`. Click opens the file picker. Beneath the well, a single muted line states the contract: `MP4 · MOV · WebM — processed locally, never uploaded`. Invalid files shake nothing; the well border turns red-ink and an inline line names the reason (`clip.avi — container not supported`). Recent-file residue is not shown — this is a single-shot bench.

### B16. Video presentation

Monitor dominates: native aspect, black matte, overlaid corner tags (`ORIGINAL` top-left, timecode bottom-right) in 11 px mono on 70%-black chips. Transport: play/pause, frame-step back/forward (essential for watermark inspection), scrub with buffered/decoded regions in two neutral tones, timecode `HH:MM:SS:FF`, mute, fullscreen. Frame-stepping is a first-class control here (unlike A and C) because watermark verification is frame-local.

### B17. Processing state

The monitor shows the frame currently being written (dimmed to 85% with a thin amber edge pulse limited to a 2 px top rule — the only permitted "glow-adjacent" motion, and it is a flat fill, not a blur). Right rail Status module shows phase (`Analyzing`, `Restoring frames`, `Muxing`), linear bar, `1,204 / 8,410 frames · 31 fps · 00:41 elapsed`, and a text `Cancel` button. Audio is muted during processing and stated as such (`Preview muted during restore`).

### B18. Progress visualization

Two coupled elements: a 3 px linear bar directly beneath the monitor (amber fill on seam track, no percentage bubble) and the rail's tabular readout. Phase is a three-segment stepper (`Validate → Analyze → Restore → Mux`) with the active segment amber and completed segments neutral-filled — words, not icons. Unknown totals show `Indexing… N frames so far` with an indeterminate 40%-width sliding block (flat, 1200 ms linear loop) — used only until the frame count resolves, then replaced by the determinate bar.

### B19. Before/after comparison

The signature interaction: a wipe slider over a single monitor (draggable 2 px amber divider with a 28 px circular handle showing `◂ ▸` chevrons — the one round element permitted). Labels `ORIGINAL` (left) and `RESTORED` (right) track the divider. A toggle switches to side-by-side (two half-monitors, synced transport) for wide screens and to isolated `A / B` flip (one monitor, instant cut on keypress `C`) for pixel-peeping. Playback stays frame-locked in all modes; a `SYNCED` tag confirms lock.

### B20. Result/download state

Export module activates: thumbnail of the restored frame, export ledger (`Restored · 1080p · AVC 12 Mbps · 246 MB`), amber solid `Download restored video` button (black text, 44 px), secondary `Save comparison still (PNG)` text button. After download, a quiet confirmation line (`Saved restored-clip.mp4 — original retained for comparison`) — no confetti, no modal.

### B21. Error states

Errors appear as a solid-panel block inside the rail (red-ink left rule, 3 px) with plain-language title + mono code + one recovery action. The monitor retains the last good frame (or the source, if pre-processing) so context is never lost. `CANCELLED` is neutral (no red): `Restore stopped at frame N — partial output discarded, source kept`. `UNSUPPORTED` names the container/codec and lists the supported set. All errors keep the `LOCAL ONLY` reassurance (`Your file never left this device`).

### B22. Motion principles

Slow, damped, picture-safe: 160–220 ms ease-out for module expansion, divider drag is 1:1 with pointer (no lag/spring), progress bar updates on frame commits (throttled to ~10 Hz to avoid layout thrash). The only looped motion is the indexing block and the 2 px working rule. Crossfades between ORIGINAL/RESTORED are 120 ms cuts, not dissolves (dissolves would misrepresent pixels). Honors `prefers-reduced-motion` by freezing the indexing loop to a static label.

### B23. Accessibility

Dark-ground contrast held to ≥4.5:1 for all chrome text (muted `#9BA0A0` on `#131516` passes; faint `#5C6262` is never used for text). Wipe handle is keyboard-operable (Left/Right 2%, Shift 10%, Home/End 0/100%) with `role="slider"` and `aria-valuenow`. Live region announces phase changes assertively and progress politely at 5 s intervals. Focus is always visible (amber ring). Captions/labels are burned as DOM overlays, not baked into video.

### B24. Information density

Low-moderate by design. The monitor area shows exactly four facts (tag, timecode, phase, bar); the rail shows one module's facts at a time. Density is deferred to disclosures (`File details`, `Detection report`) rather than always-visible ledgers. This is the least dense direction — appropriate for footage-first work, weakest for auditability.

### B25. What makes the direction distinctive

The monitor-as-workspace and the wipe comparison. Everything else (rails, seams, amber) exists to get out of the footage's way. Frame-stepping + wipe + `C`-key flip make it feel like a purpose-built inspection bench rather than a file converter with a video stuck on top.

### B26. What would make it look AI-generated

A glowing gradient behind the monitor; glassmorphic transport; a "hero" headline above the workspace; purple timeline accents; auto-playing decorative background video; star ratings or "loved by 10,000 creators" badges; oversized gradient Download pill.

### B27. Specific anti-patterns to avoid

- Do not letterbox the workspace with marketing copy — the monitor touches the top bar directly.
- Do not use circular progress dials over the video — progress lives under the frame.
- Do not add film-grain overlays, clapperboard icons, or timeline skeuomorphism — restraint is the cinema reference, not props.
- Do not split attention with a chat assistant or "AI enhance" upsell panel — single purpose, single rail.
- Do not autoplay with sound — all previews start muted with explicit unmute.

---

## 4. Direction C — Contemporary Digital Utility

### C1. Core visual concept

A warm, paper-like workbench with compact, confident controls — the feeling of a well-made Mac/Windows utility or a pro browser tool like Squoosh. Editorial type sets the tone, but the working apparatus (drop field, transport, compare, export) is always within one viewport. Warmth makes long local-processing waits tolerable; compactness makes the tool feel engineered rather than marketed.

### C2. Product personality

Capable, calm, matter-of-fact. The tone of a tool that respects the user's time: plain-language labels (`Drop a video`, `Restore`, `Compare`, `Download`), honest caveats (`Only Gemini visible watermarks · invisible SynthID untouched`), and a quiet local-only promise. Neither lab-cold (A) nor dark-room (B).

### C3. Layout grammar

Asymmetric workbench: a 7:5 split on desktop — left working column (input → viewer → compare) against a right control column (status, file facts, detection report, export). A single warm canvas unifies them; separation is by spacing and one hairline, not boxes-in-boxes. The page header is 64 px and utilitarian (wordmark, local-only tag, version), then the workbench begins immediately — no hero gap.

### C4. Grid system

12-column, max-width 1280 px, 20 px gutters, 32 px page margins (desktop). Left column spans 7, right spans 5 with a 1 px vertical hairline between (not a card edge). Baseline 4 px, section spacing 40 px, intra-module spacing 12–16 px. Breakpoints: ≥1024 px two-column; 768–1023 px stacked with control column as horizontal bands; <768 px single column, viewer first.

### C5. Desktop composition

Header (64 px) → workbench: left holds the viewer card (single card only — the one permitted surface) with transport and mode tabs (`Original / Wipe / Restored`) attached; right holds stacked compact modules: `STATUS` (phase + bar + counters), `FILE` (name, size, codec, duration, dims), `DETECTION` (catalog match, anchor offset, tier), `EXPORT` (profile selector, download). Empty state: viewer area is the drop field (large, warm, dashed-border) and the right column shows format requirements + local-only explainer + limitations — so the empty page already teaches the workflow.

### C6. Tablet behavior (768–1024 px)

Workbench stacks: viewer/drop first, then a two-across band (`STATUS` + `EXPORT`), then `FILE` + `DETECTION` two-across. Mode tabs remain attached to the viewer. Vertical hairline is removed; horizontal hairlines separate bands. Touch targets raised to 44 px; wipe handle widened to 32 px.

### C7. Mobile behavior (<768 px)

Viewer full-width with 16 px page margins; control modules become full-width sections in workflow order (Status → Compare toggle → File → Export). `EXPORT` is sticky-bottom (safe-area aware) once `COMPLETE` is reached, so Download is always reachable without scrolling past metadata. Drop field is 200 px tall with a solid `Choose video` button (file picker) plus drag support where available. Comparison defaults to wipe; side-by-side is not offered.

### C8. Typography

Editorial grotesk for headings + system-clean sans for UI + mono for data. Headings carry the personality (tight, confident); UI text stays plain and small. Timecodes and counters are tabular mono so progress does not jitter.

### C9. Font pairing recommendations

- **Display/UI:** `Söhne`-like → practical pick `Inter` (500/600 for headings at −0.02 em) or `General Sans` alternative `Space Grotesk` 500 for the wordmark + step titles only. Recommendation: `Space Grotesk` for the wordmark and the three step titles (gives utility character without quirk), `Inter` for all other UI text.
- **Mono:** `Geist Mono` (already in scaffold) for metadata, timecode, phase, buttons-that-report-numbers. 12–13 px.
- **Scale:** wordmark 15 px 600 / step title 22 px 600, −0.02 em / module title 11 px uppercase 600, 0.07 em / body 14 px, 1.55 / helper 12.5 px muted / data 12.5 px mono tabular.
- Rationale: two-family limit (Grotesk + Mono) keeps `next/font` payload small and matches the existing `Geist` variables; `Space Grotesk` adds just enough editorial edge to avoid generic-SaaS `Inter`-everywhere flatness.

### C10. Color roles

Warm neutral canvas `#F4F1EA` (paper), surface `#FFFFFF` (viewer card + control modules at 1 px border), ink `#1C1A16`, muted `#6E675C`, hairline `#E3DCCD`, faint fill `#EAE5D8`. Accent: deep moss/ink-green `#2F5D3A` (or oxidized teal `#246A5B`) — used sparingly for: primary actions (`Restore`, `Download`), active tab underline, determinate progress fill. Red `#B3261E` only for errors/destructive cancel. Amber `#9A6B0A` only for warnings (`UNSUPPORTED` hint, partial-detection caution). Success = accent fill + the word `Done`, never a green dot alone.

### C11. Surface treatment

Warm matte paper with one white working surface. The viewer card is the hero surface (white, 1 px hairline, 12 px radius, no shadow or a single 0 1px 2px rgb(28 26 22 / 0.06) hairline shadow). Control modules are flat paper with hairline separators — explicitly not white cards — so there is exactly one elevation level and no nesting. Drop field is warm fill (`#EAE5D8` at 50%) with dashed ink-30% border.

### C12. Border treatment

Hairlines everywhere structure lives: 1 px `#E3DCCD` for module separators and the inter-column rule; 1 px `#D8D1C0` for the viewer card edge; 1.5 px dashed `#8A8272` for the drop field. Buttons: solid accent fill (no border) for primary; 1 px ink-20% for secondary. Focus: 2 px accent outline offset 2 px.

### C13. Radius system

`12 px` viewer card and drop field (approachable, tool-like); `8 px` buttons, inputs, module wells; `999 px` only for the small status lozenge (`LOCAL ONLY`, `WORKING`, `DONE`) and the `ORIGINAL/RESTORED` tags — pills are quarantined to tags, never used for buttons or steps. Wipe handle is a 28 px circle (tactile) on a 2 px divider.

### C14. Shadow/elevation system

Minimal single-level: viewer card gets `0 1px 2px rgb(28 26 22 / 0.06), 0 4px 16px rgb(28 26 22 / 0.06)`; everything else is flat. No layered shadows, no hover lift. Sticky mobile export bar uses a top hairline + `0 -4px 16px rgb(28 26 22 / 0.08)` — the only second shadow, and only on mobile.

### C15. Upload experience

Left viewer area doubles as the drop field in EMPTY: dashed warm well with a compact stack — small square icon (upload arrow, 1.5 px stroke), `Drop a video to start` (15 px 600), `MP4 · MOV · WebM — stays on this device` (12.5 px muted), and a solid `Choose file` button (accent or ink). Drag-over: border turns solid accent + fill deepens one step + label changes to `Release — reading locally…`. Right column lists `SUPPORTED` (containers, codecs, max size/duration) and `LIMITS` (visible Gemini watermark only; SynthID invisible marks untouched) as two compact mono lists — honesty before upload.

### C16. Video presentation

Viewer card holds the picture (black matte, 8 px inner radius so the frame edge is clean inside the 12 px card), an attached mode tab row (`Original | Wipe | Restored` — segmented, active = ink underline + semibold), and a transport strip (play, frame-step, scrub, timecode mono, mute, fullscreen). Corner tags `ORIGINAL`/`RESTORED` persist in wipe/side modes. Caption line under transport: `clip.mp4 · 1920×1080 · 29.97 fps · 00:42` in mono 12 px muted.

### C17. Processing state

Status module becomes the focus: phase label (`Restoring frames…`), determinate bar (3 px, accent fill), tabular readout (`1,204 / 8,410 · 31 fps · 00:41`), phase stepper (`Validate → Analyze → Restore → Mux`, current in ink semibold, done with check). Viewer shows the in-progress frame with a `WORKING — preview muted` tag; scrub is disabled during processing (stated, not silently dead) while Cancel (`Stop — discard partial`) sits as a quiet secondary button. Elapsed clock keeps running even if fps dips — proof of life.

### C18. Progress visualization

Determinate 3 px bar + counters + stepper (same component from `READY` through `COMPLETE` so the user learns one language). Unknown totals: `Reading… N frames so far` with a flat indeterminate block (accent at 30% width, linear slide, 1200 ms) — replaced the moment the count resolves. No percentages without denominators; when shown, percentage is derived (`1,204 / 8,410 = 14%`) and paired with the raw numbers.

### C19. Before/after comparison

Primary mode is wipe on a single viewer (2 px ink divider, 28 px handle, edge labels track sides). `Original` and `Restored` tabs isolate each stream fullscreen-in-viewer with one-key toggle (`C`) and synced time. Optional side-by-side appears only ≥1280 px as two half-viewers with a `SYNCED` tag. Zoom control (`Fit / 100%`) is explicit; at 100% the viewer scrolls inside the card so pixels are honest. Frame-step buttons persist in compare mode for watermark-edge inspection.

### C20. Result/download state

Export module promotes to the top of the right column: restored thumbnail, `restored-clip.mp4 · 246 MB · AVC 12 Mbps` ledger, bitrate selector (only if the engine exposes it: `12 / 20 Mbps` with the 12 Mbps calibrated default marked `RECOMMENDED`), solid accent `Download restored video` (44 px), secondary `Save still (PNG)` + `Start over` text buttons. A quiet confirmation (`Saved — original kept for comparison`) follows download. Original remains one tab away — comparison is never destroyed by exporting.

### C21. Error states

Inline, warm, specific. Each error is a paper-tinted block (red-ink 2 px left rule, `#FBEFEC` fill at most, never a red wall) with: title (`Couldn't read this file`), mono code (`E-DECODE-FAIL`), cause line naming the file and reason (`clip.avi — container not supported; use MP4, MOV, or WebM`), preservation line (`Nothing was uploaded; your file is untouched`), and one primary recovery (`Choose a different file` / `Try again`). `CANCELLED` is neutral-tinted (`Stopped at frame N — partial output discarded, source kept — Resume is not available`). `UNSUPPORTED` doubles as education (supported list inline). Fingerprint-defender/Canvas interference gets its own code and fix line (disable the extension, retry) per the reference repo's known issue.

### C22. Motion principles

Compact and quick: 140 ms ease-out for module emphasis, 1:1 wipe drag, stepped progress on frame commits (~10 Hz throttle). No entrance animations, no scroll reveals, no parallax. The drop field's drag-over change is instant (binary), not animated. `prefers-reduced-motion` freezes the indeterminate block to a static label; all state changes remain text-legible without motion.

### C23. Accessibility

Warm palette checked: ink `#1C1A16` on `#F4F1EA` ≈ 14:1; muted `#6E675C` on paper ≈ 5:1 (body-safe); accent `#2F5D3A` with white text ≈ 7:1 (button-safe). Status never color-only (phase words + `role="status"`). Wipe slider is `role="slider"` keyboard-operable; tabs are real tablist semantics; transport buttons labeled. Live regions: phase changes assertive, counters polite at 5 s cadence. 44 px minimum targets for transport/download; visible accent focus rings throughout. The viewer has a text alternative line (file facts + state) for screen readers.

### C24. Information density

Medium — the balanced position. Desktop shows viewer + four facts (file) + four facts (detection) + progress + export without scrolling at 900 px height; anything more goes into `Details` disclosures. Denser than B (which hides metadata), airier than A (which ledgers everything). Right-column modules are capped at ~5 rows each to prevent rail sprawl.

### C25. What makes the direction distinctive

Warmth + compactness + editorial tabs. It is the only direction that feels like a desktop utility ported honestly to the browser: the warm canvas removes SaaS sterility, the single white viewer card focuses attention, and the attached tab row makes comparison a one-click habit rather than a feature.

### C26. What would make it look AI-generated

Cool-gray background with a purple gradient CTA; three "Why choose us" cards under a centered headline; pill buttons for `Original/Restored`; glassy sticky header; stock play-button illustration; "4.9★ from 12,000 users" badge; animated blob behind the drop field.

### C27. Specific anti-patterns to avoid

- Do not multiply white cards — one viewer card, everything else flat on paper.
- Do not use pills for buttons or steps — pills are tags only.
- Do not center the empty state as a hero — the drop field is left-column work, supported-formats are right-column facts.
- Do not auto-advance or auto-download — every destructive or conclusive action is user-initiated and labeled with its consequence.
- Do not hide the local-only promise in a footer — it sits beside every file action.

---

## 5. Detailed comparison

| Dimension | A — Swiss Technical Editorial | B — Cinematic Video Workspace | C — Contemporary Digital Utility |
|---|---|---|---|
| Dominant element | Grid + ledger + numerals | Footage monitor | Workbench: viewer card + control rail |
| Canvas | Cool paper `#FAFAF8`, ink | Near-black `#0C0D0E` | Warm paper `#F4F1EA` |
| Accent discipline | Red-orange strictly for attention | Amber strictly for phase/progress/export | Moss green strictly for primary/progress |
| Video size (desktop) | Medium figure in document column | 60–70% viewport, dominant | Large card, 7/12 width |
| Empty state | Ruled input document with format table | Dark monitor with drop well | Drop viewer + supported/limits rail |
| Processing legibility | Best (audit ledger + frame log) | Good (monitor + rail, hides detail) | Strong (status module + stepper + counters) |
| Comparison | Stacked synced figures + split toggle | Wipe-first + A/B flip + frame-step | Wipe + tabs + optional side-by-side ≥1280px |
| Error handling | Best (coded ruled blocks + ledger residue) | Good (rail block, context kept) | Strong (inline warm blocks + recovery + education) |
| Mobile fit | Accordion ledger, stacked figures | Edge-to-edge monitor, wipe-only | Viewer-first stack, sticky export |
| Density | High | Low | Medium |
| Motion | Near-zero (120 ms fades) | Slow/damped, picture-safe | Quick/compact (140 ms) |
| Implementation cost (this scaffold) | Low (CSS + type, no custom player chrome beyond transport) | Highest (custom monitor, wipe, frame-step, scrims, dark-system QA) | Medium (one card system, tabs, wipe, disclosures) |
| Risk of vibe-code drift | Low — but can feel arid/cold for video | Medium-high — darkness + amber slides easily into "AI video SaaS" glow | Low — warmth + restraint is hardest to cliché if pills/cards are policed |
| Best reference analog | Standards document / calibration sheet | Grading bay, single-purpose | Squoosh / pro browser utility |

### State-by-state fit

| State | A | B | C |
|---|---|---|---|
| `EMPTY` | Tool-like ledger; risks feeling like a form | Evocative monitor; risks hiding requirements | Strongest: drop + supported/limits visible together |
| `FILE_SELECTED` / `VALIDATING` / `ANALYZING` | Excellent: each phase is a ledger line | Adequate: phases collapse into rail text | Excellent: stepper + counters + detection preview |
| `READY` | Clear pre-flight ledger before `RESTORE` | Minimal pre-flight (single button) | Clearest: pre-flight + profile + action in one module |
| `PROCESSING` | Most truthful (frame log) | Most watchable (live frame) | Best balance (live frame + numbers) |
| `COMPLETE` | Thorough but stacked figures consume height | Best inspection (wipe + flip + step) | Strong: wipe + tabs + 100% zoom + export adjacent |
| `ERROR` / `CANCELLED` / `UNSUPPORTED` | Most precise (codes + preserved-context ledger) | Context kept on monitor; rail space cramped | Most recoverable (inline fix + supported list) |

---

## 6. Tradeoffs

1. **Authority vs. warmth.** A maximizes perceived exactness through cold archival order; extended processing waits feel longer on stark paper. C trades a few degrees of lab authority for waiting-room comfort — meaningful when restores run minutes. B trades both for immersion, which flatters footage but weakens trust copy (users must hunt for the local-only guarantee).
2. **Density vs. clarity.** A shows everything and risks overwhelming first-time users (four ledgers before pressing Restore). B shows almost nothing and risks under-informing (detection tier, export bitrate hidden). C rations density (five-row modules, disclosures) at the cost of more interaction design work — what hides, what shows, and when.
3. **Comparison power vs. build cost.** B's wipe + frame-step + `C`-flip is the best inspection instrument and the most code (pointer-locked divider, synced decoders, keyboard map, dark-QA). A's stacked synced figures are cheapest and tallest. C's tabbed wipe is 80% of B's power at ~50% of the cost, with side-by-side gated to wide screens.
4. **Dark vs. light operations.** B's dark room is genuinely better for pixel inspection (watermark edges, black-level judgment) and worse for everything else: form legibility, error reading, daylight mobile use, print/screenshot clarity, and accessibility QA burden. A and C are light-first and cheaper to make accessible; C's warm paper is additionally easier on long sessions than A's stark white.
5. **Distinctiveness vs. safety.** A is the most visually opinionated (nothing else looks like a calibration sheet) and the most polarizing — some users will read it as "developer tool." C is the safest broad-context choice (feels like software everyone has used) and must be policed hardest against generic drift (one card, no pills-as-buttons, no hero).

---

## 7. Recommendation

### Recommended: Direction C — Contemporary Digital Utility

**Why it best fits this product:**

1. **It matches the job.** This is a single-shot browser utility (Squoosh-class), not a document (A) and not a screening room (B). Users arrive with one file, wait through one local job, verify one result, and leave with one download. C's workbench — viewer left, facts and actions right — mirrors that linear job without ceremony.
2. **It carries all ten states gracefully.** The state machine is the hard requirement, and C is the only direction rated strong-or-best in every row of the state table: empty teaches, validating/analyzing report, ready pre-flights, processing proves, complete compares, and error/cancelled/unsupported recover — all without reflowing the page's identity.
3. **Comparison becomes habit, not feature.** The attached `Original / Wipe / Restored` tabs plus 100%-zoom put before/after one click away at all times, which is exactly what a restoration claim needs. B inspects marginally better; A audits marginally better; C is the only one that makes verification unavoidable and effortless.
4. **Trust is adjacent to action.** The local-only promise, supported-formats list, visible-watermark-only limitation, and SynthID caveat sit beside the drop field and every file action — not in a footer or a tooltip. For a tool that asks users to hand over personal video, that adjacency outperforms both A's ledger formality and B's rail fine-print.
5. **It fits the actual scaffold.** With Tailwind v4, Geist Mono already wired, and a single App Router page, C builds incrementally: warm tokens in `@theme`, one card component, tab + wipe + disclosure primitives, transport strip. No dark-system QA pass (B) and no full editorial grid apparatus (A) are prerequisites to reaching a shippable tool.
6. **It resists vibe-code drift when policed.** Warm neutrals + moss accent + single-card discipline have no widely copied AI-SaaS template, unlike dark+amber (B's failure mode) — provided the policed rules hold: one white card, pills-as-tags-only, no hero, no gradients, no feature grid.

**What to borrow from the runners-up:**

- From A: tabular mono everywhere numbers appear; hairline + numeral step order (`01 Input / 02 Restore / 03 Compare / 04 Export` as small rail headers); the processing audit trail (timestamped phase lines under the bar); coded errors (`E-*`) with preserved-context lines.
- From B: wipe divider interaction language (2 px divider, labeled sides, keyboard-operable slider); frame-step buttons in transport; muted-preview-during-processing rule; `SYNCED` lock tag in side-by-side mode.

**What to explicitly reject:**

- From A: full-document stacking at desktop (too tall for video + compare + export in one viewport); success-in-ink (C needs an affirmative accent for `Download`).
- From B: full-bleed dark ground, glass scrims, amber-everywhere glow-adjacent treatments, and hiding metadata behind disclosures by default.

---

## 8. Preliminary visual system — Direction C (for future implementation, not built here)

> Scope note: tokens and behaviors only. No code, no file changes, no dependencies installed.

### 8.1 Tokens (Tailwind v4 `@theme` sketch)

```css
/* canvas + surfaces */
--color-paper: #F4F1EA;
--color-paper-deep: #EAE5D8;
--color-surface: #FFFFFF;
--color-matte: #000000;          /* video matte only */
/* ink + text */
--color-ink: #1C1A16;
--color-muted: #6E675C;
--color-faint: #8A8272;
/* lines */
--color-hairline: #E3DCCD;
--color-edge: #D8D1C0;
/* accent (primary + progress only) */
--color-accent: #2F5D3A;
--color-accent-ink: #FFFFFF;
--color-accent-deep: #24492E;    /* hover/active */
/* signal (strictly scoped) */
--color-danger: #B3261E;
--color-danger-fill: #FBEFEC;
--color-warn: #9A6B0A;
--color-warn-fill: #FAF3E2;
/* type */
--font-display: "Space Grotesk", Inter, system-ui, sans-serif;
--font-sans: Inter, system-ui, sans-serif;
--font-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
```

Contrast checks (design-time, to re-verify in code): ink/paper ≈ 14:1; muted/paper ≈ 5:1; white on accent ≈ 7:1; danger on danger-fill ≈ 7:1.

### 8.2 Type scale

| Role | Spec |
|---|---|
| Wordmark | Space Grotesk 600, 15 px, −0.01 em |
| Step title (`01 — Input`) | Space Grotesk 500, 20–22 px, −0.02 em; numeral in mono 12 px muted |
| Module title (`STATUS`, `FILE`) | Inter 600, 11 px, uppercase, 0.07 em, muted-ink |
| Body / helper | Inter 400, 14 px / 1.55; helper 12.5 px muted |
| Data (facts, timecode, counters) | Geist Mono 12.5 px, tabular-nums, ink; labels muted |
| Buttons | Inter 600, 14 px (primary 44 px height); secondary 13.5 px |

### 8.3 Spacing, grid, radius, shadow

- Spacing base 4 px; module padding 16–20 px; section gap 40 px; intra-module rows 12 px; page margins 32 px desktop / 16 px mobile; workbench max 1280 px; columns 7:5 with 1 px vertical hairline at ≥1024 px.
- Radius: viewer card + drop field 12 px; buttons/inputs/wells 8 px; tags/lozenges 999 px (tags only); video matte inner 8 px; wipe handle 28 px circle.
- Shadow: single-level card `0 1px 2px rgb(28 26 22 / 0.06), 0 4px 16px rgb(28 26 22 / 0.06)`; sticky mobile export adds `0 -4px 16px rgb(28 26 22 / 0.08)`. Nothing else casts.

### 8.4 Header (all states)

64 px, paper, bottom hairline. Left: wordmark + `v1.0` mono tag. Center/right: `LOCAL ONLY — nothing uploaded` lozenge (pill, paper-deep fill, ink text, lock glyph drawn in 1.5 px stroke — not emoji), engine tag `REVERSE ALPHA` mono muted (desktop only). No nav, no links row, no CTA button — the workbench is the content.

### 8.5 Workbench modules and state behavior

- **`01 — Input` (left viewer in EMPTY; module in rail thereafter):** drop well (dashed 1.5 px `#8A8272`, 12 px radius, min-height 320 px desktop / 200 px mobile) → on `FILE_SELECTED`: file row (name truncated middle, size, duration) + `Remove` text action. Drag-over: solid accent border + one-step deeper fill + `Release — reading locally…`.
- **`STATUS` (rail):** phase stepper `Validate → Analyze → Restore → Mux` (current ink semibold + accent underline; done + check); 3 px bar (accent fill, hairline track); counters mono (`1,204 / 8,410 · 31 fps · 00:41 elapsed`); audit lines (timestamped phase transitions, muted mono 11.5 px, capped at last 4). `VALIDATING`/`ANALYZING` show indeterminate block until counts resolve. `PROCESSING` disables viewer scrub with the note `Scrub locked during restore`. Cancel: secondary `Stop — discard partial` (danger text, no fill).
- **`FILE` + `DETECTION` (rail):** definition rows (label left muted mono 11 px, value right mono 12.5 px ink): container, codec, dims, fps, duration, size; catalog match (`96×96 @ +64/+64`), anchor offset (`Δx +2 / Δy −1`), tier (`TIER 1 — CONFIDENT` / `TIER 3 — UNCERTAIN — VERIFY EDGES`). Uncertain tier surfaces an amber caution line, never blocks.
- **Viewer + transport (left):** black matte, mode tabs attached (`Original | Wipe | Restored`), transport 48 px (play, ±1 frame, scrub, `HH:MM:SS:FF` mono, mute, fullscreen). Corner tags persist. `READY`: source-cued with `Ready — review, then Restore`. `PROCESSING`: live write-frame + `WORKING — preview muted`. `COMPLETE`: wipe default, `100%` zoom available, `SYNCED` tag in side-by-side (≥1280 px only).
- **`04 — Export` (rail, promoted to top on COMPLETE; sticky-bottom on mobile):** thumbnail, ledger (`restored-clip.mp4 · 246 MB · AVC 12 Mbps`), profile select (if engine-exposed, default `12 Mbps — calibrated` marked), primary `Download restored video` (accent solid, 44 px, full label), secondaries `Save still (PNG)` / `Start over` (text, ink-underline on hover). Post-download line: `Saved — original kept for comparison`.
- **`ERROR` / `CANCELLED` / `UNSUPPORTED`:** block replaces `STATUS` content in place (rail position preserved, viewer keeps last good frame): 2 px left rule (danger/warn/ink respectively), tinted fill, title + `E-CODE` + cause naming the file + preservation line + exactly one primary recovery button. Canvas-interference error carries the fix (`Disable fingerprint-defender extension, then Try again`). `CANCELLED` states the discard frame and that resume is unavailable.

### 8.6 Motion + accessibility baseline

140 ms ease-out for emphasis only; 1:1 wipe drag; progress commits throttled ~10 Hz; drag-over is binary. `prefers-reduced-motion` freezes indeterminate motion to text. Full keyboard map: tabs as tablist, wipe as slider (arrows/Shift/Home/End), `C` flips Original/Restored, `Space` plays (when viewer focused), `?` is not needed — no hidden shortcuts beyond these. Live regions: `assertive` on phase/error, `polite` throttled on counters. Targets ≥44 px for transport, tabs, download; visible 2 px accent focus throughout.

### 8.7 Build order hint (when implementation is later authorized)

Tokens → header + workbench shell → drop/file input → transport + tabs → status/stepper/bar → detection ledger → wipe compare + zoom → export module → error/cancelled/unsupported blocks → tablet/mobile passes → reduced-motion + live-region + keyboard QA. Engine integration stays behind the existing trusted boundary; UI consumes only its reported phases, counts, and artifacts.

---

*End of exploration. Recommended next step when authorized: implement Direction C's workbench shell with EMPTY → FILE_SELECTED → VALIDATING mock states first, so layout, tokens, and comparison ergonomics can be judged with real video before wiring the processing engine.*
