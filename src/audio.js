// Gesynthetiseerd geluid (WebAudio): geen audiobestanden nodig.
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.9;
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? this.volume : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 5;
    comp.attack.value = 0.002; comp.release.value = 0.15;
    this.master.connect(comp).connect(ctx.destination);
    // hal-galm
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.2, 2.6);
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.32;
    this.reverb.connect(this.revGain).connect(this.master);
    // ruisbuffer
    const len = ctx.sampleRate * 1.5;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // zoem van de hal
    const hum = ctx.createBufferSource();
    hum.buffer = this.noise; hum.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
    const hg = ctx.createGain(); hg.gain.value = 0.05;
    hum.connect(lp).connect(hg).connect(this.master);
    hum.start();
    this.listener = ctx.listener;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? this.volume : 0;
  }

  impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // vroege reflecties van panelen + lange halstaart
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.02 ? (Math.random() * 2 - 1) * 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay)) * 0.6 + early;
      }
    }
    return b;
  }

  get ok() { return !!this.ctx && this.enabled; }

  out(pan = 0, dist = 0, wet = 0.6) {
    // routing met stereo-panning en afstandsdemping
    const ctx = this.ctx;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const att = 1 / (1 + dist * 0.12);
    g.gain.value = att;
    let node = g;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
    node.connect(this.master);
    const w = ctx.createGain(); w.gain.value = wet * (0.6 + Math.min(dist, 20) * 0.03);
    node.connect(w).connect(this.reverb);
    return g;
  }

  nz(dest, t, dur, type, freq, q, gain, attack = 0.001) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random() * 0.8);
    s.stop(t + dur + 0.05);
    return f;
  }

  osc(dest, t, dur, type, f0, f1, gain) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ----- wapen -----
  shot() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0.9);
    this.nz(d, t, 0.09, 'highpass', 900, 0.7, 0.9);
    this.nz(d, t, 0.22, 'bandpass', 1400, 0.8, 0.7);
    this.nz(d, t, 0.35, 'lowpass', 500, 0.6, 0.8);
    this.osc(d, t, 0.14, 'sine', 140, 42, 1.1);
    this.osc(d, t, 0.03, 'square', 2400, 1800, 0.06);
  }

  enemyShot(pan, dist) {
    if (!this.ok) return;
    const t = this.ctx.currentTime + dist / 340;
    const d = this.out(pan, dist, 1.0);
    this.nz(d, t, 0.12, 'bandpass', 1100, 0.7, 0.8);
    this.nz(d, t, 0.32, 'lowpass', 700, 0.6, 0.7);
    this.osc(d, t, 0.12, 'sine', 120, 45, 0.7);
  }

  whiz(pan) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(pan, 0, 0.1);
    const f = this.nz(d, t, 0.18, 'bandpass', 3000, 6, 0.35, 0.03);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.18);
  }

  casing() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0.4, 1.5, 0.3);
    const f = 3800 + Math.random() * 2200;
    this.osc(d, t, 0.08, 'sine', f, f, 0.05);
    this.osc(d, t + 0.05 + Math.random() * 0.03, 0.06, 'sine', f * 1.3, f * 1.3, 0.03);
  }

  dry() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0.1);
    this.nz(d, t, 0.04, 'bandpass', 2800, 3, 0.35);
  }

  reload(step) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0.2, 0, 0.15);
    if (step === 0) { this.nz(d, t, 0.06, 'bandpass', 1800, 4, 0.5); this.osc(d, t, 0.05, 'triangle', 600, 300, 0.2); }
    if (step === 1) { this.nz(d, t, 0.08, 'bandpass', 1200, 3, 0.7); this.osc(d, t + 0.02, 0.05, 'square', 900, 500, 0.08); }
    if (step === 2) { this.nz(d, t, 0.05, 'highpass', 2500, 2, 0.6); this.nz(d, t + 0.09, 0.07, 'bandpass', 1600, 3, 0.7); }
  }

  // ----- treffers -----
  impact(mat, pan, dist) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(pan, dist, 0.35);
    if (mat === 'wood') { this.nz(d, t, 0.07, 'bandpass', 900 + Math.random() * 300, 2.5, 0.6); this.osc(d, t, 0.05, 'sine', 260, 180, 0.25); }
    else if (mat === 'metal') { this.nz(d, t, 0.05, 'highpass', 3000, 1, 0.4); this.osc(d, t, 0.25, 'sine', 2100 + Math.random() * 600, 1900, 0.12); }
    else if (mat === 'lexan') { this.osc(d, t, 0.06, 'triangle', 1700, 1200, 0.25); this.nz(d, t, 0.03, 'highpass', 4000, 1, 0.3); }
    else if (mat === 'cardboard') { this.nz(d, t, 0.05, 'bandpass', 600, 1.5, 0.7); }
    else if (mat === 'body') { this.nz(d, t, 0.08, 'lowpass', 500, 1, 0.9); this.osc(d, t, 0.08, 'sine', 110, 60, 0.5); }
    else if (mat === 'plastic') { this.osc(d, t, 0.12, 'sine', 330, 250, 0.35); this.nz(d, t, 0.05, 'bandpass', 1200, 2, 0.4); }
    else { this.nz(d, t, 0.06, 'bandpass', 1600, 1.5, 0.5); this.nz(d, t, 0.15, 'lowpass', 300, 1, 0.2); }
  }

  steel(pan, dist) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(pan, dist, 0.6);
    for (const [f, g] of [[1650, 0.22], [2470, 0.14], [3910, 0.08], [880, 0.08]]) this.osc(d, t, 0.9, 'sine', f, f * 0.995, g);
    this.nz(d, t, 0.03, 'highpass', 3000, 1, 0.5);
  }

  thud(pan, dist) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(pan, dist, 0.5);
    this.nz(d, t, 0.25, 'lowpass', 260, 1, 0.9);
    this.osc(d, t, 0.2, 'sine', 90, 40, 0.6);
  }

  hitmarker(kill) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0);
    this.osc(d, t, 0.05, 'square', kill ? 1250 : 1800, kill ? 1000 : 1700, 0.07);
    if (kill) this.osc(d, t + 0.05, 0.08, 'square', 900, 700, 0.06);
  }

  hurt() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0.2);
    this.nz(d, t, 0.18, 'lowpass', 400, 1, 0.9);
    this.osc(d, t, 0.25, 'sine', 70, 40, 0.8);
  }

  step(alt) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(alt ? 0.15 : -0.15, 0, 0.12);
    this.nz(d, t, 0.07, 'lowpass', 550 + Math.random() * 200, 0.8, 0.22);
    this.nz(d, t, 0.03, 'highpass', 3500, 1, 0.04);
  }

  // ----- spelmomenten -----
  beep() { // IPSC shot timer
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0.4);
    this.osc(d, t, 0.42, 'square', 2780, 2780, 0.16);
  }

  ui(f = 900) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0.05);
    this.osc(d, t, 0.06, 'sine', f, f * 1.2, 0.12);
  }

  clear() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0.3);
    this.osc(d, t, 0.12, 'triangle', 660, 660, 0.18);
    this.osc(d, t + 0.1, 0.22, 'triangle', 990, 990, 0.18);
  }

  fail() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0.5);
    this.osc(d, t, 0.6, 'sawtooth', 220, 110, 0.12);
  }

  win() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const d = this.out(0, 0, 0.5);
    [523, 659, 784, 1046].forEach((f, i) => this.osc(d, t + i * 0.09, 0.35, 'triangle', f, f, 0.14));
  }
}
