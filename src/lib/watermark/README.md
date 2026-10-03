# `src/lib/watermark` — Trusted-engine boundary

`enginePort.ts` is the ONLY module allowed to import `src/vendor/*` (Phase 1).
Exposes detection reports and ROI restoration; hides all watermark mathematics.
No React, no DOM, no worker API imports.
