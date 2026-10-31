// Интерфейс боя: очки, флаги, миникарта, лента убийств, маркеры над головами, прицел, индикаторы урона
import * as THREE from './three.module.min.js';
import { clamp, TAU, DEG, fmtTime, yawTo } from './util.js';
import { WEAPONS, TEAMS, GADGETS } from './config.js';
import { HALF } from './world.js';

const $ = (id) => document.getElementById(id);
const COL = { friend: '#5fb4ff', squad: '#7dff8a', enemy: '#ff4a3d', neutral: '#e8e2d0' };
const WNAME = {
  smg: 'ПП-18', semi: 'СВ-16', lmg: 'РП-15', bolt: 'СН-98', frag: 'граната', at: 'ПТ-граната', melee: 'штык',
  tank: 'танк', mg: 'пулемёт', airship: 'цеппелин', fall: 'падение', flare: 'ракета',
};
const _v = new THREE.Vector3();

export class Hud {
  constructor(game) {
    this.g = game;
    this.el = $('hud');
    this.ov = $('overlay');
    this.ctx = this.ov.getContext('2d');
    this.mm = $('minimap');
    this.mctx = this.mm.getContext('2d');
    this.hits = [];
    this.dmg = [];
    this.pops = [];
    this.feed = [];
    this.slow = 0;
    this.whiteT = 0; this.suppressK = 0;
    this.last = {};
  }
  setup() {
    const g = this.g;
    const fb = $('flagsbar');
    fb.innerHTML = '';
    this.flagEls = g.flags.map((f) => {
      const d = document.createElement('div');
      d.className = 'fchip';
      d.innerHTML = `<i></i><b>${f.id}</b>`;
      fb.appendChild(d);
      return d;
    });
    $('tickets').hidden = false;
    $('killfeed').innerHTML = '';
    this.feed = [];
    this.pops = [];
    $('scorepops').innerHTML = '';
    this.resize();
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.ov.width = Math.round(innerWidth * dpr);
    this.ov.height = Math.round(innerHeight * dpr);
    const ms = this.mm.clientWidth || 140;
    this.mm.width = Math.round(ms * dpr); this.mm.height = Math.round(ms * dpr);
  }
  rel(team) {
    const p = this.g.player;
    if (team < 0) return 'neutral';
    return team === p.team ? 'friend' : 'enemy';
  }
  // ---------- События ----------
  killfeed(att, wid, vic, head) {
    const box = $('killfeed');
    const d = document.createElement('div');
    d.className = 'kf';
    const nm = (s) => {
      if (!s) return `<span class="kf-n">${wid === 'airship' ? 'Цеппелин' : '—'}</span>`;
      const r = s.isPlayer ? 'me' : s.team === this.g.player.team ? (s.squad ? 'squad' : 'friend') : 'enemy';
      return `<span class="kf-n ${r}">${s.name}</span>`;
    };
    d.innerHTML = (att && att !== vic ? nm(att) + ' ' : '') + `<span class="kf-w">${WNAME[wid] || wid || ''}${head ? ' ✛' : ''}</span> ` + nm(vic);
    box.prepend(d);
    this.feed.push({ el: d, t: 6 });
    while (box.children.length > 5) box.lastChild.remove();
  }
  hitMarker(head, kill, vehicle) {
    this.hits.push({ t: 0.28, head, kill, vehicle });
    this.g.audio.hit(kill ? 'kill' : head ? 'head' : 'hit');
    if (kill) this.g.vibrate(25);
  }
  // yaw — направление на стрелка в той же системе, что и взгляд
  damageFrom(yaw) {
    this.dmg.push({ a: yaw, t: 1.6 });
  }
  scorePop(pts, reason) {
    const box = $('scorepops');
    if (reason) {
      const d = document.createElement('div');
      d.className = 'pop';
      d.innerHTML = `<b>+${pts}</b> ${reason}`;
      box.prepend(d);
      this.pops.push({ el: d, t: 2.6 });
      while (box.children.length > 4) box.lastChild.remove();
    }
    this.scoreAcc = (this.scoreAcc || 0) + pts;
  }
  announce(text, good) {
    const a = $('announce');
    a.textContent = text;
    a.className = good === undefined ? 'show' : good ? 'show good' : 'show bad';
    clearTimeout(this._at);
    this._at = setTimeout(() => (a.className = ''), 3000);
  }
  suppress(k) { this.suppressK = Math.min(1, this.suppressK + k * 0.6); }
  flashWhite(k) { this.whiteT = Math.max(this.whiteT, k); }
  showScores(on) {
    const el = $('scores');
    el.hidden = !on;
    if (on) this.fillScores();
  }
  fillScores() {
    const g = this.g;
    const cols = [0, 1].map((t) => g.soldiers.filter((s) => s.team === t).sort((a, b) => b.stats.score - a.stats.score));
    const html = cols.map((list, t) => {
      const rel = t === g.player.team ? 'friend' : 'enemy';
      const rows = list.map((s) => `<tr class="${s.isPlayer ? 'me' : s.squad ? 'squad' : ''}"><td>${s.name}${s.state === 'dead' ? ' <i>✝</i>' : s.state === 'downed' ? ' <i>✚</i>' : ''}</td><td>${s.cls.name}</td><td>${s.stats.kills}</td><td>${s.stats.deaths}</td><td>${s.stats.score}</td></tr>`).join('');
      return `<div class="scol ${rel}"><h3>${TEAMS[t].name} · ${Math.max(0, Math.ceil(g.teams[t].tickets))}</h3><table><tr><th>Боец</th><th>Класс</th><th>У</th><th>С</th><th>Очки</th></tr>${rows}</table></div>`;
    }).join('');
    $('scoresBody').innerHTML = html;
  }

  // ---------- Каждый кадр ----------
  update(dt) {
    const g = this.g, p = g.player;
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t -= dt;
      if (f.t < 1) f.el.style.opacity = Math.max(0, f.t);
      if (f.t <= 0) { f.el.remove(); this.feed.splice(i, 1); }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const f = this.pops[i];
      f.t -= dt;
      if (f.t < 0.6) f.el.style.opacity = Math.max(0, f.t / 0.6);
      if (f.t <= 0) { f.el.remove(); this.pops.splice(i, 1); }
    }
    this.whiteT = Math.max(0, this.whiteT - dt * 0.8);
    this.suppressK = Math.max(0, this.suppressK - dt * 0.7);
    this.slow -= dt;
    if (this.slow <= 0) { this.slow = 0.1; this.updateDom(); }
    this.drawOverlay(dt);
    this.mmT = (this.mmT || 0) - dt;
    if (this.mmT <= 0) { this.mmT = 1 / 15; this.drawMinimap(); }
  }
  set(id, val) {
    if (this.last[id] === val) return;
    this.last[id] = val;
    const e = $(id);
    if (e) e.textContent = val;
  }
  updateDom() {
    const g = this.g, p = g.player;
    const my = p.team, en = 1 - my;
    const T = g.teams;
    this.set('tk0', Math.max(0, Math.ceil(T[my].tickets)));
    this.set('tk1', Math.max(0, Math.ceil(T[en].tickets)));
    const max = g.maxTickets;
    $('tb0').style.width = clamp(T[my].tickets / max, 0, 1) * 100 + '%';
    $('tb1').style.width = clamp(T[en].tickets / max, 0, 1) * 100 + '%';
    this.set('timer', fmtTime(g.timeLeft));
    g.flags.forEach((f, i) => {
      const el = this.flagEls[i];
      const rel = this.rel(f.owner);
      const cls = 'fchip ' + rel + (f.contested ? ' hot' : '') + (g.playerFlag === f ? ' here' : '');
      if (el.className !== cls) el.className = cls;
      const c = f.control * (my === 0 ? 1 : -1);
      el.firstChild.style.height = Math.abs(c) * 100 + '%';
      el.firstChild.style.background = c > 0 ? COL.friend : COL.enemy;
    });
    // Захват
    const cap = $('capture');
    const pf = g.playerFlag;
    if (pf && p.state === 'alive') {
      cap.hidden = false;
      const c = pf.control * (my === 0 ? 1 : -1);
      let label;
      if (pf.owner === my && c >= 0.999) label = `Флаг ${pf.id} «${pf.name}» — наш`;
      else if (pf.cnt[my] > pf.cnt[en]) label = pf.owner === en ? `Нейтрализация ${pf.id}…` : `Захват ${pf.id}…`;
      else if (pf.cnt[en] > pf.cnt[my]) label = `Враг захватывает ${pf.id}!`;
      else if (pf.cnt[en] > 0) label = `Флаг ${pf.id} оспаривается`;
      else label = `Флаг ${pf.id} «${pf.name}»`;
      this.set('capLabel', label);
      const bar = $('capBar');
      bar.style.width = Math.abs(c) * 100 + '%';
      bar.style.background = c >= 0 ? COL.friend : COL.enemy;
      this.set('capCount', `${pf.cnt[my]} : ${pf.cnt[en]}`);
    } else cap.hidden = true;
    // Здоровье и патроны
    $('hpFill').style.width = clamp(p.hp, 0, 100) + '%';
    $('hpFill').className = p.hp < 35 ? 'low' : '';
    this.set('hpNum', Math.ceil(Math.max(0, p.hp)));
    if (p.vehicle) {
      const v = p.vehicle;
      this.set('wname', 'Лёгкий танк');
      this.set('mag', Math.ceil(v.hp / 10));
      this.set('reserve', v.reload > 0 ? 'заряжание…' : 'орудие готово');
      $('ammoBox').classList.add('tank');
    } else {
      $('ammoBox').classList.remove('tank');
      this.set('wname', p.weapon.short + (p.reloadT > 0 ? ' · перезарядка' : ''));
      this.set('mag', p.mag);
      this.set('reserve', '/ ' + p.reserve);
    }
    this.set('nades', '● ' + p.grenades);
    this.set('gadget', GADGETS[p.cls.gadget].icon + ' ' + p.gadgets);
    $('vignette').style.opacity = p.state === 'alive' ? clamp((50 - p.hp) / 50, 0, 0.85) : 0;
    $('whiteFlash').style.opacity = this.whiteT;
    $('suppress').style.opacity = this.suppressK * 0.8;
  }
  project(x, y, z) {
    _v.set(x, y, z).project(this.g.camera);
    if (_v.z > 1 || _v.z < -1) return null;
    return [(_v.x + 1) * 0.5 * this.ov.width, (1 - _v.y) * 0.5 * this.ov.height];
  }
  drawOverlay(dt) {
    const g = this.g, p = g.player, c = this.ctx, W = this.ov.width, H = this.ov.height, D = this.dpr;
    c.clearRect(0, 0, W, H);
    if (!g.running) return;
    const cam = g.camera.position;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // Флаги
    c.font = `700 ${13 * D}px Oswald, sans-serif`;
    for (const f of g.flags) {
      const pt = this.project(f.x, f.pole.y + 7, f.z);
      if (!pt) continue;
      const d = Math.hypot(f.x - cam.x, f.z - cam.z);
      const rel = this.rel(f.owner);
      const r = 11 * D;
      c.globalAlpha = d < 12 ? 0.35 : 0.9;
      c.fillStyle = 'rgba(20,18,14,0.6)';
      c.beginPath(); c.arc(pt[0], pt[1], r + 3 * D, 0, TAU); c.fill();
      c.strokeStyle = COL[rel]; c.lineWidth = 2.5 * D;
      const prog = f.control * (p.team === 0 ? 1 : -1);
      c.beginPath(); c.arc(pt[0], pt[1], r, -Math.PI / 2, -Math.PI / 2 + Math.abs(prog) * TAU); c.strokeStyle = prog >= 0 ? COL.friend : COL.enemy; c.stroke();
      c.fillStyle = COL[rel];
      c.fillText(f.id, pt[0], pt[1] + 1);
      c.font = `600 ${10 * D}px Oswald, sans-serif`;
      c.fillStyle = '#eee';
      c.fillText(Math.round(d) + ' м', pt[0], pt[1] + r + 10 * D);
      c.font = `700 ${13 * D}px Oswald, sans-serif`;
    }
    c.globalAlpha = 1;
    // Солдаты
    for (const s of g.soldiers) {
      if (s === p || s.state === 'dead' || s.vehicle) continue;
      const d = s.pos.distanceTo(cam);
      const friend = s.team === p.team;
      if (friend) {
        if (s.state === 'downed') {
          if (d > (p.cls.revive ? 80 : 30)) continue;
          const pt = this.project(s.pos.x, s.pos.y + 0.9, s.pos.z);
          if (!pt) continue;
          const k = p.cls.revive ? 1 : 0.6;
          c.fillStyle = `rgba(230,60,50,${0.5 + 0.4 * Math.sin(g.time * 6) * k})`;
          const a = 7 * D;
          c.fillRect(pt[0] - a, pt[1] - a / 3, a * 2, (a * 2) / 3);
          c.fillRect(pt[0] - a / 3, pt[1] - a, (a * 2) / 3, a * 2);
          if (p.cls.revive) { c.fillStyle = '#fff'; c.font = `600 ${10 * D}px Oswald, sans-serif`; c.fillText(Math.round(d) + ' м', pt[0], pt[1] + 14 * D); }
          continue;
        }
        if (d > 140) continue;
        const pt = this.project(s.pos.x, s.pos.y + 2.05, s.pos.z);
        if (!pt) continue;
        c.fillStyle = s.squad ? COL.squad : COL.friend;
        const a = (d < 30 ? 6 : 4.5) * D;
        c.beginPath(); c.moveTo(pt[0] - a, pt[1] - a); c.lineTo(pt[0] + a, pt[1] - a); c.lineTo(pt[0], pt[1] + a * 0.4); c.closePath(); c.fill();
        if (s.squad && d < 45) { c.font = `600 ${10 * D}px Oswald, sans-serif`; c.fillText(s.name, pt[0], pt[1] - 11 * D); }
      } else if (s.state === 'alive' && s.spottedUntil > g.time && d < 160) {
        const pt = this.project(s.pos.x, s.pos.y + 2.1, s.pos.z);
        if (!pt) continue;
        c.fillStyle = COL.enemy;
        const a = 5.5 * D;
        c.beginPath(); c.moveTo(pt[0] - a, pt[1] - a); c.lineTo(pt[0] + a, pt[1] - a); c.lineTo(pt[0], pt[1] + a * 0.5); c.closePath(); c.fill();
      }
    }
    // Танки
    for (const v of g.tanks) {
      if (!v || !v.alive) continue;
      const d = v.pos.distanceTo(cam);
      if (d > 200 || (v === p.vehicle)) continue;
      const friend = v.team === p.team;
      if (!friend && !(v.driver && v.driver.spottedUntil > g.time) && d > 60) continue;
      const pt = this.project(v.pos.x, v.pos.y + 3.6, v.pos.z);
      if (!pt) continue;
      c.fillStyle = friend ? COL.friend : COL.enemy;
      c.font = `700 ${12 * D}px Oswald, sans-serif`;
      c.fillText(friend && !v.driver ? '▣ свободен' : '▣', pt[0], pt[1]);
      c.fillStyle = 'rgba(0,0,0,0.5)'; c.fillRect(pt[0] - 18 * D, pt[1] + 8 * D, 36 * D, 4 * D);
      c.fillStyle = friend ? COL.friend : COL.enemy; c.fillRect(pt[0] - 18 * D, pt[1] + 8 * D, 36 * D * (v.hp / v.maxHp), 4 * D);
    }
    // Свои ящики
    c.font = `700 ${12 * D}px sans-serif`;
    for (const d of g.combat.deployables) {
      if (d.team !== p.team) continue;
      const dist = Math.hypot(d.x - cam.x, d.z - cam.z);
      if (dist > 40) continue;
      const pt = this.project(d.x, d.y + 0.9, d.z);
      if (!pt) continue;
      c.fillStyle = d.type === 'medkit' ? '#ff6a5a' : '#ffd060';
      c.fillText(d.type === 'medkit' ? '✚' : '▣', pt[0], pt[1]);
    }
    // Гранаты рядом
    if (p.state === 'alive' && !p.vehicle) {
      for (const pr of g.combat.projectiles) {
        if (pr.type !== 'frag') continue;
        const dx = pr.pos.x - p.pos.x, dz = pr.pos.z - p.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 8) continue;
        const a = yawTo(dx, dz) - g.viewYaw;
        const R = Math.min(W, H) * 0.18;
        const x = W / 2 - Math.sin(a) * R, y = H / 2 - Math.cos(a) * R;
        c.fillStyle = `rgba(255,${120 + Math.sin(g.time * 20) * 80},60,0.95)`;
        c.beginPath(); c.arc(x, y, 10 * D, 0, TAU); c.fill();
        c.fillStyle = '#000'; c.font = `700 ${11 * D}px sans-serif`; c.fillText('!', x, y + 1);
      }
    }
    // Прицел
    const cx = W / 2, cy = H / 2;
    if (p.state === 'alive' && !p.vehicle) {
      const ads = p.adsT;
      if (ads < 0.6) {
        const sp = p.spread();
        const gap = Math.max(5 * D, (Math.tan(sp) / Math.tan((g.camera.fov * DEG) / 2)) * (H / 2));
        c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2 * D;
        c.globalAlpha = 1 - ads / 0.6;
        const L = 7 * D;
        c.beginPath();
        c.moveTo(cx - gap - L, cy); c.lineTo(cx - gap, cy);
        c.moveTo(cx + gap, cy); c.lineTo(cx + gap + L, cy);
        c.moveTo(cx, cy + gap); c.lineTo(cx, cy + gap + L);
        c.stroke();
        c.globalAlpha = 1;
      }
      if (!(p.weapon.scope && ads > 0.85)) { c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(cx - 1.2 * D, cy - 1.2 * D, 2.4 * D, 2.4 * D); }
    } else if (p.vehicle) {
      c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = 2 * D;
      c.beginPath(); c.arc(cx, cy, 14 * D, 0, TAU); c.stroke();
      const v = p.vehicle;
      if (g.tankAim) {
        const pt = this.project(g.tankAim.x, g.tankAim.y, g.tankAim.z);
        if (pt) {
          c.strokeStyle = v.reload > 0 ? 'rgba(255,120,80,0.9)' : 'rgba(120,255,140,0.95)';
          c.beginPath(); c.moveTo(pt[0] - 9 * D, pt[1]); c.lineTo(pt[0] + 9 * D, pt[1]); c.moveTo(pt[0], pt[1] - 9 * D); c.lineTo(pt[0], pt[1] + 9 * D); c.stroke();
        }
      }
      if (v.reload > 0) {
        c.strokeStyle = 'rgba(255,200,120,0.9)'; c.lineWidth = 3 * D;
        c.beginPath(); c.arc(cx, cy, 20 * D, -Math.PI / 2, -Math.PI / 2 + (1 - v.reload / 3.4) * TAU); c.stroke();
      }
    }
    // Попадания
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      h.t -= dt;
      if (h.t <= 0) { this.hits.splice(i, 1); continue; }
      c.strokeStyle = h.kill ? `rgba(255,70,50,${h.t / 0.28})` : h.head ? `rgba(255,220,90,${h.t / 0.28})` : `rgba(255,255,255,${h.t / 0.28})`;
      c.lineWidth = (h.kill ? 3 : 2) * D;
      const a = (h.kill ? 6 : 4) * D, b = (h.kill ? 14 : 10) * D;
      c.beginPath();
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { c.moveTo(cx + sx * a, cy + sy * a); c.lineTo(cx + sx * b, cy + sy * b); }
      c.stroke();
    }
    // Направление урона
    for (let i = this.dmg.length - 1; i >= 0; i--) {
      const d = this.dmg[i];
      d.t -= dt;
      if (d.t <= 0) { this.dmg.splice(i, 1); continue; }
      const r = d.a - g.viewYaw;
      const R = Math.min(W, H) * 0.24;
      c.strokeStyle = `rgba(230,40,30,${Math.min(1, d.t)})`;
      c.lineWidth = 6 * D;
      c.beginPath();
      const ang = -Math.PI / 2 - r;
      c.arc(cx, cy, R, ang - 0.32, ang + 0.32);
      c.stroke();
    }
  }
  drawMinimap() {
    const g = this.g, p = g.player, c = this.mctx, S = this.mm.width;
    if (!g.world) return;
    const k = S / 130;
    const ox = p.vehicle ? p.vehicle.pos.x : p.pos.x, oz = p.vehicle ? p.vehicle.pos.z : p.pos.z;
    const yaw = g.viewYaw;
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.arc(S / 2, S / 2, S / 2, 0, TAU); c.clip();
    c.fillStyle = '#2a2620'; c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2);
    c.rotate(yaw);
    c.scale(k, k);
    c.translate(-ox, -oz);
    c.globalAlpha = 0.92;
    c.drawImage(g.world.minimap, -HALF, -HALF);
    c.globalAlpha = 1;
    c.restore();
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const toS = (x, z) => {
      const dx = (x - ox) * k, dz = (z - oz) * k;
      return [S / 2 + dx * cs - dz * sn, S / 2 + dx * sn + dz * cs];
    };
    const inside = (pt) => Math.hypot(pt[0] - S / 2, pt[1] - S / 2) < S / 2 - 3;
    // Флаги
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = `700 ${S * 0.085}px Oswald, sans-serif`;
    for (const f of g.flags) {
      let pt = toS(f.x, f.z);
      const dd = Math.hypot(pt[0] - S / 2, pt[1] - S / 2), lim = S / 2 - S * 0.07;
      if (dd > lim) pt = [S / 2 + ((pt[0] - S / 2) / dd) * lim, S / 2 + ((pt[1] - S / 2) / dd) * lim];
      c.fillStyle = 'rgba(15,13,10,0.7)';
      c.beginPath(); c.arc(pt[0], pt[1], S * 0.06, 0, TAU); c.fill();
      c.fillStyle = COL[this.rel(f.owner)];
      c.fillText(f.id, pt[0], pt[1] + 1);
    }
    // Солдаты
    for (const s of g.soldiers) {
      if (s === p || s.state === 'dead' || s.vehicle) continue;
      const friend = s.team === p.team;
      if (!friend && s.spottedUntil < g.time) continue;
      const pt = toS(s.pos.x, s.pos.z);
      if (!inside(pt)) continue;
      c.fillStyle = s.state === 'downed' ? '#ff9a3d' : friend ? (s.squad ? COL.squad : COL.friend) : COL.enemy;
      c.beginPath(); c.arc(pt[0], pt[1], S * 0.022, 0, TAU); c.fill();
    }
    for (const v of g.vehicles) {
      if (!v.alive) continue;
      const friend = v.team === p.team;
      if (!friend && v.kind === 'tank' && !(v.driver && v.driver.spottedUntil > g.time)) continue;
      const pt = toS(v.pos.x, v.pos.z);
      if (!inside(pt) && v.kind !== 'airship') continue;
      c.fillStyle = friend ? COL.friend : COL.enemy;
      const r = v.kind === 'airship' ? S * 0.06 : S * 0.04;
      c.fillRect(pt[0] - r, pt[1] - r * 0.7, r * 2, r * 1.4);
    }
    // Игрок
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(S / 2, S / 2 - S * 0.05); c.lineTo(S / 2 - S * 0.035, S / 2 + S * 0.035); c.lineTo(S / 2 + S * 0.035, S / 2 + S * 0.035); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(232,226,208,0.5)'; c.lineWidth = 2;
    c.beginPath(); c.arc(S / 2, S / 2, S / 2 - 1, 0, TAU); c.stroke();
  }
}
