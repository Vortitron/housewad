// Doom sound effects through WebAudio.
//
// The engine hands over each effect as its raw DMX lump: a 8-byte header
// (format 3, sample rate, sample count) then 8-bit unsigned PCM with 16 bytes
// of padding at each end. Decoded buffers are cached per lump.

export class DoomSound {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.channels = new Map();
    this.master = null;
  }

  // Browsers only allow audio after a user gesture; call this from one.
  resume() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  close() {
    for (const ch of this.channels.values()) this._stopNode(ch);
    this.channels.clear();
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }

  decode(lump, bytes) {
    if (this.buffers.has(lump)) return this.buffers.get(lump);
    let buffer = null;
    if (bytes.length > 8 && bytes[0] === 3 && bytes[1] === 0) {
      const rate = bytes[2] | (bytes[3] << 8);
      const count = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16)) >>> 0;
      // Skip the 16 padding bytes at each end of the sample data.
      const start = 8 + 16;
      const length = Math.max(0, Math.min(count - 32, bytes.length - start - 16));
      if (length > 0 && rate > 0) {
        buffer = this.ctx.createBuffer(1, length, rate);
        const out = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) out[i] = (bytes[start + i] - 128) / 128;
      }
    }
    this.buffers.set(lump, buffer);
    return buffer;
  }

  start(lump, bytes, channel, vol, sep) {
    if (!this.ctx) return;
    this.stop(channel);
    const buffer = this.decode(lump, bytes);
    if (!buffer) return;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const gain = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    source.connect(gain);
    if (pan) {
      gain.connect(pan);
      pan.connect(this.master);
    } else {
      gain.connect(this.master);
    }
    const ch = { source, gain, pan, playing: true };
    source.onended = () => {
      ch.playing = false;
    };
    this.channels.set(channel, ch);
    this._apply(ch, vol, sep);
    source.start();
  }

  update(channel, vol, sep) {
    const ch = this.channels.get(channel);
    if (ch) this._apply(ch, vol, sep);
  }

  stop(channel) {
    const ch = this.channels.get(channel);
    if (!ch) return;
    this._stopNode(ch);
    this.channels.delete(channel);
  }

  playing(channel) {
    const ch = this.channels.get(channel);
    return !!(ch && ch.playing);
  }

  _apply(ch, vol, sep) {
    // Doom volume is 0..127; separation is 0..254 with 128 as centre.
    ch.gain.gain.value = Math.max(0, Math.min(1, vol / 127));
    if (ch.pan) ch.pan.pan.value = Math.max(-1, Math.min(1, (sep - 128) / 127));
  }

  _stopNode(ch) {
    try {
      ch.source.stop();
    } catch (e) {
      // Already stopped.
    }
    ch.playing = false;
  }
}
