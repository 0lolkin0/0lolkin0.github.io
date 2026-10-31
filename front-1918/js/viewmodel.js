// Оружие в руках (вид от первого лица): отдельная сцена поверх мира, покачивание, отдача, перезарядка, прицел
import * as THREE from './three.module.min.js';
import { GeoBuilder, clamp, lerp } from './util.js';
import { TEAMS } from './config.js';
import { addWeaponGeo } from './soldier.js';

const SKIN = 0xd1a07c;
const MUZZLE = { smg: [0, 0.005, -0.74], semi: [0, 0.02, -1.05], bolt: [0, 0.02, -1.05], lmg: [0, 0, -1.03] };
// Где линия прицела относительно оси ствола
const SIGHT = { smg: 0.056, semi: 0.058, bolt: 0.1, lmg: 0.111 };
// Насколько далеко оружие перед глазом при прицеливании
const ADSZ = { smg: -0.26, semi: -0.24, bolt: -0.05, lmg: -0.3 };

function beam(b, ax, ay, az, bx, by, bz, w, color) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dx / len, dy / len, dz / len));
  const m = new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, new THREE.Vector3(w, w, len));
  b.add(new THREE.BoxGeometry(1, 1, 1), m, color, 0.03);
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x554433, 1.4);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.6);
    this.dir.position.set(-0.5, 1, 0.3);
    this.scene.add(this.hemi, this.dir);
    this.models = {};
    this.cur = null;
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const fl = new GeoBuilder();
    for (let i = 0; i < 3; i++) fl.add(new THREE.PlaneGeometry(0.22, 0.06), GeoBuilder.mat(0, 0, -0.08, 0, Math.PI / 2, (i * Math.PI) / 3), 0xffd090, 0);
    fl.add(new THREE.PlaneGeometry(0.12, 0.12), GeoBuilder.mat(0, 0, 0, 0, 0, Math.PI / 4), 0xffe6b0, 0);
    this.flashGeo = fl.build();
    this.flashMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.bobT = 0; this.kickZ = 0; this.kickR = 0; this.flashT = 0;
    this.swayX = 0; this.swayY = 0;
    this.visible = true;
  }
  setLights(world) {
    const T = world.theme;
    this.hemi.color.setHex(T.hemiSky); this.hemi.groundColor.setHex(T.hemiGround);
    this.dir.color.setHex(T.sun);
  }
  build(team, wid) {
    const T = TEAMS[team], b = new GeoBuilder();
    addWeaponGeo(b, wid, 0, 0, 0, 1);
    const gripZ = -0.15, foreZ = wid === 'smg' ? -0.42 : wid === 'lmg' ? -0.55 : -0.52;
    // Руки: правая к рукояти, левая к цевью
    beam(b, 0.16, -0.32, 0.32, 0.03, -0.08, gripZ + 0.04, 0.1, T.uniform);
    b.box(0.07, 0.09, 0.11, 0.015, -0.06, gripZ, SKIN, 0, 0, 0, 0.03);
    beam(b, -0.3, -0.36, 0.05, -0.04, -0.07, foreZ + 0.05, 0.1, T.uniform);
    b.box(0.08, 0.07, 0.12, -0.02, -0.05, foreZ, SKIN, 0, 0, 0, 0.03);
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(b.build(), this.mat);
    g.add(mesh);
    // Штык для рукопашной
    if (wid !== 'lmg') {
      const bb = new GeoBuilder();
      const mz = MUZZLE[wid];
      bb.box(0.012, 0.03, 0.4, 0.025, mz[1] - 0.02, mz[2] - 0.17, 0x9a9a98, 0, 0, 0, 0.02);
      g.bayonet = new THREE.Mesh(bb.build(), this.mat);
      g.bayonet.visible = false;
      g.add(g.bayonet);
    }
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat);
    flash.position.set(...MUZZLE[wid]);
    flash.visible = false;
    g.add(flash);
    g.flash = flash;
    g.wid = wid;
    return g;
  }
  set(team, wid) {
    const key = team + wid;
    if (!this.models[key]) { this.models[key] = this.build(team, wid); this.scene.add(this.models[key]); }
    for (const k in this.models) this.models[k].visible = k === key;
    this.cur = this.models[key];
  }
  kick(w) {
    this.kickZ = Math.min(0.12, this.kickZ + (w.id === 'bolt' ? 0.09 : w.id === 'semi' ? 0.05 : 0.025));
    this.kickR = Math.min(0.3, this.kickR + w.recoil * 0.04);
    this.flashT = 0.045;
    if (this.cur) {
      this.cur.flash.rotation.z = Math.random() * Math.PI;
      const s = 0.8 + Math.random() * 0.6;
      this.cur.flash.scale.set(s, s, s);
    }
  }
  update(dt, p, dyaw, dpitch, aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const g = this.cur;
    if (!g) return;
    const wid = g.wid;
    const ads = p.adsT;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.bobT += dt * (p.sprinting ? 13 : 9) * Math.min(1, speed / 4);
    const bob = Math.min(1, speed / 4) * (p.onGround ? 1 : 0.2) * (1 - ads * 0.85);
    this.swayX = lerp(this.swayX, clamp(-dyaw * 0.9, -0.05, 0.05), Math.min(1, dt * 10));
    this.swayY = lerp(this.swayY, clamp(dpitch * 0.9, -0.05, 0.05), Math.min(1, dt * 10));
    this.kickZ = Math.max(0, this.kickZ - dt * 0.6);
    this.kickR = Math.max(0, this.kickR - dt * 2.2);
    // Прицеливание «по-мобильному»: ствол уходит чуть ниже и правее центра, точка прицела остаётся открытой
    const hip = [0.19, -0.2, -0.36], aim = [0.07, -SIGHT[wid] - 0.05, ADSZ[wid]];
    let x = lerp(hip[0], aim[0], ads), y = lerp(hip[1], aim[1], ads), z = lerp(hip[2], aim[2], ads);
    x += Math.cos(this.bobT) * 0.012 * bob + this.swayX * (1 - ads * 0.7);
    y += Math.abs(Math.sin(this.bobT)) * 0.012 * bob + this.swayY * (1 - ads * 0.7);
    z += this.kickZ;
    let rx = this.kickR, ry = 0, rz = 0;
    // Бег
    const sp = p.sprinting ? 1 : 0;
    this.sprintT = lerp(this.sprintT || 0, sp, Math.min(1, dt * 8));
    x += this.sprintT * 0.04; y -= this.sprintT * 0.06; ry += this.sprintT * 0.7; rx -= this.sprintT * 0.25;
    // Перезарядка
    if (p.reloadT > 0) {
      const total = p.weapon.reload;
      const k = clamp(1 - p.reloadT / total, 0, 1);
      const e = Math.sin(k * Math.PI);
      y -= e * 0.13; rx -= e * 0.55; rz += e * 0.5;
    }
    // Бросок гранаты / штык
    if (p.throwT > 0) { const e = Math.sin((p.throwT / 0.65) * Math.PI); y -= e * 0.35; rx -= e * 0.6; }
    const melee = p.meleeT > 0 || p.chargeT > 0;
    if (g.bayonet) g.bayonet.visible = melee;
    if (p.meleeT > 0) { const e = Math.sin((p.meleeT / 0.35) * Math.PI); z -= e * 0.28; ry -= e * 0.15; }
    if (p.chargeT > 0) { z -= 0.12; x -= 0.05; ry -= 0.25; rx += 0.05; }
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, rz);
    this.flashT -= dt;
    g.flash.visible = this.flashT > 0;
    this.visible = !(wid === 'bolt' && ads > 0.85);
    g.visible = this.visible;
  }
  // Точка дула в мире — для трассера
  muzzleWorld(out) {
    const g = this.cur, cam = this.mainCam;
    if (!g || !cam) return out.set(0, 0, 0);
    g.updateMatrixWorld(true);
    out.set(...MUZZLE[g.wid]).applyMatrix4(g.matrixWorld);
    return out.applyMatrix4(cam.matrixWorld);
  }
  render(renderer) {
    if (!this.cur || !this.cur.visible) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
