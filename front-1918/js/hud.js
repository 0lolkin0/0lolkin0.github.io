// Интерфейс боя: очки, флаги, миникарта, лента убийств, маркеры над головами, прицел, индикаторы урона
import * as THREE from './three.module.min.js';
import { clamp, TAU, DEG, fmtTime, yawTo } from './util.js';
import { WEAPONS, TEAMS, GADGETS, WNAME } from './config.js';
import { HALF } from './world.js';

const $ = (id) => document.getElementById(id);
const COL = { friend: '#5fb4ff', squad: '#7dff8a', enemy: '#ff4a3d', neutral: '#e8e2d0' };
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
      this.set('wname', 'Лёгкий танк · броня ' + Math.ceil(v.hp / 10) + '%');
      this.set('mag', v.reload > 0 ? '…' : '●');
      this.set('reserve', v.reload > 0 ? 'заряжание' : 'орудие готово');
      $('ammoBox').classList.add('tank');
    } else {
      $('ammoBox').classList.remove('tank');
      const sightTxt = p.sight.optic ? ' · ' + p.sight.name.replace('Оптика ', '') : '';
      this.set('wname', p.weapon.short + sightTxt + (p.reloadT > 0 ? ' · перезарядка' : p.switchT > 0 ? ' · смена' : ''));
      this.set('mag', p.mag);
      this.set('reserve', '/ ' + p.reserve);
      const o = p.other, oa = o && p.ammo[o.id];
      this.set('otherW', o ? `${o.short} ${oa ? oa.mag + '/' + oa.reserve : ''}` : '');
    }
    this.set('nades', 'Гранаты: ' + p.grenades);
    this.set('gadget', GADGETS[p.cls.gadget].short + ': ' + p.gadgets);
    const sw = document.querySelector('[data-btn="swap"] em');
    if (sw && p.other && sw.textContent !== p.other.short) sw.textContent = p.other.short;
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
      if (ads < 0.6 && p.switchT <= 0) {
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
      if (ads < 0.5) { c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(cx - 1.2 * D, cy - 1.2 * D, 2.4 * D, 2.4 * D); }
    } else if (p.vehicle && !g.tankZoom) {
      // Прицел танка: перекрестье с разрывом, дальность до точки прицеливания
      c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 2 * D;
      c.beginPath();
      c.arc(cx, cy, 22 * D, 0, TAU);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { c.moveTo(cx + dx * 8 * D, cy + dy * 8 * D); c.lineTo(cx + dx * 30 * D, cy + dy * 30 * D); }
      c.stroke();
      c.fillStyle = 'rgba(255,255,255,0.95)'; c.fillRect(cx - 1.5 * D, cy - 1.5 * D, 3 * D, 3 * D);
      const v = p.vehicle;
      if (g.tankAimDist) { c.font = `600 ${11 * D}px Oswald, sans-serif`; c.fillText(Math.round(g.tankAimDist) + ' м', cx + 44 * D, cy - 10 * D); }
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

  // ---------- Оптика и прицел танка ----------
  setScope(kind) {
    const cv = $('scopeCv');
    if (!kind) { if (!cv.hidden) cv.hidden = true; return; }
    cv.hidden = false;
    const W = innerWidth, H = innerHeight, dpr = this.dpr || 1;
    const key = kind + W + 'x' + H;
    if (this.scopeKey === key) return;
    this.scopeKey = key;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = W / 2, cy = H / 2, R = Math.min(W, H) * (kind === 'tank' ? 0.48 : 0.46);
    c.fillStyle = '#060504';
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'destination-out';
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    c.globalCompositeOperation = 'source-over';
    const gr = c.createRadialGradient(cx, cy, R * 0.72, cx, cy, R);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.8)');
    c.fillStyle = gr; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
    c.strokeStyle = '#0a0a09'; c.fillStyle = '#0a0a09';
    if (kind === 'cross') {
      c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(cx - R * 0.5, cy); c.lineTo(cx + R * 0.5, cy); c.moveTo(cx, cy - R * 0.5); c.lineTo(cx, cy + R * 0.5); c.stroke();
      c.lineWidth = 5;
      c.beginPath();
      c.moveTo(cx - R, cy); c.lineTo(cx - R * 0.5, cy); c.moveTo(cx + R * 0.5, cy); c.lineTo(cx + R, cy);
      c.moveTo(cx, cy + R * 0.5); c.lineTo(cx, cy + R); c.moveTo(cx, cy - R * 0.5); c.lineTo(cx, cy - R);
      c.stroke();
      c.lineWidth = 1;
      for (let i = 1; i <= 4; i++) { const y = cy + R * 0.1 * i; c.beginPath(); c.moveTo(cx - 4 - i, y); c.lineTo(cx + 4 + i, y); c.stroke(); }
      c.fillStyle = '#d02a1e'; c.beginPath(); c.arc(cx, cy, 1.6, 0, TAU); c.fill();
    } else if (kind === 'post') {
      c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.stroke();
      c.beginPath();
      c.moveTo(cx - 3.5, cy + R); c.lineTo(cx - 3.5, cy + 10); c.lineTo(cx, cy); c.lineTo(cx + 3.5, cy + 10); c.lineTo(cx + 3.5, cy + R);
      c.closePath(); c.fill();
      c.fillRect(cx - R, cy - 3, R * 0.85, 6);
      c.fillRect(cx + R * 0.15, cy - 3, R * 0.85, 6);
    } else if (kind === 'tank') {
      c.fillStyle = 'rgba(40,60,40,0.12)'; c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(20,20,18,0.95)'; c.fillStyle = 'rgba(20,20,18,0.95)';
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx - 40, cy); c.moveTo(cx + 40, cy); c.lineTo(cx + R, cy); c.stroke();
      c.beginPath(); c.moveTo(cx - 18, cy + 14); c.lineTo(cx, cy); c.lineTo(cx + 18, cy + 14); c.stroke();
      c.lineWidth = 1.5;
      c.font = '600 11px Oswald, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      for (let i = 1; i <= 5; i++) {
        const y = cy + i * R * 0.09;
        c.beginPath(); c.moveTo(cx - 10, y); c.lineTo(cx + 10, y); c.stroke();
        c.fillText(String(i * 100), cx + 14, y);
      }
      for (let i = -3; i <= 3; i++) if (i) { c.beginPath(); c.moveTo(cx + i * R * 0.18, cy - 6); c.lineTo(cx + i * R * 0.18, cy + 6); c.stroke(); }
    }
  }

  // ---------- Большая карта ----------
  drawFullMap(cv, live = true) {
    const g = this.g, p = g.player, w = g.world;
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const S = Math.min(r.width, r.height), k = S / (HALF * 2 - 10), flip = p.team === 1;
    const ox = (r.width - S) / 2, oy = (r.height - S) / 2;
    c.clearRect(0, 0, r.width, r.height);
    c.save();
    c.translate(ox + S / 2, oy + S / 2);
    if (flip) c.rotate(Math.PI);
    c.scale(k, k);
    c.drawImage(w.minimap, -HALF, -HALF);
    c.restore();
    const toS = (x, z) => [ox + S / 2 + (flip ? -x : x) * k, oy + S / 2 + (flip ? -z : z) * k];
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (const f of g.flags) {
      const [x, y] = toS(f.x, f.z);
      const rel = this.rel(f.owner);
      c.fillStyle = 'rgba(15,12,10,0.7)'; c.beginPath(); c.arc(x, y, 16, 0, TAU); c.fill();
      c.lineWidth = 3;
      c.strokeStyle = COL[rel]; c.beginPath(); c.arc(x, y, 13, 0, TAU); c.stroke();
      const prog = f.control * (p.team === 0 ? 1 : -1);
      c.strokeStyle = prog >= 0 ? COL.friend : COL.enemy; c.lineWidth = 4;
      c.beginPath(); c.arc(x, y, 18, -Math.PI / 2, -Math.PI / 2 + Math.abs(prog) * TAU); c.stroke();
      c.fillStyle = COL[rel]; c.font = '700 15px Oswald, sans-serif'; c.fillText(f.id, x, y + 1);
      c.fillStyle = 'rgba(236,229,209,0.85)'; c.font = '500 10px Oswald, sans-serif'; c.fillText(f.name, x, y + 28);
    }
    if (!live) return toS;
    for (const s of g.soldiers) {
      if (s === p || s.state === 'dead') continue;
      const friend = s.team === p.team;
      if (!friend && s.spottedUntil < g.time) continue;
      const sp = s.vehicle ? s.vehicle.pos : s.pos;
      const [x, y] = toS(sp.x, sp.z);
      c.fillStyle = s.state === 'downed' ? '#ff9a3d' : friend ? (s.squad ? COL.squad : COL.friend) : COL.enemy;
      c.beginPath(); c.arc(x, y, s.squad ? 4 : 3, 0, TAU); c.fill();
    }
    for (const v of g.vehicles) {
      if (!v.alive) continue;
      const friend = v.team === p.team;
      const [x, y] = toS(v.pos.x, v.pos.z);
      c.fillStyle = friend ? COL.friend : COL.enemy;
      const rr = v.kind === 'airship' ? 10 : 6;
      c.fillRect(x - rr, y - rr * 0.6, rr * 2, rr * 1.2);
    }
    const pp = p.vehicle ? p.vehicle.pos : p.pos;
    const [px, py] = toS(pp.x, pp.z);
    const a = -g.viewYaw + (flip ? Math.PI : 0);
    c.save(); c.translate(px, py); c.rotate(a);
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -9); c.lineTo(-6, 6); c.lineTo(6, 6); c.closePath(); c.fill(); c.stroke();
    c.restore();
    return toS;
  }
}
