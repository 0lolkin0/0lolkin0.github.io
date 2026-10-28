// Общие помощники: математика, случайные числа, шум и сборщик геометрии с цветами вершин
import * as THREE from './three.module.min.js';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
// Кратчайшая разница углов: на сколько повернуть от a, чтобы попасть в b
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
// Рыскание, при котором «вперёд» (-Z) смотрит вдоль (dx, dz)
export const yawTo = (dx, dz) => Math.atan2(-dx, -dz);
export function dirFromYawPitch(yaw, pitch, out) {
  const cp = Math.cos(pitch);
  out.x = -Math.sin(yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(yaw) * cp;
  return out;
}
export function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz;
  let t = l2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / l2 : 0;
  t = clamp(t, 0, 1);
  const dx = px - (ax + vx * t), dz = pz - (az + vz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

// Детерминированный генератор (mulberry32)
export function rng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * f());
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  return f;
}
export const rand = (lo, hi) => lo + (hi - lo) * Math.random();
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Значимый (value) шум с интерполяцией и fbm
export class Noise2D {
  constructor(seed) { this.seed = seed | 0; }
  hash(i, j) {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(this.seed, 982451653);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
  }
  get(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = this.hash(i, j), b = this.hash(i + 1, j), c = this.hash(i, j + 1), d = this.hash(i + 1, j + 1);
    return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
  }
  fbm(x, y, oct = 4) {
    let s = 0, amp = 0.5, f = 1, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += this.get(x * f, y * f) * amp;
      norm += amp; amp *= 0.5; f *= 2.03;
    }
    return s / norm;
  }
}

// Сборщик: складывает много примитивов в одну BufferGeometry с цветами вершин
const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const PRIMS = {};
function prim(key, make) {
  if (!PRIMS[key]) {
    const g = make();
    PRIMS[key] = g.index ? g.toNonIndexed() : g;
  }
  return PRIMS[key];
}
export class GeoBuilder {
  constructor() { this.pos = []; this.norm = []; this.col = []; }
  get vertexCount() { return this.pos.length / 3; }
  add(geo, matrix, color, jitter = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position, n = g.attributes.normal;
    _nm.getNormalMatrix(matrix);
    _c.set(color);
    if (jitter) {
      const k = 1 + (Math.random() * 2 - 1) * jitter;
      _c.r *= k; _c.g *= k; _c.b *= k;
    }
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      this.pos.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      this.norm.push(_v.x, _v.y, _v.z);
      this.col.push(_c.r, _c.g, _c.b);
    }
    return this;
  }
  // Матрица из позиции, поворота (ry — рыскание, rx, rz) и масштаба
  static mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'YXZ') {
    _e.set(rx, ry, rz, order);
    _q.setFromEuler(_e);
    return _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }
  box(w, h, d, x, y, z, color, ry = 0, rx = 0, rz = 0, jitter = 0.06) {
    const g = prim('box', () => new THREE.BoxGeometry(1, 1, 1));
    return this.add(g, GeoBuilder.mat(x, y, z, rx, ry, rz, w, h, d), color, jitter);
  }
  cyl(rTop, rBot, h, seg, x, y, z, color, rx = 0, ry = 0, rz = 0, jitter = 0.05) {
    const key = 'cyl' + seg + '_' + (rTop / rBot).toFixed(3);
    const g = prim(key, () => new THREE.CylinderGeometry(rTop / rBot, 1, 1, seg, 1));
    return this.add(g, GeoBuilder.mat(x, y, z, rx, ry, rz, rBot, h, rBot), color, jitter);
  }
  sphere(r, x, y, z, color, sx = 1, sy = 1, sz = 1, detail = 1, jitter = 0.05) {
    const g = prim('ico' + detail, () => new THREE.IcosahedronGeometry(1, detail));
    return this.add(g, GeoBuilder.mat(x, y, z, 0, 0, 0, r * sx, r * sy, r * sz), color, jitter);
  }
  // Полусфера (купол) — для касок
  dome(r, x, y, z, color, sx = 1, sy = 1, sz = 1, seg = 8) {
    const g = prim('dome' + seg, () => new THREE.SphereGeometry(1, seg, Math.max(3, seg / 2 | 0), 0, TAU, 0, Math.PI / 2));
    return this.add(g, GeoBuilder.mat(x, y, z, 0, 0, 0, r * sx, r * sy, r * sz), color, 0.03);
  }
  rock(r, x, y, z, color, sx = 1, sy = 1, sz = 1, ry = 0) {
    const g = prim('dodeca', () => new THREE.DodecahedronGeometry(1, 0));
    return this.add(g, GeoBuilder.mat(x, y, z, 0.3, ry, 0.2, r * sx, r * sy, r * sz), color, 0.1);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.norm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// Пересечения луча
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox, ly = cy - oy, lz = cz - oz;
  const tc = lx * dx + ly * dy + lz * dz;
  if (tc < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tc * tc;
  const r2 = r * r;
  if (d2 > r2) return -1;
  const t = tc - Math.sqrt(r2 - d2);
  return t < 0 ? 0 : t;
}
// Луч против капсулы (отрезок a-b с радиусом r). Возвращает приблизительное t или -1
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const vx = bx - ax, vy = by - ay, vz = bz - az;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const B = dx * vx + dy * vy + dz * vz;
  const C = vx * vx + vy * vy + vz * vz;
  const D = dx * wx + dy * wy + dz * wz;
  const E = vx * wx + vy * wy + vz * wz;
  const den = C - B * B;
  let s;
  if (den < 1e-6) s = 0;
  else s = clamp((E - B * D) / den, 0, 1);
  let t = B * s - D;
  if (t < 0) t = 0;
  s = C > 0 ? clamp((wx + dx * t) * vx / C + (wy + dy * t) * vy / C + (wz + dz * t) * vz / C, 0, 1) : 0;
  t = Math.max(0, (ax + vx * s - ox) * dx + (ay + vy * s - oy) * dy + (az + vz * s - oz) * dz);
  const px = ox + dx * t - (ax + vx * s), py = oy + dy * t - (ay + vy * s), pz = oz + dz * t - (az + vz * s);
  const d2 = px * px + py * py + pz * pz;
  if (d2 > r * r) return -1;
  return Math.max(0, t - Math.sqrt(r * r - d2));
}
// Расстояние от точки до луча-отрезка (для свиста пуль)
export function pointSegDist3(px, py, pz, ox, oy, oz, dx, dy, dz, len) {
  let t = (px - ox) * dx + (py - oy) * dy + (pz - oz) * dz;
  t = clamp(t, 0, len);
  const x = ox + dx * t - px, y = oy + dy * t - py, z = oz + dz * t - pz;
  return Math.sqrt(x * x + y * y + z * z);
}

export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
