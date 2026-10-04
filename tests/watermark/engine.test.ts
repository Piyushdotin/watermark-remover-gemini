// Phase 1 engine tests. All fixtures are generated inside this project
// (synthetic compositor below); nothing depends on external outputs.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_A_96,
  PROFILE_B_48,
  PROFILES,
  getProfileBySize,
  predictRoi,
} from "../../src/lib/watermark/profiles.js";
import {
  isRoiInsideFrame,
  resolveCandidateProfile,
  selectCandidates,
} from "../../src/lib/watermark/detector.js";
import {
  ANCHOR_SEARCH_RADIUS_PX,
  refineAnchor,
  toLuma,
} from "../../src/lib/watermark/anchor-search.js";
import {
  CONFIDENT_SCORE_THRESHOLD,
  UNCERTAIN_NOTE,
  UNCERTAIN_SCORE_THRESHOLD,
  assertRestorable,
  validateCandidate,
} from "../../src/lib/watermark/validator.js";
import {
  ALPHA_SAFETY_EPSILON,
  restoreRoi,
} from "../../src/lib/watermark/restoration.js";
import {
  detectFromSamples,
  restoreValidated,
} from "../../src/lib/watermark/engine.js";
import { EngineError } from "../../src/lib/watermark/types.js";
import type {
  AlphaMap,
  ScoredCandidate,
} from "../../src/lib/watermark/types.js";

// ---------- project-owned synthetic helpers (tests only) ----------

function uniformAlpha(size: number, a: number): AlphaMap {
  return { size, data: new Float32Array(size * size).fill(a) };
}

/** Forward model: W = round(A*L + (1-A)*O), per channel. */
function composite(
  original: number[],
  logo: number,
  alpha: number,
): number[] {
  return original.map((o) =>
    Math.round(alpha * logo + (1 - alpha) * o),
  );
}

/** Tolerance accounting for 8-bit rounding: |dW|<=0.5 amplifies by 1/(1-a). */
function toleranceFor(alpha: number): number {
  return Math.ceil(0.5 / (1 - alpha)) + 1;
}

function flatRgba(w: number, h: number, v: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function paintSquare(
  rgba: Uint8ClampedArray,
  frameW: number,
  x: number,
  y: number,
  size: number,
  v: number,
): void {
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = ((y + j) * frameW + (x + i)) * 4;
      rgba[o] = v;
      rgba[o + 1] = v;
      rgba[o + 2] = v;
    }
  }
}

function scored(
  overrides: Partial<ScoredCandidate> = {},
): ScoredCandidate {
  return {
    profile: PROFILE_B_48,
    roi: { x: 240, y: 160, width: 48, height: 48 },
    dx: 0,
    dy: 0,
    score: 40,
    frameWidth: 320,
    frameHeight: 240,
    ...overrides,
  };
}

// ---------- 1. profile geometry ----------

describe("profiles", () => {
  it("defines exactly the two V1 profiles", () => {
    assert.equal(PROFILES.length, 2);
    assert.deepEqual({ ...PROFILE_A_96 }, {
      id: "A-96",
      size: 96,
      rightMargin: 64,
      bottomMargin: 64,
    });
    assert.deepEqual({ ...PROFILE_B_48 }, {
      id: "B-48",
      size: 48,
      rightMargin: 32,
      bottomMargin: 32,
    });
    assert.ok(Object.isFrozen(PROFILE_A_96));
  });

  it("predicts bottom-right ROIs", () => {
    assert.deepEqual(predictRoi(1920, 1080, PROFILE_A_96), {
      x: 1760,
      y: 920,
      width: 96,
      height: 96,
    });
    assert.deepEqual(predictRoi(320, 240, PROFILE_B_48), {
      x: 240,
      y: 160,
      width: 48,
      height: 48,
    });
  });

  it("returns null when the profile does not fit", () => {
    assert.equal(predictRoi(100, 100, PROFILE_A_96), null);
    assert.equal(predictRoi(79, 200, PROFILE_B_48), null);
  });

  it("rejects non-positive frame dimensions", () => {
    assert.throws(() => predictRoi(0, 240, PROFILE_B_48), EngineError);
    assert.throws(() => predictRoi(320.5, 240, PROFILE_B_48), EngineError);
  });

  it("looks profiles up by size only", () => {
    assert.equal(getProfileBySize(96)?.id, "A-96");
    assert.equal(getProfileBySize(48)?.id, "B-48");
    assert.equal(getProfileBySize(64), null);
  });
});

// ---------- 2. candidate ROI geometry ----------

describe("detector geometry", () => {
  it("selects both profiles on HD, largest first", () => {
    const out = selectCandidates(1920, 1080);
    assert.deepEqual(out.map((c) => c.profile.id), ["A-96", "B-48"]);
  });

  it("selects only fitting profiles on small frames", () => {
    assert.deepEqual(
      selectCandidates(100, 100).map((c) => c.profile.id),
      ["B-48"],
    );
    assert.deepEqual(selectCandidates(60, 60), []);
  });

  it("rejects invalid frame dimensions", () => {
    assert.throws(() => selectCandidates(-1, 240), EngineError);
    assert.throws(() => selectCandidates(320, 0), EngineError);
  });

  it("tests ROI containment exactly", () => {
    assert.equal(
      isRoiInsideFrame({ x: 0, y: 0, width: 320, height: 240 }, 320, 240),
      true,
    );
    assert.equal(
      isRoiInsideFrame({ x: 273, y: 0, width: 48, height: 48 }, 320, 240),
      false,
    );
    assert.equal(
      isRoiInsideFrame({ x: 0, y: 0, width: 0, height: 10 }, 320, 240),
      false,
    );
  });

  it("resolves candidate profiles by size", () => {
    assert.equal(resolveCandidateProfile(96)?.id, "A-96");
    assert.equal(resolveCandidateProfile(13), null);
  });
});

// ---------- 3. anchor search ----------

describe("anchor search", () => {
  it("converts RGBA to Rec.601 luma", () => {
    const luma = toLuma(
      new Uint8ClampedArray([255, 0, 0, 255]),
      1,
      1,
    );
    assert.ok(Math.abs(luma[0] - 0.299 * 255) < 1e-5);
  });

  it("rejects mismatched pixel buffers", () => {
    assert.throws(
      () => toLuma(new Uint8ClampedArray(3 * 4), 2, 2),
      EngineError,
    );
  });

  it("finds (0,0) on an aligned synthetic watermark", () => {
    const rgba = flatRgba(320, 240, 100);
    paintSquare(rgba, 320, 240, 160, 48, 140);
    const luma = toLuma(rgba, 320, 240);
    const found = refineAnchor(luma, 320, 240, {
      x: 240,
      y: 160,
      width: 48,
      height: 48,
    });
    assert.deepEqual({ dx: found.dx, dy: found.dy }, { dx: 0, dy: 0 });
    assert.ok(found.score >= CONFIDENT_SCORE_THRESHOLD);
  });

  it("recovers a known small offset", () => {
    const rgba = flatRgba(320, 240, 100);
    paintSquare(rgba, 320, 243, 162, 48, 140);
    const luma = toLuma(rgba, 320, 240);
    const found = refineAnchor(luma, 320, 240, {
      x: 240,
      y: 160,
      width: 48,
      height: 48,
    });
    assert.deepEqual({ dx: found.dx, dy: found.dy }, { dx: 3, dy: 2 });
  });

  it("is deterministic across runs", () => {
    const rgba = flatRgba(320, 240, 100);
    paintSquare(rgba, 320, 243, 162, 48, 140);
    const luma = toLuma(rgba, 320, 240);
    const roi = { x: 240, y: 160, width: 48, height: 48 };
    assert.deepEqual(
      refineAnchor(luma, 320, 240, roi),
      refineAnchor(luma, 320, 240, roi),
    );
  });

  it("rejects bad inputs", () => {
    const luma = new Float32Array(320 * 240);
    assert.throws(
      () =>
        refineAnchor(new Float32Array(10), 320, 240, {
          x: 0,
          y: 0,
          width: 48,
          height: 48,
        }),
      EngineError,
    );
    assert.throws(
      () =>
        refineAnchor(luma, 320, 240, { x: 0, y: 0, width: 48, height: 48 }, -1),
      EngineError,
    );
  });

  it("exposes a small bounded search radius", () => {
    assert.ok(
      ANCHOR_SEARCH_RADIUS_PX <= 8,
      "search window must stay small",
    );
  });
});

// ---------- 4. validation tiers ----------

describe("validator", () => {
  it("assigns CONFIDENT above threshold", () => {
    const v = validateCandidate(scored({ score: CONFIDENT_SCORE_THRESHOLD }));
    assert.equal(v.tier, "CONFIDENT");
    assert.equal(v.note, undefined);
  });

  it("assigns UNCERTAIN with caution note in the middle band", () => {
    const v = validateCandidate(scored({ score: UNCERTAIN_SCORE_THRESHOLD }));
    assert.equal(v.tier, "UNCERTAIN");
    assert.equal(v.note, UNCERTAIN_NOTE);
  });

  it("assigns NONE below the uncertain cutoff", () => {
    const v = validateCandidate(
      scored({ score: UNCERTAIN_SCORE_THRESHOLD - 0.5 }),
    );
    assert.equal(v.tier, "NONE");
  });

  it("applies the refined (shifted) ROI", () => {
    const v = validateCandidate(scored({ dx: 3, dy: 2, score: 50 }));
    assert.deepEqual(v.roi, { x: 243, y: 162, width: 48, height: 48 });
  });

  it("rejects unknown profiles and escaped ROIs", () => {
    assert.throws(
      () =>
        validateCandidate(
          scored({
            profile: { id: "X", size: 64, rightMargin: 0, bottomMargin: 0 },
          }),
        ),
      (e: unknown) =>
        e instanceof EngineError && e.code === "UNSUPPORTED_PROFILE",
    );
    assert.throws(
      () => validateCandidate(scored({ dx: 500, score: 99 })),
      (e: unknown) =>
        e instanceof EngineError && e.code === "INVALID_GEOMETRY",
    );
    assert.throws(
      () => validateCandidate(scored({ score: NaN })),
      EngineError,
    );
  });

  it("gates restoration on CONFIDENT only", () => {
    assert.equal(
      assertRestorable(validateCandidate(scored({ score: 50 }))).tier,
      "CONFIDENT",
    );
    assert.equal(validateCandidate(scored({ score: 50 })).tier, "CONFIDENT");
    assert.throws(
      () =>
        assertRestorable(validateCandidate(scored({ score: 6 }))),
      (e: unknown) =>
        e instanceof EngineError && e.code === "NOT_VALIDATED",
    );
    assert.throws(
      () =>
        assertRestorable(validateCandidate(scored({ score: 0 }))),
      (e: unknown) =>
        e instanceof EngineError && e.code === "NOT_VALIDATED",
    );
  });
});

// ---------- 5-12. restoration ----------

describe("restoration", () => {
  it("recovers known originals (math correctness, RGB)", () => {
    const original = [10, 128, 250];
    const watermarked = composite(original, 255, 0.5);
    const data = new Uint8ClampedArray([...watermarked, 255]);
    const out = restoreRoi({
      data,
      width: 1,
      height: 1,
      alpha: uniformAlpha(1, 0.5),
      logo: 255,
    });
    for (let c = 0; c < 3; c++) {
      assert.ok(
        Math.abs(out.data[c] - original[c]) <= toleranceFor(0.5),
        `channel ${c}: got ${out.data[c]}, want ${original[c]}`,
      );
    }
    assert.equal(out.data[3], 255);
  });

  it("holds across multiple alpha values", () => {
    for (const a of [0, 0.15, 0.5, 0.9]) {
      const original = [30, 120, 220];
      const watermarked = composite(original, 200, a);
      const out = restoreRoi({
        data: new Uint8ClampedArray([...watermarked, 255]),
        width: 1,
        height: 1,
        alpha: uniformAlpha(1, a),
        logo: 200,
      });
      const tol = toleranceFor(a);
      for (let c = 0; c < 3; c++) {
        assert.ok(
          Math.abs(out.data[c] - original[c]) <= tol,
          `alpha ${a} ch${c}`,
        );
      }
    }
  });

  it("restores per-channel values independently", () => {
    const original = [0, 137, 255];
    const watermarked = composite(original, 100, 0.25);
    const out = restoreRoi({
      data: new Uint8ClampedArray([...watermarked, 200]),
      width: 1,
      height: 1,
      alpha: uniformAlpha(1, 0.25),
      logo: 100,
    });
    for (let c = 0; c < 3; c++) {
      assert.ok(Math.abs(out.data[c] - original[c]) <= 2, `ch${c}`);
    }
    assert.equal(out.data[3], 200);
  });

  it("stays finite at alpha-near-1 (passthrough, counted out)", () => {
    const out = restoreRoi({
      data: new Uint8ClampedArray([200, 200, 200, 255]),
      width: 1,
      height: 1,
      alpha: uniformAlpha(1, 1 - ALPHA_SAFETY_EPSILON / 2),
      logo: 255,
    });
    for (let c = 0; c < 4; c++) {
      assert.ok(Number.isFinite(out.data[c]));
      assert.ok(out.data[c] >= 0 && out.data[c] <= 255);
    }
    assert.equal(out.pixelsRestored, 0);
  });

  it("clamps negative recoveries to 0", () => {
    const out = restoreRoi({
      data: new Uint8ClampedArray([10, 10, 10, 255]),
      width: 1,
      height: 1,
      alpha: uniformAlpha(1, 0.9),
      logo: 255,
    });
    assert.deepEqual([out.data[0], out.data[1], out.data[2]], [0, 0, 0]);
  });

  it("clamps over-range recoveries to 255", () => {
    const out = restoreRoi({
      data: new Uint8ClampedArray([255, 255, 255, 255]),
      width: 1,
      height: 1,
      alpha: uniformAlpha(1, 0.9),
      logo: 0,
    });
    assert.deepEqual([out.data[0], out.data[1], out.data[2]], [255, 255, 255]);
  });

  it("never mutates the input and returns a separate buffer", () => {
    const data = new Uint8ClampedArray([150, 150, 150, 255]);
    const snapshot = Uint8ClampedArray.from(data);
    const out = restoreRoi({
      data,
      width: 1,
      height: 1,
      alpha: uniformAlpha(1, 0.5),
      logo: 255,
    });
    assert.deepEqual(data, snapshot);
    assert.notEqual(out.data, data);
    assert.equal(out.data.length, data.length);
  });

  it("keeps identical input/output dimensions", () => {
    const out = restoreRoi({
      data: flatRgba(4, 4, 100),
      width: 4,
      height: 4,
      alpha: uniformAlpha(4, 0.3),
      logo: 255,
    });
    assert.equal(out.width, 4);
    assert.equal(out.height, 4);
    assert.equal(out.data.length, 4 * 4 * 4);
    assert.equal(out.pixelsRestored, 16);
  });

  it("rejects invalid geometry and mismatched alpha", () => {
    const good = {
      data: flatRgba(2, 2, 100),
      width: 2,
      height: 2,
      alpha: uniformAlpha(2, 0.5),
      logo: 255,
    };
    assert.throws(() => restoreRoi({ ...good, width: 0 }), EngineError);
    assert.throws(
      () => restoreRoi({ ...good, data: flatRgba(3, 3, 100) }),
      EngineError,
    );
    assert.throws(
      () => restoreRoi({ ...good, alpha: uniformAlpha(4, 0.5) }),
      (e: unknown) => e instanceof EngineError && e.code === "ALPHA_MISMATCH",
    );
    assert.throws(
      () =>
        restoreRoi({
          ...good,
          alpha: { size: 2, data: new Float32Array([0.5, 2, 0.5, 0.5]) },
        }),
      (e: unknown) => e instanceof EngineError && e.code === "ALPHA_MISMATCH",
    );
    assert.throws(() => restoreRoi({ ...good, logo: 300 }), EngineError);
    assert.throws(() => restoreRoi({ ...good, logo: NaN }), EngineError);
  });
});

// ---------- 13-15. facade ----------

describe("engine facade", () => {
  function watermarkedSample(): { luma: Float32Array; width: number; height: number } {
    const rgba = flatRgba(320, 240, 100);
    paintSquare(rgba, 320, 240, 160, 48, 140);
    return { luma: toLuma(rgba, 320, 240), width: 320, height: 240 };
  }

  it("detects a watermarked frame end-to-end", () => {
    const result = detectFromSamples([watermarkedSample()]);
    assert.ok(result !== null);
    assert.equal(result.tier, "CONFIDENT");
    assert.equal(result.profileMatch.id, "B-48");
    assert.deepEqual(result.anchorOffset, { dx: 0, dy: 0 });
    assert.equal(result.framesSampled, 1);
    assert.ok(result.scores.length > 0);
  });

  it("returns null on clean frames (NO_WATERMARK)", () => {
    const rgba = flatRgba(320, 240, 100);
    const sample = { luma: toLuma(rgba, 320, 240), width: 320, height: 240 };
    assert.equal(detectFromSamples([sample]), null);
  });

  it("rejects empty or malformed sample sets", () => {
    assert.throws(() => detectFromSamples([]), EngineError);
    assert.throws(
      () =>
        detectFromSamples([{ luma: new Float32Array(5), width: 4, height: 4 }]),
      EngineError,
    );
  });

  it("refuses to restore anything but CONFIDENT", () => {
    const base = {
      data: flatRgba(48, 48, 140),
      width: 48,
      height: 48,
      alpha: uniformAlpha(48, 0.5),
      logo: 255,
    };
    assert.throws(
      () =>
        restoreValidated({
          ...base,
          validation: validateCandidate(scored({ score: 6 })),
        }),
      (e: unknown) => e instanceof EngineError && e.code === "NOT_VALIDATED",
    );
    assert.throws(
      () =>
        restoreValidated({
          ...base,
          validation: validateCandidate(scored({ score: 0 })),
        }),
      (e: unknown) => e instanceof EngineError && e.code === "NOT_VALIDATED",
    );
  });

  it("rejects requests disagreeing with the validation", () => {
    assert.throws(
      () =>
        restoreValidated({
          data: flatRgba(48, 48, 140),
          width: 47,
          height: 48,
          alpha: uniformAlpha(48, 0.5),
          logo: 255,
          validation: validateCandidate(scored({ score: 50 })),
        }),
      (e: unknown) =>
        e instanceof EngineError && e.code === "INVALID_GEOMETRY",
    );
  });

  it("restores a validated ROI without mutating input", () => {
    const data = flatRgba(48, 48, 140);
    const snapshot = Uint8ClampedArray.from(data);
    const out = restoreValidated({
      data,
      width: 48,
      height: 48,
      alpha: uniformAlpha(48, 0.5),
      logo: 255,
      validation: validateCandidate(scored({ score: 50 })),
    });
    assert.equal(out.width, 48);
    assert.equal(out.height, 48);
    assert.equal(out.pixelsRestored, 48 * 48);
    assert.deepEqual(data, snapshot);
  });
});
