# DESIGN.md — Final Visual Source of Truth

> Selected direction: **C — Contemporary Digital Utility** (`docs/DESIGN-DIRECTIONS.md` §4, §7, §8),
> with borrowed principles from A (Swiss Technical Editorial) and B (Cinematic Video Workspace).
> Product definition: `PRODUCT.md`. State behavior: `UI-STATES.md`.

## 1. Visual identity

A warm, paper-like browser workbench where the tool is the page. Precise, technical, editorial, restrained, purpose-built, trustworthy, quiet — information-dense where useful. A well-made desktop utility ported honestly to the browser (Squoosh-class), not a startup page, IDE, cyberpunk surface, glass template, or generated dashboard.

## 2. Canvas/background

Warm matte paper `#F4F1EA` fullscreen. No gradient, texture, pattern, or illustration on the canvas. Content max 1280px centered with 32px desktop / 16px mobile page margins. Header shares the paper (bottom hairline only, no contrasting bar fill).

## 3. Surface hierarchy

Exactly one dominant white viewer surface (`#FFFFFF`). All control modules (`STATUS`, `FILE`, `DETECTION`, `EXPORT`) sit flat on paper separated by hairlines and spacing — never white cards, never nested cards. Drop field is warm fill (`#EAE5D8` at ~50%) with dashed border, not a card. Video matte inside the viewer is pure `#000`.

## 4. Color tokens

```
--color-paper: #F4F1EA        /* canvas */
--color-paper-deep: #EAE5D8   /* drop fill, lozenge fill */
--color-surface: #FFFFFF       /* viewer card only */
--color-matte: #000000         /* video matte only */
--color-ink: #1C1A16           /* primary text, dividers requiring emphasis */
--color-muted: #6E675C         /* secondary text, module titles */
--color-faint: #8A8272         /* drop border, placeholder glyphs (never body text) */
--color-hairline: #E3DCCD     /* module separators, inter-column rule */
--color-edge: #D8D1C0         /* viewer card edge */
--color-accent: #2F5D3A       /* primary actions + active tab underline + determinate progress */
--color-accent-deep: #24492E  /* accent hover/active */
--color-accent-ink: #FFFFFF    /* text on accent */
--color-danger: #B3261E        /* errors, destructive cancel text, error left-rule */
--color-danger-fill: #FBEFEC   /* error block fill (max saturation, never a red wall) */
--color-warn: #9A6B0A          /* warnings, uncertain detection */
--color-warn-fill: #FAF3E2     /* warning block fill */
```

No other colors without documented reason. Verified contrasts: ink/paper ≈ 14:1, muted/paper ≈ 5:1, white/accent ≈ 7:1.

## 5. Typography tokens

| Role | Font | Spec |
|---|---|---|
| Wordmark, step titles (`01 — Input`), major product labels | Space Grotesk | wordmark 600 15px −0.01em; step title 500 20–22px −0.02em (numeral in mono 12px muted) |
| Normal UI, descriptions, controls, supporting text, buttons | Inter | body 400 14px/1.55; helper 12.5px muted; module title 600 11px uppercase 0.07em muted; button 600 14px (secondary 13.5px) |
| Technical metadata, numerals, frame counters, timestamps, measurements, processing stats | Geist Mono | 12.5px tabular-nums (labels muted 11px, values ink); timecode `HH:MM:SS:FF`; audit lines 11.5px muted |

Roles are strict: never set a heading in Mono, never set a counter/timecode in Inter/Space Grotesk, never use tabular data in proportional figures.

## 6. Grid

12-column, max-width ~1280px, 20px gutters. Desktop ≥1024px: viewer spans 7, control rail spans 5, separated by 1px vertical hairline (not a card edge). Tablet 768–1023px: stacked bands. Mobile <768px: single column, viewer first. 4px baseline; vertical rhythm in multiples of 4.

## 7. Spacing scale

Base 4px. Module padding 16–20px; intra-module rows 12px; module stack gap 16px; section gap 40px; viewer internal gaps 12px; page margins 32px desktop / 16px mobile. Touch targets ≥44px (transport, tabs, primary buttons, wipe handle hit-area).

## 8. Border rules

1px `#E3DCCD` for module separators and inter-column rule; 1px `#D8D1C0` viewer card edge; 1.5px dashed `#8A8272` drop field (only dashed element); primary buttons borderless solid fill; secondary buttons 1px ink-20%; state blocks 2px left rule (danger/warn/ink by severity); focus 2px accent outline offset 2px. No double borders, no thick outlined buttons, no glow rings.

## 9. Radius rules

Viewer card + drop field 12px; buttons/inputs/wells 8px; video matte inner 8px (clean inside 12px card); wipe handle 28px circle (32px on touch); 999px quarantined to small tags/lozenges (`LOCAL ONLY`, `WORKING`, `DONE`, `ORIGINAL`/`RESTORED`) — never buttons, steps, or modules. No `rounded-2xl` surfaces.

## 10. Elevation/shadow rules

Single level only: viewer card `0 1px 2px rgb(28 26 22 / 0.06), 0 4px 16px rgb(28 26 22 / 0.06)`. Everything else flat. No hover lift. Sole exception: sticky mobile export bar `0 -4px 16px rgb(28 26 22 / 0.08)` + top hairline.

## 11. Iconography

1.5px-stroke line icons only (upload arrow, play/pause, ±1 frame, mute, fullscreen, check, close). No filled glyph sets, no emoji as decoration, no illustrations, no film-clapper/3D props. Lock glyph for `LOCAL ONLY` drawn in matching stroke. Icons always paired with text labels except transport play/mute (which carry aria-labels + tooltips).

## 12. Buttons

Primary: accent solid fill, white 600 14px text, 8px radius, 44px height, full-verb label (`Choose file`, `Restore`, `Download restored video`). Hover `accent-deep`; focus accent ring; disabled 40% opacity (never spinner-inside without label). Secondary: transparent, 1px ink-20% border, ink text (`Stop — discard partial`, `Save still (PNG)`, `Start over`). Tertiary/text: underline on hover only. One primary per state; destructive actions are secondary-styled danger text placed away from primary alignment. No pills, no gradients, no icon-only conclusive actions.

## 13. Tabs

Attached segmented row on viewer (`Original | Wipe | Restored`): Inter 600 13.5px, 44px targets, real tablist semantics, active = ink semibold + 2px accent underline (borrowed accent discipline from C, restraint from B). Keyboard: arrows move, `C` flips Original/Restored. Never pill-styled.

## 14. Upload/dropzone

Left viewer area doubles as drop well in EMPTY: dashed 1.5px border, 12px radius, min-height 320px desktop / 200px mobile, warm fill; centered stack: stroke icon + `Drop a video to start` 600 15px + `MP4 · MOV · WebM — stays on this device` muted 12.5px + solid `Choose file`. Drag-over: solid accent border + one-step deeper fill + `Release — reading locally…` (instant binary change, no animation). Invalid: accent→danger border + inline cause line naming file/reason. Right rail simultaneously lists `SUPPORTED` and `LIMITS` mono lists (containers, codecs, bounds; visible-pattern-only + SynthID-untouched caveat).

## 15. Video viewer

White 12px card, 1px edge, single shadow. Black 8px-inner matte at native aspect; persistent 11px mono corner tags (`ORIGINAL`/`RESTORED`) on 70%-black chips; attached mode tabs; 48px transport (play, ±1 frame-step borrowed from B, scrub, mono timecode, mute, fullscreen); caption line mono 12px muted (`clip.mp4 · 1920×1080 · 29.97 fps · 00:42`). Scrub disabled-but-explained during processing. No color-shifting chrome; no glass over picture.

## 16. Metadata rail

Right-column flat modules, each ≤5 rows, definition-row format: label left (mono 11px muted uppercase) / value right (mono 12.5px ink tabular). `FILE`: name (middle-truncated), size, container, codec, dims, fps, duration. `DETECTION` (borrowed audit precision from A): catalog match (`96×96 @ +64/+64`), anchor offset (`Δx +2 / Δy −1`), tier (`TIER 1 — CONFIDENT` / `TIER 3 — UNCERTAIN — VERIFY EDGES`); uncertain tier adds amber caution line, never blocks silently. Header numerals (`01 — Input`) in Space Grotesk + mono numeral per A borrowing.

## 17. Progress system

One learned language from READY→COMPLETE: phase stepper `Validate → Analyze → Restore → Mux` (current ink semibold + accent underline, done + check) + 3px bar (accent fill, hairline track) + mono counters (`1,204 / 8,410 · 31 fps · 00:41 elapsed`) + timestamped audit lines (last 4, muted 11.5px mono — A borrowing). Unknown totals: `Reading… N frames so far` + flat 30%-width indeterminate slide (1200ms linear) until resolved. No percentages without denominators; derived % always paired with raw numbers. No circular dials, shimmer, or smoothed fake-precision animation. Updates on frame commits (~10Hz throttle); elapsed clock always runs.

## 18. Comparison interface

Default wipe on single viewer (borrowed divider language from B): 2px ink divider, 28px tactile handle (chevrons), `role="slider"` keyboard (arrows 2%, Shift 10%, Home/End), edge labels track sides. Isolated `Original`/`Restored` tabs with synced time + `C` flip. Side-by-side only ≥1280px with `SYNCED` tag (B borrowing). Explicit `Fit / 100%` zoom (100% scrolls inside card for pixel honesty). Frame-step persists for watermark-edge inspection. Cross-view changes are 120ms cuts, never dissolves.

## 19. Download/export area

Rail `EXPORT` module, promoted to rail top at COMPLETE (sticky-bottom mobile, safe-area aware): restored thumbnail, ledger (`restored-clip.mp4 · 246 MB · AVC 12 Mbps`), bitrate select only if engine-exposed (12 Mbps calibrated default marked `RECOMMENDED`), primary accent `Download restored video` 44px, secondaries `Save still (PNG)` / `Start over`, post-download line `Saved — original kept for comparison`. Original remains one tab away; export never destroys comparison. Success = accent fill + word `Done`.

## 20. Error states

In-place rail blocks replacing STATUS (viewer keeps last good frame): 2px left rule by severity, tinted fill (danger/warn max `#FBEFEC`/`#FAF3E2`, cancelled neutral paper-deep), plain title + mono `E-CODE` + cause naming file/reason + preservation line + exactly one primary recovery (coded-error + preserved-context discipline from A; local-only reassurance from B). Canvas-interference error carries fix line (`Disable fingerprint-defender extension, then Try again`). `CANCELLED` neutral: discard frame stated, resume declared unavailable. `UNSUPPORTED` doubles as education with supported list inline.

## 21. Empty states

Empty = working apparatus, not hero: viewer drop well + right-rail `SUPPORTED`/`LIMITS` + local-only line + 64px utilitarian header (wordmark + `v1.0` mono + `LOCAL ONLY — nothing uploaded` lozenge + desktop-only `REVERSE ALPHA` engine tag). No headline, CTA hero, feature cards, stats, testimonials, illustrations.

## 22. Responsive behavior

≥1024px two-column 7:5 with vertical hairline. 768–1023px: viewer first, then two-across bands (`STATUS`+`EXPORT`, `FILE`+`DETECTION`), horizontal hairlines, 44px targets, 32px wipe handle. <768px: viewer full-width 16px margins; modules in workflow order; comparison wipe-only; export sticky-bottom only after COMPLETE; metadata single-column; transport scrub full-width beneath frame.

## 23. Motion

140ms ease-out emphasis only; 1:1 wipe drag (no spring); stepped progress on commits; binary drag-over change. No entrances, scroll reveals, parallax, looped decoration (only indexing slide + 2px working rule while unresolved/working).

## 24. Reduced motion

`prefers-reduced-motion`: freeze indeterminate slide and working rule to static text labels; disable emphasis transitions; all state/progress remains text-legible; counters still update (throttled polite region).

## 25. Accessibility

Contrasts per §4; status never color-only (words + `role="status"`); wipe `role="slider"` with value; tabs as tablist; labeled transport buttons; viewer text-alternative line (file facts + state); live regions — assertive on phase/error, polite 5s cadence on counters; visible 2px accent focus; ≥44px targets; captions as DOM overlays, never baked into video.

## 26. Content tone

Plain, terse, present-tense utility voice: `Drop a video`, `Restore`, `Restoring frames…`, `Ready — review, then Restore`, `Scrub locked during restore`, `Stopped at frame N — partial output discarded, source kept`. Limitations stated upfront (`Only supported visible watermarks · invisible marks untouched`). Numbers always with units/denominators. No hype verbs, no "magical/instant AI," no emoji-led copy.

## 27. Technical-data presentation

All file/detection/progress/export facts in Geist Mono tabular: `1920×1080`, `29.97 fps`, `00:42`, `248 MB`, `1,204 / 8,410`, `31 fps`, `AVC 12 Mbps`, `96×96 @ +64/+64`, `Δx +2 / Δy −1`, `E-DECODE-FAIL`. Labels muted uppercase 11px, values ink 12.5px, aligned definition rows. Timecode `HH:MM:SS:FF` never shifts width. Audit trail timestamped, capped at 4 lines.

---

## Agent invariants

1. Exactly one white viewer card; all other modules flat on paper — never add a second card or nest cards.
2. Use only the §4 palette; accent solely for primary actions, active-tab underline, determinate progress; red solely errors/destructive; amber solely warnings. No gradients, glow, glass, blobs, or shadows beyond §10.
3. Strict type roles per §5; pills only for status/object tags, never buttons, steps, or tabs; radius per §9.
4. Viewer is always dominant and present; no hero, feature grid, stats, testimonials, illustrations, or giant CTA anywhere.
5. Progress is measured-only (counters + denominators + elapsed); unknown totals labeled unknown; no spinners-as-primary, no invented %/ETA/confidence.
6. Comparison always available at COMPLETE (wipe + isolated tabs + explicit zoom, `SYNCED` when split); never dissolve between streams; never destroy comparison on export.
7. Every failure names the file + reason + `E-CODE`, states preservation/discard precisely, offers exactly one primary recovery, and keeps the viewer context.
