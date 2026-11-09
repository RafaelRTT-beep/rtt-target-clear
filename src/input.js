// Besturing: touch (telefoon) en toetsenbord/muis (Mac).
export class Input {
  constructor(layer, canvas, opts) {
    this.layer = layer;
    this.canvas = canvas;
    const forced = new URLSearchParams(location.search).get('touch');
    this.touch = forced === '1' || (forced !== '0' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window));
    document.body.classList.toggle('is-touch', this.touch);
    this.sens = opts.sens || 1;
    this.moveX = 0; this.moveY = 0;
    this.lookDX = 0; this.lookDY = 0;
    this.fireHeld = false;
    this.adsToggle = false; this.adsHold = false;
    this.crouch = false;
    this._reload = false; this._pause = false;
    this.enabled = false;
    this.keys = {};
    this.joy = null;
    this.looks = new Map();
    this.fires = new Set();
    this.taps = [];
    this.tapFire = opts.tapFire !== false;
    this.joyBase = document.getElementById('joy');
    this.joyKnob = document.getElementById('joyKnob');
    this.bind();
  }

  bind() {
    const L = this.layer;
    const btnOf = (e) => { const b = e.target.closest && e.target.closest('[data-btn]'); return b ? b.dataset.btn : null; };
    L.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (!this.touch && e.pointerType === 'mouse') return;
      e.preventDefault();
      try { L.setPointerCapture(e.pointerId); } catch (_) { /* ok */ }
      const b = btnOf(e);
      const el = b ? e.target.closest('[data-btn]') : null;
      if (el) el.classList.add('on');
      if (b === 'fire' || b === 'fire2') { this.fires.add(e.pointerId); this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, el }); return; }
      if (b === 'ads') { this.adsToggle = !this.adsToggle; this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, el }); return; }
      if (b === 'reload') { this._reload = true; this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, el }); return; }
      if (b === 'crouch') { this.crouch = !this.crouch; this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, el }); return; }
      if (b === 'pause') { this._pause = true; return; }
      if (e.clientX < window.innerWidth * 0.42 && !this.joy) {
        this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), tap: true };
        this.joyBase.style.transform = `translate(${e.clientX - 60}px, ${e.clientY - 60}px)`;
        this.joyBase.classList.add('active');
        this.joyKnob.style.transform = 'translate(0px, 0px)';
        return;
      }
      // vrije vinger: slepen = kijken, korte tik = schieten
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY, el: null, sx: e.clientX, sy: e.clientY, t: performance.now(), tap: true, live: false });
    }, { passive: false });
    L.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      if (this.joy && e.pointerId === this.joy.id) {
        if (Math.hypot(e.clientX - this.joy.sx, e.clientY - this.joy.sy) > 12) this.joy.tap = false;
        let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
        const r = Math.hypot(dx, dy), max = 52;
        if (r > max) {
          // joystick schuift mee als je verder trekt
          const k = (r - max) / r;
          this.joy.ox += dx * k; this.joy.oy += dy * k;
          dx *= max / r; dy *= max / r;
          this.joyBase.style.transform = `translate(${this.joy.ox - 60}px, ${this.joy.oy - 60}px)`;
        }
        this.moveX = dx / max; this.moveY = -dy / max;
        this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
        return;
      }
      const l = this.looks.get(e.pointerId);
      if (l) {
        if (l.live === false) {
          // dode zone: een tik mag het beeld niet laten schudden
          if (Math.hypot(e.clientX - l.sx, e.clientY - l.sy) < 9) return;
          l.live = true; l.tap = false;
          l.x = e.clientX; l.y = e.clientY;
          return;
        }
        this.lookDX += (e.clientX - l.x);
        this.lookDY += (e.clientY - l.y);
        l.x = e.clientX; l.y = e.clientY;
      }
    }, { passive: false });
    const end = (e) => {
      const now = performance.now();
      const isUp = e.type === 'pointerup';
      if (this.joy && e.pointerId === this.joy.id && isUp && this.tapFire && this.joy.tap && now - this.joy.t < 260) this.taps.push({ x: e.clientX, y: e.clientY });
      const lt = this.looks.get(e.pointerId);
      if (lt && !lt.el && isUp && this.tapFire && lt.tap && now - lt.t < 260) this.taps.push({ x: e.clientX, y: e.clientY });
      if (this.joy && e.pointerId === this.joy.id) {
        this.joy = null; this.moveX = 0; this.moveY = 0;
        this.joyBase.classList.remove('active');
        this.joyKnob.style.transform = 'translate(0px, 0px)';
        this.placeJoyDefault();
      }
      const l = this.looks.get(e.pointerId);
      if (l && l.el) l.el.classList.remove('on');
      this.looks.delete(e.pointerId);
      this.fires.delete(e.pointerId);
    };
    L.addEventListener('pointerup', end);
    L.addEventListener('pointercancel', end);
    L.addEventListener('contextmenu', (e) => e.preventDefault());

    // toetsenbord + muis
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (!this.enabled) return;
      if (e.code === 'KeyR') this._reload = true;
      if (e.code === 'KeyC' || e.code === 'ControlLeft') this.crouch = !this.crouch;
      if (e.code === 'Escape' || e.code === 'KeyP') this._pause = true;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    this.canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.touch) return;
      if (document.pointerLockElement !== this.canvas) { this.requestLock(); return; }
      if (e.button === 0) this.fireHeld = true;
      if (e.button === 2) this.adsHold = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.adsHold = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled || this.touch || document.pointerLockElement !== this.canvas) return;
      this.lookDX += e.movementX; this.lookDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.touch && this.enabled && document.pointerLockElement !== this.canvas && this.onUnlock) this.onUnlock();
    });
  }

  placeJoyDefault() {
    const sl = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sl')) || 0;
    this.joyBase.style.transform = `translate(${40 + sl}px, ${window.innerHeight - 170}px)`;
  }

  requestLock() {
    if (this.touch) return;
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* ok */ }
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this.moveX = this.moveY = 0; this.lookDX = this.lookDY = 0;
      this.fireHeld = false; this.adsHold = false; this.fires.clear(); this.looks.clear(); this.taps.length = 0;
      this.joy = null; this.joyBase.classList.remove('active');
      this.placeJoyDefault();
      document.querySelectorAll('[data-btn].on').forEach((b) => b.classList.remove('on'));
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  reset() { this.adsToggle = false; this.crouch = false; }

  consume() {
    let mx = this.moveX, my = this.moveY;
    if (!this.touch) {
      const k = this.keys;
      mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      my = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
      if (k.ShiftLeft) { mx *= 0.5; my *= 0.5; }
    }
    const scale = this.touch ? 0.0046 : 0.0022;
    const out = {
      moveX: mx, moveY: my,
      lookDX: this.lookDX, lookDY: this.lookDY,
      lookYaw: -this.lookDX * scale * this.sens,
      lookPitch: -this.lookDY * scale * this.sens,
      fire: this.touch ? this.fires.size > 0 : this.fireHeld,
      ads: this.touch ? this.adsToggle : this.adsHold,
      crouch: this.crouch,
      reload: this._reload,
      pause: this._pause,
      taps: this.taps.splice(0),
    };
    this.lookDX = 0; this.lookDY = 0;
    this._reload = false; this._pause = false;
    return out;
  }
}
