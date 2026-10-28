// Управление: сенсорный джойстик и кнопки на телефоне, клавиатура и мышь на компьютере
export class Input {
  constructor(game) {
    this.g = game;
    this.moveX = 0; this.moveY = 0; this.sprint = false;
    this.lookDX = 0; this.lookDY = 0;
    this.fire = false; this.ads = false; this.crouch = false; this.mg = false;
    this.events = new Set();
    this.keys = new Set();
    this.touchMode = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.joy = null; this.look = null; this.fireIds = new Set();
    this.enabled = false;
    this.mouseFire = false; this.mouseAds = false;
    this.joyEl = document.getElementById('joy');
    this.knobEl = document.getElementById('knob');
    this.sprintEl = document.getElementById('sprintHint');
    this.bind();
  }
  bind() {
    const opts = { passive: false };
    window.addEventListener('pointerdown', (e) => this.down(e), opts);
    window.addEventListener('pointermove', (e) => this.move(e), opts);
    window.addEventListener('pointerup', (e) => this.up(e), opts);
    window.addEventListener('pointercancel', (e) => this.up(e), opts);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement && this.enabled) { this.lookDX += e.movementX * 0.55; this.lookDY += e.movementY * 0.55; }
    });
    window.addEventListener('blur', () => this.reset());
  }
  reset() {
    this.moveX = this.moveY = 0; this.sprint = false; this.fire = false; this.mg = false;
    this.joy = null; this.look = null; this.fireIds.clear(); this.keys.clear();
    this.mouseFire = false; this.mouseAds = false;
    if (this.joyEl) this.joyEl.hidden = true;
    document.querySelectorAll('.cbtn.held').forEach((b) => b.classList.remove('held'));
  }
  btnOf(e) {
    const el = e.target && e.target.closest ? e.target.closest('[data-btn]') : null;
    return el && el.offsetParent !== null ? el : null;
  }
  down(e) {
    if (!this.enabled) return;
    if (e.target.closest && e.target.closest('.screen, #btnPause, .noinput')) return;
    const btn = this.btnOf(e);
    if (e.pointerType === 'mouse') {
      if (btn) return;
      if (!document.pointerLockElement) {
        const c = this.g.renderer.domElement;
        if (c.requestPointerLock) { try { const r = c.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
        return;
      }
      if (e.button === 0) { this.mouseFire = true; this.fireLatch = true; }
      if (e.button === 2) { this.mouseAds = true; }
      e.preventDefault();
      return;
    }
    e.preventDefault();
    this.touchMode = true;
    if (btn) {
      const b = btn.dataset.btn;
      btn.classList.add('held');
      if (b === 'fire' || b === 'fire2') {
        this.fireIds.add(e.pointerId);
        this.fire = true;
        this.fireLatch = true;
        if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, btn };
        else this.fireIds.add(e.pointerId);
        btn._pid = e.pointerId;
        return;
      }
      if (b === 'mg') { this.mg = true; this.mgLatch = true; btn._pid = e.pointerId; return; }
      if (b === 'ads') { this.ads = !this.ads; btn.classList.toggle('on', this.ads); return; }
      if (b === 'crouch') { this.crouch = !this.crouch; btn.classList.toggle('on', this.crouch); return; }
      this.events.add(b);
      return;
    }
    const W = window.innerWidth;
    if (e.clientX < W * 0.42 && !this.joy) {
      this.joy = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      if (this.joyEl) {
        this.joyEl.hidden = false;
        this.joyEl.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        this.knobEl.style.transform = 'translate(0px, 0px)';
      }
      return;
    }
    if (!this.look) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }
  move(e) {
    if (!this.enabled) return;
    if (this.joy && e.pointerId === this.joy.id) {
      e.preventDefault();
      const R = 52;
      let dx = e.clientX - this.joy.ox, dy = e.clientY - this.joy.oy;
      const d = Math.hypot(dx, dy);
      // Палец ушёл далеко — тянем джойстик за ним
      if (d > R * 1.7) {
        const k = (d - R * 1.7) / d;
        this.joy.ox += dx * k; this.joy.oy += dy * k;
        dx = e.clientX - this.joy.ox; dy = e.clientY - this.joy.oy;
        if (this.joyEl) this.joyEl.style.transform = `translate(${this.joy.ox}px, ${this.joy.oy}px)`;
      }
      const dd = Math.hypot(dx, dy);
      const cl = Math.min(R, dd);
      const nx = dd > 0 ? (dx / dd) * cl : 0, ny = dd > 0 ? (dy / dd) * cl : 0;
      this.moveX = nx / R; this.moveY = ny / R;
      this.sprint = dd > R * 1.25 && dy < -Math.abs(dx) * 0.8;
      if (this.knobEl) this.knobEl.style.transform = `translate(${nx}px, ${ny}px)`;
      if (this.sprintEl) this.sprintEl.classList.toggle('on', this.sprint);
      return;
    }
    if (this.look && e.pointerId === this.look.id) {
      e.preventDefault();
      this.lookDX += e.clientX - this.look.x;
      this.lookDY += e.clientY - this.look.y;
      this.look.x = e.clientX; this.look.y = e.clientY;
    }
  }
  up(e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseAds = false;
      return;
    }
    if (this.joy && e.pointerId === this.joy.id) {
      this.joy = null; this.moveX = 0; this.moveY = 0; this.sprint = false;
      if (this.joyEl) this.joyEl.hidden = true;
      if (this.sprintEl) this.sprintEl.classList.remove('on');
    }
    if (this.look && e.pointerId === this.look.id) this.look = null;
    if (this.fireIds.has(e.pointerId)) {
      this.fireIds.delete(e.pointerId);
      if (!this.fireIds.size) this.fire = false;
    }
    document.querySelectorAll('.cbtn.held').forEach((b) => {
      if (b._pid === e.pointerId || !b._pid) b.classList.remove('held');
      if (b.dataset.btn === 'mg' && b._pid === e.pointerId) this.mg = false;
    });
  }
  key(e, down) {
    if (!this.enabled) return;
    const k = e.code;
    if (down) {
      if (this.keys.has(k)) return;
      this.keys.add(k);
      const map = { Space: 'jump', KeyR: 'reload', KeyG: 'grenade', KeyF: 'gadget', KeyV: 'melee', KeyQ: 'melee', KeyE: 'interact', KeyX: 'exit', Escape: 'pause', KeyP: 'pause' };
      if (map[k]) this.events.add(map[k]);
      if (k === 'KeyC') { this.crouch = !this.crouch; }
      if (k === 'Tab') { e.preventDefault(); this.g.hud.showScores(true); }
      if (k === 'KeyM') this.events.add('map');
      this.touchMode = false;
    } else {
      this.keys.delete(k);
      if (k === 'Tab') this.g.hud.showScores(false);
      if (k === 'ControlLeft') this.crouch = false;
    }
    if (k === 'ControlLeft' && down) this.crouch = true;
  }
  // Снимок ввода за кадр
  read() {
    let mx = this.moveX, my = this.moveY, sprint = this.sprint;
    if (this.keys.size) {
      const K = this.keys;
      const kx = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
      const ky = (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0) - (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0);
      if (kx || ky) { const l = Math.hypot(kx, ky); mx = kx / l; my = ky / l; }
      if (K.has('ShiftLeft') || K.has('ShiftRight')) sprint = true;
    }
    const out = {
      mx, my, sprint,
      dx: this.lookDX, dy: this.lookDY,
      fire: this.fire || this.mouseFire || !!this.fireLatch,
      ads: this.touchMode ? this.ads : this.mouseAds,
      crouch: this.crouch, mg: this.mg || !!this.mgLatch || this.mouseAds && this.g.player && !!this.g.player.vehicle,
      ev: this.events,
    };
    this.lookDX = 0; this.lookDY = 0;
    this.fireLatch = false; this.mgLatch = false;
    this.events = new Set();
    return out;
  }
  setAds(v) {
    this.ads = v;
    const b = document.querySelector('[data-btn="ads"]');
    if (b) b.classList.toggle('on', v);
  }
  setCrouch(v) {
    this.crouch = v;
    const b = document.querySelector('[data-btn="crouch"]');
    if (b) b.classList.toggle('on', v);
  }
}
