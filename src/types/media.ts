// Media-layer shared types (see docs/LLD.md §1).
// Superset note: `container` extends the LLD shape with the measured
// container MIME where available; all other fields match LLD exactly.

export interface VideoMetadata {
  width: number;
  height: number;
  codec: string | null;
  durationSec: number | null;
  fps: number | null;
  frameCountEstimate: number | null;
  averageBitrateBps: number | null;
  hasAudio: boolean;
  audioCodec: string | null;
  container: string | null;
  firstTimestampSec: number;
}

export interface AudioMetadata {
  present: boolean;
  codec: string | null;
  copied: boolean;
  packetCount: number;
  skipReason:
    | "none"
    | "no-audio-track"
    | "unsupported-audio-codec"
    | "no-audio-packets"
    | "disabled";
}
