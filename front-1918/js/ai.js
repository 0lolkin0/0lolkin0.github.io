// Мозг бота: выбор цели (флаг, враг, раненый товарищ, танк), путь по сетке, прицеливание с ошибкой и реакцией
import { clamp, lerp, angleDiff, yawTo, rand, pick, DEG, TAU } from './util.js';
import { GRENADE } from './config.js';

const PREF_RANGE = { smg: 28, semi: 60, lmg: 55, bolt: 110, revolver: 18, pistol: 18 };

export class BotBrain {
  constructor(soldier, game) {
    this.s = soldier;
    this.g = game;
    this.path = null; this.pi = 0;
    this.goal = null;
    this.target = null;
    this.thinkT = Math.random() * 0.3;
    this.objT = 0;
    this.errYaw = 0; this.errPitch = 0;
    this.reactT = 0;
    this.burst = 0; this.burstPause = 0;
    this.strafe = 0; this.strafeT = 0;
    this.stuckT = 0; this.lastX = 0; this.lastZ = 0;
    this.nadeCd = rand(4, 10);
    this.gadgetCd = rand(5, 15);
    this.lookYaw = 0; this.lookT = 0;
    this.mode = 'move';
    this.reviveT = 0;
    this.heard = null;
    this.crouchHold = 0;
    this.personality = Math.random();
    this.dashT = rand(2, 4.5);
    this.wanderT = 0; this.wy = 0; this.wp = 0;
    this.wantTank = false;
  }
  onSpawn() {
    this.path = null; this.goal = null; this.target = null; this.mode = 'move';
    this.objT = 0; this.reactT = 0; this.reviveT = 0; this.heard = null;
    this.lastX = this.s.pos.x; this.lastZ = this.s.pos.z; this.stuckT = 0;
  }
  onFired() { this.errYaw += rand(-0.3, 0.3) * DEG * this.s.weapon.recoil; this.errPitch += this.s.weapon.recoil * 0.25 * DEG; }
  onDamaged(att) {
    if (!att || att.team === this.s.team) return;
    this.errYaw += rand(-1.5, 1.5) * DEG;
    if (!this.target || this.target.state !== 'alive') {
      this.heard = { x: att.pos.x, y: att.pos.y + 1.2, z: att.pos.z, t: this.g.time, who: att };
    }
  }
  onKill() { this.target = null; this.burst = 0; }
  hear(src) {
    if (this.target) return;
    const d = Math.hypot(src.pos.x - this.s.pos.x, src.pos.z - this.s.pos.z);
    if (d < 55) this.heard = { x: src.pos.x, y: src.pos.y + 1.2, z: src.pos.z, t: this.g.time, who: src };
  }

  update(dt) {
    const s = this.s, g = this.g;
    const inp = s.input;
    if (s.state !== 'alive') return;
    if (s.vehicle) { this.driveTank(dt); return; }
    this.thinkT -= dt;
    if (this.thinkT <= 0) { this.thinkT = 0.2 + Math.random() * 0.12; this.think(); }
    this.objT -= dt;
    this.nadeCd -= dt; this.gadgetCd -= dt;

    // Застревание
    const moved = Math.hypot(s.pos.x - this.lastX, s.pos.z - this.lastZ);
    this.lastX = s.pos.x; this.lastZ = s.pos.z;
    const wantMove = Math.hypot(inp.mx, inp.mz) > 0.3;
    if (wantMove && moved < 0.5 * dt) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    if (this.stuckT > 0.8) inp.jump = true;
    if (this.stuckT > 2.2) { this.path = null; this.stuckT = 0; this.goal = this.goal && this.objT > 0 ? this.jitterGoal(this.goal) : null; }

    const t = this.target;
    let moveX = 0, moveZ = 0, faceYaw = s.yaw, facePitch = 0, sprint = false;
    inp.fire = false; inp.ads = false;

    // Движение по пути
    const next = this.followPath();
    if (next) {
      moveX = next[0]; moveZ = next[1];
      faceYaw = yawTo(moveX, moveZ);
      sprint = !t && this.mode !== 'revive-near';
    }

    if (t && t.state === 'alive') {
      const ey = s.eyeY;
      const ax = t.pos.x, ay = t.aimY, az = t.pos.z;
      const dx = ax - s.pos.x, dy = ay - ey, dz = az - s.pos.z;
      const dh = Math.hypot(dx, dz), dist = Math.hypot(dh, dy);
      const wantYaw = yawTo(dx, dz) + this.errYaw;
      const wantPitch = Math.atan2(dy, dh) + this.errPitch;
      faceYaw = wantYaw; facePitch = wantPitch;
      // Ошибка прицела сходится к небольшому «дрожанию», которое никогда не исчезает совсем
      const conv = Math.exp(-dt / g.diff.converge);
      const fl = g.diff.floor * DEG * (t.moving ? 1.4 : 1) * (s.moving ? 1.6 : 1) * (1 + dist / 150);
      this.wanderT -= dt;
      if (!(this.wanderT > 0)) { this.wanderT = rand(0.25, 0.6); this.wy = rand(-1, 1) * fl; this.wp = rand(-1, 1) * fl * 0.7; }
      this.errYaw = this.wy + (this.errYaw - this.wy) * conv;
      this.errPitch = this.wp + (this.errPitch - this.wp) * conv;
      this.reactT -= dt;
      const wid = s.weapon.id, pref = PREF_RANGE[wid];
      // Решения в бою: держать дистанцию, стрейф, присесть
      this.strafeT -= dt;
      if (this.strafeT <= 0) { this.strafeT = rand(0.5, 1.5); this.strafe = Math.random() < 0.35 ? 0 : (Math.random() < 0.5 ? -1 : 1); this.crouchHold = Math.random() < 0.4 ? rand(0.8, 2) : 0; }
      this.crouchHold -= dt;
      const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      const far = dist > 26;
      this.advancing = false;
      if (this.mode === 'revive' && next) {
        // к раненому товарищу, отстреливаясь на ходу
        this.advancing = true;
      } else if (far) {
        // далеко: остановиться и стрелять, потом перебежка
        this.holdT = (this.holdT ?? rand(2, 5) * (1.3 - this.personality * 0.5)) - dt;
        if (this.holdT > 0 || !next) { moveX = rx * this.strafe * 0.25; moveZ = rz * this.strafe * 0.25; }
        else {
          this.advancing = true;
          if (this.holdT < -this.dashT) { this.holdT = undefined; this.dashT = rand(2, 4.5); }
        }
      } else if (dist < pref * 0.4 && wid !== 'smg') {
        moveX = -dx / dh * 0.8 + rx * this.strafe * 0.6; moveZ = -dz / dh * 0.8 + rz * this.strafe * 0.6;
      } else if (wid === 'smg' && dist > 8 && this.personality > 0.4) {
        moveX = dx / dh * 0.8 + rx * this.strafe * 0.5; moveZ = dz / dh * 0.8 + rz * this.strafe * 0.5;
      } else {
        moveX = rx * this.strafe * 0.7; moveZ = rz * this.strafe * 0.7;
      }
      sprint = false;
      inp.crouch = !this.advancing && ((this.crouchHold > 0 && Math.hypot(moveX, moveZ) < 0.3) || (wid === 'bolt' && dist > 40));
      // Снайперы и часть пулемётчиков ложатся, когда стреляют издалека
      inp.prone = !this.advancing && this.mode !== 'revive' && dist > 45 && (wid === 'bolt' || (wid === 'lmg' && this.personality < 0.4));
      if (inp.prone) inp.crouch = false;
      if (inp.crouch || inp.prone) { moveX *= 0.3; moveZ *= 0.3; }
      // Пусто в основном стволе — к пистолету
      if (s.slot === 0 && s.mag === 0 && (s.reserve === 0 || (dist < 12 && s.reloadT > 0.6)) && s.switchT <= 0) inp.swap = true;
      inp.ads = dist > 18 || wid === 'bolt';
      // Огонь
      const aimErr = Math.abs(angleDiff(s.yaw, wantYaw - this.errYaw)) + Math.abs(s.pitch - (wantPitch - this.errPitch));
      const errMag = Math.hypot(this.errYaw, this.errPitch);
      const tol = Math.max(0.4 * DEG, Math.atan2(0.45, dist) * (s.weapon.auto ? 2.6 : 1.5));
      const steady = errMag < tol;
      const allowed = dist < pref * 2.4 && !(this.advancing && dist > 40);
      if (this.reactT <= 0 && steady && allowed && aimErr < tol + errMag + 1.5 * DEG) {
        if (dist < 2.3) { inp.melee = true; }
        else if (s.weapon.auto) {
          if (this.burstPause > 0) this.burstPause -= dt;
          else {
            inp.fire = true;
            if (s.fireCd <= 0 && s.mag > 0) {
              this.burst++;
              const [b0, b1] = g.diff.burst;
              const maxB = dist > 45 ? b0 : b1;
              if (this.burst >= maxB) { this.burst = 0; this.burstPause = rand(0.2, 0.55) * (dist > 45 ? 1.6 : 1); }
            }
          }
        } else {
          if (this.burstPause > 0) this.burstPause -= dt;
          else if (s.fireCd <= 0) {
            inp.fire = true;
            this.burstPause = wid === 'bolt' ? rand(0.5, 1.4) : rand(0.18, 0.5);
          }
        }
      }
      // Граната
      if (this.nadeCd <= 0 && s.grenades > 0 && dist > 9 && dist < 26 && Math.random() < 0.02) this.throwAt(t.pos, 'frag');
    } else {
      if (this.heard && g.time - this.heard.t < 3) {
        faceYaw = yawTo(this.heard.x - s.pos.x, this.heard.z - s.pos.z);
        facePitch = 0;
        sprint = false;
      } else if (!next) {
        this.lookT -= dt;
        if (this.lookT <= 0) { this.lookT = rand(1.2, 3); this.lookYaw = s.yaw + rand(-1.2, 1.2); }
        faceYaw = this.lookYaw;
      }
      inp.crouch = !next && this.mode === 'hold' && this.personality > 0.3;
      inp.prone = false;
      if (this.mode === 'revive-near') inp.crouch = true;
      // Бой окончен — обратно к основному оружию
      if (s.slot === 1 && s.switchT <= 0 && s.ammo[s.slots[0]] && (s.ammo[s.slots[0]].mag + s.ammo[s.slots[0]].reserve) > 0 && !this.heard) inp.swap = true;
    }

    // Ракета/ящик/аптечка
    this.useGadgets();

    // Поворот с ограниченной скоростью
    const turn = g.diff.turn * (t ? 1 : 0.7);
    s.yaw += clamp(angleDiff(s.yaw, faceYaw), -turn * dt, turn * dt);
    s.pitch += clamp(facePitch - s.pitch, -turn * 0.6 * dt, turn * 0.6 * dt);
    const ml = Math.hypot(moveX, moveZ);
    if (ml > 1) { moveX /= ml; moveZ /= ml; }
    inp.mx = moveX; inp.mz = moveZ;
    inp.sprint = sprint && ml > 0.5;
    if (s.reloadT > 0 && t && Math.random() < 0.01) inp.crouch = true;
  }

  think() {
    const s = this.s, g = this.g, w = g.world;
    // Цель-враг
    const diff = g.diff;
    let best = null, bestScore = Infinity;
    const ex = s.pos.x, ey = s.eyeY, ez = s.pos.z;
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const view = s.weapon.id === 'bolt' ? diff.view * 1.5 : diff.view;
    const cosFov = Math.cos((diff.fov / 2) * DEG);
    let checks = 0;
    const cands = [];
    for (const o of g.soldiers) {
      if (o.team === s.team || o.state !== 'alive' || o.vehicle) continue;
      const dx = o.pos.x - ex, dz = o.pos.z - ez;
      const d = Math.hypot(dx, dz);
      if (d > view) continue;
      const inFov = (dx * fx + dz * fz) / (d || 1) > cosFov;
      const spotted = o.spottedUntil > g.time && d < view * 0.8;
      const heard = this.heard && this.heard.who === o && g.time - this.heard.t < 2;
      if (!inFov && d > 12 && !spotted && !heard) continue;
      let sc = d;
      if (o === this.target) sc *= 0.6;
      if (o.lastShot > g.time - 1.5) sc *= 0.8;
      if (o.isPlayer) sc *= g.playerAggro;
      // Укрывшихся видно хуже
      if (o.crouchT > 0.5 && d > 40) sc *= 1.4;
      cands.push([sc, o]);
    }
    cands.sort((a, b) => a[0] - b[0]);
    for (const [sc, o] of cands) {
      if (checks++ > 3) break;
      const ty = o.aimY + 0.1;
      if (w.los(ex, ey, ez, o.pos.x, ty, o.pos.z)) { best = o; bestScore = sc; break; }
    }
    if (best && best !== this.target) {
      const d = Math.hypot(best.pos.x - ex, best.pos.z - ez);
      const r = diff.reaction;
      this.reactT = rand(r[0], r[1]) * (this.target ? 0.5 : 1);
      const err = diff.aimErr * DEG * rand(0.6, 1.4) * (1 + d / 120);
      const a = Math.random() * TAU;
      this.errYaw = Math.cos(a) * err; this.errPitch = Math.sin(a) * err * 0.6;
      this.burst = 0;
    }
    if (best !== this.target) this.holdT = undefined;
    this.target = best;

    // Медик: ищет раненых
    if (s.cls.revive) {
      let rv = null, rd = 32;
      for (const o of g.soldiers) {
        if (o.team !== s.team || o.state !== 'downed' || o.downT < 1.2) continue;
        const d = Math.hypot(o.pos.x - ex, o.pos.z - ez) * (o.isPlayer ? 0.5 : 1);
        if (d < rd) { rd = d; rv = o; }
      }
      const busy = best && Math.hypot(best.pos.x - ex, best.pos.z - ez) < 22 && rd > 9;
      if (rv && !busy) {
        const d = Math.hypot(rv.pos.x - ex, rv.pos.z - ez);
        if (d < 1.8) {
          this.mode = 'revive-near';
          this.path = null;
          this.reviveT += 0.25;
          if (this.reviveT > 1.2) { g.combat.revive(rv, s); this.reviveT = 0; this.mode = 'move'; this.objT = 0; }
          return;
        }
        this.mode = 'revive';
        this.reviveT = 0;
        if (!this.goal || this.goalRef !== rv || !this.path) this.setGoal(rv.pos.x, rv.pos.z, rv);
        return;
      }
    }
    if (this.mode === 'revive' || this.mode === 'revive-near') { this.mode = 'move'; this.objT = 0; this.reviveT = 0; }

    // Танк
    const tank = g.tanks[s.team];
    if (this.wantTank && tank && tank.alive && !tank.driver && !best) {
      const d = Math.hypot(tank.pos.x - ex, tank.pos.z - ez);
      if (d < 4.5) { tank.enter(s); this.path = null; return; }
      if (this.goalRef !== tank) this.setGoal(tank.pos.x, tank.pos.z, tank);
      return;
    }

    // Цель-флаг
    if (this.objT <= 0 || !this.goal) {
      this.objT = rand(6, 14);
      this.pickObjective();
    }
  }
  pickObjective() {
    const s = this.s, g = this.g;
    const flags = g.flags;
    if (!flags.length) {
      // Схватка: идём к центру событий
      const p = g.hotspot(s.team);
      this.setGoal(p[0] + rand(-25, 25), p[1] + rand(-25, 25), null);
      this.mode = 'move';
      return;
    }
    let target = null;
    if (s.squad && g.player && g.player.state === 'alive' && g.playerObjective) target = g.playerObjective;
    if (!target) {
      let best = -Infinity;
      for (const f of flags) {
        const d = Math.hypot(f.x - s.pos.x, f.z - s.pos.z);
        let v = 0;
        if (f.owner !== s.team) v = 1.3 - d / 220 + (f.owner === -1 ? 0.25 : 0);
        else if (f.contested) v = 1.5 - d / 260;
        else v = 0.15 - d / 400;
        v -= (g.assigned(s.team, f) || 0) * 0.07;
        v += Math.random() * 0.35;
        if (v > best) { best = v; target = f; }
      }
    }
    if (!target) return;
    this.flag = target;
    this.mode = target.owner === s.team && !target.contested ? 'hold' : 'move';
    const r = target.r * 0.75;
    const [x, z] = g.world.randomFreePoint(target.x, target.z, r);
    this.setGoal(x, z, target);
  }
  setGoal(x, z, ref) {
    const s = this.s;
    this.goal = [x, z];
    this.goalRef = ref;
    this.path = this.g.world.findPath(s.pos.x, s.pos.z, x, z, false);
    this.pi = 1;
    if (!this.path) this.path = [[s.pos.x, s.pos.z], [x, z]];
  }
  jitterGoal(gl) { return [gl[0] + rand(-6, 6), gl[1] + rand(-6, 6)]; }
  followPath() {
    const s = this.s, p = this.path;
    if (!p) {
      if (this.goal) this.setGoal(this.goal[0], this.goal[1], this.goalRef);
      return null;
    }
    if (this.goalRef && this.goalRef.pos && this.mode === 'revive') {
      const gx = this.goalRef.pos.x, gz = this.goalRef.pos.z;
      const end = p[p.length - 1];
      if (Math.hypot(end[0] - gx, end[1] - gz) > 4) { this.setGoal(gx, gz, this.goalRef); return null; }
    }
    while (this.pi < p.length) {
      const [x, z] = p[this.pi];
      const dx = x - s.pos.x, dz = z - s.pos.z;
      const d = Math.hypot(dx, dz);
      const last = this.pi === p.length - 1;
      if (d < (last ? 1.0 : 1.4)) { this.pi++; continue; }
      return [dx / d, dz / d];
    }
    return null;
  }
  throwAt(tp, type) {
    const s = this.s;
    const dx = tp.x - s.pos.x, dz = tp.z - s.pos.z, dy = tp.y - s.pos.y;
    const d = Math.hypot(dx, dz);
    const v = GRENADE[type].speed, gr = 13;
    // Угол броска для дистанции d (с поправкой на высоту)
    const k = (gr * (d + rand(-2, 2))) / (v * v);
    let ang = 0.5 * Math.asin(clamp(k, -1, 1)) + Math.atan2(dy, d) * 0.5;
    s.yaw = yawTo(dx, dz) + rand(-0.06, 0.06);
    s.pitch = ang - 10 * DEG;
    if (type === 'frag') { s.input.grenade = true; this.nadeCd = rand(10, 20); }
    else s.input.gadget = true;
  }
  useGadgets() {
    const s = this.s, g = this.g;
    if (this.gadgetCd > 0 || s.gadgets <= 0) return;
    const id = s.cls.gadget;
    if (id === 'at') {
      // ПТ-граната по вражескому танку
      for (const v of g.tanks) {
        if (!v || !v.alive || v.team === s.team) continue;
        const d = Math.hypot(v.pos.x - s.pos.x, v.pos.z - s.pos.z);
        if (d < 22 && d > 5 && g.world.los(s.pos.x, s.eyeY, s.pos.z, v.pos.x, v.pos.y + 1.4, v.pos.z)) {
          this.throwAt({ x: v.pos.x, y: v.pos.y + 1, z: v.pos.z }, 'at');
          this.gadgetCd = rand(3, 5);
          return;
        }
      }
    } else if (id === 'medkit') {
      if (s.hp < 55 || (this.target && Math.random() < 0.05)) { s.input.gadget = true; this.gadgetCd = rand(25, 40); }
    } else if (id === 'ammo') {
      if (this.target || s.reserve < s.weapon.mag * 2) { s.input.gadget = true; this.gadgetCd = rand(25, 45); }
    } else if (id === 'flare') {
      if (this.flag && this.flag.owner !== s.team) {
        const d = Math.hypot(this.flag.x - s.pos.x, this.flag.z - s.pos.z);
        if (d < 80 && d > 25) {
          s.yaw = yawTo(this.flag.x - s.pos.x, this.flag.z - s.pos.z);
          s.pitch = 0.45;
          s.input.gadget = true;
          this.gadgetCd = rand(25, 40);
        }
      }
    }
  }

  // ---------- Танкист ----------
  driveTank(dt) {
    const s = this.s, g = this.g, tank = s.vehicle, w = g.world;
    const ti = tank.input;
    this.thinkT -= dt;
    if (this.thinkT <= 0) {
      this.thinkT = 0.35;
      // Ищем цели
      let best = null, bd = 110;
      for (const o of g.soldiers) {
        if (o.team === s.team || o.state !== 'alive') continue;
        const tp = o.vehicle ? o.vehicle.pos : o.pos;
        const d = Math.hypot(tp.x - tank.pos.x, tp.z - tank.pos.z);
        if (d > bd) continue;
        if (!w.los(tank.pos.x, tank.pos.y + 2.4, tank.pos.z, tp.x, tp.y + 1.2, tp.z)) continue;
        bd = d; best = o;
      }
      this.target = best;
      if (this.objT <= 0 || !this.goal) {
        this.objT = rand(15, 25);
        let tf = null, bv = -Infinity;
        for (const f of g.flags) {
          const d = Math.hypot(f.x - tank.pos.x, f.z - tank.pos.z);
          const v = (f.owner !== s.team ? 1 : f.contested ? 0.8 : -1) - d / 300 + Math.random() * 0.3;
          if (v > bv) { bv = v; tf = f; }
        }
        const gp = tf ? w.randomFreePoint(tf.x, tf.z, tf.r + 8, true) : g.hotspot(s.team);
        this.goal = gp;
        this.path = w.findPath(tank.pos.x, tank.pos.z, gp[0], gp[1], true) || [[tank.pos.x, tank.pos.z], gp];
        this.pi = 1;
      }
    }
    this.objT -= dt;
    // Движение
    let thr = 0, steer = 0;
    if (this.path && this.pi < this.path.length) {
      const [x, z] = this.path[this.pi];
      const dx = x - tank.pos.x, dz = z - tank.pos.z, d = Math.hypot(dx, dz);
      if (d < 3.5) this.pi++;
      else {
        const want = yawTo(dx, dz);
        const da = angleDiff(tank.yaw, want);
        steer = clamp(-da * 2, -1, 1);
        thr = Math.abs(da) > 1 ? 0.15 : this.target && Math.hypot(this.target.pos.x - tank.pos.x, this.target.pos.z - tank.pos.z) < 45 ? 0.35 : 1;
      }
    }
    // Застревание: сдать назад
    const moved = Math.hypot(tank.pos.x - this.lastX, tank.pos.z - this.lastZ);
    this.lastX = tank.pos.x; this.lastZ = tank.pos.z;
    if (thr > 0.3 && moved < 0.4 * dt) this.stuckT += dt; else this.stuckT = Math.max(0, this.stuckT - dt);
    if (this.stuckT > 1.5) { this.reverseT = 1.6; this.stuckT = 0; }
    if (this.reverseT > 0) { this.reverseT -= dt; thr = -1; steer = 0.8; if (this.reverseT <= 0) this.objT = 0; }
    ti.throttle = thr; ti.steer = steer;
    // Наводка и огонь
    ti.fire = false; ti.mg = false;
    const t = this.target;
    if (t && t.state === 'alive') {
      const tp = t.vehicle ? t.vehicle.pos : t.pos;
      const m = tank.muzzle(this._mz || (this._mz = tank.pos.clone()));
      const dx = tp.x - m.x, dz = tp.z - m.z, dy = tp.y + 1 - m.y;
      const dh = Math.hypot(dx, dz);
      // Поправка на падение снаряда
      const drop = 0.5 * 9.8 * (dh / 150) ** 2;
      ti.aimYaw = yawTo(dx, dz) + this.errYaw;
      ti.aimPitch = Math.atan2(dy + drop, dh);
      this.errYaw *= Math.exp(-dt / 1.2);
      const err = Math.abs(angleDiff(tank.turretYaw, ti.aimYaw));
      if (err < 0.06) {
        ti.fire = tank.reload <= 0 && (t.vehicle || dh > 12);
        ti.mg = dh < 70 && !t.vehicle;
      }
    } else {
      ti.aimYaw = tank.yaw;
      ti.aimPitch = 0;
      this.errYaw = rand(-0.08, 0.08);
    }
    // Вылезти, если танк едва жив
    if (tank.hp < 150 && Math.random() < dt * 0.3) { tank.exit(); this.wantTank = false; this.path = null; this.goal = null; }
  }
}
