// Phase 3 facade-contract tests: the stable interface later phases depend
// on. Fixtures are generated locally; no external references.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  detectFromSamples,
  NO_WATERMARK_FOUND_CODE,
  requireDetection,
  restoreValidated,
} from "../../src/lib/watermark/engine.js";
import { toLuma } from "../../src/lib/watermark/anchor-search.js";
import { validateCandidate } from "../../src/lib/watermark/validator.js";
import { EngineError } from "../../src/lib/watermark/types.js";
import type { AlphaMap } from "../../src/lib/watermark/types.js";

function uniformAlpha(size: number, a: number): AlphaMap {
  return { size, data: new Float32Array(size * size).fill(a) };
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

function sampleWithSquare(bg: number, square: number | null) {
  const rgba = flatRgba(320, 240, bg);
  if (square !== null) paintSquare(rgba, 320, 240, 160, 48, square);
  return { luma: toLuma(rgba, 320, 240), width: 320, height: 240 };
}

describe("facade tier mapping", () => {
  it("passes CONFIDENT results through with full shape", () => {
    const result = detectFromSamples([sampleWithSquare(100, 140)]);
    assert.ok(result !== null);
    assert.equal(result.tier, "CONFIDENT");
    assert.equal(result.profileMatch.id, "B-48");
    assert.deepEqual(result.anchorOffset, { dx: 0, dy: 0 });
    assert.equal(result.framesSampled, 1);
    assert.ok(result.scores.length > 0);
  });

  it("surfaces UNCERTAIN results with the caution note", () => {
    const result = detectFromSamples([sampleWithSquare(100, 106)]);
    assert.ok(result !== null);
    assert.equal(result.tier, "UNCERTAIN");
    assert.ok(
      typeof result.note === "string" && result.note.length > 0,
      "uncertain results carry a review note",
    );
  });

  it("returns null below evidence thresholds", () => {
    assert.equal(detectFromSamples([sampleWithSquare(100, null)]), null);
  });
});

describe("E-NO-WATERMARK-FOUND mapping", () => {
  it("exposes the stable pipeline code", () => {
    assert.equal(NO_WATERMARK_FOUND_CODE, "E-NO-WATERMARK-FOUND");
  });

  it("converts null detections to the coded error", () => {
    assert.throws(
      () => requireDetection(null, "clip.mp4"),
      (e: unknown) => {
        assert.ok(e instanceof EngineError);
        assert.equal(e.code, "E-NO-WATERMARK-FOUND");
        assert.ok(e.message.includes("clip.mp4"));
        return true;
      },
    );
  });

  it("passes real detections through untouched", () => {
    const result = detectFromSamples([sampleWithSquare(100, 140)]);
    assert.equal(requireDetection(result, "clip.mp4"), result);
  });
});

describe("facade restore contract", () => {
  it("restores with identical dims and no input mutation", () => {
    const detection = detectFromSamples([sampleWithSquare(100, 140)]);
    assert.ok(detection !== null && detection.tier === "CONFIDENT");
    const data = flatRgba(48, 48, 140);
    const snapshot = Uint8ClampedArray.from(data);
    const validated = validateCandidate({
      profile: detection.profileMatch,
      roi: { x: 240, y: 160, width: 48, height: 48 },
      dx: detection.anchorOffset.dx,
      dy: detection.anchorOffset.dy,
      score: Math.max(...detection.scores),
      frameWidth: 320,
      frameHeight: 240,
    });
    const out = restoreValidated({
      data,
      width: 48,
      height: 48,
      alpha: uniformAlpha(48, 0.5),
      logo: 255,
      validation: validated,
    });
    assert.equal(out.width, 48);
    assert.equal(out.height, 48);
    assert.equal(out.data.length, data.length);
    assert.deepEqual(data, snapshot);
  });

  it("refuses UNCERTAIN evidence at the facade boundary", () => {
    const detection = detectFromSamples([sampleWithSquare(100, 106)]);
    assert.ok(detection !== null && detection.tier === "UNCERTAIN");
    const validated = validateCandidate({
      profile: detection.profileMatch,
      roi: { x: 240, y: 160, width: 48, height: 48 },
      dx: detection.anchorOffset.dx,
      dy: detection.anchorOffset.dy,
      score: Math.max(...detection.scores),
      frameWidth: 320,
      frameHeight: 240,
    });
    assert.throws(
      () =>
        restoreValidated({
          data: flatRgba(48, 48, 140),
          width: 48,
          height: 48,
          alpha: uniformAlpha(48, 0.5),
          logo: 255,
          validation: validated,
        }),
      (e: unknown) =>
        e instanceof EngineError && e.code === "NOT_VALIDATED",
    );
  });
});

describe("facade isolation", () => {
  it("engine.ts depends only on watermark internals plus shared types", () => {
    const src = readFileSync(
      new URL("../../src/lib/watermark/engine.ts", import.meta.url),
      "utf8",
    );
    const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map(
      (m) => m[1],
    );
    assert.ok(imports.length > 0);
    for (const spec of imports) {
      assert.ok(
        spec.startsWith("./") || spec.startsWith("../../types/"),
        `unexpected engine dependency: ${spec}`,
      );
    }
    assert.ok(!/from ["'](react|next|mediabunny)/.test(src));
  });

  it("project detection types are dependency-free", () => {
    const src = readFileSync(
      new URL("../../src/types/detection.ts", import.meta.url),
      "utf8",
    );
    assert.ok(!/^\s*import\s/m.test(src), "contract types import nothing");
  });
});
