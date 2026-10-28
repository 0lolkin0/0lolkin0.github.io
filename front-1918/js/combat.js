// Бой: выстрелы-лучи, урон, ранения и оживление, гранаты, снаряды, взрывы, штык, ящики снабжения и ракеты
import * as THREE from './three.module.min.js';
import { GeoBuilder, clamp, lerp, smoothstep, rand, DEG, TAU, raySphere, rayCapsule, pointSegDist3, dirFromYawPitch } from './util.js';
import { WEAPONS, GRENADE, SCORE, TEAMS } from './config.js';

const _d = new THREE.Vector3(), _o = new THREE.Vector3(), _m = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
const _hit = {}, _shape = {};
const UP = new THREE.Vector3(0, 1, 0);

function projGeo(type, team) {
  const b = new GeoBuilder();
  if (type === 'frag') {
    if (team === 1) { b.cyl(0.035, 0.035, 0.3, 6, 0, 0, 0, 0x6b4a2c); b.cyl(0.06, 0.06, 0.12, 8, 0, 0.18, 0, 0x4d4f48); }
    else b.sphere(0.07, 0, 0, 0, 0x4f553e, 0.8, 1.15, 0.8, 1);
  } else if (type === 'at') {
    b.cyl(0.035, 0.035, 0.3, 6, 0, 0, 0, 0x6b4a2c);
    for (let i = 0; i < 5; i++) b.cyl(0.05, 0.05, 0.16, 6, Math.cos(i * 1.26) * 0.08, 0.2, Math.sin(i * 1.26) * 0.08, 0x4d4f48);
  } else if (type === 'flare') b.cyl(0.03, 0.03, 0.12, 6, 0, 0, 0, 0xc04030);
  else if (type === 'shell') b.cyl(0.05, 0.08, 0.5, 6, 0, 0, 0, 0x9a7b3f, Math.PI / 2);
  else if (type === 'bomb') { b.cyl(0.12, 0.18, 0.9, 8, 0, 0, 0, 0x3f403b); b.box(0.4, 0.3, 0.02, 0, 0.5, 0, 0x3f403b); }
  return b.build();
}
function crateGeo(type) {
  const b = new GeoBuilder();
  if (type === 'medkit') {
    b.box(0.55, 0.35, 0.38, 0, 0.175, 0, 0xd8d2c0);
    b.box(0.3, 0.08, 0.39, 0, 0.2, 0, 0xb02a24);
    b.box(0.08, 0.28, 0.39, 0, 0.2, 0, 0xb02a24);
    b.box(0.56, 0.03, 0.39, 0, 0.36, 0, 0x6d5a3f);
  } else {
    b.box(0.7, 0.42, 0.42, 0, 0.21, 0, 0x5a5a3e);
    b.box(0.72, 0.05, 0.44, 0, 0.42, 0, 0x3d3d2a);
    b.box(0.2, 0.12, 0.43, -0.15, 0.25, 0, 0xc9a640);
    b.box(0.2, 0.12, 0.43, 0.15, 0.25, 0, 0xc9a640);
  }
  return b.build();
}

export class Combat {
  constructor(game) {
    this.g = game;
    this.projectiles = [];
    this.deployables = [];
    this.flares = [];
    this.geos = {};
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.lastWhiz = 0;
  }
  geo(key, fn) { return this.geos[key] || (this.geos[key] = fn()); }

  // ---------- Пули ----------
  spreadDir(base, spread, out) {
    if (spread <= 0) return out.copy(base);
    const r = spread * Math.sqrt(Math.random()), a = Math.random() * TAU;
    _r.crossVectors(base, UP);
    if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
    _r.normalize();
    _u.crossVectors(_r, base).normalize();
    out.copy(base).addScaledVector(_r, Math.tan(r) * Math.cos(a)).addScaledVector(_u, Math.tan(r) * Math.sin(a)).normalize();
    return out;
  }
  // Ближайшая цель луча: солдат / техника / мир
  trace(shooter, team, ox, oy, oz, dx, dy, dz, range) {
    const g = this.g;
    let best = g.world.raycast(ox, oy, oz, dx, dy, dz, range, _hit);
    const res = { t: best, target: null, head: false, world: best < Infinity, nx: _hit.nx, ny: _hit.ny, nz: _hit.nz, mat: _hit.mat };
    for (const s of g.soldiers) {
      if (s.team === team || s.state === 'dead' || s.vehicle || s === shooter) continue;
      const cx = s.pos.x - ox, cy = s.pos.y + 0.9 - oy, cz = s.pos.z - oz;
      const tc = cx * dx + cy * dy + cz * dz;
      if (tc < -2 || tc > best + 2) continue;
      const px = cx - dx * tc, py = cy - dy * tc, pz = cz - dz * tc;
      if (px * px + py * py + pz * pz > 4.5) continue;
      s.hitShape(_shape);
      const th = raySphere(ox, oy, oz, dx, dy, dz, _shape.hx, _shape.hy, _shape.hz, _shape.hr);
      const tb = rayCapsule(ox, oy, oz, dx, dy, dz, _shape.ax, _shape.ay, _shape.az, _shape.bx, _shape.by, _shape.bz, _shape.r);
      let t = -1, head = false;
      if (th >= 0 && (tb < 0 || th <= tb + 0.2)) { t = th; head = true; } else if (tb >= 0) t = tb;
      if (t >= 0 && t < best) { best = t; res.t = t; res.target = s; res.head = head; }
    }
    for (const v of g.vehicles) {
      if (!v.alive || v.team === team) continue;
      const t = v.rayHit(ox, oy, oz, dx, dy, dz, best);
      if (t >= 0 && t < best) { best = t; res.t = t; res.target = v; res.head = false; }
    }
    return res;
  }
  fireWeapon(s) {
    const g = this.g, w = s.weapon;
    if (s.isPlayer && !s.bot) {
      _o.set(s.pos.x, s.eyeY, s.pos.z);
      g.camera.getWorldDirection(_d);
    } else {
      _o.set(s.pos.x, s.eyeY, s.pos.z);
      s.aimDir(_d);
    }
    this.spreadDir(_d, s.spread(), _d);
    const res = this.trace(s, s.team, _o.x, _o.y, _o.z, _d.x, _d.y, _d.z, w.range);
    const t = Math.min(res.t, w.range);
    const hx = _o.x + _d.x * t, hy = _o.y + _d.y * t, hz = _o.z + _d.z * t;
    if (res.target) {
      if (res.target.kind) res.target.damage(res.target.kind === 'airship' ? (w.dmg[0] * 0.4) : 2, s);
      else {
        let dmg = lerp(w.dmg[0], w.dmg[1], smoothstep(w.fall[0], w.fall[1], t));
        if (w.sweet && t >= w.sweet[0] && t <= w.sweet[1]) dmg = 100;
        if (res.head) dmg *= w.head;
        if (s.bot && res.target.isPlayer) dmg *= g.diff.dmgMul;
        this.damage(res.target, dmg, s, w.id, res.head, _d.x, _d.z, false);
        g.effects.blood(hx, hy, hz, -_d.x, -_d.y, -_d.z);
      }
      if (res.target.kind === 'tank') g.effects.impact(hx, hy, hz, -_d.x, -_d.y, -_d.z, 'metal');
    } else if (res.world) {
      g.effects.impact(hx, hy, hz, res.nx, res.ny, res.nz, res.mat);
    }
    // Дуло, трассер, звук
    if (s.isPlayer) g.viewmodel.muzzleWorld(_m);
    else s.muzzle(_m);
    s.shotN = (s.shotN || 0) + 1;
    if (s.shotN % w.tracerEvery === 0) g.effects.tracers.add(_m.x, _m.y, _m.z, hx, hy, hz, w.id === 'bolt' ? 600 : 430);
    if (!s.isPlayer) g.effects.muzzle(_m.x, _m.y, _m.z, _d.x, _d.y, _d.z, w.id === 'lmg' || w.id === 'bolt');
    else g.effects.flash(_m.x, _m.y, _m.z, w.id === 'bolt' ? 6 : 3.5, 12, 0.06, 0xffc070, 2);
    g.audio.shot(w.snd, _m.x, _m.y, _m.z, s.isPlayer);
    if (s.isPlayer) {
      const k = lerp(1, 0.7, s.adsT) * lerp(1, 0.8, s.crouchT);
      s.recoilP += w.recoil * rand(0.85, 1.15) * DEG * k;
      s.recoilY += rand(-1, 1) * w.recoilYaw * DEG * k;
      g.viewmodel.kick(w);
      if (w.id === 'bolt' || w.id === 'semi') g.shake(w.id === 'bolt' ? 0.12 : 0.05);
    }
    if (s.bot) s.bot.onFired();
    this.whizCheck(s, _o, _d, t);
    g.hearShot(s);
  }
  whizCheck(shooter, o, d, len) {
    const g = this.g, p = g.player;
    if (!p || shooter.team === p.team || p.state !== 'alive' || p.vehicle) return;
    const ey = p.eyeY;
    const dist = pointSegDist3(p.pos.x, ey, p.pos.z, o.x, o.y, o.z, d.x, d.y, d.z, len);
    if (dist < 2.6 && dist > 0.3 && g.time - this.lastWhiz > 0.07) {
      this.lastWhiz = g.time;
      const pan = g.audio.spatial(o.x + d.x * len * 0.5, ey, o.z + d.z * len * 0.5).pan;
      g.audio.whiz(pan);
      g.hud.suppress(1 - dist / 2.6);
    }
  }
  mgShot(shooter, vehicle, o, d, dmg, range) {
    const g = this.g;
    const team = vehicle ? vehicle.team : shooter.team;
    const res = this.trace(shooter, team, o.x, o.y, o.z, d.x, d.y, d.z, range);
    const t = Math.min(res.t, range);
    const hx = o.x + d.x * t, hy = o.y + d.y * t, hz = o.z + d.z * t;
    if (res.target) {
      if (res.target.kind) res.target.damage(res.target.kind === 'airship' ? dmg * 0.4 : 2, shooter);
      else {
        let k = 1;
        if (vehicle && vehicle.kind === 'airship' && res.target.isPlayer) k = g.diff.dmgMul;
        else if (shooter && shooter.bot && res.target.isPlayer) k = g.diff.dmgMul;
        this.damage(res.target, dmg * (res.head ? 1.5 : 1) * k, shooter, vehicle ? vehicle.kind : 'mg', res.head, d.x, d.z, false);
        g.effects.blood(hx, hy, hz, -d.x, -d.y, -d.z);
      }
    } else if (res.world) g.effects.impact(hx, hy, hz, res.nx, res.ny, res.nz, res.mat);
    vehicle.mgN = (vehicle.mgN || 0) + 1;
    if (vehicle.mgN % 2 === 0) g.effects.tracers.add(o.x, o.y, o.z, hx, hy, hz, 400, 0.04, 8, 1, 0.75, 0.4);
    g.effects.muzzle(o.x, o.y, o.z, d.x, d.y, d.z, false);
    const fake = shooter || { team, isPlayer: false };
    this.whizCheck(fake, o, d, t);
    if (shooter) g.hearShot(shooter);
  }

  // ---------- Урон ----------
  damage(target, amount, attacker, wid, head, dx, dz, explosive) {
    const g = this.g;
    if (target.state === 'dead' || amount <= 0) return;
    if (target.state === 'downed') {
      if (amount >= 8) this.finishOff(target, attacker);
      return;
    }
    if (target.invuln > 0) return;
    target.hp -= amount;
    target.lastDamage = g.time;
    if (attacker && attacker !== target) {
      target.lastAttacker = attacker;
      target.damageLog.set(attacker, (target.damageLog.get(attacker) || 0) + amount);
    }
    const killed = target.hp <= 0;
    if (target.isPlayer) g.onPlayerHurt(amount, attacker, dx, dz);
    if (attacker && attacker.isPlayer && attacker !== target) g.hud.hitMarker(head, killed);
    if (target.bot) target.bot.onDamaged(attacker);
    if (killed) this.down(target, attacker, wid, head, explosive && target.hp < -70);
  }
  down(t, attacker, wid, head, gib) {
    const g = this.g;
    t.state = 'downed';
    t.hp = 0;
    t.downT = t.isPlayer ? 15 : 11;
    t.lieT = 0;
    t.reloadT = 0; t.adsT = 0; t.chargeT = 0; t.throwT = 0;
    t.vel.x *= 0.3; t.vel.z *= 0.3;
    t.downAt = g.time;
    t.stats.deaths++;
    t.killer = attacker;
    t.killWeapon = wid;
    if (attacker && attacker !== t && attacker.team !== t.team) {
      attacker.stats.kills++;
      if (head) attacker.stats.heads++;
      g.addScore(attacker, SCORE.kill + (head ? SCORE.head : 0), head ? 'Убийство в голову' : 'Убийство');
      for (const [a, d] of t.damageLog) {
        if (a !== attacker && a.team !== t.team && d >= 25) { a.stats.assists++; g.addScore(a, SCORE.assist, 'Помощь'); }
      }
      const f = g.flagAt(t.pos.x, t.pos.z);
      if (f && f.owner === attacker.team) g.addScore(attacker, SCORE.defend, 'Защита флага');
      if (attacker.bot) attacker.bot.onKill(t);
    }
    g.hud.killfeed(attacker, wid, t, head);
    g.onDowned(t, attacker);
    if (gib) this.finishOff(t, attacker);
  }
  finishOff(t, by) {
    const g = this.g;
    if (t.state === 'dead') return;
    t.state = 'dead';
    t.deadAt = g.time;
    t.respawnT = 9 + Math.random() * 3;
    g.onDeath(t);
  }
  revive(t, medic) {
    const g = this.g;
    if (t.state !== 'downed') return;
    t.state = 'alive';
    t.hp = 80;
    t.lieT = 0;
    t.invuln = 1.5;
    t.lastDamage = g.time;
    t.stats.deaths = Math.max(0, t.stats.deaths - 1);
    t.damageLog.clear();
    medic.stats.revives++;
    g.addScore(medic, SCORE.revive, 'Оживление');
    g.onRevived(t, medic);
  }

  // ---------- Штык ----------
  melee(s, charge) {
    const g = this.g;
    g.audio.melee();
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    let best = null, bd = charge ? 1.9 : 2.5;
    for (const o of g.soldiers) {
      if (o.team === s.team || o.state === 'dead' || o.vehicle) continue;
      const dx = o.pos.x - s.pos.x, dz = o.pos.z - s.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > bd || Math.abs(o.pos.y - s.pos.y) > 1.6) continue;
      if ((dx * fx + dz * fz) / (d || 1) < 0.5) continue;
      best = o; bd = d;
    }
    if (!best) return false;
    this.damage(best, 200, s, 'melee', false, fx, fz, false);
    g.effects.blood(best.pos.x, best.pos.y + 1.1, best.pos.z, fx, 0.2, fz);
    return true;
  }
  chargeCheck(s) {
    if (this.melee(s, true)) s.chargeT = 0;
  }

  // ---------- Снаряды ----------
  addProjectile(p) {
    p.mesh = new THREE.Mesh(this.geo(p.type + (p.team === 1 ? '1' : '0'), () => projGeo(p.type, p.team)), this.mat);
    p.mesh.position.copy(p.pos);
    this.g.scene.add(p.mesh);
    p.spin = rand(-12, 12);
    this.projectiles.push(p);
    return p;
  }
  throwProjectile(s, type) {
    const g = this.g;
    const spec = GRENADE[type];
    s.aimDir(_d);
    if (s.isPlayer && !s.bot) g.camera.getWorldDirection(_d);
    const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
    const o = new THREE.Vector3(s.pos.x + _d.x * 0.5 + rx * 0.2, s.eyeY - 0.1, s.pos.z + _d.z * 0.5 + rz * 0.2);
    let pitch = Math.asin(clamp(_d.y, -1, 1));
    if (type !== 'flare') pitch = clamp(pitch + 10 * DEG, -0.6, 1.2);
    else pitch = Math.max(pitch, 25 * DEG);
    const yaw = Math.atan2(-_d.x, -_d.z);
    dirFromYawPitch(yaw, pitch, _d);
    const vel = _d.clone().multiplyScalar(spec.speed);
    vel.x += s.vel.x * 0.5; vel.z += s.vel.z * 0.5;
    this.addProjectile({ type, owner: s, team: s.team, pos: o, vel, fuse: type === 'frag' ? spec.fuse : 6, age: 0, rest: false });
    g.audio.throwSnd();
  }
  spawnShell(tank, pos, dir) {
    this.addProjectile({ type: 'shell', owner: tank.driver, team: tank.team, vehicle: tank, pos: pos.clone(), vel: dir.clone().multiplyScalar(150), fuse: 4, age: 0 });
  }
  spawnBomb(ship, x, y, z) {
    this.addProjectile({ type: 'bomb', owner: null, team: ship.team, vehicle: ship, pos: new THREE.Vector3(x, y, z), vel: new THREE.Vector3(-Math.sin(ship.yaw) * 6, -2, -Math.cos(ship.yaw) * 6), fuse: 20, age: 0 });
  }
  updateProjectiles(dt) {
    const g = this.g, w = g.world;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      if (p.type === 'flare' && p.burning) {
        p.burn -= dt;
        g.effects.flareGlow(p.pos.x, p.pos.y + 0.3, p.pos.z);
        p.spotT = (p.spotT || 0) - dt;
        if (p.spotT <= 0) { p.spotT = 0.5; this.flareSpot(p); }
        if (p.burn <= 0) this.removeProj(i);
        continue;
      }
      if (!p.rest) {
        const grav = p.type === 'shell' ? 9.8 : p.type === 'bomb' ? 12 : 13;
        p.vel.y -= grav * dt;
        const sp = p.vel.length();
        const step = sp * dt;
        if (step > 1e-4) {
          _d.copy(p.vel).divideScalar(sp);
          // Прямое попадание снаряда/ПТ-гранаты в технику или солдата
          let tHit = w.raycast(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z, step, _hit);
          let directV = null;
          if (p.type === 'shell' || p.type === 'at' || p.type === 'bomb') {
            for (const v of g.vehicles) {
              if (!v.alive || v === p.vehicle || v.team === p.team) continue;
              const t = v.rayHit(p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z, Math.min(step, tHit));
              if (t >= 0) { tHit = t; directV = v; }
            }
            if (p.type !== 'bomb') {
              const r = this.trace(p.owner, p.team, p.pos.x, p.pos.y, p.pos.z, _d.x, _d.y, _d.z, Math.min(step, tHit));
              if (r.target && !r.target.kind && r.t < tHit) { tHit = r.t; directV = null; p.directS = r.target; }
            }
          }
          if (tHit <= step) {
            const hx = p.pos.x + _d.x * tHit, hy = p.pos.y + _d.y * tHit, hz = p.pos.z + _d.z * tHit;
            if (p.type === 'frag') {
              const vn = p.vel.x * _hit.nx + p.vel.y * _hit.ny + p.vel.z * _hit.nz;
              p.vel.x = (p.vel.x - 2 * vn * _hit.nx) * 0.4;
              p.vel.y = (p.vel.y - 2 * vn * _hit.ny) * 0.32;
              p.vel.z = (p.vel.z - 2 * vn * _hit.nz) * 0.4;
              p.pos.set(hx + _hit.nx * 0.06, hy + _hit.ny * 0.06, hz + _hit.nz * 0.06);
              if (p.vel.lengthSq() < 0.6) { p.rest = true; p.vel.set(0, 0, 0); }
              else g.audio.bounce(hx, hy, hz);
            } else if (p.type === 'flare') {
              p.pos.set(hx, hy + 0.05, hz);
              p.burning = true; p.burn = GRENADE.flare.time;
              if (p.mesh) p.mesh.position.copy(p.pos);
              continue;
            } else {
              p.pos.set(hx - _d.x * 0.2, hy - _d.y * 0.2, hz - _d.z * 0.2);
              this.detonate(p, directV);
              this.removeProj(i);
              continue;
            }
          } else p.pos.addScaledVector(p.vel, dt);
        }
        if (p.type === 'flare' && p.age > 1.6 && !p.burning) { p.burning = true; p.burn = GRENADE.flare.time; p.vel.set(0, 0, 0); p.rest = true; }
        if (p.type === 'flare') g.effects.flareGlow(p.pos.x, p.pos.y, p.pos.z);
        if (p.type === 'shell' && Math.random() < 0.5) g.effects.smokePuff(p.pos.x, p.pos.y, p.pos.z, 0.3);
      }
      if (p.pos.y < -20 || Math.abs(p.pos.x) > 400 || Math.abs(p.pos.z) > 400) { this.removeProj(i); continue; }
      p.fuse -= dt;
      if (p.fuse <= 0) {
        if (p.type === 'frag' || p.type === 'at') this.detonate(p, null);
        this.removeProj(i);
        continue;
      }
      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        if (!p.rest) { p.mesh.rotation.x += p.spin * dt; p.mesh.rotation.z += p.spin * 0.6 * dt; }
        if (p.type === 'shell' || p.type === 'bomb') p.mesh.lookAt(_m.copy(p.pos).add(p.vel));
      }
    }
  }
  removeProj(i) {
    const p = this.projectiles[i];
    if (p.mesh) this.g.scene.remove(p.mesh);
    this.projectiles.splice(i, 1);
  }
  detonate(p, directV) {
    const x = p.pos.x, y = p.pos.y, z = p.pos.z;
    if (p.type === 'frag') this.explode(x, y, z, GRENADE.frag.radius, GRENADE.frag.dmg, p.owner, 'frag', 120);
    else if (p.type === 'at') {
      if (directV) directV.damage(GRENADE.at.vehicle, p.owner);
      this.explode(x, y, z, GRENADE.at.radius, GRENADE.at.dmg, p.owner, 'at', directV ? 0 : 180, 0.7);
    } else if (p.type === 'shell') {
      if (directV) directV.damage(260, p.owner);
      if (p.directS) this.damage(p.directS, 150, p.owner, 'tank', false, 0, 0, true);
      this.explode(x, y, z, 5.5, 115, p.owner, 'tank', directV ? 0 : 90, 1.1);
    } else if (p.type === 'bomb') {
      if (directV) directV.damage(200, p.owner);
      this.explode(x, y, z, 9, 160, null, 'airship', 150, 1.6, p.team);
    }
  }
  // Взрыв: урон по радиусу с учётом укрытия
  explode(x, y, z, radius, dmg, owner, wid, vehicleDmg = 0, fxScale, team = owner ? owner.team : -1) {
    const g = this.g, w = g.world;
    g.effects.explosion(x, y, z, fxScale ?? radius / 6);
    g.audio.explosion(x, y, z, Math.min(2, radius / 6));
    for (const s of g.soldiers) {
      if (s.state === 'dead' || s.vehicle) continue;
      if (team >= 0 && s.team === team && s !== owner) continue;
      const cy = s.pos.y + (s.state === 'downed' ? 0.3 : 0.9);
      const dx = s.pos.x - x, dy = cy - y, dz = s.pos.z - z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) continue;
      let k = 1 - d / radius;
      k = k * 0.85 + 0.15;
      if (!w.los(x, y + 0.4, z, s.pos.x, cy, s.pos.z)) k *= 0.25;
      this.damage(s, dmg * k, owner || null, wid, false, dx, dz, true);
    }
    if (vehicleDmg) {
      for (const v of g.vehicles) {
        if (!v.alive || (team >= 0 && v.team === team) || v.kind === 'airship') continue;
        const d = Math.hypot(v.pos.x - x, v.pos.y + 1.2 - y, v.pos.z - z);
        if (d < radius + 2) v.damage(vehicleDmg * (1 - d / (radius + 2)), owner);
      }
    }
    const p = g.player, cam = g.camera.position;
    const dc = Math.hypot(cam.x - x, cam.y - y, cam.z - z);
    if (dc < 40) g.shake(Math.min(1, (1 - dc / 40) * radius / 5));
    if (p && dc < radius * 1.6) g.hud.flashWhite(1 - dc / (radius * 1.6));
  }

  // ---------- Снабжение ----------
  placeDeployable(s, type) {
    const g = this.g, w = g.world;
    for (let i = this.deployables.length - 1; i >= 0; i--) {
      const d = this.deployables[i];
      if (d.owner === s && d.type === type) { g.scene.remove(d.mesh); this.deployables.splice(i, 1); }
    }
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    let x = s.pos.x + fx * 0.9, z = s.pos.z + fz * 0.9;
    if (w.blockedAt(x, z, s.pos.y, 0.3)) { x = s.pos.x; z = s.pos.z; }
    const y = w.groundAt(x, z, s.pos.y + 0.3);
    const mesh = new THREE.Mesh(this.geo('crate_' + type, () => crateGeo(type)), this.mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = s.yaw;
    mesh.castShadow = true;
    g.scene.add(mesh);
    this.deployables.push({ type, owner: s, team: s.team, x, y, z, t: 30, tick: 0, n: 0, mesh });
    g.audio.throwSnd();
  }
  updateDeployables(dt) {
    const g = this.g;
    for (let i = this.deployables.length - 1; i >= 0; i--) {
      const d = this.deployables[i];
      d.t -= dt;
      if (d.t <= 0 || d.owner.state === 'dead' && d.t < 20) { g.scene.remove(d.mesh); this.deployables.splice(i, 1); continue; }
      d.tick -= dt;
      if (d.tick > 0) continue;
      d.tick = 1;
      d.n++;
      for (const s of g.soldiers) {
        if (s.team !== d.team || s.state !== 'alive' || s.vehicle) continue;
        if ((s.pos.x - d.x) ** 2 + (s.pos.z - d.z) ** 2 > 16 || Math.abs(s.pos.y - d.y) > 2.5) continue;
        if (d.type === 'medkit') {
          if (s.hp < 100) {
            s.hp = Math.min(100, s.hp + 18);
            g.effects.heal(s.pos.x, s.pos.y + 1, s.pos.z);
            if (s !== d.owner) g.addScore(d.owner, SCORE.heal, null);
          }
        } else {
          const wpn = s.weapon;
          let gave = false;
          const cap = wpn.reserve * (s.bot ? 2 : 1);
          if (s.reserve < cap) { s.reserve = Math.min(cap, s.reserve + Math.ceil(wpn.mag / 2)); gave = true; }
          if (d.n % 5 === 0 && s.grenades < s.cls.grenades) { s.grenades++; gave = true; }
          if (d.n % 8 === 0 && s.gadgets < s.cls.gadgetCount) { s.gadgets++; gave = true; }
          if (gave && s !== d.owner) g.addScore(d.owner, SCORE.resupply, null);
        }
      }
    }
  }
  flareSpot(p) {
    const g = this.g, R = GRENADE.flare.radius;
    for (const s of g.soldiers) {
      if (s.team === p.team || s.state !== 'alive') continue;
      if ((s.pos.x - p.pos.x) ** 2 + (s.pos.z - p.pos.z) ** 2 > R * R) continue;
      if (s.spottedUntil < g.time && p.owner) g.addScore(p.owner, 5, null);
      s.spottedUntil = Math.max(s.spottedUntil, g.time + 1.2);
    }
  }
  clear() {
    for (const p of this.projectiles) if (p.mesh) this.g.scene.remove(p.mesh);
    for (const d of this.deployables) this.g.scene.remove(d.mesh);
    this.projectiles = []; this.deployables = [];
  }
}
