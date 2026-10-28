// Мир: рельеф (сетка высот 1 м), окопы, воронки, постройки, коллайдеры, лучи, навигационная сетка и миникарта
import * as THREE from './three.module.min.js';
import { GeoBuilder, Noise2D, rng, clamp, smoothstep, lerp, segDist, TAU } from './util.js';
import { THEMES } from './maps.js';

export const HALF = 150, SIZE = 300, PLAY = 141;
const N = 300, V = N + 1;
const G = 10, GN = SIZE / G; // сетка коллайдеров
export const NAVC = 1, NAVN = SIZE / NAVC;
export const STEP = 0.5; // на сколько можно шагнуть вверх без прыжка
const BLOCK = 255;

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; }
const lin2srgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

export class World {
  constructor(def, quality = 1) {
    this.def = def;
    this.theme = THEMES[def.theme];
    this.quality = quality;
    const seed = hashStr(def.id);
    this.rand = rng(seed);
    this.noise = new Noise2D(seed);
    this.colliders = [];
    this.cells = Array.from({ length: GN * GN }, () => []);
    this.stamp = 1;
    this.sb = new GeoBuilder(); // вся статика одним мешем
    this.footprints = [];
    this.craters = [];
    this.wireSegs = [];
    this.smokers = [];
    this.windmills = [];
    this.trees = [];
    this.group = new THREE.Group();
    this.C = {};
    for (const k of ['stone', 'brick', 'roof', 'wood', 'woodDark', 'canvas']) this.C[k] = this.theme[k];

    this.genTerrain();
    this.buildStructures();
    this.buildTrenchProps();
    this.buildWires();
    this.buildHQs();
    this.buildFlagPoles();
    this.buildTrees();
    this.buildRocks();
    this.buildMeshes();
    this.buildNav();
    this.buildMinimap();
  }

  // ---------- Рельеф ----------
  baseHeight(x, z) {
    const d = this.def, n = this.noise;
    let h = n.fbm(x * 0.009 + 13.1, z * 0.009 - 7.3, 4) * d.noiseAmp;
    h += n.fbm(x * 0.045 + 101, z * 0.045 + 33, 2) * 0.45;
    for (const hl of d.hills) {
      const dx = x - hl.x, dz = z - hl.z;
      h += hl.h * Math.exp(-(dx * dx + dz * dz) / (hl.r * hl.r));
    }
    const e = Math.max(Math.abs(x), Math.abs(z)) - (PLAY - 3);
    if (e > 0) h += e * e * 0.07;
    return h;
  }
  footprintOf(st) {
    switch (st.t) {
      case 'house': case 'barn': case 'cabin': case 'shed': return [st.w / 2 + 1.2, st.d / 2 + 1.2, 4];
      case 'church': return [7.5, 14, 6];
      case 'chapel': return [5, 8, 5];
      case 'windmill': return [4.5, 4.5, 5];
      case 'bunker': return [st.w / 2 + 1.5, st.d / 2 + 1.5, 3];
      case 'blockhouse': return [6.5, 6.5, 5];
      case 'fort': return [19, 19, 9];
      case 'gun': case 'cart': case 'tankwreck': case 'logs': return [3, 3, 2];
      case 'tent': return [3, 3, 2];
      default: return null;
    }
  }
  genTerrain() {
    const def = this.def;
    const H = (this.H = new Float32Array(V * V));
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) H[j * V + i] = this.baseHeight(i - HALF, j - HALF);

    // Выравниваем площадки под постройками и штабами
    const flats = [];
    for (const st of def.structures) {
      const fp = this.footprintOf(st);
      if (!fp) continue;
      const yaw = st.yaw || 0;
      let target = this.baseHeight(st.x, st.z);
      if (st.t === 'fort') target += 0.3;
      flats.push({ x: st.x, z: st.z, hw: fp[0], hd: fp[1], m: fp[2], c: Math.cos(yaw), s: Math.sin(yaw), target });
      this.footprints.push({ x: st.x, z: st.z, r: Math.hypot(fp[0], fp[1]) });
    }
    for (const hq of def.hq) {
      flats.push({ x: hq.x, z: hq.z, hw: 22, hd: 12, m: 10, c: 1, s: 0, target: this.baseHeight(hq.x, hq.z) });
      this.footprints.push({ x: hq.x, z: hq.z, r: 24 });
    }
    for (const f of flats) {
      const R = Math.hypot(f.hw, f.hd) + f.m;
      this.forEachVertex(f.x - R, f.z - R, f.x + R, f.z + R, (k, x, z) => {
        const dx = x - f.x, dz = z - f.z;
        const lx = dx * f.c - dz * f.s, lz = dx * f.s + dz * f.c;
        const ox = Math.max(Math.abs(lx) - f.hw, 0), oz = Math.max(Math.abs(lz) - f.hd, 0);
        const w = 1 - smoothstep(0, f.m, Math.hypot(ox, oz));
        if (w > 0) H[k] = lerp(H[k], f.target, w);
      });
    }
    const B = (this.B = new Float32Array(H));

    // Воронки
    const r = this.rand;
    const cr = def.craters;
    let tries = 0;
    while (this.craters.length < cr.count && tries++ < cr.count * 20) {
      const x = r.range(-PLAY + 6, PLAY - 6), z = r.range(cr.zMin, cr.zMax);
      const rad = r.range(2.2, 6.2);
      if (this.nearFootprint(x, z, rad + 1.5)) continue;
      this.craters.push({ x, z, r: rad, d: rad * r.range(0.28, 0.42) });
    }
    for (const c of this.craters) {
      const R = c.r * 1.7;
      this.forEachVertex(c.x - R, c.z - R, c.x + R, c.z + R, (k, x, z) => {
        const d = Math.hypot(x - c.x, z - c.z);
        let v = 0;
        if (d < c.r) v -= c.d * (1 - (d / c.r) * (d / c.r));
        const q = (d - c.r) / (0.32 * c.r);
        v += c.d * 0.28 * Math.exp(-q * q);
        H[k] += v;
      });
    }

    // Окопы: держим минимальное расстояние до осевых линий
    const T = new Float32Array(V * V).fill(99);
    this.trenchSegs = [];
    for (const tr of def.trenches) {
      for (let s = 0; s + 1 < tr.pts.length; s++) {
        const [ax, az] = tr.pts[s], [bx, bz] = tr.pts[s + 1];
        this.trenchSegs.push({ ax, az, bx, bz, side: tr.side });
        const m = 4;
        this.forEachVertex(Math.min(ax, bx) - m, Math.min(az, bz) - m, Math.max(ax, bx) + m, Math.max(az, bz) + m, (k, x, z) => {
          const d = segDist(x, z, ax, az, bx, bz);
          if (d < T[k]) T[k] = d;
        });
      }
    }
    const tw = 0.95, slope = 1.15, depth = 1.9;
    for (let k = 0; k < V * V; k++) {
      const d = T[k];
      if (d > 4) continue;
      const prof = d < tw ? 1 : 1 - smoothstep(tw, tw + slope, d);
      let bump = 0;
      if (d > tw + 0.9 && d < tw + 2.9) bump = 0.38 * Math.sin((Math.PI * (d - tw - 0.9)) / 2.0);
      H[k] = H[k] - depth * prof + (prof < 0.02 ? bump : 0);
    }
    this.trenchDist = T;

    let maxH = -1e9;
    for (let k = 0; k < V * V; k++) if (H[k] > maxH) maxH = H[k];
    this.maxH = maxH + 1;
  }
  forEachVertex(x0, z0, x1, z1, fn) {
    const i0 = clamp(Math.floor(x0 + HALF), 0, N), i1 = clamp(Math.ceil(x1 + HALF), 0, N);
    const j0 = clamp(Math.floor(z0 + HALF), 0, N), j1 = clamp(Math.ceil(z1 + HALF), 0, N);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) fn(j * V + i, i - HALF, j - HALF);
  }
  nearFootprint(x, z, pad) {
    for (const f of this.footprints) if (Math.hypot(x - f.x, z - f.z) < f.r + pad) return true;
    return false;
  }
  height(x, z) {
    let fx = x + HALF, fz = z + HALF;
    fx = fx < 0 ? 0 : fx > N - 1e-4 ? N - 1e-4 : fx;
    fz = fz < 0 ? 0 : fz > N - 1e-4 ? N - 1e-4 : fz;
    const i = fx | 0, j = fz | 0, u = fx - i, v = fz - j;
    const H = this.H, k = j * V + i;
    if (u + v <= 1) {
      const h00 = H[k];
      return h00 + (H[k + 1] - h00) * u + (H[k + V] - h00) * v;
    }
    const h11 = H[k + V + 1];
    return h11 + (H[k + V] - h11) * (1 - u) + (H[k + 1] - h11) * (1 - v);
  }
  normalAt(x, z, out) {
    const hx = this.height(x + 0.5, z) - this.height(x - 0.5, z);
    const hz = this.height(x, z + 0.5) - this.height(x, z - 0.5);
    out.set(-hx, 1, -hz).normalize();
    return out;
  }
  inTrench(x, z) {
    const i = clamp(Math.round(x + HALF), 0, N), j = clamp(Math.round(z + HALF), 0, N);
    return this.trenchDist[j * V + i] < 1.4;
  }

  // ---------- Коллайдеры ----------
  addBox(x, z, y0, y1, hx, hz, yaw = 0, mat = 'stone') {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const col = { kind: 0, x, z, y: y0, top: y1, hx, hz, c, s, mat, st: 0 };
    col.ex = Math.abs(c) * hx + Math.abs(s) * hz;
    col.ez = Math.abs(s) * hx + Math.abs(c) * hz;
    this.insert(col);
    return col;
  }
  addCyl(x, z, y0, y1, r, mat = 'wood') {
    const col = { kind: 1, x, z, y: y0, top: y1, r, ex: r, ez: r, mat, st: 0 };
    this.insert(col);
    return col;
  }
  insert(col) {
    this.colliders.push(col);
    const i0 = clamp(Math.floor((col.x - col.ex + HALF) / G), 0, GN - 1), i1 = clamp(Math.floor((col.x + col.ex + HALF) / G), 0, GN - 1);
    const j0 = clamp(Math.floor((col.z - col.ez + HALF) / G), 0, GN - 1), j1 = clamp(Math.floor((col.z + col.ez + HALF) / G), 0, GN - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.cells[j * GN + i].push(col);
  }
  // Видимый и твёрдый блок: w — по локальной X, d — по локальной Z, y — низ
  solid(w, h, d, x, y, z, yaw, color, mat = 'stone', jitter = 0.07) {
    this.sb.box(w, h, d, x, y + h / 2, z, color, yaw, 0, 0, jitter);
    return this.addBox(x, z, y, y + h, w / 2, d / 2, yaw, mat);
  }
  forNear(x, z, r, fn) {
    const st = ++this.stamp;
    const i0 = clamp(Math.floor((x - r + HALF) / G), 0, GN - 1), i1 = clamp(Math.floor((x + r + HALF) / G), 0, GN - 1);
    const j0 = clamp(Math.floor((z - r + HALF) / G), 0, GN - 1), j1 = clamp(Math.floor((z + r + HALF) / G), 0, GN - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const cell = this.cells[j * GN + i];
      for (let k = 0; k < cell.length; k++) {
        const c = cell[k];
        if (c.st === st) continue;
        c.st = st;
        if (Math.abs(c.x - x) > c.ex + r || Math.abs(c.z - z) > c.ez + r) continue;
        if (fn(c) === false) return;
      }
    }
  }
  // Выталкивание круга (солдат, танк). Возвращает самый высокий упёршийся коллайдер в out.block
  pushCircle(pos, r, footY, headY, out) {
    out.block = null;
    out.hits = 0;
    this.forNear(pos.x, pos.z, r + 0.5, (c) => {
      if (c.top <= footY + STEP || c.y >= headY) return;
      if (c.kind === 0) {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        let lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
        const qx = clamp(lx, -c.hx, c.hx), qz = clamp(lz, -c.hz, c.hz);
        const ex = lx - qx, ez = lz - qz;
        const d2 = ex * ex + ez * ez;
        if (d2 >= r * r) return;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2), k = (r - d) / d;
          lx += ex * k; lz += ez * k;
        } else {
          const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
          if (px < pz) lx = (lx < 0 ? -1 : 1) * (c.hx + r);
          else lz = (lz < 0 ? -1 : 1) * (c.hz + r);
        }
        pos.x = c.x + lx * c.c + lz * c.s;
        pos.z = c.z - lx * c.s + lz * c.c;
      } else {
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const rr = r + c.r, d2 = dx * dx + dz * dz;
        if (d2 >= rr * rr) return;
        const d = Math.sqrt(d2) || 1e-3;
        pos.x = c.x + (dx / d) * rr;
        pos.z = c.z + (dz / d) * rr;
      }
      out.hits++;
      if (!out.block || c.top > out.block.top) out.block = c;
    });
    return out;
  }
  // Пол под ногами: рельеф или верх ящика/стены (если не выше шага)
  groundAt(x, z, y) {
    let g = this.height(x, z);
    const i = clamp(Math.floor((x + HALF) / G), 0, GN - 1), j = clamp(Math.floor((z + HALF) / G), 0, GN - 1);
    const cell = this.cells[j * GN + i];
    for (let k = 0; k < cell.length; k++) {
      const c = cell[k];
      if (c.top <= g || c.top > y + STEP) continue;
      if (c.kind === 0) {
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
        if (Math.abs(lx) <= c.hx + 0.05 && Math.abs(lz) <= c.hz + 0.05) g = c.top;
      } else if ((x - c.x) ** 2 + (z - c.z) ** 2 <= c.r * c.r) g = c.top;
    }
    return g;
  }
  // Есть ли что-то твёрдое в точке (для проверки точек появления)
  blockedAt(x, z, y, r = 0.5) {
    let hit = false;
    this.forNear(x, z, r, (c) => {
      if (c.top <= y + STEP || c.y >= y + 1.8) return;
      if (c.kind === 0) {
        const dx = x - c.x, dz = z - c.z;
        const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
        if (Math.abs(lx) < c.hx + r && Math.abs(lz) < c.hz + r) { hit = true; return false; }
      } else if (Math.hypot(x - c.x, z - c.z) < c.r + r) { hit = true; return false; }
    });
    return hit;
  }

  // ---------- Лучи ----------
  rayCollider(c, ox, oy, oz, dx, dy, dz, maxT, out) {
    if (c.kind === 0) {
      const rx = ox - c.x, rz = oz - c.z;
      const lox = rx * c.c - rz * c.s, loz = rx * c.s + rz * c.c;
      const ldx = dx * c.c - dz * c.s, ldz = dx * c.s + dz * c.c;
      const hy = (c.top - c.y) / 2, cy = c.y + hy, loy = oy - cy;
      let tmin = 0, tmax = maxT, ax = 0;
      // X
      if (Math.abs(ldx) < 1e-9) { if (lox < -c.hx || lox > c.hx) return -1; }
      else {
        let t1 = (-c.hx - lox) / ldx, t2 = (c.hx - lox) / ldx, sg = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
        if (t1 > tmin) { tmin = t1; ax = 1 * sg; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
      if (Math.abs(dy) < 1e-9) { if (loy < -hy || loy > hy) return -1; }
      else {
        let t1 = (-hy - loy) / dy, t2 = (hy - loy) / dy, sg = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
        if (t1 > tmin) { tmin = t1; ax = 2 * sg; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
      if (Math.abs(ldz) < 1e-9) { if (loz < -c.hz || loz > c.hz) return -1; }
      else {
        let t1 = (-c.hz - loz) / ldz, t2 = (c.hz - loz) / ldz, sg = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sg = 1; }
        if (t1 > tmin) { tmin = t1; ax = 3 * sg; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return -1;
      }
      if (tmin <= 0 && ax === 0) return -1; // начало внутри — пропускаем
      if (out) {
        let nx = 0, ny = 0, nz = 0;
        const a = Math.abs(ax), sg = ax > 0 ? 1 : -1;
        if (a === 1) nx = sg; else if (a === 2) ny = sg; else nz = sg;
        // ось a выбрана по входу: нормаль смотрит против луча
        if (a === 1) nx = -Math.sign(ldx); else if (a === 2) ny = -Math.sign(dy); else nz = -Math.sign(ldz);
        out.nx = nx * c.c + nz * c.s; out.ny = ny; out.nz = -nx * c.s + nz * c.c;
      }
      return tmin;
    }
    // Цилиндр
    const rx = ox - c.x, rz = oz - c.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-9) return -1;
    const b = rx * dx + rz * dz, cc = rx * rx + rz * rz - c.r * c.r;
    const disc = b * b - a * cc;
    if (disc < 0) return -1;
    const t = (-b - Math.sqrt(disc)) / a;
    if (t < 0 || t > maxT) return -1;
    const y = oy + dy * t;
    if (y < c.y || y > c.top) return -1;
    if (out) {
      const nx = rx + dx * t, nz = rz + dz * t, l = Math.hypot(nx, nz) || 1;
      out.nx = nx / l; out.ny = 0; out.nz = nz / l;
    }
    return t;
  }
  // Луч по миру: возвращает расстояние (Infinity — мимо). out: nx, ny, nz, mat, terrain
  raycast(ox, oy, oz, dx, dy, dz, maxD, out) {
    let best = maxD, hit = false;
    const tmp = this._rtmp || (this._rtmp = {});
    const st = ++this.stamp;
    let gx = Math.floor((ox + HALF) / G), gz = Math.floor((oz + HALF) / G);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = Math.abs(dx) > 1e-9 ? G / Math.abs(dx) : Infinity;
    const tdz = Math.abs(dz) > 1e-9 ? G / Math.abs(dz) : Infinity;
    let tmx = Math.abs(dx) > 1e-9 ? ((gx + (dx > 0 ? 1 : 0)) * G - HALF - ox) / dx : Infinity;
    let tmz = Math.abs(dz) > 1e-9 ? ((gz + (dz > 0 ? 1 : 0)) * G - HALF - oz) / dz : Infinity;
    let tcell = 0;
    for (let guard = 0; guard < 200; guard++) {
      if (gx >= 0 && gz >= 0 && gx < GN && gz < GN) {
        const cell = this.cells[gz * GN + gx];
        for (let k = 0; k < cell.length; k++) {
          const c = cell[k];
          if (c.st === st) continue;
          c.st = st;
          const t = this.rayCollider(c, ox, oy, oz, dx, dy, dz, best, tmp);
          if (t >= 0 && t < best) {
            best = t; hit = true;
            if (out) { out.nx = tmp.nx; out.ny = tmp.ny; out.nz = tmp.nz; out.mat = c.mat; out.terrain = false; }
          }
        }
      } else if ((gx < 0 && sx < 0) || (gz < 0 && sz < 0) || (gx >= GN && sx > 0) || (gz >= GN && sz > 0)) break;
      tcell = Math.min(tmx, tmz);
      if (tcell > best) break;
      if (tmx < tmz) { gx += sx; tmx += tdx; } else { gz += sz; tmz += tdz; }
    }
    const tt = this.rayTerrain(ox, oy, oz, dx, dy, dz, best);
    if (tt >= 0 && tt < best) {
      best = tt; hit = true;
      if (out) {
        const n = this._n || (this._n = new THREE.Vector3());
        this.normalAt(ox + dx * tt, oz + dz * tt, n);
        out.nx = n.x; out.ny = n.y; out.nz = n.z; out.mat = 'dirt'; out.terrain = true;
      }
    }
    return hit ? best : Infinity;
  }
  rayTerrain(ox, oy, oz, dx, dy, dz, maxD) {
    const step = 0.8;
    let prevT = 0, prevD = oy - this.height(ox, oz);
    if (prevD < 0) return 0;
    for (let t = step; t <= maxD + step; t += step) {
      const tt = Math.min(t, maxD);
      const y = oy + dy * tt;
      if (dy > 0 && y > this.maxH) return -1;
      const d = y - this.height(ox + dx * tt, oz + dz * tt);
      if (d < 0) {
        let a = prevT, b = tt;
        for (let i = 0; i < 6; i++) {
          const m = (a + b) / 2;
          if (oy + dy * m - this.height(ox + dx * m, oz + dz * m) < 0) b = m; else a = m;
        }
        return a;
      }
      prevT = tt; prevD = d;
      if (tt >= maxD) break;
    }
    return -1;
  }
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.01) return true;
    return this.raycast(ax, ay, az, dx / d, dy / d, dz / d, d - 0.25, null) === Infinity;
  }
  inWire(x, z) {
    for (const w of this.wireSegs) {
      if (x < w.minx || x > w.maxx || z < w.minz || z > w.maxz) continue;
      if (segDist(x, z, w.ax, w.az, w.bx, w.bz) < 1.1) return true;
    }
    return false;
  }

  // ---------- Постройки ----------
  L(st, lx, lz) {
    const c = Math.cos(st.yaw || 0), s = Math.sin(st.yaw || 0);
    return [st.x + lx * c + lz * s, st.z - lx * s + lz * c];
  }
  // Стена из кусков между локальными точками a и b, с проёмами и разрушениями
  wallLine(st, ax, az, bx, bz, y0, h, t, color, opt = {}) {
    const r = this.rand;
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.round(len / 1.7));
    const seg = len / n;
    const ux = (bx - ax) / len, uz = (bz - az) / len;
    const wyaw = (st.yaw || 0) + Math.atan2(-uz, ux);
    const ruin = opt.ruin || 0;
    for (let k = 0; k < n; k++) {
      const mx = ax + ux * seg * (k + 0.5), mz = az + uz * seg * (k + 0.5);
      const [wx, wz] = this.L(st, mx, mz);
      const isDoor = opt.door !== undefined && k === Math.floor(opt.door * n);
      if (isDoor) {
        if (ruin < 0.5 && h > 2.6) this.solid(seg, h - 2.3, t, wx, y0 + 2.3, wz, wyaw, color, opt.mat);
        continue;
      }
      if (ruin && r() < ruin * 0.3) {
        if (r() < 0.5) this.rubble(wx, wz, y0, color);
        continue;
      }
      let sh = h * (ruin ? 1 - r() * ruin * 0.75 : 1);
      sh = Math.max(0.6, sh);
      const win = opt.windows !== false && sh > 2.7 && k % 2 === 1 && k !== 0 && k !== n - 1 && r() < 0.75;
      if (win) {
        this.solid(seg, 1.05, t, wx, y0, wz, wyaw, color, opt.mat);
        this.solid(seg, sh - 2.0, t, wx, y0 + 2.0, wz, wyaw, color, opt.mat);
      } else this.solid(seg, sh, t, wx, y0, wz, wyaw, color, opt.mat);
    }
  }
  rubble(x, z, y0, color) {
    const r = this.rand;
    for (let i = 0; i < 4; i++) {
      const s = r.range(0.25, 0.6);
      this.sb.box(s, s * 0.7, s * 1.1, x + r.range(-0.9, 0.9), y0 + s * 0.3, z + r.range(-0.9, 0.9), color, r() * 3, r() * 0.5, r() * 0.5, 0.12);
    }
  }
  roof(st, w, d, yh, hr, color) {
    // Двускатная крыша — треугольная призма вдоль локальной Z
    const sx = (w + 0.9) / 1.732, sz = hr / 1.5;
    const m = GeoBuilder.mat(st.x, yh + 0.5 * sz, st.z, -Math.PI / 2, st.yaw || 0, 0, sx, d + 0.7, sz);
    this.sb.add(this.prism(), m, color, 0.05);
    this.addBox(st.x, st.z, yh, yh + hr * 0.55, w / 2, d / 2, st.yaw || 0, 'wood');
  }
  prism() {
    if (!this._prism) this._prism = new THREE.CylinderGeometry(1, 1, 1, 3, 1).toNonIndexed();
    return this._prism;
  }
  house(st, color, mat = 'stone') {
    const { w, d, h } = st;
    const y0 = this.height(st.x, st.z) - 0.05;
    const t = 0.4, ruin = st.ruin || 0;
    const o = { ruin, mat };
    this.wallLine(st, -w / 2, d / 2, w / 2, d / 2, y0, h, t, color, { ...o, door: 0.5 });
    this.wallLine(st, -w / 2, -d / 2, w / 2, -d / 2, y0, h, t, color, o);
    this.wallLine(st, -w / 2, -d / 2 + t / 2, -w / 2, d / 2 - t / 2, y0, h, t, color, { ...o, door: ruin > 0.5 ? undefined : 0.3 });
    this.wallLine(st, w / 2, -d / 2 + t / 2, w / 2, d / 2 - t / 2, y0, h, t, color, o);
    this.sb.box(w - 0.2, 0.12, d - 0.2, st.x, y0 + 0.04, st.z, this.C.woodDark, st.yaw || 0);
    if (st.roof && ruin < 0.5) this.roof(st, w, d, y0 + h, 2.6, this.C.roof);
    else if (ruin < 0.8) {
      for (let i = 0; i < 3; i++) {
        if (this.rand() < 0.4) continue;
        const [bx, bz] = this.L(st, (i - 1) * w * 0.3, 0);
        this.sb.box(0.18, 0.2, d, bx, y0 + h * 0.85, bz, this.C.woodDark, st.yaw || 0, 0, this.rand.range(-0.2, 0.2));
      }
    }
    for (let i = 0; i < 3; i++) {
      const [rx, rz] = this.L(st, this.rand.range(-w / 2, w / 2), this.rand.range(-d / 2, d / 2));
      if (ruin > 0.3) this.rubble(rx, rz, y0, color);
    }
  }
  sandbags(x, z, yaw, len, rows = 3) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let y0 = Infinity;
    for (const k of [-0.5, 0, 0.5]) y0 = Math.min(y0, this.height(x + c * len * k, z - s * len * k));
    y0 -= 0.08;
    const n = Math.max(2, Math.round(len / 0.6));
    const bw = len / n;
    const col = this.def.theme === 'winter' ? 0xa79f8a : 0x9a8a62;
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < n - (row % 2); i++) {
        const lx = -len / 2 + bw * (i + 0.5 + (row % 2) * 0.5);
        this.sb.box(bw * 0.96, 0.26, 0.42, x + c * lx, y0 + 0.13 + row * 0.25, z - s * lx, col, yaw + (Math.random() - 0.5) * 0.12, 0, 0, 0.1);
      }
    }
    return this.addBox(x, z, y0, y0 + rows * 0.25 + 0.05, len / 2, 0.24, yaw, 'sand');
  }
  buildStructures() {
    const C = this.C, r = this.rand;
    for (const st of this.def.structures) {
      const y = this.height(st.x, st.z);
      const yaw = st.yaw || 0;
      switch (st.t) {
        case 'house': this.house(st, st.mat === 'brick' ? C.brick : C.stone); break;
        case 'cabin': this.house({ ...st, ruin: 0, roof: true }, C.wood, 'wood'); break;
        case 'barn': {
          const s2 = { ...st, ruin: 0.15, roof: true };
          this.house(s2, C.wood, 'wood');
          break;
        }
        case 'shed': {
          const { w, d, h } = st;
          this.wallLine(st, -w / 2, -d / 2, w / 2, -d / 2, y, h, 0.3, C.wood, { mat: 'wood', windows: false });
          this.wallLine(st, -w / 2, -d / 2, -w / 2, d / 2, y, h, 0.3, C.wood, { mat: 'wood', windows: false });
          this.wallLine(st, w / 2, -d / 2, w / 2, d / 2, y, h, 0.3, C.wood, { mat: 'wood', windows: false });
          for (const px of [-w / 2, w / 2]) {
            const [x, z] = this.L(st, px, d / 2 - 0.2);
            this.solid(0.3, h, 0.3, x, y, z, yaw, C.woodDark, 'wood');
          }
          this.roof(st, w, d, y + h, 1.6, C.roof);
          break;
        }
        case 'church': this.church(st, y); break;
        case 'chapel': this.chapel(st, y); break;
        case 'windmill': this.windmill(st, y); break;
        case 'bunker': this.bunker(st, y); break;
        case 'blockhouse': this.blockhouse(st, y); break;
        case 'fort': this.fort(st, y); break;
        case 'sandbags': this.sandbags(st.x, st.z, yaw, st.len); break;
        case 'ring': {
          const n = 7;
          for (let i = 0; i < n; i++) {
            if (i === 0) continue; // проход
            const a = (i / n) * TAU + Math.PI / 2;
            this.sandbags(st.x + Math.cos(a) * st.r, st.z + Math.sin(a) * st.r, -a + Math.PI / 2, 2.9, 3);
          }
          break;
        }
        case 'wall': {
          const n = Math.max(2, Math.round(st.len / 2.5));
          const seg = st.len / n;
          for (let i = 0; i < n; i++) {
            const lx = -st.len / 2 + seg * (i + 0.5);
            const [x, z] = this.L(st, lx, 0);
            const h = st.h * (r() < 0.25 ? r.range(0.5, 0.85) : 1);
            this.solid(seg, h, 0.55, x, this.height(x, z) - 0.1, z, yaw, C.stone, 'stone');
          }
          break;
        }
        case 'fence': {
          for (let s = 0; s + 1 < st.pts.length; s++) {
            const [ax, az] = st.pts[s], [bx, bz] = st.pts[s + 1];
            const len = Math.hypot(bx - ax, bz - az), n = Math.round(len / 2.2);
            const fy = Math.atan2(-(bz - az), bx - ax);
            for (let i = 0; i <= n; i++) {
              const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
              if (r() < 0.15) continue;
              this.sb.box(0.12, 1.1, 0.12, x, this.height(x, z) + 0.5, z, C.woodDark, fy, r.range(-0.15, 0.15), 0, 0.1);
              if (i < n && r() < 0.8) {
                const mx = x + (bx - ax) / n / 2, mz = z + (bz - az) / n / 2;
                const hy = this.height(mx, mz);
                this.sb.box(len / n, 0.08, 0.05, mx, hy + 0.85, mz, C.wood, fy, 0, r.range(-0.08, 0.08), 0.1);
                if (r() < 0.6) this.sb.box(len / n, 0.08, 0.05, mx, hy + 0.45, mz, C.wood, fy, 0, r.range(-0.08, 0.08), 0.1);
              }
            }
          }
          break;
        }
        case 'crates': {
          const n = r.int(3, 5);
          for (let i = 0; i < n; i++) {
            const s = r.range(0.85, 1.1);
            const x = st.x + r.range(-1.6, 1.6), z = st.z + r.range(-1.6, 1.6);
            const stack = i > 2 && r() < 0.6;
            const gy = stack ? this.groundAt(x, z, y + 2) : this.height(x, z) - 0.05;
            this.solid(s, s, s, x, gy, z, r() * 3, i % 2 ? C.wood : C.woodDark, 'wood', 0.12);
          }
          break;
        }
        case 'shells': {
          this.solid(1.6, 0.15, 1.2, st.x, y, st.z, yaw, C.woodDark, 'wood');
          for (let i = 0; i < 12; i++) {
            const x = st.x + ((i % 4) - 1.5) * 0.35, z = st.z + (Math.floor(i / 4) - 1) * 0.35;
            this.sb.cyl(0.11, 0.13, 0.7, 6, x, y + 0.5, z, 0x9a7b3f);
          }
          break;
        }
        case 'hay': {
          this.sb.cyl(1.05, 1.15, 1.3, 8, st.x, y + 0.6, st.z, 0xb3974f, 0, r() * 3);
          this.sb.dome(1.05, st.x, y + 1.25, st.z, 0xc0a45a, 1, 0.7, 1);
          this.addCyl(st.x, st.z, y, y + 1.9, 1.1, 'sand');
          break;
        }
        case 'well': {
          this.sb.cyl(0.85, 0.9, 0.9, 8, st.x, y + 0.45, st.z, C.stone);
          this.sb.box(0.1, 1.8, 0.1, st.x - 0.7, y + 0.9, st.z, C.woodDark);
          this.sb.box(0.1, 1.8, 0.1, st.x + 0.7, y + 0.9, st.z, C.woodDark);
          this.sb.box(1.8, 0.1, 1.2, st.x, y + 1.85, st.z, C.roof, 0, 0, 0);
          this.addCyl(st.x, st.z, y, y + 0.9, 0.9, 'stone');
          break;
        }
        case 'cart': {
          const [x, z] = [st.x, st.z];
          this.sb.box(1.4, 0.45, 2.6, x, y + 0.85, z, C.wood, yaw);
          for (const s of [-1, 1]) {
            const [wx, wz] = this.L(st, s * 0.8, 0.2);
            this.sb.cyl(0.6, 0.6, 0.12, 10, wx, y + 0.6, wz, C.woodDark, 0, yaw, Math.PI / 2);
          }
          const [sx, sz] = this.L(st, 0, -2.2);
          this.sb.box(0.9, 0.08, 1.8, sx, y + 0.55, sz, C.woodDark, yaw, -0.3);
          this.addBox(x, z, y, y + 1.1, 0.75, 1.3, yaw, 'wood');
          break;
        }
        case 'gun': this.fieldGun(st, y); break;
        case 'logs': {
          const rows = [4, 3, 2];
          let lvl = 0;
          for (const n of rows) {
            for (let i = 0; i < n; i++) {
              const [x, z] = this.L(st, 0, (i - (n - 1) / 2) * 0.72);
              this.sb.cyl(0.35, 0.36, 5, 7, x, y + 0.35 + lvl * 0.6, z, i % 2 ? C.wood : 0x7a5c3c, 0, yaw, Math.PI / 2, 0.1);
            }
            lvl++;
          }
          this.addBox(st.x, st.z, y, y + 1.6, 2.5, 1.4, yaw, 'wood');
          break;
        }
        case 'tankwreck': this.tankWreck(st, y); break;
      }
    }
  }
  church(st, y) {
    const C = this.C, w = 11, d = 20, h = 7.5;
    const s = { ...st, w, d };
    const o = { ruin: 0.45, mat: 'stone' };
    this.wallLine(s, -w / 2, d / 2, w / 2, d / 2, y, h, 0.7, C.stone, { ...o, door: 0.5 });
    this.wallLine(s, -w / 2, -d / 2, w / 2, -d / 2, y, h, 0.7, C.stone, { ...o, door: 0.5 });
    this.wallLine(s, -w / 2, -d / 2 + 0.35, -w / 2, d / 2 - 0.35, y, h, 0.7, C.stone, { ...o, door: 0.5 });
    this.wallLine(s, w / 2, -d / 2 + 0.35, w / 2, d / 2 - 0.35, y, h, 0.7, C.stone, { ...o, door: 0.4 });
    // Колокольня у задней стены
    const [tx, tz] = this.L(s, w / 2 - 0.5, -d / 2 - 2.3);
    this.solid(4.4, 14, 4.4, tx, y, tz, st.yaw, C.stone, 'stone', 0.04);
    for (const [px, pz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
      const [x, z] = this.L({ ...s, x: tx, z: tz }, px, pz);
      this.sb.box(0.7, 2.6, 0.7, x, y + 15.3, z, C.stone, st.yaw);
    }
    const m = GeoBuilder.mat(tx, y + 18.2, tz, 0, (st.yaw || 0) + Math.PI / 4, 0, 3.4, 3.2, 3.4);
    this.sb.add(this.pyramid(), m, C.roof, 0.05);
    this.sb.box(4.6, 0.4, 4.6, tx, y + 14.2, tz, C.stone, st.yaw);
    // Балки, скамьи и завалы внутри
    for (let i = 0; i < 4; i++) {
      const [bx, bz] = this.L(s, 0, -d / 2 + 3 + i * 4.5);
      if (this.rand() < 0.6) this.sb.box(w, 0.25, 0.25, bx, y + h - 0.3, bz, C.woodDark, st.yaw, 0, this.rand.range(-0.15, 0.15));
      const [px, pz] = this.L(s, this.rand.range(-3, 3), -d / 2 + 4 + i * 4);
      this.solid(2.4, 0.5, 0.5, px, y, pz, (st.yaw || 0) + this.rand.range(-0.4, 0.4), C.woodDark, 'wood');
      this.rubble(px + 1, pz - 1, y, C.stone);
    }
  }
  chapel(st, y) {
    const C = this.C, w = 7, d = 11, h = 5;
    this.house({ ...st, w, d, h, ruin: 0.15, roof: true }, C.stone, 'stone');
    const [tx, tz] = this.L(st, 0, -d / 2 - 1.6);
    this.solid(3, 9, 3, tx, y, tz, st.yaw, C.stone, 'stone', 0.04);
    const m = GeoBuilder.mat(tx, y + 10.6, tz, 0, (st.yaw || 0) + Math.PI / 4, 0, 2.3, 3.2, 2.3);
    this.sb.add(this.pyramid(), m, C.roof, 0.05);
  }
  pyramid() {
    if (!this._pyr) this._pyr = new THREE.ConeGeometry(1, 1, 4, 1).toNonIndexed();
    return this._pyr;
  }
  windmill(st, y) {
    const C = this.C;
    this.sb.cyl(2.4, 3.2, 9, 8, st.x, y + 4.5, st.z, C.stone, 0, 0.2);
    this.sb.cyl(0.3, 2.8, 2.8, 8, st.x, y + 10.4, st.z, C.roof, 0, 0.2);
    this.addCyl(st.x, st.z, y - 0.5, y + 11, 3.0, 'stone');
    const blades = new GeoBuilder();
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU;
      blades.box(0.25, 8.5, 0.12, Math.sin(a) * 4.3, Math.cos(a) * 4.3, 0, C.woodDark, 0, 0, -a, 0.05);
      blades.box(1.4, 6.5, 0.05, Math.sin(a) * 4.9 + Math.cos(a) * 0.7, Math.cos(a) * 4.9 - Math.sin(a) * 0.7, 0.05, 0xb8ae94, 0, 0, -a, 0.05);
    }
    blades.cyl(0.5, 0.5, 0.8, 8, 0, 0, 0, C.woodDark, Math.PI / 2);
    const mesh = new THREE.Mesh(blades.build(), this.mat());
    mesh.position.set(st.x + 0, y + 8.6, st.z + 3.3);
    mesh.castShadow = true;
    this.group.add(mesh);
    this.windmills.push(mesh);
  }
  bunker(st, y) {
    const C = this.C, w = st.w, d = st.d, h = 2.4, t = 0.55;
    const y0 = y - 0.35, conc = 0x8a8a82;
    // Передняя стена с амбразурой (локальная −Z смотрит на врага при yaw=0)
    const [fx, fz] = this.L(st, 0, -d / 2);
    this.solid(w, 1.2, t, fx, y0, fz, st.yaw, conc, 'stone');
    this.solid(w, h - 1.55, t, fx, y0 + 1.55, fz, st.yaw, conc, 'stone');
    for (const s of [-1, 1]) {
      const [sx, sz] = this.L(st, (s * w) / 2, 0);
      this.solid(t, h, d - t, sx, y0, sz, st.yaw, conc, 'stone');
    }
    for (const s of [-1, 1]) {
      const [bx, bz] = this.L(st, s * (w / 4 + 0.3), d / 2);
      this.solid(w / 2 - 0.6, h, t, bx, y0, bz, st.yaw, conc, 'stone');
    }
    this.solid(w + 0.6, 0.45, d + 0.6, st.x, y0 + h, st.z, st.yaw, 0x7d7d76, 'stone');
    this.sandbags(...this.L(st, 0, -d / 2 - 0.9), st.yaw, w * 0.9, 2);
  }
  blockhouse(st, y) {
    const C = this.C, w = 10, d = 10, h = 3.3;
    const s = { ...st, w, d };
    for (const [ax, az, bx, bz, door] of [
      [-w / 2, d / 2, w / 2, d / 2, 0.5], [-w / 2, -d / 2, w / 2, -d / 2, undefined],
      [-w / 2, -d / 2 + 0.2, -w / 2, d / 2 - 0.2, undefined], [w / 2, -d / 2 + 0.2, w / 2, d / 2 - 0.2, undefined],
    ]) this.wallLine(s, ax, az, bx, bz, y, h, 0.45, C.wood, { mat: 'wood', door, windows: true });
    this.roof(s, w, d, y + h, 2.4, C.roof);
  }
  fort(st, y) {
    const C = this.C, R = 15, h = 4.2, t = 1.6;
    const sides = [[-R, -R, R, -R], [R, -R, R, R], [R, R, -R, R], [-R, R, -R, -R]];
    for (const [ax, az, bx, bz] of sides) {
      const len = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / len, uz = (bz - az) / len;
      // Ворота посередине
      const g = 2.4;
      this.wallLine(st, ax + ux * 2.5, az + uz * 2.5, ax + ux * (len / 2 - g), az + uz * (len / 2 - g), y, h, t, C.stone, { ruin: 0.25, mat: 'stone', windows: false });
      this.wallLine(st, ax + ux * (len / 2 + g), az + uz * (len / 2 + g), bx - ux * 2.5, bz - uz * 2.5, y, h, t, C.stone, { ruin: 0.25, mat: 'stone', windows: false });
    }
    for (const [cx, cz] of [[-R, -R], [R, -R], [R, R], [-R, R]]) {
      const [x, z] = this.L(st, cx, cz);
      this.solid(5, 6.5, 5, x, y - 0.2, z, st.yaw, C.stone, 'stone', 0.05);
      this.sb.box(5.6, 0.5, 5.6, x, y + 6.4, z, 0x7d7a74, st.yaw);
    }
    this.house({ ...st, w: 8, d: 7, h: 4.5, ruin: 0.5, roof: false }, C.stone, 'stone');
    for (const [px, pz] of [[-8, 6], [7, -7], [8, 8], [-7, -8]]) {
      const [x, z] = this.L(st, px, pz);
      this.sandbags(x, z, (st.yaw || 0) + Math.atan2(pz, px), 4);
    }
  }
  fieldGun(st, y) {
    const metal = st.wreck ? 0x4a4640 : 0x5a5c4c;
    const tilt = st.wreck ? 0.25 : 0;
    const P = (lx, lz) => this.L(st, lx, lz);
    for (const s of [-1, 1]) {
      const [x, z] = P(s * 0.9, 0);
      this.sb.cyl(0.65, 0.65, 0.12, 12, x, y + 0.65 - (st.wreck && s > 0 ? 0.3 : 0), z, this.C.woodDark, 0, st.yaw, Math.PI / 2 + (st.wreck ? s * 0.3 : 0));
    }
    const [bx, bz] = P(0, -0.8);
    this.sb.cyl(0.09, 0.12, 2.8, 8, bx, y + 1.0, bz, metal, Math.PI / 2 - 0.12 - tilt, st.yaw);
    const [sx, sz] = P(0, -0.15);
    this.sb.box(1.9, 1.15, 0.06, sx, y + 1.0, sz, metal, st.yaw, tilt);
    const [tx, tz] = P(0, 1.3);
    this.sb.box(0.25, 0.2, 2.4, tx, y + 0.45, tz, metal, st.yaw, -0.2);
    this.addBox(st.x, st.z, y, y + 1.55, 1.0, 1.0, st.yaw || 0, 'metal');
  }
  tankWreck(st, y) {
    const rust = 0x4f4235, dark = 0x2e2924;
    const tilt = 0.12;
    this.sb.box(3.2, 1.9, 6.4, st.x, y + 0.9, st.z, rust, st.yaw, tilt, 0.08);
    for (const s of [-1, 1]) {
      const [x, z] = this.L(st, s * 1.75, 0);
      this.sb.box(0.5, 1.6, 6.8, x, y + 0.75, z, dark, st.yaw, tilt, 0);
    }
    const [tx, tz] = this.L(st, 0, 0.6);
    this.sb.box(1.6, 0.9, 1.8, tx, y + 2.2, tz, rust, (st.yaw || 0) + 0.4, 0, 0.3);
    this.addBox(st.x, st.z, y, y + 2.4, 2.0, 3.3, st.yaw || 0, 'metal');
    this.smokers.push({ x: st.x, y: y + 2.5, z: st.z, rate: 0.6 });
  }

  // Доски в окопах и мешки на брустверах
  buildTrenchProps() {
    const wood = this.C.wood, dark = this.C.woodDark;
    const bag = this.def.theme === 'winter' ? 0xa79f8a : 0x9a8a62;
    for (const sg of this.trenchSegs) {
      const len = Math.hypot(sg.bx - sg.ax, sg.bz - sg.az);
      const ux = (sg.bx - sg.ax) / len, uz = (sg.bz - sg.az) / len;
      const yaw = Math.atan2(-uz, ux);
      let nx = -uz, nz = ux;
      if (sg.side && Math.sign(nz) !== Math.sign(sg.side)) { nx = -nx; nz = -nz; }
      const n = Math.floor(len / 1.25);
      for (let i = 0; i <= n; i++) {
        const t = i / Math.max(1, n);
        const cx = sg.ax + (sg.bx - sg.ax) * t, cz = sg.az + (sg.bz - sg.az) * t;
        // настил
        if (i < n) {
          const mx = cx + ux * 0.62, mz = cz + uz * 0.62;
          this.sb.box(1.15, 0.06, 0.75, mx, this.height(mx, mz) + 0.04, mz, dark, yaw, 0, 0, 0.15);
        }
        // обшивка стенок
        for (const s of [-1, 1]) {
          if (this.rand() < 0.25) continue;
          const px = cx + -uz * s * 1.2, pz = cz + ux * s * 1.2;
          const top = this.height(cx + -uz * s * 2.0, cz + ux * s * 2.0);
          const bot = this.height(cx, cz);
          const hh = Math.max(0.6, top - bot);
          this.sb.box(1.15, hh, 0.08, px, bot + hh / 2, pz, i % 3 ? wood : dark, yaw, s * 0.12, 0, 0.12);
        }
        // мешки на бруствере со стороны врага
        if (sg.side && i % 1 === 0 && this.rand() < 0.85) {
          const bx = cx + nx * 2.3, bz = cz + nz * 2.3;
          const by = this.height(bx, bz);
          this.sb.box(1.0, 0.28, 0.45, bx, by + 0.1, bz, bag, yaw + this.rand.range(-0.1, 0.1), 0, 0, 0.1);
          if (this.rand() < 0.6) this.sb.box(0.9, 0.26, 0.42, bx + ux * 0.3, by + 0.36, bz + uz * 0.3, bag, yaw, 0, 0, 0.1);
        }
      }
    }
  }
  buildWires() {
    const posts = this.sb;
    const lines = [];
    const dark = 0x3b3128;
    for (const w of this.def.wires) {
      for (let s = 0; s + 1 < w.pts.length; s++) {
        const [ax, az] = w.pts[s], [bx, bz] = w.pts[s + 1];
        this.wireSegs.push({ ax, az, bx, bz, minx: Math.min(ax, bx) - 1.2, maxx: Math.max(ax, bx) + 1.2, minz: Math.min(az, bz) - 1.2, maxz: Math.max(az, bz) + 1.2 });
        const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / 3));
        const yaw = Math.atan2(-(bz - az), bx - ax);
        let prev = null;
        for (let i = 0; i <= n; i++) {
          const x = ax + ((bx - ax) * i) / n, z = az + ((bz - az) * i) / n;
          const y = this.height(x, z);
          // Х-образная рогатка
          posts.box(0.07, 1.5, 0.07, x, y + 0.6, z, dark, yaw, 0, 0.5, 0.1);
          posts.box(0.07, 1.5, 0.07, x, y + 0.6, z, dark, yaw, 0, -0.5, 0.1);
          if (prev) {
            for (const hgt of [0.35, 0.75, 1.05]) {
              const steps = 4;
              for (let k = 0; k < steps; k++) {
                const t0 = k / steps, t1 = (k + 1) / steps;
                const j0 = (k % 2 ? 0.12 : -0.12), j1 = -j0;
                lines.push(lerp(prev[0], x, t0), lerp(prev[1], y, t0) + hgt + j0 * 0.5, lerp(prev[2], z, t0) + j0,
                  lerp(prev[0], x, t1), lerp(prev[1], y, t1) + hgt + j1 * 0.5, lerp(prev[2], z, t1) + j1);
              }
            }
          }
          prev = [x, y, z];
        }
      }
    }
    if (lines.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
      const m = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x2d2924, transparent: true, opacity: 0.85 }));
      this.group.add(m);
    }
  }
  buildHQs() {
    const C = this.C;
    this.hqBanners = [];
    this.def.hq.forEach((hq, team) => {
      const y = this.height(hq.x, hq.z);
      const st = { x: hq.x, z: hq.z, yaw: hq.yaw };
      for (const [lx, lz] of [[-14, 6], [-8, 7], [9, 6], [15, 7]]) {
        const [x, z] = this.L(st, lx, lz);
        const m = GeoBuilder.mat(x, this.height(x, z) + 0.7, z, -Math.PI / 2, hq.yaw, 0, 1.9, 4.2, 1.5);
        this.sb.add(this.prism(), m, C.canvas, 0.06);
        this.addBox(x, z, y, y + 2.2, 1.6, 2.1, hq.yaw, 'sand');
      }
      for (const [lx, lz] of [[-18, -4], [18, -3], [4, 9]]) {
        const [x, z] = this.L(st, lx, lz);
        this.solid(1, 1, 1, x, this.height(x, z), z, hq.yaw + 0.3, C.wood, 'wood');
        this.solid(1, 1, 1, x + 1.1, this.height(x + 1.1, z), z + 0.2, hq.yaw, C.woodDark, 'wood');
      }
      for (const lx of [-10, 10]) {
        const [x, z] = this.L(st, lx, -10);
        this.sandbags(x, z, hq.yaw, 6);
      }
      // Высокий флагшток штаба
      const [px, pz] = this.L(st, 0, 2);
      this.sb.cyl(0.08, 0.1, 11, 6, px, y + 5.5, pz, 0x8a8172);
      this.hqBanners.push({ x: px, y: y + 9.6, z: pz, team });
    });
  }
  buildFlagPoles() {
    this.flagPoles = this.def.flags.map((f) => {
      const y = this.groundAt(f.x, f.z, this.height(f.x, f.z) + 3);
      this.sb.cyl(0.07, 0.09, 9, 6, f.x, y + 4.5, f.z, 0x8a8172);
      this.sb.cyl(0.55, 0.7, 0.4, 7, f.x, y + 0.15, f.z, this.C.stone);
      this.addCyl(f.x, f.z, y, y + 9, 0.12, 'metal');
      return { x: f.x, y, z: f.z };
    });
  }
  buildTrees() {
    const r = this.rand;
    const T = this.theme;
    const types = {};
    for (const spec of this.def.trees) {
      let placed = 0, tries = 0;
      while (placed < spec.count && tries++ < spec.count * 30) {
        const x = r.range(spec.xMin ?? -PLAY, spec.xMax ?? PLAY), z = r.range(spec.zMin ?? -PLAY, spec.zMax ?? PLAY);
        if (this.nearFootprint(x, z, 2.5)) continue;
        if (this.def.flags.some((f) => Math.hypot(x - f.x, z - f.z) < 7)) continue;
        if (this.trenchDist[clamp(Math.round(z + HALF), 0, N) * V + clamp(Math.round(x + HALF), 0, N)] < 3) continue;
        if (this.roadDist(x, z) < 3) continue;
        if (this.trees.some((t) => Math.abs(t.x - x) < 2.2 && Math.abs(t.z - z) < 2.2)) continue;
        const s = r.range(0.8, 1.3);
        const y = this.height(x, z) - 0.2;
        this.trees.push({ x, z, y, s, type: spec.type });
        (types[spec.type] ||= []).push(this.trees[this.trees.length - 1]);
        this.addCyl(x, z, y, y + 7 * s, 0.32 * s, 'wood');
        placed++;
      }
    }
    const trunkCol = this.def.theme === 'winter' ? 0x4d3d30 : 0x4b4036;
    const mat = this.mat();
    for (const [type, list] of Object.entries(types)) {
      const trunk = new GeoBuilder(), crown = new GeoBuilder();
      if (type === 'dead') {
        trunk.cyl(0.1, 0.32, 6, 6, 0, 3, 0, 0x3f3a33);
        trunk.cyl(0.04, 0.08, 1.8, 4, 0.5, 4, 0, 0x3f3a33, 0, 0, -0.9);
        trunk.cyl(0.03, 0.07, 1.4, 4, -0.4, 4.8, 0.2, 0x3f3a33, 0.3, 0, 0.8);
      } else if (type === 'poplar') {
        trunk.cyl(0.14, 0.26, 4, 6, 0, 2, 0, trunkCol);
        crown.sphere(1.5, 0, 6.6, 0, 0xffffff, 1, 3.0, 1, 1, 0.08);
      } else if (type === 'oak') {
        trunk.cyl(0.25, 0.38, 3.6, 6, 0, 1.8, 0, trunkCol);
        crown.sphere(2.4, 0, 5.4, 0, 0xffffff, 1, 0.8, 1, 1, 0.08);
        crown.sphere(1.8, 1.4, 4.8, 0.6, 0xf0f0f0, 1, 0.8, 1, 1, 0.08);
        crown.sphere(1.7, -1.2, 5.0, -0.8, 0xe8e8e8, 1, 0.8, 1, 1, 0.08);
      } else if (type === 'pine') {
        trunk.cyl(0.14, 0.28, 3, 6, 0, 1.5, 0, trunkCol);
        const snow = this.def.theme === 'winter';
        for (let i = 0; i < 4; i++) {
          const rr = 2.3 - i * 0.5, yy = 2.4 + i * 1.6;
          crown.cyl(0.05, rr, 2.4, 7, 0, yy + 1.2, 0, 0xffffff, 0, i * 0.7);
          if (snow) crown.cyl(0.05, rr * 0.55, 1.1, 7, 0, yy + 1.85, 0, 0xffffff, 0, i * 0.7 + 0.2);
        }
      } else if (type === 'deadpine') {
        trunk.cyl(0.08, 0.26, 7, 6, 0, 3.5, 0, 0x3d342c);
        for (let i = 0; i < 5; i++) trunk.cyl(0.02, 0.06, 1.3, 4, 0, 2.5 + i, 0, 0x3d342c, 0, i * 1.3, 1.2);
      }
      const leafCols = T.leaves.map((h) => new THREE.Color(h));
      const tm = new THREE.InstancedMesh(trunk.build(), mat, list.length);
      const cm = crown.vertexCount ? new THREE.InstancedMesh(crown.build(), mat, list.length) : null;
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
      list.forEach((t, i) => {
        e.set(r.range(-0.05, 0.05), r() * TAU, r.range(-0.05, 0.05));
        q.setFromEuler(e);
        m4.compose(p.set(t.x, t.y, t.z), q, sc.set(t.s, t.s * r.range(0.9, 1.15), t.s));
        tm.setMatrixAt(i, m4);
        if (cm) {
          cm.setMatrixAt(i, m4);
          const lc = leafCols[i % leafCols.length].clone();
          if (this.def.theme === 'winter') lc.lerp(new THREE.Color(0xffffff), 0.12);
          cm.setColorAt(i, lc);
        }
      });
      tm.castShadow = true;
      this.group.add(tm);
      if (cm) { cm.castShadow = true; this.group.add(cm); }
    }
  }
  buildRocks() {
    const n = this.def.rocks || 0;
    const r = this.rand;
    let placed = 0, tries = 0;
    while (placed < n && tries++ < n * 30) {
      const x = r.range(-PLAY + 5, PLAY - 5), z = r.range(-PLAY + 5, PLAY - 5);
      if (this.nearFootprint(x, z, 3) || this.roadDist(x, z) < 3) continue;
      if (this.def.flags.some((f) => Math.hypot(x - f.x, z - f.z) < 6)) continue;
      const s = r.range(0.8, 2.2), y = this.height(x, z);
      this.sb.rock(s, x, y + s * 0.3, z, 0x8c8a86, 1.2, 0.8, 1, r() * 3);
      if (this.def.theme === 'winter') this.sb.rock(s * 0.85, x, y + s * 0.62, z, 0xe8eef2, 1.1, 0.35, 0.95, r() * 3);
      this.addCyl(x, z, y - 1, y + s * 0.9, s * 0.95, 'stone');
      placed++;
    }
  }
  roadDist(x, z) {
    let best = 99;
    for (const road of this.def.roads) for (let i = 0; i + 1 < road.length; i++) {
      const d = segDist(x, z, road[i][0], road[i][1], road[i + 1][0], road[i + 1][1]);
      if (d < best) best = d;
    }
    return best;
  }
  mat() {
    if (!this._mat) this._mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    return this._mat;
  }

  // ---------- Меши ----------
  buildMeshes() {
    const T = this.theme, H = this.H, B = this.B;
    const pos = new Float32Array(V * V * 3), col = new Float32Array(V * V * 3);
    this.srgb = new Uint8ClampedArray(V * V * 3);
    const cG = new THREE.Color(T.grass), cG2 = new THREE.Color(T.grass2), cM = new THREE.Color(T.mud), cM2 = new THREE.Color(T.mud2);
    const cD = new THREE.Color(T.dark), cR = new THREE.Color(T.road), c = new THREE.Color(), c2 = new THREE.Color();
    const nz = this.noise;
    // Предрасчёт расстояния до дорог
    const RD = new Float32Array(V * V).fill(99);
    for (const road of this.def.roads) for (let s = 0; s + 1 < road.length; s++) {
      const [ax, az] = road[s], [bx, bz] = road[s + 1];
      this.forEachVertex(Math.min(ax, bx) - 4, Math.min(az, bz) - 4, Math.max(ax, bx) + 4, Math.max(az, bz) + 4, (k, x, z) => {
        const d = segDist(x, z, ax, az, bx, bz);
        if (d < RD[k]) RD[k] = d;
      });
    }
    const winter = this.def.theme === 'winter';
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i, x = i - HALF, z = j - HALF;
      pos[k * 3] = x; pos[k * 3 + 1] = H[k]; pos[k * 3 + 2] = z;
      const n1 = nz.get(x * 0.08, z * 0.08) * 0.5 + 0.5, n2 = nz.get(x * 0.03 + 50, z * 0.03) * 0.5 + 0.5;
      c.copy(cG).lerp(cG2, n1);
      let m = 1 - smoothstep(86, 112, Math.abs(z));
      m = clamp(m * (0.6 + 0.6 * n2) + (winter ? -0.25 : 0), 0, 1);
      c2.copy(cM).lerp(cM2, n1);
      c.lerp(c2, m * (winter ? 0.55 : 0.88));
      const dep = B[k] - H[k];
      if (dep > 0.25) c.lerp(winter ? cM2 : cD, clamp(dep / 2.4, 0, winter ? 0.7 : 0.85));
      const gx = (i < N ? H[k + 1] : H[k]) - (i > 0 ? H[k - 1] : H[k]);
      const gz = (j < N ? H[k + V] : H[k]) - (j > 0 ? H[k - V] : H[k]);
      const sl = Math.hypot(gx, gz) * 0.5;
      if (winter && sl > 0.5) c.lerp(cM2, clamp((sl - 0.5) * 0.8, 0, 0.6));
      const rd = RD[k];
      if (rd < 2.6) c.lerp(cR, 0.85 * (1 - smoothstep(1.3, 2.6, rd)));
      const jt = 0.93 + 0.14 * this.noise.hash(i, j + 7);
      c.multiplyScalar(jt * (1 - clamp(sl * 0.12, 0, 0.25)));
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      const shade = clamp(1 + (-gx + gz) * 0.25, 0.6, 1.3);
      this.srgb[k * 3] = lin2srgb(c.r) * 255 * shade;
      this.srgb[k * 3 + 1] = lin2srgb(c.g) * 255 * shade;
      this.srgb[k * 3 + 2] = lin2srgb(c.b) * 255 * shade;
    }
    const idx = new Uint32Array(N * N * 6);
    let p = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, cc = a + V, d = cc + 1;
      idx[p++] = a; idx[p++] = cc; idx[p++] = b;
      idx[p++] = b; idx[p++] = cc; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const terrain = new THREE.Mesh(g, this.mat());
    terrain.receiveShadow = true;
    this.group.add(terrain);
    this.terrainMesh = terrain;

    // Дальняя земля за краем карты
    const outer = new THREE.Shape([new THREE.Vector2(-700, -700), new THREE.Vector2(700, -700), new THREE.Vector2(700, 700), new THREE.Vector2(-700, 700)]);
    outer.holes.push(new THREE.Path([new THREE.Vector2(-HALF + 1, -HALF + 1), new THREE.Vector2(-HALF + 1, HALF - 1), new THREE.Vector2(HALF - 1, HALF - 1), new THREE.Vector2(HALF - 1, -HALF + 1)]));
    const far = new THREE.Mesh(new THREE.ShapeGeometry(outer).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: winter ? 0xd8dfe6 : 0x5d6340 }));
    far.position.y = 4;
    this.group.add(far);

    // Лужи в воронках
    if (this.def.puddles) {
      const pb = new GeoBuilder();
      const disc = new THREE.CircleGeometry(1, 10).rotateX(-Math.PI / 2);
      for (const cr of this.craters) {
        if (cr.d < 1.2 || this.rand() > this.def.puddles) continue;
        const hy = this.height(cr.x, cr.z);
        pb.add(disc, GeoBuilder.mat(cr.x, hy + Math.min(0.45, cr.d * 0.3), cr.z, 0, 0, 0, cr.r * 0.5, 1, cr.r * 0.5), T.water, 0.05);
      }
      if (pb.vertexCount) {
        const pm = new THREE.Mesh(pb.build(), new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 90, specular: 0x8a8a8a }));
        pm.receiveShadow = true;
        this.group.add(pm);
      }
    }

    const sm = new THREE.Mesh(this.sb.build(), this.mat());
    sm.castShadow = true;
    sm.receiveShadow = true;
    this.group.add(sm);
    this.sb = null;
  }

  // ---------- Навигация ----------
  buildNav() {
    const nav = (this.nav = new Uint8Array(NAVN * NAVN));
    const navT = (this.navTank = new Uint8Array(NAVN * NAVN));
    for (let j = 0; j < NAVN; j++) for (let i = 0; i < NAVN; i++) {
      const x = -HALF + (i + 0.5) * NAVC, z = -HALF + (j + 0.5) * NAVC;
      const k = j * NAVN + i;
      if (Math.abs(x) > PLAY - 1 || Math.abs(z) > PLAY - 1) { nav[k] = BLOCK; navT[k] = BLOCK; continue; }
      const gy = this.height(x, z);
      let cost = 0, tank = 0;
      this.forNear(x, z, 2.6, (c) => {
        const tall = c.top - gy;
        if (tall < 0.35 || c.y > gy + 1.9) return;
        const d = this.distToCollider(c, x, z);
        if (d < 0.45) cost = Math.max(cost, tall > 1.3 ? BLOCK : 6);
        if (d < 2.3 && tall > 1.3) tank = BLOCK;
      });
      if (cost < BLOCK && this.inWire(x, z)) cost = Math.max(cost, 8);
      nav[k] = cost;
      navT[k] = tank || (this.inWire(x, z) ? 2 : 0);
    }
  }
  distToCollider(c, x, z) {
    if (c.kind === 1) return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
    const dx = x - c.x, dz = z - c.z;
    const lx = dx * c.c - dz * c.s, lz = dx * c.s + dz * c.c;
    const ox = Math.max(Math.abs(lx) - c.hx, 0), oz = Math.max(Math.abs(lz) - c.hz, 0);
    return Math.hypot(ox, oz);
  }
  navCell(x, z) {
    return [clamp(Math.floor((x + HALF) / NAVC), 0, NAVN - 1), clamp(Math.floor((z + HALF) / NAVC), 0, NAVN - 1)];
  }
  navFree(x, z, tank = false) {
    const [i, j] = this.navCell(x, z);
    return (tank ? this.navTank : this.nav)[j * NAVN + i] < BLOCK;
  }
  nearestFree(i, j, grid) {
    if (grid[j * NAVN + i] < BLOCK) return [i, j];
    for (let r = 1; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.abs(di) !== r && Math.abs(dj) !== r) continue;
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= NAVN || b >= NAVN) continue;
        if (grid[b * NAVN + a] < BLOCK) return [a, b];
      }
    }
    return null;
  }
  // A* по сетке 2 м. Возвращает массив точек [x, z] (сглаженный) или null
  findPath(sx, sz, gx, gz, tank = false) {
    const grid = tank ? this.navTank : this.nav;
    let [si, sj] = this.navCell(sx, sz);
    let [gi, gj] = this.navCell(gx, gz);
    const s = this.nearestFree(si, sj, grid), g = this.nearestFree(gi, gj, grid);
    if (!s || !g) return null;
    [si, sj] = s; [gi, gj] = g;
    const NN = NAVN * NAVN;
    if (!this._g) {
      this._g = new Float32Array(NN); this._par = new Int32Array(NN); this._seen = new Uint32Array(NN); this._closed = new Uint32Array(NN);
      this._heap = new Int32Array(NN * 3); this._hf = new Float32Array(NN * 3); this._run = 0;
    }
    const gs = this._g, par = this._par, seen = this._seen, closed = this._closed, heap = this._heap, hf = this._hf;
    const run = ++this._run;
    let hn = 0;
    const push = (n, f) => {
      if (hn >= heap.length) return;
      let i = hn++;
      heap[i] = n; hf[i] = f;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hf[p] <= hf[i]) break;
        const tn = heap[p], tf = hf[p]; heap[p] = heap[i]; hf[p] = hf[i]; heap[i] = tn; hf[i] = tf; i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      hn--;
      if (hn > 0) {
        heap[0] = heap[hn]; hf[0] = hf[hn];
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let m = i;
          if (l < hn && hf[l] < hf[m]) m = l;
          if (r < hn && hf[r] < hf[m]) m = r;
          if (m === i) break;
          const tn = heap[m], tf = hf[m]; heap[m] = heap[i]; hf[m] = hf[i]; heap[i] = tn; hf[i] = tf; i = m;
        }
      }
      return top;
    };
    const hfun = (i, j) => {
      const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
      return dx + dz + (1.4142 - 2) * Math.min(dx, dz);
    };
    const start = sj * NAVN + si, goal = gj * NAVN + gi;
    gs[start] = 0; par[start] = -1; seen[start] = run;
    push(start, hfun(si, sj));
    let found = false, expanded = 0;
    while (hn > 0 && expanded < 30000) {
      const cur = pop();
      if (closed[cur] === run) continue;
      closed[cur] = run;
      expanded++;
      if (cur === goal) { found = true; break; }
      const ci = cur % NAVN, cj = (cur / NAVN) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= NAVN || nj >= NAVN) continue;
        const nk = nj * NAVN + ni;
        const cost = grid[nk];
        if (cost >= BLOCK || closed[nk] === run) continue;
        if (di && dj && (grid[cj * NAVN + ni] >= BLOCK || grid[nj * NAVN + ci] >= BLOCK)) continue;
        const ng = gs[cur] + (di && dj ? 1.4142 : 1) * (1 + cost * 0.5);
        if (seen[nk] !== run || ng < gs[nk]) {
          seen[nk] = run; gs[nk] = ng; par[nk] = cur;
          push(nk, ng + hfun(ni, nj));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let n = goal; n !== -1; n = par[n]) cells.push(n);
    cells.reverse();
    const pts = cells.map((n) => [-HALF + ((n % NAVN) + 0.5) * NAVC, -HALF + (((n / NAVN) | 0) + 0.5) * NAVC]);
    pts[pts.length - 1] = [gx, gz];
    // Сглаживание: пропускаем точки, если прямая проходима
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 24);
      while (j > i + 1 && !this.lineFree(pts[i][0], pts[i][1], pts[j][0], pts[j][1], grid)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }
  lineFree(ax, az, bx, bz, grid) {
    const d = Math.hypot(bx - ax, bz - az), n = Math.ceil(d / 0.45);
    for (let k = 1; k < n; k++) {
      const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
      const [i, j] = this.navCell(x, z);
      if (grid[j * NAVN + i] > 0) return false;
    }
    return true;
  }
  randomFreePoint(cx, cz, r, tank = false) {
    for (let t = 0; t < 25; t++) {
      const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r;
      const x = clamp(cx + Math.cos(a) * d, -PLAY + 2, PLAY - 2), z = clamp(cz + Math.sin(a) * d, -PLAY + 2, PLAY - 2);
      const [i, j] = this.navCell(x, z);
      if ((tank ? this.navTank : this.nav)[j * NAVN + i] === 0) {
        const y = this.height(x, z);
        if (!this.blockedAt(x, z, y, tank ? 2.2 : 0.5)) return [x, z];
      }
    }
    return [cx, cz];
  }

  // ---------- Миникарта ----------
  buildMinimap() {
    const S = 300;
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const k = y * V + x, o = (y * S + x) * 4;
      img.data[o] = this.srgb[k * 3]; img.data[o + 1] = this.srgb[k * 3 + 1]; img.data[o + 2] = this.srgb[k * 3 + 2]; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    // Окопы темнее
    ctx.strokeStyle = 'rgba(30,22,16,0.55)';
    ctx.lineWidth = 2;
    for (const sg of this.trenchSegs) {
      ctx.beginPath(); ctx.moveTo(sg.ax + HALF, sg.az + HALF); ctx.lineTo(sg.bx + HALF, sg.bz + HALF); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,36,32,0.78)';
    for (const c of this.colliders) {
      if (c.top - c.y < 0.9) continue;
      if (c.kind === 0) {
        ctx.save();
        ctx.translate(c.x + HALF, c.z + HALF);
        ctx.rotate(-Math.atan2(c.s, c.c));
        ctx.fillRect(-c.hx, -c.hz, c.hx * 2, c.hz * 2);
        ctx.restore();
      } else if (c.r > 0.5) {
        ctx.beginPath(); ctx.arc(c.x + HALF, c.z + HALF, c.r, 0, TAU); ctx.fill();
      }
    }
    ctx.fillStyle = this.def.theme === 'winter' ? 'rgba(30,60,40,0.75)' : 'rgba(40,52,28,0.7)';
    for (const t of this.trees) { ctx.beginPath(); ctx.arc(t.x + HALF, t.z + HALF, 1.6 * t.s, 0, TAU); ctx.fill(); }
    ctx.strokeStyle = 'rgba(20,16,12,0.6)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    for (const w of this.wireSegs) { ctx.beginPath(); ctx.moveTo(w.ax + HALF, w.az + HALF); ctx.lineTo(w.bx + HALF, w.bz + HALF); ctx.stroke(); }
    ctx.setLineDash([]);
    this.minimap = cv;
  }

  update(dt) {
    for (const m of this.windmills) m.rotation.z += dt * 0.35;
  }
}
