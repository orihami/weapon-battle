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
      } else if (e.type === 'boom') {
        this.noise(0.3);
      } else if (e.type === 'heal') {
        this.tone('heal', 660, 0.12, 'sine', 0.05, 1.5);
      } else if (e.type === 'end') {
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone('end' + i, f, 0.18, 'square', 0.05), i * 110));
      }
    }
  }
}
