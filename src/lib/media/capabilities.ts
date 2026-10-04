// Runtime capability probing. No user-agent sniffing: every capability is
// measured with a real API call. Probes are injectable so tests can drive
// every combination without a browser harness.
// Framework-free: no React/Next/DOM-at-import-time, no watermark imports.
import { canEncodeVideo } from "mediabunny";

/** Frozen V1 export profile, mirrored here for the probe (see plan F4). */
export const V1_PROBE_VIDEO = {
  codec: "avc",
  width: 1280,
  height: 720,
  bitrateBps: 12_000_000,
  frameRate: 30,
} as const;

export interface CapabilityProbes {
  hasWorker: () => boolean;
  hasOffscreenCanvas: () => boolean;
  hasWorking2dContext: () => boolean;
  canEncodeAvc: (
    width: number,
    height: number,
    bitrateBps: number,
    frameRate: number,
  ) => Promise<boolean>;
}

export interface CapabilityReport {
  worker: boolean;
  offscreenCanvas: boolean;
  canvas2d: boolean;
  avcEncode: boolean;
  /** Capability keys that failed, e.g. ["avc-encode"]. */
  missing: string[];
  /** Degraded-but-usable notes, e.g. main-thread canvas fallback. */
  degraded: string[];
  /**
   * The AVC probe is necessary but not sufficient: it answers whether the
   * browser encodes this configuration, not whether a full export succeeds.
   */
  note: string;
}

function safeBoolean(fn: () => boolean): boolean {
  try {
    return fn() === true;
  } catch {
    return false;
  }
}

export const defaultProbes: CapabilityProbes = {
  hasWorker: () => typeof Worker !== "undefined",
  hasOffscreenCanvas: () => typeof OffscreenCanvas !== "undefined",
  hasWorking2dContext: () => {
    try {
      if (typeof OffscreenCanvas !== "undefined") {
        const canvas = new OffscreenCanvas(2, 2);
        return canvas.getContext("2d") !== null;
      }
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = 2;
        canvas.height = 2;
        return canvas.getContext("2d") !== null;
      }
      return false;
    } catch {
      return false;
    }
  },
  canEncodeAvc: async (width, height, bitrateBps, frameRate) => {
    try {
      return (
        (await canEncodeVideo("avc", {
          width,
          height,
          bitrate: bitrateBps,
          frameRate,
          latencyMode: "quality",
          bitrateMode: "constant",
          hardwareAcceleration: "no-preference",
        })) === true
      );
    } catch {
      return false;
    }
  },
};

export async function checkCapabilities(
  probes: CapabilityProbes = defaultProbes,
): Promise<CapabilityReport> {
  const worker = safeBoolean(probes.hasWorker);
  const offscreenCanvas = safeBoolean(probes.hasOffscreenCanvas);
  const canvas2d = safeBoolean(probes.hasWorking2dContext);
  let avcEncode = false;
  try {
    avcEncode =
      (await probes.canEncodeAvc(
        V1_PROBE_VIDEO.width,
        V1_PROBE_VIDEO.height,
        V1_PROBE_VIDEO.bitrateBps,
        V1_PROBE_VIDEO.frameRate,
      )) === true;
  } catch {
    avcEncode = false;
  }
  const missing: string[] = [];
  if (!worker) missing.push("worker");
  if (!offscreenCanvas) missing.push("offscreen-canvas");
  if (!canvas2d) missing.push("canvas-2d");
  if (!avcEncode) missing.push("avc-encode");
  const degraded: string[] = [];
  if (!offscreenCanvas && canvas2d) {
    degraded.push("offscreen-canvas:main-thread-canvas-fallback");
  }
  return {
    worker,
    offscreenCanvas,
    canvas2d,
    avcEncode,
    missing,
    degraded,
    note: "AVC probe tests the frozen V1 configuration (MP4/H.264, 12 Mbps, BT.709-compatible, 2 s keyframes); a pass is necessary but does not guarantee a full export succeeds.",
  };
}
