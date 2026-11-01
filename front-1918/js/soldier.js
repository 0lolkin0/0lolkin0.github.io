// Солдат (общий для игрока и ботов): движение, стойки (стоя/присев/лёжа), основное и личное оружие, урон.
// Плюс отрисовка всех солдат инстансами
import * as THREE from './three.module.min.js';
import { clamp, lerp, DEG, TAU, dirFromYawPitch } from './util.js';
import { TEAMS, WEAPONS, CLASS_BY_ID, SIGHTS, sightZoom } from './config.js';
import { PLAY } from './world.js';
import { torsoGeo, thighGeo, shinGeo, armsGeo, WEAPON_IDS } from './models.js';

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
    this.crouchT = 0; this.proneT = 0; this.adsT = 0; this.sprinting = false;
    this.walkPhase = Math.random() * TAU;
    this.lieT = 0;
    this.respawnT = 0; this.downT = 0;
    this.stats = { kills: 0, deaths: 0, score: 0, revives: 0, caps: 0, assists: 0, heads: 0 };
    this.input = { mx: 0, mz: 0, sprint: false, crouch: false, prone: false, jump: false, fire: false, ads: false, reload: false, grenade: false, gadget: false, melee: false, swap: false, hold: false };
    this.ammo = {};
    this.sights = {};
    this.slot = 0;
    this.setClass('assault');
    this.vehicle = null;
    this.spottedUntil = 0;
    this.damageLog = new Map();
    this.lastDamage = -99; this.lastShot = -99; this.lastAttacker = null;
    this.stepAcc = 0;
    this.recoilP = 0; this.recoilY = 0;
    this.switchT = 0;
  }
  setClass(id) {
    this.cls = CLASS_BY_ID[id];
    this.slots = [this.cls.weapon, TEAMS[this.team].sidearm];
    this.slot = 0;
  }
  get weapon() { return WEAPONS[this.slots[this.slot]]; }
  get other() { return WEAPONS[this.slots[1 - this.slot]]; }
  get mag() { return this.ammo[this.weapon.id]?.mag ?? 0; }
  set mag(v) { (this.ammo[this.weapon.id] ||= { mag: 0, reserve: 0 }).mag = v; }
  get reserve() { return this.ammo[this.weapon.id]?.reserve ?? 0; }
  set reserve(v) { (this.ammo[this.weapon.id] ||= { mag: 0, reserve: 0 }).reserve = v; }
  get sight() { const w = this.weapon; return SIGHTS[this.sights[w.id]] && w.sights.includes(this.sights[w.id]) ? SIGHTS[this.sights[w.id]] : SIGHTS[w.sights[0]]; }
  get zoom() { return sightZoom(this.weapon, this.sight.id); }
  get scoped() { return this.sight.optic && this.adsT > 0.85; }
  get alive() { return this.state === 'alive'; }
  get prone() { return this.proneT > 0.5; }
  get eyeY() {
    if (this.state === 'downed') return this.pos.y + 0.35;
    return this.pos.y + lerp(lerp(1.6, 1.12, this.crouchT), 0.42, this.proneT);
  }
  get moving() { return this.vel.x * this.vel.x + this.vel.z * this.vel.z > 0.5; }

  spawn(x, z, yaw) {
    const w = this.game.world;
    this.pos.set(x, w.groundAt(x, z, w.height(x, z) + 1), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw; this.pitch = 0;
    this.state = 'alive';
    this.hp = 100;
    this.lieT = 0; this.crouchT = 0; this.proneT = 0; this.adsT = 0;
    this.slot = 0;
    for (const [i, wid] of this.slots.entries()) {
      const wp = WEAPONS[wid];
      this.ammo[wid] = { mag: wp.mag, reserve: wp.reserve * (this.bot && i === 0 ? 2 : 1) };
    }
    this.grenades = this.cls.grenades;
    this.gadgets = this.cls.gadgetCount;
    this.fireCd = 0; this.reloadT = 0; this.bloom = 0; this.switchT = 0;
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
    const bx = Math.sin(this.yaw), bz = Math.cos(this.yaw);
    if (this.state === 'downed' || this.state === 'dead') {
      out.ax = p.x + bx * 0.25; out.ay = p.y + 0.2; out.az = p.z + bz * 0.25;
      out.bx = p.x + bx * 1.3; out.by = p.y + 0.25; out.bz = p.z + bz * 1.3;
      out.r = 0.26;
      out.hx = p.x + bx * 1.62; out.hy = p.y + 0.22; out.hz = p.z + bz * 1.62; out.hr = 0.17;
      return out;
    }
    if (this.proneT > 0.5) {
      // Лёжа: голова у точки взгляда, тело тянется назад
      out.ax = p.x + bx * 0.3; out.ay = p.y + 0.22; out.az = p.z + bz * 0.3;
      out.bx = p.x + bx * 1.45; out.by = p.y + 0.2; out.bz = p.z + bz * 1.45;
      out.r = 0.24;
      out.hx = p.x - bx * 0.02; out.hy = p.y + 0.3; out.hz = p.z - bz * 0.02; out.hr = 0.16;
      return out;
    }
    const c = this.crouchT;
    out.ax = p.x; out.ay = p.y + 0.28; out.az = p.z;
    out.bx = p.x; out.by = p.y + lerp(1.3, 0.88, c); out.bz = p.z;
    out.r = 0.27;
    out.hx = p.x; out.hy = p.y + lerp(1.64, 1.17, c); out.hz = p.z; out.hr = 0.17;
    return out;
  }
  // Высота точки, в которую целятся по этому солдату
  get aimY() { return this.pos.y + (this.proneT > 0.5 ? 0.28 : this.crouchT > 0.5 ? 0.95 : 1.3); }

  update(dt) {
    const g = this.game;
    if (this.state === 'dead') { this.lieT = Math.min(1, this.lieT + dt * 2.2); return; }
    if (this.vehicle) return;
    if (this.state === 'downed') {
      this.lieT = Math.min(1, this.lieT + dt * 2.2);
      this.proneT = Math.max(0, this.proneT - dt * 3);
      this.downT -= dt;
      this.vel.x *= 0.9; this.vel.z *= 0.9;
      this.applyGravity(dt);
      if (this.downT <= 0) g.combat.finishOff(this, null);
      return;
    }
    const w = g.world, inp = this.input;
    this.invuln -= dt;
    this.fireCd -= dt; this.meleeCd -= dt; this.gadgetCd -= dt;
    if (this.throwT > 0) this.throwT -= dt;
    if (this.meleeT > 0) this.meleeT -= dt;
    if (this.switchT > 0) this.switchT -= dt;
    if (inp.swap) { inp.swap = false; this.switchWeapon(); }
    const wpn = this.weapon;
    this.bloom = Math.max(0, this.bloom - wpn.recover * dt);

    // Стойка и прицеливание. Прицел прерывает бег, бег поднимает с земли
    const reloading = this.reloadT > 0;
    let mag = Math.min(1, Math.hypot(inp.mx, inp.mz));
    const charging = this.chargeT > 0;
    const wantProne = inp.prone && !charging && this.onGround;
    let sprint = (inp.sprint || charging) && mag > 0.4 && !inp.fire && !inp.ads && this.throwT <= 0 && this.proneT < 0.2 && !wantProne;
    const crouch = inp.crouch && !sprint && !wantProne;
    this.crouchT = clamp(this.crouchT + (crouch ? 6 : -6) * dt, 0, 1);
    this.proneT = clamp(this.proneT + (wantProne ? 1.8 : -2.4) * dt, 0, 1);
    const adsTime = wpn.adsTime + (this.sight.optic ? 0.08 + this.zoom * 0.008 : 0);
    const adsWant = inp.ads && !reloading && this.throwT <= 0 && this.meleeT <= 0 && this.switchT <= 0 && !charging;
    this.adsT = clamp(this.adsT + (adsWant ? 1 : -1.6) * dt / adsTime, 0, 1);
    this.sprinting = sprint;

    // Скорость
    let speed = 4.3 * this.cls.speed * wpn.speedMul;
    if (sprint) speed = 6.7 * this.cls.speed;
    if (charging) { speed = 7.8; this.chargeT -= dt; }
    speed *= lerp(1, 0.5, this.crouchT);
    speed *= lerp(1, 0.27, this.proneT);
    speed *= lerp(1, 0.55, this.adsT);
    if (w.inWire(this.pos.x, this.pos.z)) speed *= this.proneT > 0.5 ? 0.8 : 0.42;
    let mx = inp.mx, mz = inp.mz;
    if (charging) { mx = -Math.sin(this.yaw); mz = -Math.cos(this.yaw); mag = 1; }
    const tvx = mx * speed, tvz = mz * speed;
    const acc = this.onGround ? 12 : 2.5;
    const k = Math.min(1, acc * dt);
    this.vel.x += (tvx - this.vel.x) * k;
    this.vel.z += (tvz - this.vel.z) * k;

    if (inp.jump && this.onGround && this.crouchT < 0.5 && this.proneT < 0.3) {
      this.vel.y = 5.3;
      this.onGround = false;
    }
    inp.jump = false;

    // Перемещение и столкновения
    const p = this.pos;
    const ox = p.x, oz = p.z;
    p.x += this.vel.x * dt;
    p.z += this.vel.z * dt;
    const head = p.y + lerp(lerp(1.75, 1.25, this.crouchT), 0.55, this.proneT);
    w.pushCircle(p, 0.38, p.y, head, _push);
    if (_push.hits) w.pushCircle(p, 0.38, p.y, head, _push);
    // Автоперелаз через низкие стенки
    if (_push.block && this.onGround && mag > 0.5 && this.proneT < 0.3) {
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
      this.walkPhase += moved * (sprint ? 1.9 : this.proneT > 0.5 ? 4.5 : 2.4);
      if (moved > 0.001) {
        this.stepAcc += moved;
        if (this.stepAcc > (sprint ? 1.7 : 1.3)) {
          this.stepAcc = 0;
          const soft = this.crouchT > 0.5 || this.proneT > 0.5 ? 0.5 : 1;
          if (this.isPlayer && !this.bot) g.audio.step(0, 0, 0, true, soft);
          else g.audio.step(p.x, p.y, p.z, false);
        }
      }
    } else if (charging) this.walkPhase += dt * 14;

    // Восстановление здоровья
    if (g.time - this.lastDamage > 6 && this.hp < 100) this.hp = Math.min(100, this.hp + 7 * dt);

    // Оружие
    if (reloading) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = wpn.mag - this.mag, take = Math.min(need, this.reserve);
        this.mag += take; this.reserve -= take;
        this.reloadT = 0;
      }
    }
    if (inp.reload) { inp.reload = false; this.startReload(); }
    if (this.mag === 0 && this.reserve > 0 && this.reloadT <= 0 && this.fireCd <= 0 && this.switchT <= 0) this.startReload();
    if (inp.fire && this.reloadT <= 0 && this.fireCd <= 0 && this.throwT <= 0 && this.meleeT <= 0 && this.switchT <= 0 && !charging) {
      if (this.mag > 0) {
        g.combat.fireWeapon(this);
        this.mag--;
        this.fireCd = 60 / wpn.rpm;
        this.bloom = Math.min(wpn.bloomMax, this.bloom + wpn.bloom);
        this.lastShot = g.time;
        this.spottedUntil = Math.max(this.spottedUntil, g.time + 2.2);
        if (wpn.id === 'bolt' && this.isPlayer) g.audio.bolt();
      } else if (this.isPlayer && this.fireCd <= 0) {
        g.audio.empty();
        this.fireCd = 0.3;
        // Пусто и нечем перезарядить — сразу к другому стволу
        if (this.reserve <= 0 && this.other && (this.ammo[this.other.id]?.mag || this.ammo[this.other.id]?.reserve)) this.switchWeapon();
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
      if (this.meleeCd <= 0 && this.proneT < 0.3) {
        if (sprint && !charging) { this.chargeT = 1.5; this.meleeCd = 2.2; g.audio.melee(); }
        else if (!charging) { this.meleeT = 0.35; this.meleeCd = 0.9; g.combat.melee(this, false); }
      }
    }
    if (charging) g.combat.chargeCheck(this);
  }
  switchWeapon() {
    if (this.switchT > 0 || this.throwT > 0 || this.chargeT > 0) return false;
    this.slot = 1 - this.slot;
    this.switchT = this.weapon.side ? 0.4 : 0.55;
    this.reloadT = 0;
    this.adsT = 0;
    this.bloom = 0;
    this.fireCd = Math.max(this.fireCd, 0);
    if (this.isPlayer) this.game.audio.reload(0.3);
    return true;
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
    if (this.reloadT > 0 || this.mag >= wpn.mag || this.reserve <= 0 || this.switchT > 0) return;
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
    s *= lerp(1, 0.45, this.proneT);
    if (!this.onGround) s *= 2;
    if (this.bot) s *= this.game.diff.spreadMul;
    return s * DEG;
  }
  aimDir(out) { return dirFromYawPitch(this.yaw, this.pitch, out); }
  // Точка дула в мире (приблизительно, для трассеров ботов)
  muzzle(out) {
    const f = dirFromYawPitch(this.yaw, this.pitch, _tmp);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    out.set(this.pos.x + f.x * 0.9 + rx * 0.12, this.eyeY - (this.proneT > 0.5 ? 0.1 : 0.2) + f.y * 0.9, this.pos.z + f.z * 0.9 + rz * 0.12);
    return out;
  }
}

// ---------- Отрисовка ----------
export class SoldierRenderer {
  constructor(scene, perTeam, gfx) {
    const mat = gfx ? gfx.triplanar('fabric', { local: true, scale: 5, roughness: 0.88, strength: 0.7, env: 0.5 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    this.teams = [0, 1].map((t) => {
      const mk = (geo, n) => {
        const m = new THREE.InstancedMesh(geo, mat, n);
        m.frustumCulled = false;
        m.castShadow = true;
        m.receiveShadow = true;
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
    this.thL.rotation.set(lerp(sw, 1.4, c), 0, 0);
    this.thR.rotation.set(lerp(-sw, -0.1, c), 0, 0);
    this.shL.rotation.x = lerp(-Math.max(0, -Math.sin(ph)) * amp * 1.4, -1.4, c);
    this.shR.rotation.x = lerp(-Math.max(0, Math.sin(ph)) * amp * 1.4, -1.45, c);
    let lean = s.sprinting ? -0.22 : -0.05 * sp;
    lean = lerp(lean, -0.12, c);
    this.torso.rotation.set(lean, 0, 0);
    let ap = s.pitch - lean;
    if (s.sprinting) ap = -0.75;
    if (s.reloadT > 0) ap = -0.55;
    if (s.switchT > 0) ap = -0.9;
    if (s.throwT > 0.3) ap = 0.9;
    if (s.meleeT > 0) ap = -0.1;
    if (s.chargeT > 0) ap = -0.15;
    this.arms.rotation.set(ap, s.sprinting ? 0.5 : 0, s.reloadT > 0 ? 0.4 : 0);
    this.arms.position.z = s.meleeT > 0 ? -0.25 : 0;
    // Лёжа на животе: тело вытянуто назад от точки взгляда
    const pr = s.state === 'alive' ? s.proneT : 0;
    if (pr > 0) {
      const e = pr * pr * (3 - 2 * pr);
      const bx = Math.sin(s.yaw), bz = Math.cos(s.yaw);
      r.position.x += bx * 1.62 * e; r.position.z += bz * 1.62 * e;
      r.position.y += 0.15 * e;
      r.rotation.x = -Math.PI / 2 * e;
      this.hip.position.y = lerp(this.hip.position.y, 0.92, e);
      const crawl = Math.sin(ph) * sp * 0.25;
      this.thL.rotation.set(lerp(this.thL.rotation.x, crawl, e), 0, lerp(0, -0.12, e));
      this.thR.rotation.set(lerp(this.thR.rotation.x, -crawl, e), 0, lerp(0, 0.12, e));
      this.shL.rotation.x = lerp(this.shL.rotation.x, -0.1, e);
      this.shR.rotation.x = lerp(this.shR.rotation.x, -0.1, e);
      this.torso.rotation.x = lerp(lean, 0, e);
      this.arms.rotation.set(lerp(ap, Math.PI / 2 + s.pitch * 0.7 - 0.1, e), 0, 0);
    }
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
      if (camPos && s.pos.distanceToSquared(camPos) > 300 * 300) continue;
      const T = this.teams[s.team];
      this.pose(s, time);
      T.torso.setMatrixAt(T.n, this.torso.matrixWorld);
      const wid = s.weapon.id;
      T.arms[wid].setMatrixAt(T.an[wid]++, this.arms.matrixWorld);
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
