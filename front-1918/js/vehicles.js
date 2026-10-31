// Техника: лёгкий танк (по одному на сторону), цеппелин поддержки для отстающей стороны и бипланы для атмосферы
import * as THREE from './three.module.min.js';
import { GeoBuilder, clamp, lerp, angleDiff, DEG, TAU, rand, dirFromYawPitch, raySphere, smoothstep } from './util.js';
import { TEAMS } from './config.js';
import { PLAY } from './world.js';

const _push = {};
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

function tankGeos(team) {
  const T = TEAMS[team];
  const hull = new GeoBuilder(), tur = new GeoBuilder(), gun = new GeoBuilder();
  const c = T.tank, dk = T.tankDark, trk = 0x2a2723;
  if (team === 0) {
    // Узкий корпус с покатым носом и «хвостом»
    hull.box(1.7, 1.15, 4.0, 0, 1.15, 0, c);
    hull.box(1.7, 0.9, 1.2, 0, 1.0, -2.3, c, 0, 0.55);
    hull.box(1.5, 0.5, 1.4, 0, 0.75, 2.6, dk, 0, -0.35);
    hull.box(1.0, 0.4, 0.9, 0, 1.85, 0.9, dk);
    for (let i = 0; i < 6; i++) hull.box(1.72, 0.05, 0.06, 0, 1.5, -1.6 + i * 0.6, dk, 0, 0, 0, 0.02);
  } else {
    // Коробчатый корпус
    hull.box(2.3, 1.3, 4.4, 0, 1.25, 0, c);
    hull.box(2.3, 0.8, 1.0, 0, 1.15, -2.55, c, 0, 0.5);
    hull.box(2.0, 0.35, 3.6, 0, 2.05, 0.2, dk);
    for (let i = 0; i < 9; i++) hull.box(0.6, 0.6, 0.5, (Math.random() - 0.5) * 1.8, 1.6 + Math.random() * 0.4, (Math.random() - 0.5) * 3.8, Math.random() < 0.5 ? 0x6c6347 : 0x48503e, 0, 0, 0, 0.04);
  }
  const w = team === 0 ? 1.05 : 1.35;
  for (const s of [-1, 1]) {
    hull.box(0.48, 1.05, 5.0, s * w, 0.62, 0, trk, 0, 0, 0, 0.03);
    hull.box(0.5, 0.6, 1.0, s * w, 0.9, -2.55, trk, 0, 0.6);
    for (let i = 0; i < 6; i++) hull.cyl(0.3, 0.3, 0.1, 8, s * (w + 0.26), 0.45, -1.9 + i * 0.76, 0x3a3630, 0, 0, Math.PI / 2, 0.02);
    for (let i = 0; i < 16; i++) hull.box(0.52, 0.05, 0.12, s * w, 1.16, -2.4 + i * 0.32, 0x1d1b18, 0, 0, 0, 0.02);
  }
  // Башня и пушка
  tur.cyl(0.7, 0.78, 0.75, 8, 0, 0.37, 0, c, 0, Math.PI / 8);
  tur.dome(0.55, 0, 0.74, 0, dk, 1, 0.5, 1, 8);
  tur.box(0.5, 0.42, 0.3, 0, 0.38, -0.78, dk);
  tur.box(0.2, 0.14, 0.12, 0.42, 0.42, -0.7, 0x222220);
  gun.cyl(0.075, 0.09, 1.5, 8, 0, 0, -0.75, 0x33332f, Math.PI / 2);
  gun.cyl(0.1, 0.1, 0.14, 8, 0, 0, -1.48, 0x2a2a27, Math.PI / 2);
  return { hull: hull.build(), tur: tur.build(), gun: gun.build() };
}

export class Tank {
  constructor(game, team, spawn) {
    this.game = game;
    this.team = team;
    this.spawnPt = spawn;
    this.maxHp = 1000;
    this.kind = 'tank';
    const g = tankGeos(team);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.root = new THREE.Group();
    this.hull = new THREE.Mesh(g.hull, this.mat);
    this.turret = new THREE.Group();
    this.turret.position.set(0, team === 0 ? 1.72 : 2.2, team === 0 ? 0.3 : 0);
    const tm = new THREE.Mesh(g.tur, this.mat);
    this.gunPivot = new THREE.Group();
    this.gunPivot.position.set(0, 0.38, -0.82);
    this.gun = new THREE.Mesh(g.gun, this.mat);
    this.gunPivot.add(this.gun);
    this.turret.add(tm, this.gunPivot);
    this.root.add(this.hull, this.turret);
    for (const m of [this.hull, tm, this.gun]) { m.castShadow = true; m.receiveShadow = true; }
    game.scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.input = { throttle: 0, steer: 0, aimYaw: 0, aimPitch: 0, fire: false, mg: false };
    this.emitter = null;
    this.respawn();
  }
  respawn() {
    const w = this.game.world, s = this.spawnPt;
    this.pos.set(s.x, w.height(s.x, s.z), s.z);
    this.yaw = s.yaw; this.speed = 0;
    this.turretYaw = s.yaw; this.gunPitch = 0;
    this.pitch = 0; this.roll = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.driver = null;
    this.reload = 0; this.mgCd = 0; this.recoil = 0;
    this.respawnT = 0;
    this.lastDriverExit = -99;
    this.mat.color.setHex(0xffffff);
    this.root.visible = true;
    this.setEmitter(0);
  }
  setEmitter(level) {
    const fx = this.game.effects;
    if (this.emitter) { fx.emitters.splice(fx.emitters.indexOf(this.emitter), 1); this.emitter = null; }
    if (level > 0) { this.emitter = { x: 0, y: 0, z: 0, rate: level, size: 1 }; fx.emitters.push(this.emitter); }
  }
  get forwardX() { return -Math.sin(this.yaw); }
  get forwardZ() { return -Math.cos(this.yaw); }
  muzzle(out) {
    this.gun.updateWorldMatrix(true, false);
    return out.set(0, 0, -1.6).applyMatrix4(this.gun.matrixWorld);
  }
  gunDir(out) {
    this.gun.updateWorldMatrix(true, false);
    return out.set(0, 0, -1).transformDirection(this.gun.matrixWorld);
  }
  enter(s) {
    if (!this.alive || this.driver) return false;
    this.driver = s;
    s.vehicle = this;
    s.reloadT = 0; s.adsT = 0;
    this.input.aimYaw = this.turretYaw; this.input.aimPitch = this.gunPitch;
    return true;
  }
  exit() {
    const s = this.driver;
    if (!s) return;
    this.driver = null;
    s.vehicle = null;
    this.lastDriverExit = this.game.time;
    const w = this.game.world;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let px = this.pos.x + rx * 2.6, pz = this.pos.z + rz * 2.6;
    if (w.blockedAt(px, pz, w.height(px, pz), 0.5)) { px = this.pos.x - rx * 2.6; pz = this.pos.z - rz * 2.6; }
    s.pos.set(px, w.groundAt(px, pz, w.height(px, pz) + 1), pz);
    s.vel.set(0, 0, 0);
    s.yaw = this.turretYaw;
    this.input.throttle = 0; this.input.steer = 0; this.input.fire = false; this.input.mg = false;
  }
  update(dt) {
    const g = this.game, w = g.world;
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.emitter) { this.emitter.x = this.pos.x; this.emitter.y = this.pos.y + 2; this.emitter.z = this.pos.z; }
      if (Math.random() < dt * 6) g.effects.fire(this.pos.x, this.pos.y + 1.8, this.pos.z, 1.2);
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    const inp = this.input;
    if (!this.driver) { inp.throttle = 0; inp.steer = 0; inp.fire = false; inp.mg = false; }
    const tgt = inp.throttle * (inp.throttle > 0 ? 6.8 : 3.2);
    const acc = Math.abs(tgt) > Math.abs(this.speed) ? 3.2 : 6;
    this.speed += clamp(tgt - this.speed, -acc * dt, acc * dt);
    const turn = inp.steer * 0.85 * (this.speed < -0.2 ? -1 : 1);
    this.yaw -= turn * dt;
    const p = this.pos, ox = p.x, oz = p.z;
    p.x += this.forwardX * this.speed * dt;
    p.z += this.forwardZ * this.speed * dt;
    w.pushCircle(p, 2.3, p.y + 0.9, p.y + 2.6, _push);
    if (_push.hits) { w.pushCircle(p, 2.3, p.y + 0.9, p.y + 2.6, _push); this.speed *= Math.pow(0.1, dt); }
    p.x = clamp(p.x, -PLAY + 2, PLAY - 2); p.z = clamp(p.z, -PLAY + 2, PLAY - 2);
    // Наклон по рельефу
    const fx = this.forwardX, fz = this.forwardZ, rx = -fz, rz = fx;
    const hf = w.height(p.x + fx * 2.1, p.z + fz * 2.1), hb = w.height(p.x - fx * 2.1, p.z - fz * 2.1);
    const hl = w.height(p.x - rx * 1.2, p.z - rz * 1.2), hr = w.height(p.x + rx * 1.2, p.z + rz * 1.2);
    const hc = w.height(p.x, p.z);
    const ty = Math.max(hc, (hf + hb + hl + hr) / 4);
    p.y = lerp(p.y, ty, Math.min(1, dt * 10));
    this.pitch = lerp(this.pitch, Math.atan2(hf - hb, 4.2), Math.min(1, dt * 6));
    this.roll = lerp(this.roll, Math.atan2(hr - hl, 2.4), Math.min(1, dt * 6));
    // Наводка башни
    const dy = angleDiff(this.turretYaw, inp.aimYaw);
    this.turretYaw += clamp(dy, -1.3 * dt, 1.3 * dt);
    const pTarget = clamp(inp.aimPitch - this.pitch, -0.15, 0.4);
    this.gunPitch += clamp(pTarget - this.gunPitch, -0.9 * dt, 0.9 * dt);
    this.reload -= dt; this.mgCd -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 2.5);
    if (inp.fire && this.reload <= 0) this.fireCannon();
    if (inp.mg && this.mgCd <= 0) this.fireMG();
    // Давим врагов
    if (Math.abs(this.speed) > 1.5) {
      for (const s of g.soldiers) {
        if (s.state === 'dead' || s.vehicle) continue;
        const dx = s.pos.x - p.x, dz = s.pos.z - p.z;
        if (dx * dx + dz * dz > 6.5 || Math.abs(s.pos.y - p.y) > 2) continue;
        if (s.team !== this.team) g.combat.damage(s, 200, this.driver, 'tank', false, dx, dz, true);
      }
    }
    this.sync();
    if (this.emitter) { this.emitter.x = p.x; this.emitter.y = p.y + 2.2; this.emitter.z = p.z; }
    if (this.driver && this.driver.isPlayer) g.audio.engine(0.2 + Math.min(1, Math.abs(this.speed) / 6.8) * 0.8);
  }
  sync() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.turret.rotation.set(0, this.turretYaw - this.yaw, 0);
    this.gunPivot.rotation.set(this.gunPitch, 0, 0);
    this.gun.position.z = this.recoil * 0.35;
  }
  fireCannon() {
    const g = this.game;
    this.reload = 3.4;
    this.recoil = 1;
    const m = this.muzzle(_v.clone());
    const d = this.gunDir(_d);
    g.combat.spawnShell(this, m, d);
    g.effects.muzzle(m.x, m.y, m.z, d.x, d.y, d.z, true);
    for (let i = 0; i < 4; i++) g.effects.smokePuff(m.x + d.x * i * 0.6, m.y, m.z + d.z * i * 0.6, 0.8);
    g.effects.flash(m.x, m.y, m.z, 25, 20, 0.15);
    g.audio.shot('cannon', m.x, m.y, m.z, this.driver && this.driver.isPlayer);
    if (this.driver && this.driver.isPlayer) g.shake(0.5);
    if (this.driver) this.driver.spottedUntil = g.time + 4;
  }
  fireMG() {
    const g = this.game;
    this.mgCd = 0.1;
    const m = this.muzzle(_v.clone());
    m.y -= 0.02;
    const d = this.gunDir(_d.clone());
    const sp = 1.8 * DEG;
    d.x += (Math.random() - 0.5) * sp * 2; d.y += (Math.random() - 0.5) * sp * 2; d.z += (Math.random() - 0.5) * sp * 2;
    d.normalize();
    g.combat.mgShot(this.driver, this, m, d, 22, 170);
    g.audio.shot('mg', m.x, m.y, m.z, this.driver && this.driver.isPlayer);
  }
  // Пересечение луча с корпусом (без учёта наклона)
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const rx = ox - this.pos.x, rz = oz - this.pos.z, ry = oy - (this.pos.y + 1.3);
    const lx = rx * c - rz * s, lz = rx * s + rz * c;
    const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
    const H = [1.5, 1.3, 2.8], O = [lx, ry, lz], D = [ldx, dy, ldz];
    let tmin = 0, tmax = maxT;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(D[a]) < 1e-9) { if (O[a] < -H[a] || O[a] > H[a]) return -1; continue; }
      let t1 = (-H[a] - O[a]) / D[a], t2 = (H[a] - O[a]) / D[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }
  damage(amount, attacker) {
    if (!this.alive) return;
    const g = this.game;
    amount = Math.min(amount, this.hp);
    this.hp -= amount;
    if (attacker && attacker.team !== this.team) {
      g.addScore(attacker, Math.round(amount / 10) * 2, null);
      if (attacker.isPlayer) g.hud.hitMarker(false, false, true);
    }
    if (this.driver && this.driver.bot) this.driver.bot.onDamaged(attacker);
    if (this.driver && this.driver.isPlayer) { g.onPlayerHurt(0, attacker, 0, 0); g.shake(0.4); }
    this.setEmitter(this.hp < this.maxHp * 0.25 ? 3 : this.hp < this.maxHp * 0.55 ? 1.2 : 0);
    if (this.hp <= 0) this.destroy(attacker);
  }
  destroy(attacker) {
    const g = this.game;
    this.alive = false;
    this.hp = 0;
    this.respawnT = 50;
    this.mat.color.setHex(0x3a3633);
    g.effects.explosion(this.pos.x, this.pos.y + 1.2, this.pos.z, 1.8);
    g.audio.explosion(this.pos.x, this.pos.y, this.pos.z, 1.6);
    this.setEmitter(2.5);
    const d = this.driver;
    if (d) {
      this.exit();
      g.combat.damage(d, 999, attacker, 'tank', false, 0, 0, true);
      g.combat.finishOff(d, attacker);
    }
    if (attacker && attacker.team !== this.team) {
      g.addScore(attacker, 500, 'Танк уничтожен');
      g.hud.killfeed(attacker, 'at', { name: 'Танк ' + TEAMS[this.team].adj, team: this.team }, false);
    }
    g.combat.explode(this.pos.x, this.pos.y + 1, this.pos.z, 6, 80, attacker, 'tank', 0);
    if (g.player && g.player.team === this.team) g.hud.announce('Наш танк уничтожен', false);
  }
}

// ---------- Цеппелин ----------
function airshipGeo(team) {
  const T = TEAMS[team];
  const b = new GeoBuilder();
  b.sphere(1, 0, 0, 0, 0x8e8b82, 8, 7.5, 30, 2, 0.04);
  for (const z of [-14, -4, 6, 16]) b.cyl(7.6 * Math.sqrt(1 - (z / 30) ** 2), 7.6 * Math.sqrt(1 - (z / 30) ** 2), 0.4, 14, 0, 0, z, 0x77746c, Math.PI / 2, 0, 0, 0.02);
  b.box(2.2, 2.0, 12, 0, -8.5, 2, 0x5a5348);
  b.box(0.3, 1.5, 0.3, 0, -7.3, -2, 0x3a3630);
  b.box(0.3, 1.5, 0.3, 0, -7.3, 6, 0x3a3630);
  for (const s of [-1, 1]) {
    b.box(1.0, 1.0, 2.6, s * 4.5, -6.6, 6, 0x4a463e);
  }
  b.box(0.3, 9, 6, 0, 0, 27, 0x6d6a62);
  b.box(13, 0.3, 6, 0, 0, 27, 0x6d6a62);
  b.box(8.3, 0.6, 3, 0, 4.5, -10, T.banner);
  b.box(8.3, 0.6, 3, 0, 4.5, 14, T.banner);
  return b.build();
}

export class Airship {
  constructor(game, team) {
    this.game = game;
    this.team = team;
    this.kind = 'airship';
    this.maxHp = 5200;
    this.hp = this.maxHp;
    this.alive = true;
    this.crashing = false;
    const hq = game.world.def.hq[team];
    this.pos = new THREE.Vector3(hq.x + rand(-40, 40), 95, hq.z + (team === 0 ? 40 : -40));
    this.yaw = hq.yaw;
    this.mesh = new THREE.Mesh(airshipGeo(team), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
    this.bombCd = 0;
    this.gunCd = [0, 0, 0];
    this.crashT = 0;
    this.target = null;
    this.sync();
  }
  sync() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(-this.crashT * 0.05, this.yaw, this.crashT * 0.03, 'YXZ');
  }
  update(dt) {
    const g = this.game, w = g.world;
    if (this.crashing) {
      this.crashT += dt;
      this.pos.y -= dt * (3 + this.crashT * 2.2);
      this.pos.x += -Math.sin(this.yaw) * 4 * dt; this.pos.z += -Math.cos(this.yaw) * 4 * dt;
      for (let i = 0; i < 3; i++) g.effects.fire(this.pos.x + rand(-6, 6), this.pos.y + rand(-3, 5), this.pos.z + rand(-20, 20), 3);
      if (Math.random() < dt * 8) g.effects.smokePuff(this.pos.x + rand(-6, 6), this.pos.y, this.pos.z + rand(-20, 20), 3, true);
      if (this.pos.y < w.height(this.pos.x, this.pos.z) + 4) {
        g.combat.explode(this.pos.x, this.pos.y, this.pos.z, 18, 220, this.killer, 'airship', 600, 2.5, -1);
        for (let i = 0; i < 4; i++) g.effects.explosion(this.pos.x + rand(-10, 10), this.pos.y, this.pos.z + rand(-25, 25), 2.2);
        g.scene.remove(this.mesh);
        this.alive = false;
      }
      this.sync();
      return;
    }
    // Цель — вражеский флаг (или центр)
    let best = null, bd = Infinity;
    for (const f of g.flags) {
      if (f.owner === this.team) continue;
      const d = Math.hypot(f.x - this.pos.x, f.z - this.pos.z) + (f.owner === -1 ? 60 : 0);
      if (d < bd) { bd = d; best = f; }
    }
    const tx = best ? best.x : 0, tz = best ? best.z : 0;
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(-dx, -dz);
    const turn = dist < 35 ? 0.05 : 0.16;
    this.yaw += clamp(angleDiff(this.yaw, want), -turn * dt, turn * dt);
    const sp = 8.5;
    this.pos.x += -Math.sin(this.yaw) * sp * dt;
    this.pos.z += -Math.cos(this.yaw) * sp * dt;
    this.pos.x = clamp(this.pos.x, -PLAY - 20, PLAY + 20); this.pos.z = clamp(this.pos.z, -PLAY - 20, PLAY + 20);
    this.pos.y = lerp(this.pos.y, Math.max(85, w.height(this.pos.x, this.pos.z) + 75), dt * 0.3);
    // Бомбы над целью
    this.bombCd -= dt;
    if (best && dist < 26 && this.bombCd <= 0) {
      this.bombCd = 0.55;
      g.combat.spawnBomb(this, this.pos.x + rand(-4, 4), this.pos.y - 9, this.pos.z + rand(-8, 8));
    }
    // Бортовые пулемёты
    const guns = [[0, -9.5, 8], [4.5, -6.6, 6], [-4.5, -6.6, 6]];
    for (let i = 0; i < 3; i++) {
      this.gunCd[i] -= dt;
      if (this.gunCd[i] > 0) continue;
      this.gunCd[i] = 0.14;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const [lx, ly, lz] = guns[i];
      const gx = this.pos.x + lx * c + lz * s, gy = this.pos.y + ly, gz = this.pos.z - lx * s + lz * c;
      let tgt = null, td = 115;
      for (const so of g.soldiers) {
        if (so.team === this.team || so.state !== 'alive' || so.vehicle) continue;
        const d = Math.hypot(so.pos.x - gx, so.pos.y - gy, so.pos.z - gz);
        if (d < td) { td = d; tgt = so; }
      }
      if (!tgt) { this.gunCd[i] = 0.6; continue; }
      if (!w.los(gx, gy, gz, tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z)) { this.gunCd[i] = 0.5; continue; }
      _d.set(tgt.pos.x - gx, tgt.pos.y + 1.1 - gy, tgt.pos.z - gz).normalize();
      const sp2 = 3.2 * DEG;
      _d.x += rand(-sp2, sp2); _d.y += rand(-sp2, sp2); _d.z += rand(-sp2, sp2);
      _d.normalize();
      g.combat.mgShot(null, this, _v.set(gx, gy, gz), _d, 13, 160);
      g.audio.shot('aa', gx, gy, gz, false);
    }
    this.sync();
  }
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    // Эллипсоид 8 × 7.5 × 30 вдоль курса
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const rx = ox - this.pos.x, ry = oy - this.pos.y, rz = oz - this.pos.z;
    const lx = (rx * c - rz * s) / 8, ly = ry / 7.5, lz = (rx * s + rz * c) / 30;
    let ldx = (dx * c - dz * s) / 8, ldy = dy / 7.5, ldz = (dx * s + dz * c) / 30;
    const L = Math.hypot(ldx, ldy, ldz);
    ldx /= L; ldy /= L; ldz /= L;
    const t = raySphere(lx, ly, lz, ldx, ldy, ldz, 0, 0, 0, 1);
    if (t < 0) return -1;
    const tw = t / L;
    return tw <= maxT ? tw : -1;
  }
  damage(amount, attacker) {
    if (this.crashing) return;
    const g = this.game;
    amount = Math.min(amount, this.hp);
    this.hp -= amount;
    if (attacker && attacker.isPlayer) g.hud.hitMarker(false, false, true);
    if (attacker && attacker.team !== this.team) g.addScore(attacker, Math.max(1, Math.round(amount / 25)), null);
    if (this.hp <= 0) {
      this.crashing = true;
      this.killer = attacker;
      if (attacker && attacker.team !== this.team) g.addScore(attacker, 800, 'Цеппелин сбит');
      g.hud.announce(this.team === g.player.team ? 'Наш цеппелин сбит!' : 'Вражеский цеппелин сбит!', this.team !== g.player.team);
      g.audio.explosion(this.pos.x, this.pos.y, this.pos.z, 2);
      g.effects.airburst(this.pos.x, this.pos.y, this.pos.z);
    }
  }
}

// ---------- Бипланы для атмосферы ----------
export class Biplane {
  constructor(game, team, phase) {
    this.game = game;
    const T = TEAMS[team];
    const b = new GeoBuilder();
    b.box(0.9, 0.9, 5.5, 0, 0, 0, T.tank);
    b.box(9, 0.12, 1.4, 0, 0.9, -0.6, 0xb7ab8a);
    b.box(8.4, 0.12, 1.3, 0, -0.35, -0.5, 0xb7ab8a);
    for (const s of [-3.4, 3.4]) b.box(0.08, 1.25, 0.08, s, 0.28, -0.5, 0x3a3630);
    b.box(3, 0.1, 0.9, 0, 0.2, 2.5, 0xb7ab8a);
    b.box(0.1, 1.1, 0.9, 0, 0.7, 2.6, T.banner);
    b.cyl(0.35, 0.35, 0.3, 8, 0, 0, -2.9, 0x3a3630, Math.PI / 2);
    this.mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    const pb = new GeoBuilder();
    pb.box(0.15, 2.6, 0.06, 0, 0, 0, 0x4a3826);
    this.prop = new THREE.Mesh(pb.build(), this.mesh.material);
    this.prop.position.z = -3.1;
    this.mesh.add(this.prop);
    game.scene.add(this.mesh);
    this.t = phase;
    this.r = rand(70, 110);
    this.cx = rand(-30, 30); this.cz = rand(-30, 30);
    this.h = rand(70, 105);
    this.speed = 0.17 * (team ? -1 : 1);
  }
  update(dt) {
    this.t += dt * this.speed;
    const x = this.cx + Math.cos(this.t) * this.r, z = this.cz + Math.sin(this.t * 2) * this.r * 0.5;
    const nx = this.cx + Math.cos(this.t + 0.01 * Math.sign(this.speed)) * this.r, nz = this.cz + Math.sin((this.t + 0.01 * Math.sign(this.speed)) * 2) * this.r * 0.5;
    const yaw = Math.atan2(-(nx - x), -(nz - z));
    const bank = clamp(angleDiff(this.lastYaw ?? yaw, yaw) * 60, -0.8, 0.8);
    this.lastYaw = yaw;
    this.mesh.position.set(x, this.h + Math.sin(this.t * 3) * 6, z);
    this.mesh.rotation.set(0, yaw, -bank, 'YXZ');
    this.prop.rotation.z += dt * 40;
  }
}
