# UI-STATES.md — State Specifications

> Behavior per state. Product scope: `PRODUCT.md`. Visual tokens: `DESIGN.md`.
> Canonical states: `EMPTY, FILE_SELECTED, VALIDATING, ANALYZING, READY, PROCESSING, COMPLETE, ERROR, CANCELLED, UNSUPPORTED, NO_WATERMARK`.
> Engine is a trusted boundary: UI consumes its phases, counts, verdicts, artifacts — never re-implements detection math.

## 1. EMPTY

- **Purpose:** teach the job and invite the first file; the page already looks like the tool.
- **Visible:** 64px header (wordmark, `v1.0`, `LOCAL ONLY` lozenge, desktop `REVERSE ALPHA` tag); viewer drop well (icon, `Drop a video to start`, format line, `Choose file`); rail `SUPPORTED` + `LIMITS` mono lists + local-only line + SynthID caveat. No video, no progress, no export.
- **Primary:** `Choose file` (picker). **Secondary:** drag-and-drop anywhere on well.
- **Disabled:** restore, compare tabs (tabs hidden), download, transport (no scrub/timecode; show `—` placeholders, not zeros).
- **Progress:** none. **Video:** dashed well, min-height 320px desktop / 200px mobile. **Metadata:** supported-requirements only, no file facts.
- **Transitions:** file accepted → `FILE_SELECTED`; invalid → `UNSUPPORTED` in place.
- **Accessibility/keyboard:** picker is a labeled button + native input; full keyboard path without drag; focus order header → well → rail lists.
- **Recovery:** n/a (education state).

## 2. FILE_SELECTED

- **Purpose:** confirm what was received, instantly, locally.
- **Visible:** file row (middle-truncated name, size, duration once probed) + `Remove` text action; rail `FILE` facts populate as probing resolves (each row appears with `Reading…` skeleton text, never fake values).
- **Primary:** auto-advance to `VALIDATING` (no user click needed). **Secondary:** `Remove` (returns to `EMPTY`, revokes object URL).
- **Disabled:** restore, compare, download until `READY`.
- **Progress:** none (selection is instant; any wait belongs to `VALIDATING`).
- **Video:** source loads muted in viewer; first frame shown; transport enabled (play, step, scrub, timecode).
- **Metadata:** name/size/container/codec/dims/fps/duration as each resolves; unresolved = `Reading…`.
- **Transitions:** probe ok → `VALIDATING`; unreadable → `ERROR (E-DECODE-FAIL)`; unsupported container/codec → `UNSUPPORTED`.
- **Accessibility/keyboard:** file row announced via polite region (`clip.mp4 selected — reading…`); `Remove` reachable by keyboard, focus returns to `Choose file`.
- **Recovery:** `Remove` always available.

## 3. VALIDATING

- **Purpose:** readability + container/codec checks with honest indeterminate state.
- **Visible:** STATUS stepper (`Validate` current), indeterminate flat slide + `Reading… N frames so far` if indexing, elapsed clock; viewer source dimmed 95% with `CHECKING` tag; scrub stays enabled (validation is non-destructive).
- **Primary:** none (automatic). **Secondary:** `Stop — discard partial` (resolves to `CANCELLED`).
- **Disabled:** restore, compare tabs, download.
- **Progress:** phase + elapsed + frames-so-far; no totals, no %, no ETA.
- **Video:** source frame retained; no write-preview. **Metadata:** `FILE` rows continue resolving; `DETECTION` shows `Awaiting analysis`.
- **Transitions:** pass → `ANALYZING`; fail → `ERROR`/`UNSUPPORTED` with cause.
- **Accessibility/keyboard:** assertive announce on phase entry; counters polite 5s; cancel is a real button, focus-trapped never.
- **Recovery:** cancel anytime; failure blocks carry the single recovery.

## 4. ANALYZING

- **Purpose:** watermark localization verdict (catalog + anchor + validation tier).
- **Visible:** stepper (`Analyze` current); viewer source with `ANALYZING — preview muted`; rail `DETECTION` rows fill: catalog match, anchor offset, tier. Uncertain tier → amber caution line (`TIER 3 — UNCERTAIN — VERIFY EDGES`), never silent.
- **Primary:** none (automatic). **Secondary:** cancel.
- **Disabled:** restore, compare, download.
- **Progress:** same honest counters as VALIDATING; analysis is bounded — if engine reports sub-steps, log them as audit lines.
- **Video:** source retained; no pixels modified. **Metadata:** detection rows are the deliverable of this state.
- **Transitions:** confident/uncertain → `READY` (uncertain flagged); none-found → `NO_WATERMARK`; failure → `ERROR`.
- **Accessibility/keyboard:** tier announced in words, never color-only.
- **Recovery:** cancel; `NO_WATERMARK` path preserves source untouched.

## 5. READY

- **Purpose:** pre-flight review before committing to a minutes-long job.
- **Visible:** source cued in viewer + `Ready — review, then Restore`; STATUS stepper with Validate/Analyze checked; rail FILE + DETECTION complete; EXPORT preview (profile `12 Mbps — calibrated RECOMMENDED` if exposed); primary `Restore`.
- **Primary:** `Restore` (starts PROCESSING). **Secondary:** `Remove` / `Choose different file`, transport review (play/step/scrub).
- **Disabled:** compare tabs, download.
- **Progress:** readiness checklist state (checks, not bar). **Video:** full source preview. **Metadata:** all pre-flight facts visible.
- **Transitions:** `Restore` → `PROCESSING`; remove → `EMPTY`.
- **Accessibility/keyboard:** `Restore` is the single tab-stop primary; detection tier re-announced on entry.
- **Recovery:** leaving costs nothing (no partial output exists).

## 6. PROCESSING

- **Purpose:** execute frame-by-frame restoration with real, cancellable, proof-of-life reporting.
- **Visible:** STATUS focus — phase label (`Restoring frames…` / `Muxing…`), 3px determinate bar (accent) once totals known else indeterminate slide, counters (`1,204 / 8,410 · 31 fps · 00:41 elapsed`), stepper, last-4 audit lines; viewer live write-frame + `WORKING — preview muted`; `Stop — discard partial` secondary.
- **Primary:** none while running (job owns the engine). **Secondary:** `Stop — discard partial` (→ `CANCELLED`). **Disabled:** viewer scrub (`Scrub locked during restore`, stated), compare tabs, download, new file.
- **Progress (explicit):** real frame commits only (~10Hz throttle); processed/total where available else `N frames so far`; elapsed always; ETA only when reliably derivable (stable fps + known total), labeled `~ remaining`, otherwise omitted — never fake progress, never indefinite-spinner-as-primary.
- **Video:** current write-frame muted; audio muted and stated. **Metadata:** FILE static; DETECTION static; audit lines append.
- **Transitions:** done → `COMPLETE`; stopped → `CANCELLED`; failure → `ERROR`.
- **Accessibility/keyboard:** assertive on phase change; polite 5s counters; stop reachable without mouse; focus stays on STATUS, never stolen per frame.
- **Recovery:** stop discards partial output, releases temp resources, retains source.

## 7. COMPLETE

- **Purpose:** pixel-honest verification, then download.
- **Visible:** viewer comparison instrument — default wipe (2px ink divider, 28px handle, tracked `ORIGINAL`/`RESTORED` labels) + tabs `Original | Wipe | Restored` + `Fit / 100%` zoom + frame-step + `SYNCED` tag when split (≥1280px side-by-side only); EXPORT promoted to rail top (thumbnail, ledger, profile, primary download, `Save still (PNG)`, `Start over`); `Saved — original kept for comparison` after download; explicit `Processed locally — nothing uploaded` line.
- **Primary:** `Download restored video` (44px accent). **Secondary:** `Save still (PNG)`, `Start over` (→ `EMPTY`, revokes blobs), continued inspection.
- **Disabled:** restore (job done; `Start over` begins anew), scrub-lock lifted (both streams scrubbable, frame-locked).
- **Progress:** terminal `Done` state (accent + word, never dot-only); counters freeze at final (`8,410 / 8,410 · completed in MM:SS`).
- **Video:** both streams same timestamp, frame-locked; cuts between modes 120ms, never dissolves; 100% scrolls inside card.
- **Metadata:** output ledger (name, size, AVC profile/bitrate, dims, fps, duration, frame count) beside retained source facts.
- **Transitions:** download (stays COMPLETE + confirmation); `Start over` → `EMPTY`.
- **Accessibility/keyboard:** wipe is `role="slider"` (arrows/Shift/Home/End); tabs are tablist; `C` flips; live confirmation on save.
- **Recovery:** re-download always available; source retained for re-compare.

## 8. ERROR

- **Purpose:** name a technical failure, preserve context, offer exactly one way forward.
- **Visible:** rail block in place of STATUS (2px danger left-rule, `#FBEFEC` fill): title (`Couldn't restore this file`), mono `E-CODE` (`E-DECODE-FAIL`, `E-INTERRUPTED`, canvas-interference code), cause naming file + reason, preservation line (`Nothing was uploaded; your file is untouched`), one primary recovery (`Try again` / `Choose a different file`); collapsible mono detail (codec string, anchor outcome); viewer keeps last good frame.
- **Primary:** the single recovery button. **Secondary:** `Choose a different file`. **Disabled:** restore, compare, download for the failed job.
- **Progress:** frozen at failure point (`Stopped at frame N of M` or `Failed during VALIDATING`); no further ticks.
- **Video:** last good/source frame, transport enabled for review. **Metadata:** FILE + whatever DETECTION resolved, retained.
- **Transitions:** recovery → re-validate or `EMPTY`; repeated failure keeps same code.
- **Accessibility/keyboard:** assertive announce (title + recovery); focus moves to block heading once, then user-controlled.
- **Recovery:** exactly one recommended action; canvas-interference variant appends fix (`Disable fingerprint-defender extension, then Try again`).

## 9. CANCELLED

- **Purpose:** confirm intentional stop with precise discard semantics.
- **Visible:** neutral block (paper-deep fill, ink left-rule): `Stopped — partial output discarded` + `Stopped at frame N — source kept — resume is not available` + `Nothing was uploaded`.
- **Primary:** `Choose a file` / `Restore again from start` (fresh run, never resume). **Secondary:** review retained source.
- **Disabled:** download, compare (no output exists), resume (explicitly unavailable).
- **Progress:** frozen discard statement; temp resources released (object URLs revoked except source).
- **Video:** source retained, preview enabled. **Metadata:** FILE retained; DETECTION retained if resolved.
- **Transitions:** new action → `EMPTY`/`FILE_SELECTED`.
- **Accessibility/keyboard:** assertive announce; focus to recovery action.
- **Recovery:** fresh start only — no false resumability claim.

## 10. UNSUPPORTED

- **Purpose:** reject out-of-scope input educationally.
- **Visible:** warning block (amber left-rule, `#FAF3E2` fill): `This file type isn't supported` + cause naming property (`clip.avi — container not supported; use MP4, MOV, or WebM`) + supported list inline + `Nothing was uploaded; your file is untouched`.
- **Primary:** `Choose a different file`. **Secondary:** none (no job exists). **Disabled:** everything downstream (validate/analyze/restore/compare/download).
- **Progress:** none (rejected before work). **Video:** well retains drop affordance; offending file never loads as source. **Metadata:** supported-requirements list is the content.
- **Transitions:** new file → `FILE_SELECTED` or `UNSUPPORTED` again.
- **Accessibility/keyboard:** assertive announce with supported formats in text.
- **Recovery:** single action; education prevents repeat rejection.

## 11. NO_WATERMARK

- **Purpose:** report confident non-detection without touching a pixel.
- **Visible:** neutral/amber block: `No supported watermark found` + `No supported watermark pattern was confidently detected (catalog + anchor check)` + `Your original was not altered — download would return the identical file, so none is offered` + detection summary (catalog attempted, anchor result, tier).
- **Primary:** `Choose a different file`. **Secondary:** `Keep reviewing source` (viewer stays usable), `Start over`.
- **Disabled:** restore (nothing to restore), download of "restored" (forbidden — would imply modification), compare (streams identical; offering wipe would mislead).
- **Progress:** analysis terminal statement, not a bar. **Video:** source only, fully scrubbable. **Metadata:** detection rows show the negative verdict explicitly.
- **Transitions:** new file → `FILE_SELECTED`; never → `PROCESSING` for this file.
- **Accessibility/keyboard:** assertive announce; emphasis that no change occurred (screen-reader text parity).
- **Recovery:** different file or accept source as-is; never alters the original.

---

## Agent invariants

1. Implement states exactly as named; never merge, rename, skip, or auto-advance `READY→PROCESSING` / `COMPLETE→download` without explicit user action.
2. PROCESSING reports measured frames/phases/elapsed only; ETA solely when reliable; scrub locked-with-reason; cancel always available and always lands in `CANCELLED` with discard frame + no-resume statement + resource release.
3. COMPLETE always presents wipe + isolated tabs + explicit zoom with frame-locked streams and persistent labels before download; export never destroys comparison; download confirmation retains the original.
4. Failures (ERROR/UNSUPPORTED/NO_WATERMARK) name file + reason + `E-CODE` (where applicable), state preservation verbatim, and expose exactly one primary recovery; `NO_WATERMARK` never offers a modified download and never alters the source.
5. Every phase change and failure announces assertively; counters politely (≤5s cadence); wipe is a keyboard-operable slider; tabs are real tablists; all conclusive/destructive actions are user-initiated, consequence-labeled buttons with ≥44px targets.
