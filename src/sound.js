// 効果音(WebAudioで合成。音声ファイルは使わない)

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.last = {};
  }

  // ブラウザの制限で、タップなどの操作の中で一度呼ぶ必要がある
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
  }

  tone(key, freq, dur, type = 'square', vol = 0.06, slide = 0) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.last[key] && now - this.last[key] < 0.035) return;
    this.last[key] = now;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * slide), now + dur);
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(this.ctx.destination);
    o.start(now);
    o.stop(now + dur + 0.02);
  }

  noise(dur, vol = 0.12) {
    if (!this.enabled || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (this.last.noise && now - this.last.noise < 0.08) return;
    this.last.noise = now;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = this.ctx.createBufferSource();
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.buffer = buf;
    src.connect(g).connect(this.ctx.destination);
    src.start(now);
  }

  play(events) {
    for (const e of events) {
      if (e.type === 'hit') {
        if (e.kind === 'poison' || e.kind === 'burn') this.tone('dot', 220, 0.05, 'sine', 0.03);
        else this.tone('hit', 300 + Math.min(600, e.amount * 40) + Math.random() * 80, 0.08, 'square', 0.05, 0.5);
      } else if (e.type === 'parry' || e.type === 'block') {
        this.tone('parry', 1400, 0.09, 'triangle', 0.07, 0.7);
      } else if (e.type === 'zap') {
        // ゴロゴロ: 低いノイズ + 鋭い高音
        this.noise(e.big === false ? 0.2 : 0.45, e.big === false ? 0.1 : 0.18);
        this.tone('zap', 2200, 0.15, 'sawtooth', 0.05, 0.1);
        this.tone('zapLow', 90, 0.35, 'square', 0.06, 0.5);
      } else if (e.type === 'laser') {
        this.tone('laser', 1400, 0.3, 'sawtooth', 0.06, 0.3);
      } else if (e.type === 'burst') {
        this.noise(0.2, 0.08);
        this.tone('burst', 900 + Math.random() * 500, 0.15, 'triangle', 0.04, 1.6);
      } else if (e.type === 'quake') {
        this.noise(0.35, 0.16);
        this.tone('quake', 60, 0.4, 'square', 0.07, 0.6);
      } else if (e.type === 'rebirth') {
        [392, 523, 659, 784].forEach((f, i) => setTimeout(() => this.tone('reb' + i, f, 0.16, 'triangle', 0.06), i * 70));
      } else if (e.type === 'prism') {
        this.tone('prism', 1700, 0.25, 'sawtooth', 0.05, 0.4);
      } else if (e.type === 'timestop') {
        this.tone('tick', 1800, 0.05, 'square', 0.05);
        setTimeout(() => this.tone('tock', 1200, 0.05, 'square', 0.05), 120);
      } else if (e.type === 'slam') {
        this.noise(0.25, 0.14);
        this.tone('slam', 120, 0.2, 'square', 0.08, 0.5);
      } else if (e.type === 'roll') {
        this.tone('roll', 400 + e.value * 40, 0.1, 'triangle', 0.05, 1.3);
      } else if (e.type === 'boom') {
        this.noise(0.3);
      } else if (e.type === 'heal') {
        this.tone('heal', 660, 0.12, 'sine', 0.05, 1.5);
      } else if (e.type === 'end') {
        this.noise(0.5, 0.2);
        this.tone('ko', 80, 0.5, 'square', 0.08, 0.4);
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone('end' + i, f, 0.18, 'square', 0.05), i * 110));
      }
    }
  }
}
