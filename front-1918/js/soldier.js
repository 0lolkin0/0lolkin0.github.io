// Солдат (общий для игрока и ботов): движение, стойки, оружие, урон. Плюс отрисовка всех солдат инстансами
import * as THREE from './three.module.min.js';
import { GeoBuilder, clamp, lerp, DEG, TAU, dirFromYawPitch } from './util.js';
import { TEAMS, WEAPONS, CLASS_BY_ID, GRENADE } from './config.js';
import { PLAY } from './world.js';

const GRAV = 15;
const _push = {};
const _tmp = new THREE.Vector3();

export class Soldier {
  constructor(game, team, id, name, isPlayer = false) {
    this.game = game;
    this.team = team;
    this.id = id;
    this.name = name;
    this.isPlayer = isPlayer;
    this.bot = null;
    this.squad = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.state = 'dead';
    this.hp = 100;
    this.onGround = true;
    this.crouchT = 0; this.adsT = 0; this.sprinting = false;
    this.walkPhase = Math.random() * TAU;
    this.lieT = 0;
    this.respawnT = 0; this.downT = 0;
    this.stats = { kills: 0, deaths: 0, score: 0, revives: 0, caps: 0, assists: 0, heads: 0 };
    this.input = { mx: 0, mz: 0, sprint: false, crouch: false, jump: false, fire: false, ads: false, reload: false, grenade: false, gadget: false, melee: false };
    this.setClass('assault');
    this.vehicle = null;
    this.deployable = null;
    this.spottedUntil = 0;
    this.damageLog = new Map();
    this.lastDamage = -99; this.lastShot = -99; this.lastAttacker = null;
    this.stepAcc = 0;
    this.recoilP = 0; this.recoilY = 0;
  }
  setClass(id) {
    this.cls = CLASS_BY_ID[id];
    this.weapon = WEAPONS[this.cls.weapon];
  }
  get alive() { return this.state === 'alive'; }
  get eyeY() { return this.pos.y + (this.state === 'downed' ? 0.35 : lerp(1.6, 1.12, this.crouchT)); }
  get moving() { return this.vel.x * this.vel.x + this.vel.z * this.vel.z > 0.5; }

  spawn(x, z, yaw) {
    const w = this.game.world;
    this.pos.set(x, w.groundAt(x, z, w.height(x, z) + 1), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.state = 'alive';
    this.hp = 100;
    this.lieT = 0; this.crouchT = 0; this.adsT = 0;
    const wpn = this.weapon;
    this.mag = wpn.mag;
    this.reserve = wpn.reserve * (this.bot ? 2 : 1);
    this.grenades = this.cls.grenades;
    this.gadgets = this.cls.gadgetCount;
    this.fireCd = 0; this.reloadT = 0; this.bloom = 0;
    this.throwT = 0; this.meleeT = 0; this.meleeCd = 0; this.chargeT = 0; this.gadgetCd = 0;
    this.invuln = 2.0;
    this.damageLog.clear();
    this.lastDamage = -99;
    this.lastAttacker = null;
    this.spawnTime = this.game.time;
    this.looted = false;
    this.recoilP = 0; this.recoilY = 0;
    for (const k in this.input) this.input[k] = typeof this.input[k] === 'boolean' ? false : 0;
    if (this.bot) this.bot.onSpawn();
  }

  // Капсула тела и голова для попаданий
  hitShape(out) {
    const p = this.pos;
    if (this.state === 'downed' || this.state === 'dead') {
      const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw);
      out.ax = p.x + bx * 0.25; out.ay = p.y + 0.2; out.az = p.z + bz * 0.25;
      out.bx = p.x + bx * 1.3; out.by = p.y + 0.25; out.bz = p.z + bz * 1.3;
      out.r = 0.26;
      out.hx = p.x + bx * 1.62; out.hy = p.y + 0.22; out.hz = p.z + bz * 1.62; out.hr = 0.17;
      return out;
    }
    const c = this.crouchT;
    out.ax = p.x; out.ay = p.y + 0.28; out.az = p.z;
    out.bx = p.x; out.by = p.y + lerp(1.3, 0.88, c); out.bz = p.z;
    out.r = 0.27;
    out.hx = p.x; out.hy = p.y + lerp(1.64, 1.17, c); out.hz = p.z; out.hr = 0.17;
    return out;
  }

  update(dt) {
    const g = this.game;
    if (this.state === 'dead') { this.lieT = Math.min(1, this.lieT + dt * 2.2); return; }
    if (this.vehicle) return;
    if (this.state === 'downed') {
      this.lieT = Math.min(1, this.lieT + dt * 2.2);
      this.downT -= dt;
      this.vel.x *= 0.9; this.vel.z *= 0.9;
      this.applyGravity(dt);
      if (this.downT <= 0) g.combat.finishOff(this, null);
      return;
    }
    const w = g.world, inp = this.input, wpn = this.weapon;
    this.invuln -= dt;
    this.fireCd -= dt; this.meleeCd -= dt; this.gadgetCd -= dt;
    if (this.throwT > 0) this.throwT -= dt;
    if (this.meleeT > 0) this.meleeT -= dt;
    this.bloom = Math.max(0, this.bloom - wpn.recover * dt);

    // Стойка и прицеливание
    const reloading = this.reloadT > 0;
    let mag = Math.min(1, Math.hypot(inp.mx, inp.mz));
    const charging = this.chargeT > 0;
    let sprint = (inp.sprint || charging) && mag > 0.4 && !inp.fire && this.adsT < 0.5 && this.throwT <= 0;
    const crouch = inp.crouch && !sprint;
    this.crouchT = clamp(this.crouchT + (crouch ? 6 : -6) * dt, 0, 1);
    const adsWant = inp.ads && !sprint && !reloading && this.throwT <= 0 && this.meleeT <= 0;
    this.adsT = clamp(this.adsT + (adsWant ? 1 : -1.5) * dt / wpn.adsTime, 0, 1);
    this.sprinting = sprint;

    // Скорость
    let speed = 4.3 * this.cls.speed * wpn.speedMul;
    if (sprint) speed = 6.7 * this.cls.speed;
    if (charging) { speed = 7.8; this.chargeT -= dt; }
    speed *= lerp(1, 0.5, this.crouchT);
    speed *= lerp(1, 0.55, this.adsT);
    if (w.inWire(this.pos.x, this.pos.z)) speed *= 0.42;
    let mx = inp.mx, mz = inp.mz;
    if (charging) { mx = -Math.sin(this.yaw); mz = -Math.cos(this.yaw); mag = 1; }
    const tvx = mx * speed, tvz = mz * speed;
    const acc = this.onGround ? 12 : 2.5;
    const k = Math.min(1, acc * dt);
    this.vel.x += (tvx - this.vel.x) * k;
    this.vel.z += (tvz - this.vel.z) * k;

    if (inp.jump && this.onGround && this.crouchT < 0.5) {
      this.vel.y = 5.3;
      this.onGround = false;
    }
    inp.jump = false;

    // Перемещение и столкновения
    const p = this.pos;
    const ox = p.x, oz = p.z;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    const head = p.y + lerp(1.75, 1.25, this.crouchT);
    w.pushCircle(p, 0.38, p.y, head, _push);
    if (_push.hits) w.pushCircle(p, 0.38, p.y, head, _push);
    // Автоперелаз через низкие стенки
    if (_push.block && this.onGround && mag > 0.5) {
      const dh = _push.block.top - p.y;
      if (dh > 0 && dh < 1.35) {
        this.vel.y = Math.sqrt(2 * GRAV * (dh + 0.3));
        this.onGround = false;
      }
    }
    p.x = clamp(p.x, -PLAY, PLAY);
    p.z = clamp(p.z, -PLAY, PLAY);
    this.applyGravity(dt);
    if (this.onGround && charging === false) {
      const moved = Math.hypot(p.x - ox, p.z - oz);
      this.walkPhase += moved * (sprint ? 1.9 : 2.4);
      if (moved > 0.001) {
        this.stepAcc += moved;
        if (this.stepAcc > (sprint ? 1.7 : 1.3)) {
          this.stepAcc = 0;
          if (this.isPlayer || !this.bot) g.audio.step(0, 0, 0, true, this.crouchT > 0.5 ? 0.5 : 1);
          else g.audio.step(p.x, p.y, p.z, false);
        }
      }
    } else if (charging) this.walkPhase += dt * 14;

    // Восстановление здоровья
    if (g.time - this.lastDamage > 6 && this.hp < 100) this.hp = Math.min(100, this.hp + 7 * dt);

    // Оружие
    if (reloading) {
      this.reloadT -= dt;
      if (sprint && this.isPlayer) { /* перезарядка продолжается на бегу */ }
      if (this.reloadT <= 0) {
        const need = wpn.mag - this.mag, take = Math.min(need, this.reserve);
        this.mag += take; this.reserve -= take;
        this.reloadT = 0;
      }
    }
    if (inp.reload) { inp.reload = false; this.startReload(); }
    if (this.mag === 0 && this.reserve > 0 && this.reloadT <= 0 && this.fireCd <= 0) this.startReload();
    if (inp.fire && this.reloadT <= 0 && this.fireCd <= 0 && this.throwT <= 0 && this.meleeT <= 0 && !charging) {
      if (this.mag > 0) {
        g.combat.fireWeapon(this);
        this.mag--;
        this.fireCd = 60 / wpn.rpm;
        this.bloom = Math.min(wpn.bloomMax, this.bloom + wpn.bloom);
        this.lastShot = g.time;
        this.spottedUntil = Math.max(this.spottedUntil, g.time + 2.2);
        if (wpn.id === 'bolt' && this.isPlayer) g.audio.bolt();
      } else if (this.reserve <= 0 && this.isPlayer && this.fireCd <= 0) {
        g.audio.empty();
        this.fireCd = 0.3;
      }
    }
    if (inp.grenade) {
      inp.grenade = false;
      if (this.grenades > 0 && this.throwT <= 0 && !charging) {
        this.grenades--;
        this.throwT = 0.65;
        this.reloadT = 0;
        g.combat.throwProjectile(this, 'frag');
      }
    }
    if (inp.gadget) {
      inp.gadget = false;
      this.useGadget();
    }
    if (inp.melee) {
      inp.melee = false;
      if (this.meleeCd <= 0) {
        if (sprint && !charging) { this.chargeT = 1.5; this.meleeCd = 2.2; g.audio.melee(); }
        else if (!charging) { this.meleeT = 0.35; this.meleeCd = 0.9; g.combat.melee(this, false); }
      }
    }
    if (charging) g.combat.chargeCheck(this);
  }
  applyGravity(dt) {
    const w = this.game.world, p = this.pos;
    this.vel.y -= GRAV * dt;
    let ny = p.y + this.vel.y * dt;
    const ground = w.groundAt(p.x, p.z, p.y);
    if (ny <= ground) {
      if (!this.onGround && this.vel.y < -11 && this.state === 'alive') {
        this.game.combat.damage(this, (-this.vel.y - 11) * 9, null, 'fall', false, 0, 0, false);
      }
      ny = ground; this.vel.y = 0; this.onGround = true;
    } else if (this.onGround && this.vel.y <= 0 && ny - ground < 0.5) {
      ny = ground; this.vel.y = 0;
    } else this.onGround = false;
    p.y = ny;
  }
  startReload() {
    const wpn = this.weapon;
    if (this.reloadT > 0 || this.mag >= wpn.mag || this.reserve <= 0) return;
    this.reloadT = wpn.reload * (this.mag === 0 ? 1.15 : 1);
    this.adsT = Math.min(this.adsT, 0.3);
    if (this.isPlayer) this.game.audio.reload(this.reloadT);
  }
  useGadget() {
    const g = this.game;
    if (this.gadgets <= 0 || this.gadgetCd > 0 || this.throwT > 0) return false;
    const id = this.cls.gadget;
    if (id === 'at') { g.combat.throwProjectile(this, 'at'); this.throwT = 0.7; }
    else if (id === 'flare') { g.combat.throwProjectile(this, 'flare'); this.throwT = 0.5; }
    else if (id === 'medkit' || id === 'ammo') { g.combat.placeDeployable(this, id); this.throwT = 0.5; }
    this.gadgets--;
    this.gadgetCd = 1.2;
    return true;
  }
  // Текущий разброс в радианах
  spread() {
    const w = this.weapon;
    let s = lerp(w.hip, w.ads, this.adsT);
    if (this.moving) s += w.moveAdd * (this.adsT > 0.5 ? 0.6 : 1);
    s += this.bloom;
    s *= lerp(1, 0.75, this.crouchT);
    if (!this.onGround) s *= 2;
    if (this.bot) s *= this.game.diff.spreadMul;
    return s * DEG;
  }
  aimDir(out) { return dirFromYawPitch(this.yaw, this.pitch, out); }
  // Точка дула в мире (приблизительно, для трассеров ботов)
  muzzle(out) {
    const f = dirFromYawPitch(this.yaw, this.pitch, _tmp);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    out.set(this.pos.x + f.x * 0.9 + rx * 0.12, this.eyeY - 0.2 + f.y * 0.9, this.pos.z + f.z * 0.9 + rz * 0.12);
    return out;
  }
}

// ---------- Модели ----------
const SKIN = 0xd1a07c, LEATHER = 0x3d2e20, BOOT = 0x2a211a, WOOD = 0x6d4a2c, METAL = 0x2b2b29, BRASS = 0x8d7340;

function beam(b, ax, ay, az, bx, by, bz, w, h, color) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / len, dy / len, dz / len));
  m.compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(w, h, len));
  b.add(new THREE.BoxGeometry(1, 1, 1), m, color, 0.03);
}

// Оружие вдоль −Z; рукоять около z = −0.15. scale — для вида от первого лица
export function addWeaponGeo(b, id, ox, oy, oz, s = 1) {
  const B = (w, h, d, x, y, z, c) => b.box(w * s, h * s, d * s, ox + x * s, oy + y * s, oz + z * s, c, 0, 0, 0, 0.04);
  const Cz = (r, len, x, y, z, c, seg = 8) => b.cyl(r * s, r * s, len * s, seg, ox + x * s, oy + y * s, oz + z * s, c, Math.PI / 2, 0, 0, 0.03);
  if (id === 'smg') {
    B(0.05, 0.11, 0.3, 0, -0.02, 0.05, WOOD);
    B(0.055, 0.075, 0.32, 0, 0.005, -0.25, METAL);
    Cz(0.03, 0.34, 0, 0.005, -0.56, 0x3a3a36);
    for (let i = 0; i < 3; i++) B(0.064, 0.01, 0.03, 0, 0.005, -0.44 - i * 0.08, 0x1c1c1a);
    B(0.12, 0.045, 0.04, -0.07, 0.0, -0.3, METAL);
    B(0.035, 0.08, 0.035, 0, -0.07, -0.13, WOOD);
    B(0.01, 0.025, 0.01, 0, 0.045, -0.7, METAL);
    B(0.03, 0.016, 0.012, 0, 0.049, -0.12, METAL);
  } else if (id === 'semi' || id === 'bolt') {
    B(0.055, 0.12, 0.34, 0, -0.03, 0.08, WOOD);
    B(0.05, 0.07, 0.64, 0, 0.0, -0.4, WOOD);
    B(0.04, 0.05, 0.22, 0, 0.035, -0.18, METAL);
    Cz(0.012, 0.36, 0, 0.02, -0.86, METAL, 6);
    B(0.02, 0.025, 0.04, 0, 0.045, -1.0, METAL);
    if (id === 'bolt') {
      Cz(0.024, 0.32, 0, 0.1, -0.2, 0x1e1e1c);
      B(0.02, 0.05, 0.02, 0, 0.065, -0.12, METAL); B(0.02, 0.05, 0.02, 0, 0.065, -0.3, METAL);
      B(0.08, 0.015, 0.015, 0.04, 0.03, -0.1, METAL);
    } else {
      B(0.04, 0.05, 0.08, 0, -0.04, -0.2, METAL);
    }
  } else if (id === 'lmg') {
    B(0.05, 0.1, 0.3, 0, -0.03, 0.1, WOOD);
    B(0.065, 0.09, 0.26, 0, 0.0, -0.18, METAL);
    Cz(0.048, 0.62, 0, 0.0, -0.6, 0x3a3a34, 10);
    Cz(0.014, 0.12, 0, 0.0, -0.96, METAL, 6);
    b.cyl(0.115 * s, 0.115 * s, 0.05 * s, 12, ox, oy + 0.075 * s, oz - 0.2 * s, 0x34342f, 0, 0, 0, 0.03);
    b.cyl(0.03 * s, 0.03 * s, 0.03 * s, 6, ox, oy + 0.09 * s, oz - 0.2 * s, METAL, 0, 0, 0, 0.03);
    B(0.012, 0.065, 0.012, 0, 0.08, -0.88, METAL);
    B(0.035, 0.08, 0.035, 0, -0.08, -0.08, WOOD);
  }
}

function torsoGeo(team) {
  const T = TEAMS[team], b = new GeoBuilder();
  b.box(0.44, 0.6, 0.26, 0, 0.3, 0, T.uniform);
  b.box(0.46, 0.07, 0.28, 0, 0.06, 0, LEATHER);
  b.box(0.12, 0.09, 0.06, -0.12, 0.14, -0.15, LEATHER);
  b.box(0.12, 0.09, 0.06, 0.12, 0.14, -0.15, LEATHER);
  beam(b, -0.2, 0.58, -0.12, 0.2, 0.06, -0.13, 0.04, 0.02, LEATHER);
  b.box(0.3, 0.32, 0.12, 0, 0.36, 0.18, T.uniformDark);
  b.cyl(0.07, 0.07, 0.36, 7, 0, 0.56, 0.2, T.puttee, 0, 0, Math.PI / 2);
  b.box(0.13, 0.08, 0.13, 0, 0.63, 0, SKIN);
  b.box(0.21, 0.23, 0.22, 0, 0.77, 0, SKIN);
  b.box(0.22, 0.04, 0.02, 0, 0.8, -0.115, 0x7a5a48);
  if (T.helmet === 'brodie') {
    b.cyl(0.25, 0.25, 0.022, 12, 0, 0.885, 0, T.helmetColor);
    b.dome(0.15, 0, 0.89, 0, T.helmetColor, 1, 0.75, 1.05);
  } else {
    b.dome(0.16, 0, 0.84, 0, T.helmetColor, 1, 0.95, 1.08);
    b.cyl(0.165, 0.19, 0.1, 12, 0, 0.82, 0.01, T.helmetColor);
    b.box(0.02, 0.03, 0.03, 0.16, 0.86, 0, 0x3d403b);
    b.box(0.02, 0.03, 0.03, -0.16, 0.86, 0, 0x3d403b);
  }
  return b.build();
}
function thighGeo(team) {
  const b = new GeoBuilder();
  b.box(0.17, 0.47, 0.2, 0, -0.22, 0, TEAMS[team].uniform);
  return b.build();
}
function shinGeo(team) {
  const T = TEAMS[team], b = new GeoBuilder();
  b.box(0.15, 0.36, 0.17, 0, -0.17, 0, T.puttee);
  b.box(0.16, 0.13, 0.27, 0, -0.41, -0.04, BOOT);
  return b.build();
}
function armsGeo(team, wid) {
  const T = TEAMS[team], b = new GeoBuilder();
  // Правая рука к рукояти, левая — к цевью
  beam(b, 0.21, 0.0, 0.0, 0.2, -0.24, -0.05, 0.12, 0.13, T.uniform);
  beam(b, 0.2, -0.24, -0.05, 0.08, -0.17, -0.17, 0.11, 0.11, T.uniform);
  b.box(0.08, 0.09, 0.09, 0.07, -0.17, -0.2, SKIN);
  const hz = wid === 'smg' ? -0.4 : -0.5;
  beam(b, -0.21, 0.0, 0.0, -0.17, -0.22, hz * 0.5, 0.12, 0.13, T.uniform);
  beam(b, -0.17, -0.22, hz * 0.5, 0.03, -0.17, hz, 0.11, 0.11, T.uniform);
  b.box(0.08, 0.09, 0.1, 0.05, -0.16, hz - 0.02, SKIN);
  addWeaponGeo(b, wid, 0.07, -0.13, 0);
  return b.build();
}

const WEAPON_IDS = ['smg', 'semi', 'lmg', 'bolt'];

export class SoldierRenderer {
  constructor(scene, perTeam) {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.teams = [0, 1].map((t) => {
      const mk = (geo, n) => {
        const m = new THREE.InstancedMesh(geo, mat, n);
        m.frustumCulled = false;
        m.castShadow = true;
        m.count = 0;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        scene.add(m);
        return m;
      };
      const arms = {};
      for (const w of WEAPON_IDS) arms[w] = mk(armsGeo(t, w), perTeam);
      return { thigh: mk(thighGeo(t), perTeam * 2), shin: mk(shinGeo(t), perTeam * 2), torso: mk(torsoGeo(t), perTeam), arms };
    });
    // Шаблонный скелет
    const O = () => new THREE.Object3D();
    this.root = O(); this.hip = O(); this.torso = O(); this.arms = O();
    this.thL = O(); this.thR = O(); this.shL = O(); this.shR = O();
    this.root.rotation.order = 'YXZ';
    this.root.add(this.hip);
    this.hip.add(this.thL, this.thR, this.torso);
    this.thL.position.x = -0.11; this.thR.position.x = 0.11;
    this.thL.add(this.shL); this.thR.add(this.shR);
    this.shL.position.y = -0.45; this.shR.position.y = -0.45;
    this.torso.add(this.arms);
    this.arms.position.y = 0.52;
  }
  pose(s, time) {
    const r = this.root;
    r.position.copy(s.pos);
    r.rotation.set(0, s.yaw, 0);
    const c = s.crouchT;
    const sp = Math.min(1, Math.hypot(s.vel.x, s.vel.z) / 4.5);
    const ph = s.walkPhase;
    const amp = (s.onGround ? sp : 0.2) * (s.sprinting ? 0.85 : 0.6) * (1 - c * 0.7);
    const sw = Math.sin(ph) * amp;
    this.hip.position.y = lerp(0.92, 0.56, c) + Math.abs(Math.cos(ph)) * amp * 0.06;
    this.thL.rotation.x = lerp(sw, 1.4, c);
    this.thR.rotation.x = lerp(-sw, -0.1, c);
    this.shL.rotation.x = lerp(-Math.max(0, -Math.sin(ph)) * amp * 1.4, -1.4, c);
    this.shR.rotation.x = lerp(-Math.max(0, Math.sin(ph)) * amp * 1.4, -1.45, c);
    let lean = s.sprinting ? -0.22 : -0.05 * sp;
    lean = lerp(lean, -0.12, c);
    this.torso.rotation.set(lean, 0, 0);
    let ap = s.pitch - lean;
    if (s.sprinting) ap = -0.75;
    if (s.reloadT > 0) ap = -0.55;
    if (s.throwT > 0.3) ap = 0.9;
    if (s.meleeT > 0) ap = -0.1;
    if (s.chargeT > 0) ap = -0.15;
    this.arms.rotation.set(ap, s.sprinting ? 0.5 : 0, s.reloadT > 0 ? 0.4 : 0);
    this.arms.position.z = s.meleeT > 0 ? -0.25 : 0;
    if (s.state !== 'alive') {
      const t = s.lieT, e = t * t * (3 - 2 * t);
      r.rotation.x = e * 1.5;
      r.position.y += e * 0.12;
      this.hip.position.y = lerp(this.hip.position.y, 0.92, e);
      this.thL.rotation.x = lerp(this.thL.rotation.x, 0.15, e);
      this.thR.rotation.x = lerp(this.thR.rotation.x, -0.1, e);
      this.shL.rotation.x = lerp(this.shL.rotation.x, -0.2, e);
      this.shR.rotation.x = lerp(this.shR.rotation.x, 0, e);
      this.torso.rotation.x = 0;
      this.arms.rotation.set(lerp(ap, s.state === 'downed' ? 1.1 + Math.sin(time * 3 + s.id) * 0.1 : 1.6, e), 0, 0);
    }
    r.updateMatrixWorld(true);
  }
  update(soldiers, time, hide, camPos) {
    for (const T of this.teams) {
      T.n = 0; T.l = 0; T.an = {};
      for (const w of WEAPON_IDS) T.an[w] = 0;
    }
    for (const s of soldiers) {
      if (s === hide || s.vehicle) continue;
      if (s.state === 'dead' && s.lieT >= 1 && s.game.time - s.deadAt > 9) continue;
      if (camPos && s.pos.distanceToSquared(camPos) > 240 * 240) continue;
      const T = this.teams[s.team];
      this.pose(s, time);
      T.torso.setMatrixAt(T.n, this.torso.matrixWorld);
      const arms = T.arms[s.weapon.id];
      arms.setMatrixAt(T.an[s.weapon.id]++, this.arms.matrixWorld);
      T.thigh.setMatrixAt(T.l, this.thL.matrixWorld);
      T.shin.setMatrixAt(T.l++, this.shL.matrixWorld);
      T.thigh.setMatrixAt(T.l, this.thR.matrixWorld);
      T.shin.setMatrixAt(T.l++, this.shR.matrixWorld);
      T.n++;
    }
    for (const T of this.teams) {
      T.torso.count = T.n; T.thigh.count = T.l; T.shin.count = T.l;
      T.torso.instanceMatrix.needsUpdate = true; T.thigh.instanceMatrix.needsUpdate = true; T.shin.instanceMatrix.needsUpdate = true;
      for (const w of WEAPON_IDS) { T.arms[w].count = T.an[w]; T.arms[w].instanceMatrix.needsUpdate = true; }
    }
  }
}
