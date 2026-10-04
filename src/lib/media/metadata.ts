// Client-side media probing (mediabunny demux only — no decode, no encode).
// Framework-free: no React/Next/DOM imports, no watermark-engine imports.
import { ALL_FORMATS, BlobSource, Input } from "mediabunny";
import type { VideoMetadata } from "../../types/media.js";

/**
 * Reuses the LLD ProcessingError taxonomy (docs/LLD.md §1) — no new codes:
 * unrecognizable/missing video content → E-UNSUPPORTED-CONTAINER,
 * mid-probe decode failure → E-DECODE-FAIL.
 */
export type MediaProbeErrorCode =
  | "E-UNSUPPORTED-CONTAINER"
  | "E-UNSUPPORTED-CODEC"
  | "E-DECODE-FAIL";

export class MediaProbeError extends Error {
  readonly code: MediaProbeErrorCode;
  readonly fileName: string;
  constructor(code: MediaProbeErrorCode, fileName: string, reason: string) {
    super(`${fileName} — ${reason}`);
    this.name = "MediaProbeError";
    this.code = code;
    this.fileName = fileName;
  }
}

/** Raw measured parts before nullable rules are applied (see assembleMetadata). */
export interface MeasuredParts {
  width: number | null;
  height: number | null;
  codec: string | null;
  durationSec: number | null;
  fps: number | null;
  hasAudio: boolean;
  audioCodec: string | null;
  container: string | null;
  fileSizeBytes: number;
  firstTimestampSec: number;
}

function positiveOrNull(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

/**
 * Apply the nullable rules. Frame count is derived ONLY from measured
 * duration × measured fps — never from an assumed FPS. Bitrate only from
 * measured size ÷ measured duration.
 */
export function assembleMetadata(parts: MeasuredParts): VideoMetadata {
  const width = parts.width;
  const height = parts.height;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new MediaProbeError(
      "E-DECODE-FAIL",
      "media",
      "usable video dimensions could not be determined",
    );
  }
  const durationSec = positiveOrNull(parts.durationSec);
  const fps = positiveOrNull(parts.fps);
  const frameCountEstimate =
    durationSec !== null && fps !== null
      ? Math.max(1, Math.round(durationSec * fps))
      : null;
  const averageBitrateBps =
    durationSec !== null && parts.fileSizeBytes > 0
      ? Math.round((parts.fileSizeBytes * 8) / durationSec)
      : null;
  return {
    width,
    height,
    codec: parts.codec,
    durationSec,
    fps,
    frameCountEstimate,
    averageBitrateBps,
    hasAudio: parts.hasAudio,
    audioCodec: parts.audioCodec,
    container: parts.container,
    firstTimestampSec: Number.isFinite(parts.firstTimestampSec)
      ? parts.firstTimestampSec
      : 0,
  };
}

/**
 * Probe a local File for metadata. Reads container/track headers only;
 * never decodes frames. Throws MediaProbeError with an LLD error code.
 */
export async function probeFile(file: File): Promise<VideoMetadata> {
  let input: Input;
  try {
    input = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });
  } catch {
    throw new MediaProbeError(
      "E-UNSUPPORTED-CONTAINER",
      file.name,
      "container not recognized; use MP4, MOV, or WebM",
    );
  }
  try {
    let videoTrack = null;
    try {
      videoTrack = await input.getPrimaryVideoTrack();
    } catch {
      videoTrack = null;
    }
    if (videoTrack === null) {
      throw new MediaProbeError(
        "E-UNSUPPORTED-CONTAINER",
        file.name,
        "no video track found",
      );
    }
    const track = videoTrack;
    const [width, height] = await Promise.all([
      track.getDisplayWidth().catch(() => null),
      track.getDisplayHeight().catch(() => null),
    ]);
    const codec = await track.getCodec().catch(() => null);
    const firstTimestampSec = await input
      .getFirstTimestamp([track])
      .catch(() => 0);
    let durationSec = await input
      .getDurationFromMetadata([track], { skipLiveWait: true })
      .catch(() => null);
    if (!(typeof durationSec === "number" && durationSec > 0)) {
      durationSec = await track.computeDuration().catch(() => null);
    }
    const metrics = await track.computeFrameRateMetrics().catch(() => null);
    const fps =
      metrics?.underlyingFrameRate ?? metrics?.bestGuessFrameRate ?? null;
    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    const audioCodec = audioTrack
      ? await audioTrack.getCodec().catch(() => null)
      : null;
    const container = await input.getMimeType().catch(() => null);
    return assembleMetadata({
      width,
      height,
      codec,
      durationSec,
      fps,
      hasAudio: audioTrack !== null,
      audioCodec,
      container,
      fileSizeBytes: file.size,
      firstTimestampSec,
    });
  } catch (error) {
    if (error instanceof MediaProbeError) throw error;
    const name = (error as { name?: string })?.name;
    if (name === "UnsupportedInputFormatError") {
      throw new MediaProbeError(
        "E-UNSUPPORTED-CONTAINER",
        file.name,
        "container not recognized; use MP4, MOV, or WebM",
      );
    }
    throw new MediaProbeError(
      "E-DECODE-FAIL",
      file.name,
      "media could not be read",
    );
  } finally {
    input.dispose();
  }
}
