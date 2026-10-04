// Phase 2 tests: media metadata (real synthetic MP4s through the real
// mediabunny demuxer) + capability probing (injected probe boundary).
// Fixtures are generated locally by ./fixtures.mjs — nothing copied.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeMp4 } from "./fixtures.mjs";
import {
  assembleMetadata,
  MediaProbeError,
  probeFile,
} from "../../src/lib/media/metadata.js";
import {
  checkCapabilities,
  defaultProbes,
  V1_PROBE_VIDEO,
} from "../../src/lib/media/capabilities.js";

function mp4File(
  name: string,
  opts?: Parameters<typeof makeMp4>[0],
): File {
  const buf = makeMp4(opts);
  return new File([new Uint8Array(buf)], name, {
    type: "video/mp4",
  });
}

describe("probeFile with real fixtures", () => {
  it("reads a valid landscape MP4", async () => {
    const meta = await probeFile(mp4File("clip.mp4"));
    assert.equal(meta.width, 320);
    assert.equal(meta.height, 240);
    assert.equal(meta.codec, "avc");
    assert.equal(meta.durationSec, 2);
    assert.equal(meta.fps, 30);
    assert.equal(meta.frameCountEstimate, 60);
    assert.equal(meta.hasAudio, false);
    assert.equal(meta.audioCodec, null);
    assert.ok(
      meta.container !== null && meta.container.includes("mp4"),
      `container: ${meta.container}`,
    );
    assert.ok(
      typeof meta.averageBitrateBps === "number" && meta.averageBitrateBps > 0,
    );
  });

  it("reads portrait dimensions without swapping", async () => {
    const meta = await probeFile(mp4File("portrait.mp4", { w: 240, h: 320 }));
    assert.equal(meta.width, 240);
    assert.equal(meta.height, 320);
  });

  it("detects present audio with codec", async () => {
    const meta = await probeFile(mp4File("with-audio.mp4", { audio: true }));
    assert.equal(meta.hasAudio, true);
    assert.equal(meta.audioCodec, "aac");
  });

  it("reports audio-less sources explicitly", async () => {
    const meta = await probeFile(mp4File("silent.mp4"));
    assert.equal(meta.hasAudio, false);
    assert.equal(meta.audioCodec, null);
  });

  it("rejects garbage bytes as unsupported container", async () => {
    const file = new File([new Uint8Array([0, 1, 2, 3, 4, 5])], "junk.mp4", {
      type: "video/mp4",
    });
    await assert.rejects(() => probeFile(file), (e: unknown) => {
      assert.ok(e instanceof MediaProbeError);
      assert.equal(e.code, "E-UNSUPPORTED-CONTAINER");
      assert.equal(e.fileName, "junk.mp4");
      return true;
    });
  });

  it("rejects empty files as unsupported container", async () => {
    const file = new File([], "empty.mp4", { type: "video/mp4" });
    await assert.rejects(() => probeFile(file), (e: unknown) => {
      assert.ok(e instanceof MediaProbeError);
      return true;
    });
  });
});

describe("assembleMetadata nullable rules", () => {
  const base = {
    width: 320,
    height: 240,
    codec: "avc",
    durationSec: 2,
    fps: 30,
    hasAudio: false,
    audioCodec: null,
    container: "video/mp4",
    fileSizeBytes: 8000,
    firstTimestampSec: 0,
  };

  it("nulls duration-dependent fields when duration is unknown", () => {
    const meta = assembleMetadata({ ...base, durationSec: null });
    assert.equal(meta.durationSec, null);
    assert.equal(meta.frameCountEstimate, null);
    assert.equal(meta.averageBitrateBps, null);
    assert.equal(meta.fps, 30);
  });

  it("nulls frame count when fps is unknown, keeps duration", () => {
    const meta = assembleMetadata({ ...base, fps: null });
    assert.equal(meta.fps, null);
    assert.equal(meta.durationSec, 2);
    assert.equal(meta.frameCountEstimate, null);
  });

  it("derives frame count and bitrate only from measured values", () => {
    const meta = assembleMetadata(base);
    assert.equal(meta.frameCountEstimate, 60);
    assert.equal(meta.averageBitrateBps, Math.round((8000 * 8) / 2));
  });

  it("rejects unusable dimensions instead of inventing them", () => {
    assert.throws(
      () => assembleMetadata({ ...base, width: null }),
      MediaProbeError,
    );
  });
});

describe("checkCapabilities", () => {
  const allTrue = {
    hasWorker: () => true,
    hasOffscreenCanvas: () => true,
    hasWorking2dContext: () => true,
    canEncodeAvc: async () => true,
  };

  it("reports full support on the positive path", async () => {
    const report = await checkCapabilities(allTrue);
    assert.deepEqual(report.missing, []);
    assert.equal(report.worker, true);
    assert.equal(report.avcEncode, true);
  });

  it("covers the OffscreenCanvas degraded path", async () => {
    const report = await checkCapabilities({
      ...allTrue,
      hasOffscreenCanvas: () => false,
    });
    assert.ok(report.missing.includes("offscreen-canvas"));
    assert.ok(
      report.degraded.includes("offscreen-canvas:main-thread-canvas-fallback"),
    );
  });

  it("maps total failure to missing capabilities", async () => {
    const report = await checkCapabilities({
      hasWorker: () => false,
      hasOffscreenCanvas: () => false,
      hasWorking2dContext: () => {
        throw new Error("no canvas");
      },
      canEncodeAvc: async () => {
        throw new Error("no encoder");
      },
    });
    assert.deepEqual(report.missing, [
      "worker",
      "offscreen-canvas",
      "canvas-2d",
      "avc-encode",
    ]);
  });

  it("probes the frozen V1 AVC configuration", async () => {
    let seen: unknown[] = [];
    await checkCapabilities({
      ...allTrue,
      canEncodeAvc: async (...args: unknown[]) => {
        seen = args;
        return true;
      },
    });
    assert.deepEqual(seen, [
      V1_PROBE_VIDEO.width,
      V1_PROBE_VIDEO.height,
      V1_PROBE_VIDEO.bitrateBps,
      V1_PROBE_VIDEO.frameRate,
    ]);
    assert.equal(V1_PROBE_VIDEO.bitrateBps, 12_000_000);
  });

  it("exposes the real default probes without UA sniffing", () => {
    const src =
      readFileSync(
        new URL(
          "../../src/lib/media/capabilities.ts",
          import.meta.url,
        ),
        "utf8",
      );
    assert.ok(!/userAgent/i.test(src), "no UA sniffing in capabilities");
    assert.ok(typeof defaultProbes.hasWorker === "function");
  });
});

describe("media module boundaries", () => {
  it("imports neither UI frameworks nor the watermark engine", () => {
    for (const name of ["metadata.ts", "capabilities.ts"]) {
      const src = readFileSync(
        new URL(`../../src/lib/media/${name}`, import.meta.url),
        "utf8",
      );
      assert.ok(!/from ["']react["']/.test(src), `${name}: no React`);
      assert.ok(!/from ["']next/.test(src), `${name}: no Next.js`);
      assert.ok(
        !/lib\/watermark|watermark\//.test(src),
        `${name}: no watermark imports`,
      );
      assert.ok(!/fetch\(|WebSocket|XMLHttpRequest/.test(src), `${name}: no network`);
    }
  });
});
