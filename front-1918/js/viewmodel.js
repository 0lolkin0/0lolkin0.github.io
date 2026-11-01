// Оружие в руках (вид от первого лица): отдельная сцена поверх мира. При прицеливании линия целик–мушка
// проходит точно через центр экрана; с оптикой модель прячется и рисуется прицельная сетка
import * as THREE from './three.module.min.js';
import { GeoBuilder, clamp, lerp } from './util.js';
import { GUN, viewArmsGeo } from './models.js';

// Как далеко целик от глаза при прицеливании
const REAR_DIST = { smg: 0.17, semi: 0.15, bolt: 0.17, lmg: 0.09, revolver: 0.42, pistol: 0.42 };

export class ViewModel {
  constructor(gfx) {
    this.gfx = gfx;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.01, 10);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x554433, 1.2);
    this.dir = new THREE.DirectionalLight(0xffffff, 1.8);
    this.dir.position.set(-0.5, 1, 0.3);
    this.scene.add(this.hemi, this.dir);
    this.models = {};
    this.cur = null;
    this.mat = gfx ? gfx.triplanar('fabric', { local: true, scale: 9, roughness: 0.75, strength: 0.5, env: 0.8, key: 'vm' }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    const fl = new GeoBuilder();
    for (let i = 0; i < 3; i++) fl.add(new THREE.PlaneGeometry(0.22, 0.06), GeoBuilder.mat(0, 0, -0.08, 0, Math.PI / 2, (i * Math.PI) / 3), 0xffd090, 0);
    fl.add(new THREE.PlaneGeometry(0.12, 0.12), GeoBuilder.mat(0, 0, 0, 0, 0, Math.PI / 4), 0xffe6b0, 0);
    this.flashGeo = fl.build();
    this.flashMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    this.flashMat.color.setScalar(3);
    this.bobT = 0; this.kickZ = 0; this.kickR = 0; this.flashT = 0;
    this.swayX = 0; this.swayY = 0;
    this.visible = true;
  }
  setEnv(world, envMap) {
    const T = world.theme;
    this.hemi.color.setHex(T.hemiSky); this.hemi.groundColor.setHex(T.hemiGround);
    this.dir.color.setHex(T.sun);
    this.scene.environment = envMap || null;
  }
  build(team, wid, optic) {
    const g = new THREE.Group();
    const mesh = new THREE.Mesh(viewArmsGeo(team, wid, optic), this.mat);
    g.add(mesh);
    const G = GUN[wid];
    if (!G.pistol && wid !== 'lmg') {
      const bb = new GeoBuilder();
      const mz = G.muzzle;
      bb.box(0.012, 0.03, 0.4, 0.025, mz[1] - 0.02, mz[2] - 0.17, 0x9a9a98, 0, 0, 0, 0.02);
      g.bayonet = new THREE.Mesh(bb.build(), this.mat);
      g.bayonet.visible = false;
      g.add(g.bayonet);
    }
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat);
    flash.position.set(...G.muzzle);
    if (G.pistol) flash.scale.setScalar(0.6);
    flash.visible = false;
    g.add(flash);
    g.flash = flash;
    g.wid = wid;
    g.optic = optic;
    return g;
  }
  set(team, wid, optic = false) {
    const key = team + wid + (optic ? 'o' : '');
    if (!this.models[key]) { this.models[key] = this.build(team, wid, optic); this.scene.add(this.models[key]); }
    for (const k in this.models) this.models[k].visible = k === key;
    this.cur = this.models[key];
  }
  kick(w) {
    this.kickZ = Math.min(0.12, this.kickZ + (w.id === 'bolt' ? 0.08 : w.id === 'semi' ? 0.045 : w.side ? 0.05 : 0.022));
    this.kickR = Math.min(0.32, this.kickR + w.recoil * (w.side ? 0.05 : 0.035));
    this.flashT = 0.045;
    if (this.cur) {
      this.cur.flash.rotation.z = Math.random() * Math.PI;
      const s = (0.8 + Math.random() * 0.6) * (GUN[this.cur.wid].pistol ? 0.6 : 1);
      this.cur.flash.scale.set(s, s, s);
    }
  }
  update(dt, p, dyaw, dpitch, aspect) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const g = this.cur;
    if (!g) return;
    const wid = g.wid, G = GUN[wid];
    const ads = p.adsT;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    this.bobT += dt * (p.sprinting ? 13 : p.proneT > 0.5 ? 6 : 9) * Math.min(1, speed / 4);
    const bob = Math.min(1, speed / 4) * (p.onGround ? 1 : 0.2) * (1 - ads * 0.9);
    this.swayX = lerp(this.swayX, clamp(-dyaw * 0.9, -0.05, 0.05), Math.min(1, dt * 10));
    this.swayY = lerp(this.swayY, clamp(dpitch * 0.9, -0.05, 0.05), Math.min(1, dt * 10));
    this.kickZ = Math.max(0, this.kickZ - dt * 0.6);
    this.kickR = Math.max(0, this.kickR - dt * 2.4);
    const H = g.optic ? G.opticH : G.H;
    const hip = G.pistol ? [0.13, -0.15, -0.42] : [0.16, -0.17, -0.3];
    const aim = [0, -H, -REAR_DIST[wid] - G.rearZ];
    const e = ads * ads * (3 - 2 * ads);
    let x = lerp(hip[0], aim[0], e), y = lerp(hip[1], aim[1], e), z = lerp(hip[2], aim[2], e);
    x += Math.cos(this.bobT) * 0.012 * bob + this.swayX * (1 - ads * 0.85);
    y += Math.abs(Math.sin(this.bobT)) * 0.012 * bob + this.swayY * (1 - ads * 0.85);
    z += this.kickZ * (1 - ads * 0.5);
    let rx = this.kickR * (1 - ads * 0.6), ry = 0, rz = 0;
    // Бег
    this.sprintT = lerp(this.sprintT || 0, p.sprinting ? 1 : 0, Math.min(1, dt * 8));
    x += this.sprintT * 0.04; y -= this.sprintT * 0.06; ry += this.sprintT * 0.7; rx -= this.sprintT * 0.25;
    // Перезарядка и смена оружия
    if (p.reloadT > 0) {
      const k = clamp(1 - p.reloadT / p.weapon.reload, 0, 1);
      const s = Math.sin(k * Math.PI);
      y -= s * 0.13; rx -= s * 0.55; rz += s * 0.5;
    }
    if (p.switchT > 0) {
      const s = Math.sin(clamp(p.switchT / 0.55, 0, 1) * Math.PI * 0.5);
      y -= s * 0.35; rx -= s * 0.8;
    }
    if (p.throwT > 0) { const s = Math.sin((p.throwT / 0.65) * Math.PI); y -= s * 0.35; rx -= s * 0.6; }
    const melee = p.meleeT > 0 || p.chargeT > 0;
    if (g.bayonet) g.bayonet.visible = melee;
    if (p.meleeT > 0) { const s = Math.sin((p.meleeT / 0.35) * Math.PI); z -= s * 0.28; ry -= s * 0.15; }
    if (p.chargeT > 0) { z -= 0.12; x -= 0.05; ry -= 0.25; rx += 0.05; }
    // Лёжа оружие чуть ниже и ближе
    if (p.proneT > 0) { y -= p.proneT * 0.02 * (1 - ads); }
    g.position.set(x, y, z);
    g.rotation.set(rx, ry, rz);
    this.flashT -= dt;
    g.flash.visible = this.flashT > 0 && !(g.optic && ads > 0.85);
    this.visible = !(g.optic && ads > 0.85);
    g.visible = this.visible;
  }
  // Точка дула в мире — для трассера
  muzzleWorld(out) {
    const g = this.cur, cam = this.mainCam;
    if (!g || !cam) return out.set(0, 0, 0);
    g.updateMatrixWorld(true);
    out.set(...GUN[g.wid].muzzle).applyMatrix4(g.matrixWorld);
    return out.applyMatrix4(cam.matrixWorld);
  }
  render(renderer) {
    if (!this.cur || !this.cur.visible) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
