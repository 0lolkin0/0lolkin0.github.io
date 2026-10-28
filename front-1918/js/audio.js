// Звук: всё синтезируется на лету через Web Audio — никаких чужих записей
const SHOTS = {
  smg: { dur: 0.09, f: 2200, boom: 140, bd: 0.07, g: 0.45, echo: 0.25 },
  rifle: { dur: 0.22, f: 1500, boom: 95, bd: 0.12, g: 0.8, echo: 0.35 },
  lmg: { dur: 0.13, f: 1700, boom: 110, bd: 0.09, g: 0.55, echo: 0.3 },
  sniper: { dur: 0.38, f: 1300, boom: 75, bd: 0.16, g: 1.0, echo: 0.45 },
  cannon: { dur: 0.9, f: 700, boom: 48, bd: 0.5, g: 1.4, echo: 0.6 },
  mg: { dur: 0.1, f: 1900, boom: 120, bd: 0.07, g: 0.5, echo: 0.25 },
  aa: { dur: 0.1, f: 1700, boom: 110, bd: 0.07, g: 0.35, echo: 0.2 },
};

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.lx = 0; this.ly = 0; this.lz = 0; this.lyaw = 0;
    this.voices = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(this.lp);
    this.lp.connect(comp);
    comp.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // Коричневый шум для ветра и гула
    this.brown = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; b[i] = last * 3.5; }
    this.startAmbient();
  }
  get t() { return this.ctx.currentTime; }
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  suspend(on) { if (!this.ctx) return; if (on) this.ctx.suspend(); else this.ctx.resume(); }
  setListener(x, y, z, yaw) { this.lx = x; this.ly = y; this.lz = z; this.lyaw = yaw; }
  spatial(x, y, z) {
    const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rx = Math.cos(this.lyaw), rz = -Math.sin(this.lyaw);
    const pan = d > 0.5 ? Math.max(-1, Math.min(1, ((dx * rx + dz * rz) / d) * 0.85)) : 0;
    return { d, pan };
  }
  out(pan) {
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      p.connect(this.master);
      return p;
    }
    return this.master;
  }
  noiseBurst(dest, t0, dur, freq, gain, type = 'lowpass', q = 0.7, buf = this.noise, endFreq = 0) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * Math.max(0, 1.9 - dur), dur + 0.05);
    this.voices++;
    src.onended = () => { this.voices--; };
  }
  tone(dest, t0, dur, f0, f1, gain, type = 'sine') {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  shot(type, x, y, z, own = false) {
    if (!this.ctx) return;
    const s = SHOTS[type] || SHOTS.rifle;
    const { d, pan } = own ? { d: 0, pan: 0 } : this.spatial(x, y, z);
    if (d > 320 || (!own && this.voices > 40)) return;
    const att = own ? 1 : 1 / Math.pow(1 + d / 14, 1.15);
    const g = s.g * att;
    if (g < 0.004) return;
    const t0 = this.t;
    const dest = this.out(pan);
    const lp = s.f / (1 + d / 45);
    this.noiseBurst(dest, t0, s.dur * (1 + d / 120), Math.max(220, lp), g, 'lowpass', 0.8);
    if (d < 90) this.tone(dest, t0, s.bd, s.boom, s.boom * 0.45, g * 0.9);
    if (d > 35 || type === 'sniper' || type === 'cannon') {
      this.noiseBurst(dest, t0 + 0.18 + Math.min(0.5, d / 400), s.dur * 2.2, Math.max(180, lp * 0.5), g * s.echo, 'lowpass', 0.5);
    }
  }
  explosion(x, y, z, big = 1) {
    if (!this.ctx) return;
    const { d, pan } = this.spatial(x, y, z);
    if (d > 400) return;
    const att = 1 / Math.pow(1 + d / 20, 1.1);
    const t0 = this.t + Math.min(0.6, d / 340);
    const dest = this.out(pan);
    this.noiseBurst(dest, t0, 1.4 * big, 1100 / (1 + d / 80), 1.3 * att * big, 'lowpass', 0.7, this.noise, 160);
    this.tone(dest, t0, 0.7, 62, 28, 1.1 * att * big);
    this.noiseBurst(dest, t0 + 0.25, 1.6, 300, 0.4 * att, 'lowpass', 0.4, this.brown);
    if (d < 11) this.deafen(1.6 + (11 - d) * 0.15);
  }
  distantArtillery() {
    if (!this.ctx) return;
    const t0 = this.t;
    const dest = this.out(Math.random() * 2 - 1);
    const g = 0.06 + Math.random() * 0.08;
    this.noiseBurst(dest, t0, 2.2, 260, g, 'lowpass', 0.6, this.brown);
    this.tone(dest, t0, 1.0, 45, 25, g * 1.6);
  }
  deafen(sec) {
    if (!this.ctx) return;
    const t0 = this.t, f = this.lp.frequency;
    f.cancelScheduledValues(t0);
    f.setValueAtTime(500, t0);
    f.exponentialRampToValueAtTime(20000, t0 + sec);
    this.tone(this.master, t0, sec * 0.8, 3200, 3000, 0.05);
  }
  whiz(pan) {
    if (!this.ctx) return;
    const dest = this.out(pan);
    this.noiseBurst(dest, this.t, 0.14, 3200, 0.28, 'bandpass', 3, this.noise, 1400);
  }
  hit(kind) {
    if (!this.ctx) return;
    const t0 = this.t;
    if (kind === 'kill') {
      this.tone(this.master, t0, 0.08, 980, 980, 0.18, 'triangle');
      this.tone(this.master, t0 + 0.07, 0.12, 1470, 1470, 0.16, 'triangle');
    } else if (kind === 'head') {
      this.tone(this.master, t0, 0.09, 2600, 2400, 0.16, 'square');
    } else {
      this.tone(this.master, t0, 0.035, 1700, 1500, 0.1, 'square');
    }
  }
  hurt() {
    if (!this.ctx) return;
    this.tone(this.master, this.t, 0.18, 120, 60, 0.35);
    this.noiseBurst(this.master, this.t, 0.12, 900, 0.18);
  }
  reload(dur) {
    if (!this.ctx) return;
    const t0 = this.t;
    for (const [k, f] of [[0.05, 2400], [0.45, 1800], [0.85, 2800]]) {
      this.noiseBurst(this.master, t0 + dur * k, 0.05, f, 0.16, 'bandpass', 2);
      this.tone(this.master, t0 + dur * k, 0.04, 900, 700, 0.06, 'square');
    }
  }
  bolt() {
    if (!this.ctx) return;
    const t0 = this.t + 0.35;
    this.noiseBurst(this.master, t0, 0.06, 2600, 0.15, 'bandpass', 2);
    this.noiseBurst(this.master, t0 + 0.3, 0.06, 1900, 0.15, 'bandpass', 2);
  }
  empty() { if (this.ctx) this.tone(this.master, this.t, 0.04, 1200, 1000, 0.08, 'square'); }
  step(x, y, z, own, soft = 1) {
    if (!this.ctx) return;
    let pan = 0, att = 1;
    if (!own) { const s = this.spatial(x, y, z); if (s.d > 25) return; pan = s.pan; att = 1 / (1 + s.d / 4); }
    this.noiseBurst(this.out(pan), this.t, 0.07, 380 + Math.random() * 200, 0.07 * att * soft, 'lowpass', 1, this.brown);
  }
  throwSnd() { if (this.ctx) this.noiseBurst(this.master, this.t, 0.18, 900, 0.12, 'bandpass', 1, this.noise, 400); }
  bounce(x, y, z) {
    if (!this.ctx) return;
    const s = this.spatial(x, y, z);
    if (s.d > 30) return;
    this.tone(this.out(s.pan), this.t, 0.05, 700, 500, 0.12 / (1 + s.d / 5), 'triangle');
  }
  melee() {
    if (!this.ctx) return;
    this.noiseBurst(this.master, this.t, 0.15, 1200, 0.25, 'bandpass', 1.5, this.noise, 500);
    this.tone(this.master, this.t + 0.05, 0.12, 160, 80, 0.25);
  }
  capture(good) {
    if (!this.ctx) return;
    const t0 = this.t;
    const notes = good ? [262, 330, 392, 523] : [392, 311, 262, 196];
    notes.forEach((f, i) => {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain(), lp = this.ctx.createBiquadFilter();
      o.type = 'sawtooth'; o.frequency.value = f;
      lp.type = 'lowpass'; lp.frequency.value = 1400;
      const s = t0 + i * 0.13;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.09, s + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, s + (i === 3 ? 0.9 : 0.2));
      o.connect(lp); lp.connect(g); g.connect(this.master);
      o.start(s); o.stop(s + 1);
    });
  }
  whistle() {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = this.t;
    const o = ctx.createOscillator(), lfo = ctx.createOscillator(), lg = ctx.createGain(), g = ctx.createGain();
    o.frequency.value = 2650;
    lfo.frequency.value = 28; lg.gain.value = 140;
    lfo.connect(lg); lg.connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.04);
    g.gain.setValueAtTime(0.13, t0 + 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.25);
    o.connect(g); g.connect(this.master);
    o.start(t0); lfo.start(t0); o.stop(t0 + 1.3); lfo.stop(t0 + 1.3);
  }
  heartbeat() {
    if (!this.ctx) return;
    this.tone(this.master, this.t, 0.12, 70, 45, 0.3);
    this.tone(this.master, this.t + 0.22, 0.12, 62, 40, 0.22);
  }
  ui() { if (this.ctx) this.tone(this.master, this.t, 0.05, 660, 620, 0.08, 'triangle'); }
  announce(good) {
    if (!this.ctx) return;
    const t0 = this.t;
    (good ? [523, 659] : [330, 262]).forEach((f, i) => this.tone(this.master, t0 + i * 0.16, 0.3, f, f, 0.1, 'triangle'));
  }
  startAmbient() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.brown; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.045;
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.09; lg.gain.value = 0.025;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this.amb = g;
  }
  setRain(on) {
    if (!this.ctx || this.rain === on) return;
    this.rain = on;
    if (on) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
      const g = ctx.createGain(); g.gain.value = 0.02;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
      this.rainSrc = src;
    } else if (this.rainSrc) { this.rainSrc.stop(); this.rainSrc = null; }
  }
  // Мотор танка игрока
  engine(level) {
    if (!this.ctx) return;
    if (level <= 0) {
      if (this.eng) { this.eng.g.gain.setTargetAtTime(0.0001, this.t, 0.2); }
      return;
    }
    if (!this.eng) {
      const ctx = this.ctx;
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 38;
      const n = ctx.createBufferSource(); n.buffer = this.brown; n.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
      const g = ctx.createGain(); g.gain.value = 0.0001;
      o.connect(f); n.connect(f); f.connect(g); g.connect(this.master);
      o.start(); n.start();
      this.eng = { o, g, f };
    }
    this.eng.o.frequency.setTargetAtTime(34 + level * 30, this.t, 0.15);
    this.eng.f.frequency.setTargetAtTime(200 + level * 260, this.t, 0.15);
    this.eng.g.gain.setTargetAtTime(0.09 + level * 0.07, this.t, 0.15);
  }
}
