// Local synthetic MP4 fixture generator (tests only).
// Builds minimal valid-structure MP4s by hand — no encoder, no copies.
function box(type, ...payloads) {
  const size = 8 + payloads.reduce((n, p) => n + p.length, 0);
  const out = Buffer.alloc(size);
  out.writeUInt32BE(size, 0);
  out.write(type, 4, 4, "ascii");
  let o = 8;
  for (const p of payloads) { p.copy(out, o); o += p.length; }
  return out;
}
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0, 0); return b; };
const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v, 0); return b; };
const full = (v, f) => Buffer.concat([Buffer.from([v, f >> 16 & 255, f >> 8 & 255, f & 255])]);

function mvhd(timescale, duration) {
  return box("mvhd", full(0, 0),
    u32(0), u32(0), u32(timescale), u32(duration),
    u32(0x00010000), u16(0x0100), u16(0), Buffer.alloc(8), (() => {
      const m = Buffer.alloc(36);
      m.writeUInt32BE(0x00010000, 0); m.writeUInt32BE(0x00010000, 12); m.writeUInt32BE(0x40000000, 24);
      return m;
    })(), Buffer.alloc(24), u32(3));
}
function tkhd(id, w, h) {
  const b = Buffer.concat([full(0, 3), u32(0), u32(0), u32(id), u32(0), u32(0),
    u32(0), u32(0), u16(0), u16(0), u16(0x0100), u16(0),
    (() => { const m = Buffer.alloc(36); m.writeUInt32BE(0x00010000, 0); m.writeUInt32BE(0x00010000, 12); m.writeUInt32BE(0x40000000, 24); return m; })(),
    u32(w << 16), u32(h << 16)]);
  return box("tkhd", b);
}
function mdhd(timescale, duration) {
  return box("mdhd", Buffer.concat([full(0, 0), u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0)]));
}
function hdlr(handler, name) {
  return box("hdlr", Buffer.concat([full(0, 0), u32(0), Buffer.from(handler, "ascii"), Buffer.alloc(12), Buffer.from(name + "\0", "ascii")]));
}
function dinf() {
  return box("dinf", box("dref", Buffer.concat([full(0, 0), u32(1), box("url ", full(0, 1))])));
}
function avcC() {
  // Minimal plausible AVCDecoderConfigurationRecord (baseline, level 3.0).
  return box("avcC", Buffer.from([0x01, 0x42, 0x00, 0x1e, 0xff, 0xe1, 0x00, 0x0d,
    0x67, 0x42, 0x00, 0x1e, 0x89, 0x8b, 0x60, 0x28, 0x02, 0xdd, 0x80, 0x01, 0x00, 0x04,
    0x68, 0xce, 0x38, 0x80]));
}
function avc1(w, h) {
  return box("avc1", Buffer.concat([Buffer.alloc(6), u16(1), Buffer.alloc(16), u16(w), u16(h),
    u32(0x00480000), u32(0x00480000), u32(0), u16(1), Buffer.alloc(32), u16(0x0018), u16(0xffff), avcC()]));
}
function mp4a() {
  const esds = box("esds", Buffer.concat([full(0, 0), Buffer.from([
    0x03, 0x19, 0x00, 0x00, 0x00, 0x04, 0x11, 0x40, 0x15, 0x00, 0x06, 0x00,
    0x00, 0x00, 0xda, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x05, 0x02, 0x12, 0x10, 0x06, 0x01, 0x02])]));
  return box("mp4a", Buffer.concat([Buffer.alloc(6), u16(1), Buffer.alloc(8), u16(2), u16(16), u32(0),
    u32(44100 << 16), esds]));
}
function stbl(sampleEntry, sampleCount, sampleDelta, sampleSize, timescaleUnused) {
  void timescaleUnused;
  const sizes = Buffer.alloc(4 * sampleCount).fill(0);
  for (let i = 0; i < sampleCount; i++) sizes.writeUInt32BE(sampleSize, i * 4);
  return box("stbl",
    box("stsd", Buffer.concat([full(0, 0), u32(1), sampleEntry])),
    box("stts", Buffer.concat([full(0, 0), u32(1), u32(sampleCount), u32(sampleDelta)])),
    box("stsc", Buffer.concat([full(0, 0), u32(1), u32(1), u32(sampleCount), u32(1)])),
    box("stsz", Buffer.concat([full(0, 0), u32(0), u32(sampleCount), sizes])),
    box("stco", Buffer.concat([full(0, 0), u32(1), u32(0)]))); // offset patched later
}
function videoTrak(w, h, frames, timescale) {
  return box("trak", tkhd(1, w, h),
    box("mdia", mdhd(timescale, frames), hdlr("vide", "VideoHandler"),
      box("minf", box("vmhd", Buffer.concat([full(0, 1), u16(0), u16(0), u16(0), u16(0)])),
        dinf(), stbl(avc1(w, h), frames, 1, 64, 0))));
}
function audioTrak(frames) {
  return box("trak", tkhd(2, 0, 0),
    box("mdia", mdhd(44100, frames * 1024), hdlr("soun", "SoundHandler"),
      box("minf", box("smhd", Buffer.concat([full(0, 0), u16(0), u16(0)])),
        dinf(), stbl(mp4a(), frames, 1024, 32, 0))));
}
export function makeMp4({ w = 320, h = 240, frames = 60, timescale = 30, audio = false, durationMs = 2000 } = {}) {
  const traks = [videoTrak(w, h, frames, timescale)];
  if (audio) traks.push(audioTrak(frames));
  const moov = box("moov", mvhd(1000, durationMs), ...traks);
  // mdat: fake payload sized to stsz tables (video 64B + audio 32B per frame).
  const perFrame = 64 + (audio ? 32 : 0);
  const mdat = box("mdat", Buffer.alloc(frames * perFrame));
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("isom"), u32(0), Buffer.from("isommp41")]));
  const file = Buffer.concat([ftyp, moov, mdat]);
  // Patch stco chunk offsets: mdat payload starts at ftyp+moov+8.
  const mdatData = ftyp.length + moov.length + 8;
  let vOffset = mdatData, aOffset = mdatData + frames * 64;
  // Walk moov to find stco boxes in order (video first, then audio).
  let searchFrom = 0, found = 0;
  const moovBuf = file.subarray(ftyp.length, ftyp.length + moov.length);
  for (let i = 0; i < moovBuf.length - 4; i++) {
    if (moovBuf.toString("ascii", i, i + 4) === "stco") {
      const offPos = ftyp.length + i + 12;
      file.writeUInt32BE(found === 0 ? vOffset : aOffset, offPos);
      found++;
      if (found === (audio ? 2 : 1)) break;
    }
  }
  return file;
}
