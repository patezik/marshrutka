// Весь звук синтезируется WebAudio — без файлов.

class Sfx {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  private engOsc: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engGain: GainNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  muted = false;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, when = 0, glide = 0) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
    this.env(g, t, 0.005, vol, dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, when = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, 0.01, vol, dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  coin() {
    const f = 2400 + Math.random() * 900;
    this.tone(f, 0.12, 'sine', 0.18);
    this.tone(f * 1.48, 0.09, 'sine', 0.09, 0.025);
  }
  bill() { this.noise(0.12, 0.35, 3200, 0.8); }
  click() { this.tone(900, 0.04, 'square', 0.05); }
  ding() {
    this.tone(1320, 0.5, 'sine', 0.2);
    this.tone(1760, 0.4, 'sine', 0.08, 0.01);
  }
  door() {
    this.noise(0.45, 0.25, 900, 0.5);
    this.tone(180, 0.15, 'triangle', 0.08, 0.35);
  }
  thud() {
    this.tone(120, 0.18, 'sine', 0.35, 0, 0.5);
    this.noise(0.12, 0.2, 400, 0.7);
  }
  flash() {
    this.tone(3000, 0.05, 'square', 0.06);
    this.noise(0.25, 0.25, 6000, 0.5, 0.03);
  }
  horn() {
    this.tone(330, 0.35, 'sawtooth', 0.08);
    this.tone(415, 0.35, 'sawtooth', 0.06);
  }
  kaching() {
    [1046, 1318, 1568, 2093].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.07));
    this.noise(0.2, 0.15, 5000, 1, 0.3);
  }
  sad() {
    this.tone(392, 0.25, 'triangle', 0.12);
    this.tone(311, 0.4, 'triangle', 0.12, 0.2);
  }
  happy() {
    this.tone(784, 0.12, 'triangle', 0.1);
    this.tone(1046, 0.18, 'triangle', 0.1, 0.09);
  }

  /** Неразборчивое бормотание пассажира. mood 0 — злое, 1 — довольное. */
  mumble(mood = 0.5, kid = false, n = 0) {
    if (!this.ctx || !this.master) return;
    const syll = n || 3 + Math.floor(Math.random() * 4);
    const base = (kid ? 420 : 170 + Math.random() * 120) * (mood < 0.3 ? 0.9 : 1);
    for (let i = 0; i < syll; i++) {
      const t = this.ctx.currentTime + i * (mood < 0.3 ? 0.075 : 0.105);
      const o = this.ctx.createOscillator();
      const f = this.ctx.createBiquadFilter();
      const g = this.ctx.createGain();
      o.type = 'sawtooth';
      const p = base * (0.85 + Math.random() * 0.4) * (mood > 0.7 && i === syll - 1 ? 1.3 : 1);
      o.frequency.setValueAtTime(p, t);
      o.frequency.linearRampToValueAtTime(p * (0.9 + Math.random() * 0.25), t + 0.08);
      f.type = 'bandpass';
      f.frequency.value = 600 + Math.random() * 1400;
      f.Q.value = 4;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(mood < 0.3 ? 0.22 : 0.14, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      o.connect(f).connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  engineStart() {
    if (!this.ctx || !this.master || this.engOsc) return;
    this.engOsc = this.ctx.createOscillator();
    this.engOsc2 = this.ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc2.type = 'square';
    this.engFilter = this.ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 300;
    this.engGain = this.ctx.createGain();
    this.engGain.gain.value = 0.0;
    this.engOsc.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.engOsc.start();
    this.engOsc2.start();
  }

  engine(speed01: number, throttle: number) {
    if (!this.ctx || !this.engOsc || !this.engOsc2 || !this.engGain || !this.engFilter) return;
    const t = this.ctx.currentTime;
    const f = 38 + speed01 * 70 + throttle * 18;
    this.engOsc.frequency.setTargetAtTime(f, t, 0.08);
    this.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(220 + throttle * 500 + speed01 * 300, t, 0.1);
    this.engGain.gain.setTargetAtTime(0.06 + throttle * 0.07, t, 0.1);
  }

  engineStop() {
    if (!this.ctx) return;
    try {
      this.engOsc?.stop();
      this.engOsc2?.stop();
    } catch { /* уже остановлен */ }
    this.engOsc = this.engOsc2 = null;
    this.engGain = null;
    this.engFilter = null;
  }
}

export const sfx = new Sfx();
