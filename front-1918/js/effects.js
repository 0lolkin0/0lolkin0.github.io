// Эффекты: частицы (дым, грязь, огонь, искры), трассеры, вспышки света, дождь и снег
import * as THREE from './three.module.min.js';
import { rand, TAU } from './util.js';

const VS = `
attribute float size;
attribute vec4 pcolor;
varying vec4 vColor;
varying float vRot;
uniform float scale;
#include <fog_pars_vertex>
void main() {
  vColor = pcolor;
  vRot = fract(sin(float(gl_VertexID) * 12.9898) * 43758.5453) * 6.2832;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(size * scale / max(0.1, -mvPosition.z), 0.0, 600.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const FS = `
varying vec4 vColor;
varying float vRot;
uniform sampler2D map;
#include <fog_pars_fragment>
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float cs = cos(vRot), sn = sin(vRot);
  vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
  vec4 t = texture2D(map, rc);
  float a = vColor.a * t.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * mix(0.75, 1.15, t.r), a);
  #include <tonemapping_fragment>
  #include <fog_fragment>
  #include <colorspace_fragment>
}`;
// Мягкое облачко для дыма, пыли и огня
let PUFF = null;
function puffTexture() {
  if (PUFF) return PUFF;
  const S = 128, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const c = cv.getContext('2d');
  const img = c.createImageData(S, S);
  const rnd = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const vn = (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = rnd(i, j), b = rnd(i + 1, j), cc = rnd(i, j + 1), d = rnd(i + 1, j + 1);
    return a + (b - a) * su + (cc - a) * sv + (a - b - cc + d) * su * sv;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2), d = Math.sqrt(dx * dx + dy * dy);
    const n = vn(x / 14, y / 14) * 0.5 + vn(x / 7, y / 7) * 0.3 + vn(x / 3.5, y / 3.5) * 0.2;
    const fall = Math.max(0, 1 - d);
    const a = Math.max(0, Math.min(1, fall * fall * (0.55 + n * 0.9) * 1.4 - 0.05));
    const o = (y * S + x) * 4;
    img.data[o] = img.data[o + 1] = img.data[o + 2] = 120 + n * 135; img.data[o + 3] = a * 255;
  }
  c.putImageData(img, 0, 0);
  PUFF = new THREE.CanvasTexture(cv);
  return PUFF;
}

class Particles {
  constructor(cap, additive) {
    this.cap = cap;
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.vel = new Float32Array(cap * 3);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grow = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.drag = new Float32Array(cap);
    this.a0 = new Float32Array(cap);
    this.s0 = new Float32Array(cap);
    this.ptr = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('pcolor', this.aCol);
    g.setAttribute('size', this.aSize);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { scale: { value: 500 }, map: { value: null } }]),
      vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: !additive,
    });
    this.mat.uniforms.map.value = puffTexture();
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 3 : 2;
    this.active = 0;
  }
  spawn(x, y, z, vx, vy, vz, size, grow, life, color, alpha, grav = 0, drag = 0) {
    const i = this.ptr;
    this.ptr = (this.ptr + 1) % this.cap;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 4] = color.r; this.col[i * 4 + 1] = color.g; this.col[i * 4 + 2] = color.b; this.col[i * 4 + 3] = 0;
    this.size[i] = size; this.s0[i] = size; this.grow[i] = grow;
    this.life[i] = life; this.max[i] = life; this.a0[i] = alpha;
    this.grav[i] = grav; this.drag[i] = drag;
  }
  update(dt) {
    let any = 0;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; continue; }
      any++;
      const t = 1 - this.life[i] / this.max[i];
      const dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.s0[i] * (1 + this.grow[i] * t);
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, t * 8) * (1 - t);
    }
    this.active = any;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true;
  }
}

const TRACER_CAP = 96;
class Tracers {
  constructor() {
    this.list = [];
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(TRACER_CAP * 4 * 3);
    this.col = new Float32Array(TRACER_CAP * 4 * 3);
    const idx = new Uint16Array(TRACER_CAP * 6);
    for (let i = 0; i < TRACER_CAP; i++) {
      const v = i * 4, o = i * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v + 2; idx[o + 4] = v + 1; idx[o + 5] = v + 3;
    }
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('color', this.aCol);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    }));
    this.mesh.material.color.setScalar(2.2);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }
  add(ax, ay, az, bx, by, bz, speed = 420, width = 0.035, len = 7, r = 1, gg = 0.8, b = 0.45) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 2) return;
    if (this.list.length >= TRACER_CAP) this.list.shift();
    this.list.push({ ax, ay, az, dx: dx / d, dy: dy / d, dz: dz / d, total: d, head: 0, speed, width, len, r, g: gg, b });
  }
  update(dt, cam) {
    const P = this.pos, C = this.col;
    P.fill(0);
    let n = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const t = this.list[i];
      t.head += t.speed * dt;
      const tail = Math.max(0, t.head - t.len);
      if (tail >= t.total) { this.list.splice(i, 1); continue; }
    }
    for (const t of this.list) {
      if (n >= TRACER_CAP) break;
      const head = Math.min(t.head, t.total), tail = Math.max(0, t.head - t.len);
      const x0 = t.ax + t.dx * tail, y0 = t.ay + t.dy * tail, z0 = t.az + t.dz * tail;
      const x1 = t.ax + t.dx * head, y1 = t.ay + t.dy * head, z1 = t.az + t.dz * head;
      const cx = cam.x - x0, cy = cam.y - y0, cz = cam.z - z0;
      let sx = t.dy * cz - t.dz * cy, sy = t.dz * cx - t.dx * cz, sz = t.dx * cy - t.dy * cx;
      const sl = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      const w = t.width * (1 + Math.sqrt(cx * cx + cy * cy + cz * cz) * 0.01);
      sx = (sx / sl) * w; sy = (sy / sl) * w; sz = (sz / sl) * w;
      const o = n * 12;
      P[o] = x0 - sx; P[o + 1] = y0 - sy; P[o + 2] = z0 - sz;
      P[o + 3] = x0 + sx; P[o + 4] = y0 + sy; P[o + 5] = z0 + sz;
      P[o + 6] = x1 - sx; P[o + 7] = y1 - sy; P[o + 8] = z1 - sz;
      P[o + 9] = x1 + sx; P[o + 10] = y1 + sy; P[o + 11] = z1 + sz;
      for (let k = 0; k < 4; k++) {
        const f = k < 2 ? 0.08 : 1;
        C[o + k * 3] = t.r * f; C[o + k * 3 + 1] = t.g * f; C[o + k * 3 + 2] = t.b * f;
      }
      n++;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }
}

class Weather {
  constructor(type) {
    this.type = type;
    const n = type === 'snow' ? 1400 : 1000;
    this.n = n;
    this.box = type === 'snow' ? [36, 18] : [32, 16];
    this.p = new Float32Array(n * 3);
    this.v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.p[i * 3] = rand(-this.box[0], this.box[0]);
      this.p[i * 3 + 1] = rand(-this.box[1], this.box[1]);
      this.p[i * 3 + 2] = rand(-this.box[0], this.box[0]);
      this.v[i] = type === 'snow' ? rand(0.9, 1.7) : rand(13, 17);
    }
    const g = new THREE.BufferGeometry();
    if (type === 'snow') {
      this.attr = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.attr);
      const cv = document.createElement('canvas');
      cv.width = cv.height = 32;
      const c = cv.getContext('2d');
      const gr = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = gr; c.fillRect(0, 0, 32, 32);
      this.obj = new THREE.Points(g, new THREE.PointsMaterial({
        size: 0.14, map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.9,
      }));
    } else {
      this.attr = new THREE.BufferAttribute(new Float32Array(n * 6), 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute('position', this.attr);
      this.obj = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb5bcc4, transparent: true, opacity: 0.32, depthWrite: false }));
    }
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.obj.frustumCulled = false;
    this.t = 0;
  }
  update(dt, cam) {
    this.t += dt;
    const [bx, by] = this.box, p = this.p, a = this.attr.array, snow = this.type === 'snow';
    for (let i = 0; i < this.n; i++) {
      let y = p[i * 3 + 1] - this.v[i] * dt;
      if (y < -by) y += by * 2;
      p[i * 3 + 1] = y;
      if (snow) p[i * 3] += Math.sin(this.t * 0.8 + i) * 0.4 * dt;
      else p[i * 3] += 1.5 * dt;
      // Держим частицы вокруг камеры
      let x = p[i * 3], z = p[i * 3 + 2];
      x = ((((x - cam.x) % (bx * 2)) + bx * 3) % (bx * 2)) - bx + cam.x;
      z = ((((z - cam.z) % (bx * 2)) + bx * 3) % (bx * 2)) - bx + cam.z;
      p[i * 3] = x; p[i * 3 + 2] = z;
      const wy = y + cam.y;
      if (snow) { a[i * 3] = x; a[i * 3 + 1] = wy; a[i * 3 + 2] = z; }
      else {
        const o = i * 6;
        a[o] = x; a[o + 1] = wy; a[o + 2] = z;
        a[o + 3] = x - 0.1; a[o + 4] = wy + 0.75; a[o + 5] = z;
      }
    }
    this.attr.needsUpdate = true;
  }
}

const COL = (h) => new THREE.Color(h);
const C = {
  fire1: COL(0xffc46a), fire2: COL(0xff7a2a), smoke: COL(0x4a4540), smokeL: COL(0x8a857c), dirt: COL(0x4a3a2a), dirtL: COL(0x7a6650),
  snow: COL(0xe8edf2), stone: COL(0x9a958c), wood: COL(0x8a6a48), spark: COL(0xffd890), blood: COL(0x7a1010), flash: COL(0xffe0a0),
  sand: COL(0xb09a6a), flare: COL(0xff5040), flareCore: COL(0xffffff), dust: COL(0xa49a88),
};

export class Effects {
  constructor(scene, quality, weather, winter) {
    this.scene = scene;
    this.q = quality;
    this.winter = winter;
    this.normal = new Particles(quality >= 2 ? 3000 : 1800, false);
    this.add = new Particles(quality >= 2 ? 1400 : 900, true);
    scene.add(this.normal.points, this.add.points);
    this.tracers = new Tracers();
    scene.add(this.tracers.mesh);
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb060, 0, 30, 1.6);
      scene.add(l);
      this.lights.push({ l, t: 0, dur: 1, peak: 0 });
    }
    this.li = 0;
    this.weather = weather ? new Weather(weather) : null;
    if (this.weather) scene.add(this.weather.obj);
    this.emitters = [];
    this.flares = [];
  }
  setScale(h, fov) {
    const s = h / (2 * Math.tan((fov * Math.PI) / 360));
    this.normal.mat.uniforms.scale.value = s;
    this.add.mat.uniforms.scale.value = s;
  }
  flash(x, y, z, peak, dist, dur, color = 0xffb060, slot = -1) {
    const L = slot >= 0 ? this.lights[slot] : this.lights[(this.li = (this.li + 1) % 2)];
    L.l.position.set(x, y, z);
    L.l.color.setHex(color);
    L.l.distance = dist;
    L.peak = peak; L.t = dur; L.dur = dur;
  }
  explosion(x, y, z, s = 1) {
    this.flash(x, y + 1.5, z, 60 * s, 30 * s, 0.35);
    const A = this.add, Nn = this.normal;
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, u = rand(0.2, 1);
      A.spawn(x, y + 0.6 * s, z, Math.cos(a) * rand(2, 6) * s, rand(1, 6) * s * u, Math.sin(a) * rand(2, 6) * s,
        rand(1.6, 3.2) * s, 1.8, rand(0.25, 0.45), i % 2 ? C.fire1 : C.fire2, 0.95, -2, 3);
    }
    const dirt = this.winter ? C.snow : C.dirt;
    for (let i = 0; i < 28; i++) {
      const a = Math.random() * TAU, sp = rand(2, 8) * s;
      Nn.spawn(x, y + 0.3, z, Math.cos(a) * sp, rand(5, 15) * s, Math.sin(a) * sp, rand(0.2, 0.55) * s, 0.2, rand(1.0, 1.9), i % 3 ? dirt : C.dirtL, 1, 17, 0.3);
    }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU, sp = rand(0.5, 2.5) * s;
      Nn.spawn(x + Math.cos(a) * 0.8, y + rand(0.5, 2.5) * s, z + Math.sin(a) * 0.8, Math.cos(a) * sp, rand(1, 3), Math.sin(a) * sp,
        rand(2.5, 4.5) * s, 2.2, rand(3, 5.5), i % 2 ? C.smoke : C.smokeL, 0.55, -0.2, 0.6);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      Nn.spawn(x, y + 0.3, z, Math.cos(a) * 7 * s, 0.4, Math.sin(a) * 7 * s, 1.5 * s, 2.5, 1.6, this.winter ? C.snow : C.dust, 0.45, 0, 2.2);
    }
  }
  airburst(x, y, z) {
    this.flash(x, y, z, 30, 30, 0.25);
    for (let i = 0; i < 8; i++) this.add.spawn(x, y, z, rand(-4, 4), rand(-4, 4), rand(-4, 4), rand(1.5, 3), 1.5, 0.3, C.fire2, 0.9, 0, 2);
    for (let i = 0; i < 8; i++) this.normal.spawn(x, y, z, rand(-2, 2), rand(-1, 2), rand(-2, 2), rand(2, 4), 2, rand(3, 5), C.smoke, 0.6, -0.1, 0.5);
  }
  impact(x, y, z, nx, ny, nz, mat) {
    const N = this.normal;
    let col = C.dirt, light = C.dirtL, sparks = 0;
    if (mat === 'dirt') { col = this.winter ? C.snow : C.dirt; light = this.winter ? C.snow : C.dirtL; }
    else if (mat === 'stone') { col = C.stone; light = C.dust; sparks = 1; }
    else if (mat === 'wood') { col = C.wood; light = C.dust; }
    else if (mat === 'metal') { col = C.smokeL; light = C.stone; sparks = 4; }
    else if (mat === 'sand') { col = C.sand; light = C.dust; }
    for (let i = 0; i < 4; i++) {
      N.spawn(x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * rand(1, 4) + rand(-1, 1), ny * rand(1, 4) + rand(0.5, 2.5), nz * rand(1, 4) + rand(-1, 1),
        rand(0.06, 0.14), 0, rand(0.4, 0.8), col, 1, 12, 0.5);
    }
    N.spawn(x + nx * 0.2, y + ny * 0.2, z + nz * 0.2, nx * 0.6, 0.5, nz * 0.6, 0.35, 2.2, 0.9, light, 0.5, -0.1, 1.5);
    for (let i = 0; i < sparks; i++) this.add.spawn(x, y, z, nx * 4 + rand(-3, 3), ny * 4 + rand(-1, 3), nz * 4 + rand(-3, 3), 0.07, 0, 0.18, C.spark, 1, 10, 1);
  }
  blood(x, y, z, dx, dy, dz) {
    for (let i = 0; i < 6; i++) {
      this.normal.spawn(x, y, z, dx * rand(1, 3) + rand(-0.8, 0.8), dy * 2 + rand(0, 1.5), dz * rand(1, 3) + rand(-0.8, 0.8),
        rand(0.06, 0.13), 0.3, rand(0.35, 0.6), C.blood, 0.9, 12, 0.4);
    }
    this.normal.spawn(x, y, z, dx * 0.6, 0.2, dz * 0.6, 0.3, 1.4, 0.35, C.blood, 0.45, 0, 2);
  }
  muzzle(x, y, z, dx, dy, dz, big = false) {
    this.add.spawn(x, y, z, dx * 2, dy * 2, dz * 2, big ? 0.9 : 0.55, 0.4, 0.05, C.flash, 1, 0, 0);
    if (Math.random() < 0.5) this.normal.spawn(x + dx * 0.3, y + dy * 0.3, z + dz * 0.3, dx * 0.8, 0.3, dz * 0.8, 0.25, 3, 0.6, C.smokeL, 0.25, -0.2, 1);
  }
  smokePuff(x, y, z, s = 1, dark = false) {
    this.normal.spawn(x + rand(-0.4, 0.4), y, z + rand(-0.4, 0.4), rand(-0.3, 0.3), rand(1, 2), rand(-0.3, 0.3), rand(1, 2) * s, 2.5, rand(3, 5), dark ? C.smoke : C.smokeL, 0.42, -0.15, 0.3);
  }
  fire(x, y, z, s = 1) {
    this.add.spawn(x + rand(-0.5, 0.5) * s, y, z + rand(-0.5, 0.5) * s, rand(-0.3, 0.3), rand(1.5, 3), rand(-0.3, 0.3), rand(0.6, 1.2) * s, 0.5, rand(0.3, 0.6), Math.random() < 0.5 ? C.fire1 : C.fire2, 0.8, -1, 0.5);
  }
  flareGlow(x, y, z) {
    this.add.spawn(x, y, z, 0, 0, 0, 1.4, 0.2, 0.08, C.flare, 1, 0, 0);
    this.add.spawn(x, y, z, 0, 0, 0, 0.5, 0, 0.08, C.flareCore, 1, 0, 0);
    if (Math.random() < 0.4) this.normal.spawn(x, y, z, rand(-0.2, 0.2), rand(-0.2, 0.3), rand(-0.2, 0.2), 0.5, 3, 2, C.smokeL, 0.3, 0, 0.2);
  }
  heal(x, y, z) {
    this.add.spawn(x + rand(-0.4, 0.4), y, z + rand(-0.4, 0.4), 0, 1.2, 0, 0.18, 0, 0.7, COL(0x70ff90), 0.8, 0, 0);
  }
  update(dt, cam) {
    this.normal.update(dt);
    this.add.update(dt);
    this.tracers.update(dt, cam);
    for (const L of this.lights) {
      if (L.t > 0) {
        L.t -= dt;
        const k = Math.max(0, L.t / L.dur);
        L.l.intensity = L.peak * k * k;
      } else L.l.intensity = 0;
    }
    if (this.weather) this.weather.update(dt, cam);
    for (const e of this.emitters) {
      e.acc = (e.acc || 0) + dt * e.rate;
      while (e.acc > 1) { e.acc -= 1; this.smokePuff(e.x, e.y, e.z, e.size || 1, true); }
    }
  }
}
