// Графика: процедурные текстуры, материалы (рельеф со смешиванием слоёв, трипланарные детали), небо с облаками,
// трава вокруг камеры и пост-обработка (свечение, цветокоррекция, сглаживание)
import * as THREE from './three.module.min.js';
import { EffectComposer } from './addons/postprocessing/EffectComposer.js';
import { RenderPass } from './addons/postprocessing/RenderPass.js';
import { ShaderPass } from './addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './addons/postprocessing/OutputPass.js';
import { FXAAShader } from './addons/shaders/FXAAShader.js';
import { rng, clamp, smoothstep, lerp } from './util.js';

// ---------- Бесшовный шум ----------
function noiseLayer(size, cells, seed) {
  const r = rng(seed);
  const L = new Float32Array(cells * cells);
  for (let i = 0; i < L.length; i++) L[i] = r();
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const fy = (y / size) * cells, j = Math.floor(fy), v = fy - j, sv = v * v * (3 - 2 * v);
    const j0 = j % cells, j1 = (j + 1) % cells;
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells, i = Math.floor(fx), u = fx - i, su = u * u * (3 - 2 * u);
      const i0 = i % cells, i1 = (i + 1) % cells;
      const a = L[j0 * cells + i0], b = L[j0 * cells + i1], c = L[j1 * cells + i0], d = L[j1 * cells + i1];
      out[y * size + x] = a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
    }
  }
  return out;
}
function fbm(size, cells, oct, seed, gain = 0.5) {
  const out = new Float32Array(size * size);
  let amp = 1, norm = 0;
  for (let o = 0; o < oct; o++) {
    const n = noiseLayer(size, cells << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    norm += amp; amp *= gain;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
function canvasOf(size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  return [cv, cv.getContext('2d')];
}
// Рисует фигуру с переносом через край, чтобы текстура оставалась бесшовной
function wrapDraw(size, x, y, pad, fn) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
    if (x + ox < -pad || x + ox > size + pad || y + oy < -pad || y + oy > size + pad) continue;
    fn(x + ox, y + oy);
  }
}
function finishTex(src, srgb, aniso) {
  const t = src instanceof HTMLCanvasElement ? new THREE.CanvasTexture(src) : src;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

// ---------- Цветные слои рельефа ----------
function colorField(size, seed, pal, opts = {}) {
  const [cv, c] = canvasOf(size);
  const img = c.createImageData(size, size);
  const n1 = fbm(size, 4, 6, seed), n2 = fbm(size, 3, 4, seed + 7), n3 = fbm(size, 16, 3, seed + 13);
  for (let i = 0; i < size * size; i++) {
    let col = mixc(pal[0], pal[1], clamp((n1[i] - 0.25) * 2, 0, 1));
    if (pal[2]) col = mixc(col, pal[2], clamp((n2[i] - 0.55) * 3, 0, 1) * (opts.patch ?? 0.7));
    const k = 0.88 + n3[i] * 0.24;
    img.data[i * 4] = col[0] * k; img.data[i * 4 + 1] = col[1] * k; img.data[i * 4 + 2] = col[2] * k; img.data[i * 4 + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return [cv, c, n1];
}
function speckle(c, size, r, n, colors, rmin, rmax, alpha = 1) {
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size, rad = rmin + r() * (rmax - rmin);
    c.globalAlpha = alpha * (0.5 + r() * 0.5);
    c.fillStyle = colors[Math.floor(r() * colors.length)];
    wrapDraw(size, x, y, rad + 2, (px, py) => { c.beginPath(); c.arc(px, py, rad, 0, Math.PI * 2); c.fill(); });
  }
  c.globalAlpha = 1;
}
function strokes(c, size, r, n, colors, lmin, lmax, wid, angSpread, alpha = 0.7) {
  c.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * size, y = r() * size, len = lmin + r() * (lmax - lmin);
    const a = -Math.PI / 2 + (r() - 0.5) * angSpread * 2;
    c.strokeStyle = colors[Math.floor(r() * colors.length)];
    c.globalAlpha = alpha * (0.5 + r() * 0.5);
    c.lineWidth = wid * (0.6 + r() * 0.8);
    wrapDraw(size, x, y, len + 2, (px, py) => { c.beginPath(); c.moveTo(px, py); c.lineTo(px + Math.cos(a) * len, py + Math.sin(a) * len); c.stroke(); });
  }
  c.globalAlpha = 1;
}
const TERRAIN_RECIPES = {
  grass(size, seed) {
    const [cv, c] = colorField(size, seed, [hex(0x39441f), hex(0x6a7234), hex(0x8a7d3c)]);
    const r = rng(seed + 3);
    strokes(c, size, r, size * size / 22, ['#4e5a26', '#5f6a2c', '#7a7d38', '#3a4420', '#8f8746', '#6b7a32'], 3, 9, 1.4, 0.9, 0.75);
    speckle(c, size, r, size * 2, ['#4a3a28', '#5d4a34'], 0.6, 1.8, 0.6);
    return cv;
  },
  mud(size, seed) {
    const [cv, c, n] = colorField(size, seed, [hex(0x2f241a), hex(0x6b5640), hex(0x40352c)], { patch: 0.9 });
    const r = rng(seed + 5);
    strokes(c, size, r, size / 2, ['rgba(25,18,12,0.9)', 'rgba(60,46,32,0.9)'], 20, 70, 3, 3.2, 0.35);
    speckle(c, size, r, size * 3, ['#7d6a55', '#8a7a68', '#5a4a3a', '#3b3026'], 0.8, 2.6, 0.8);
    speckle(c, size, r, size / 3, ['rgba(20,24,26,0.5)'], 6, 18, 0.35);
    return cv;
  },
  dirt(size, seed) {
    const [cv, c] = colorField(size, seed, [hex(0x5a4a38), hex(0x8b7a60), hex(0x6f6a5a)]);
    const r = rng(seed + 9);
    speckle(c, size, r, size * 8, ['#9a8a72', '#4a3d30', '#b0a088', '#6a6258'], 0.6, 2.2, 0.85);
    return cv;
  },
  rock(size, seed) {
    const [cv, c] = colorField(size, seed, [hex(0x4c4844), hex(0x8a857c), hex(0x66694a)], { patch: 0.4 });
    const r = rng(seed + 11);
    strokes(c, size, r, size / 3, ['rgba(30,28,26,0.9)'], 15, 60, 1.6, 3.2, 0.6);
    speckle(c, size, r, size * 3, ['#9d978d', '#3c3936'], 0.6, 2, 0.7);
    return cv;
  },
  snow(size, seed) {
    const [cv, c] = colorField(size, seed, [hex(0xbfcad6), hex(0xf2f6fa), hex(0xdde6ee)], { patch: 0.5 });
    const r = rng(seed + 13);
    speckle(c, size, r, size * 4, ['#ffffff', '#e3ebf2'], 0.5, 1.4, 0.8);
    return cv;
  },
  slush(size, seed) {
    const [cv, c] = colorField(size, seed, [hex(0x8d8984), hex(0xd6dce1), hex(0x6f6256)], { patch: 0.8 });
    const r = rng(seed + 17);
    speckle(c, size, r, size, ['#5a4e42', '#7a6e62', '#e8edf2'], 2, 7, 0.5);
    return cv;
  },
};

// Нормали из «высоты» — общие неровности земли
function normalTexture(size, seed, strength = 2.5) {
  const h = fbm(size, 8, 5, seed, 0.55);
  const r = rng(seed + 1);
  for (let k = 0; k < size * 3; k++) {
    const cx = Math.floor(r() * size), cy = Math.floor(r() * size), rad = 1 + r() * 2.5;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const d = Math.hypot(dx, dy);
      if (d > rad) continue;
      const i = ((cy + dy + size) % size) * size + ((cx + dx + size) % size);
      h[i] += (1 - d / rad) * 0.08;
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const hx = h[y * size + ((x + 1) % size)] - h[y * size + ((x - 1 + size) % size)];
    const hy = h[((y + 1) % size) * size + x] - h[((y - 1 + size) % size) * size + x];
    let nx = -hx * strength * size / 64, ny = -hy * strength * size / 64, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    data[i * 4] = (nx * 0.5 + 0.5) * 255; data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255; data[i * 4 + 3] = 255;
  }
  return new THREE.DataTexture(data, size, size);
}

// ---------- Серые детали для построек (среднее ≈ 0.5, умножаются на цвет вершин) ----------
function grayTex(size, fill) {
  const data = new Uint8Array(size * size * 4);
  fill((x, y, v) => {
    const i = (y * size + x) * 4, b = clamp(v, 0, 1) * 255;
    data[i] = b; data[i + 1] = b; data[i + 2] = b; data[i + 3] = 255;
  });
  return new THREE.DataTexture(data, size, size);
}
const DETAIL_RECIPES = {
  stone(size, seed) {
    const n = fbm(size, 8, 4, seed), r = rng(seed);
    const rows = 8, rh = size / rows;
    const blocks = [];
    for (let j = 0; j < rows; j++) {
      let x = r() * 30;
      const off = x;
      while (x < size + off) { const w = 40 + r() * 60; blocks.push([j, x, Math.min(w, size + off - x), 0.42 + r() * 0.2]); x += w; }
    }
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, 0.5);
      for (const [j, bx, bw, br] of blocks) {
        for (let y = Math.floor(j * rh); y < Math.floor((j + 1) * rh); y++) for (let k = 0; k < bw; k++) {
          const x = Math.floor(bx + k) % size;
          const ey = Math.min(y - j * rh, (j + 1) * rh - y), ex = Math.min(k, bw - k);
          const edge = Math.min(ey, ex);
          let v = br + (n[y * size + x] - 0.5) * 0.35;
          if (edge < 2.5) v = 0.22 + edge * 0.04;
          else if (edge < 5) v *= 0.92;
          set(x, y, v);
        }
      }
    });
  },
  brick(size, seed) {
    const n = fbm(size, 16, 3, seed), r = rng(seed);
    const rh = size / 16, bw = size / 4;
    const tint = [];
    for (let i = 0; i < 64; i++) tint.push(0.42 + r() * 0.16);
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) {
        const row = Math.floor(y / rh), off = row % 2 ? bw / 2 : 0, ly = y - row * rh;
        for (let x = 0; x < size; x++) {
          const xx = (x + off) % size, col = Math.floor(xx / bw), lx = xx - col * bw;
          let v = tint[(row * 4 + col) % 64] + (n[y * size + x] - 0.5) * 0.25;
          if (ly < 2 || lx < 2) v = 0.66 + (n[y * size + x] - 0.5) * 0.1;
          set(x, y, v);
        }
      }
    });
  },
  wood(size, seed) {
    const r = rng(seed);
    const g = noiseLayer(size, 64, seed);
    const n = fbm(size, 4, 4, seed + 3);
    const planks = [];
    let x = 0;
    while (x < size) { const w = 36 + r() * 30; planks.push([x, Math.min(w, size - x), 0.42 + r() * 0.16]); x += w; }
    return grayTex(size, (set) => {
      for (const [px, pw, pb] of planks) for (let k = 0; k < pw; k++) {
        const xx = Math.floor(px + k);
        for (let y = 0; y < size; y++) {
          let v = pb + (g[((y * 7) % size) * size + xx] - 0.5) * 0.12 + Math.sin((xx + n[y * size + xx] * 30) * 0.9) * 0.05;
          v += (n[y * size + xx] - 0.5) * 0.15;
          if (k < 2 || k > pw - 2) v = 0.18;
          set(xx, y, v);
        }
      }
    });
  },
  roof(size, seed) {
    const n = fbm(size, 8, 3, seed), r = rng(seed);
    const rh = size / 12, tw = size / 8;
    const t = [];
    for (let i = 0; i < 96; i++) t.push(0.42 + r() * 0.18);
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) {
        const row = Math.floor(y / rh), ly = (y - row * rh) / rh, off = row % 2 ? tw / 2 : 0;
        for (let x = 0; x < size; x++) {
          const xx = (x + off) % size, col = Math.floor(xx / tw), lx = (xx - col * tw) / tw;
          const curve = Math.abs(lx - 0.5) * 2;
          let v = t[(row * 8 + col) % 96] * (0.75 + 0.35 * ly) + (n[y * size + x] - 0.5) * 0.2;
          if (ly > 1 - 0.12 * (1 - curve * curve)) v *= 0.55;
          if (lx < 0.03) v *= 0.7;
          set(x, y, v);
        }
      }
    });
  },
  cloth(size, seed) {
    const n = fbm(size, 8, 4, seed);
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const weave = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.05;
        let v = 0.5 + weave + (n[y * size + x] - 0.5) * 0.3;
        if (y % 64 < 2) v *= 0.75;
        set(x, y, v);
      }
    });
  },
  metal(size, seed) {
    const n = fbm(size, 6, 5, seed), m = fbm(size, 24, 2, seed + 5);
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let v = 0.5 + (n[y * size + x] - 0.5) * 0.45 + (m[y * size + x] - 0.5) * 0.12;
        const rx = x % 64, ry = y % 64;
        const d = Math.hypot(rx - 8, ry - 8);
        if (d < 3) v = 0.7 - d * 0.08;
        if (rx < 1 || ry < 1) v *= 0.7;
        set(x, y, v);
      }
    });
  },
  concrete(size, seed) {
    const n = fbm(size, 6, 5, seed), r = rng(seed);
    const holes = [];
    for (let i = 0; i < 160; i++) holes.push([r() * size, r() * size, 0.8 + r() * 2]);
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let v = 0.5 + (n[y * size + x] - 0.5) * 0.35;
        if (y % 96 < 2) v *= 0.8;
        set(x, y, v);
      }
      for (const [hx, hy, hr] of holes) for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        if (Math.hypot(dx, dy) < hr) set(Math.floor(hx + dx + size) % size, Math.floor(hy + dy + size) % size, 0.25);
      }
    });
  },
  bark(size, seed) {
    const n = noiseLayer(size, 32, seed), m = fbm(size, 4, 4, seed + 2);
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const a = n[Math.floor(y / 8) % size * size + x];
        set(x, y, 0.5 + (a - 0.5) * 0.7 + (m[y * size + x] - 0.5) * 0.3);
      }
    });
  },
  leaves(size, seed) {
    const n = fbm(size, 16, 4, seed), m = fbm(size, 4, 3, seed + 9);
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const v = n[y * size + x];
        set(x, y, 0.32 + smoothstep(0.35, 0.65, v) * 0.42 + (m[y * size + x] - 0.5) * 0.25);
      }
    });
  },
  fabric(size, seed) {
    const n = fbm(size, 8, 4, seed);
    return grayTex(size, (set) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const tw = ((x + y) % 4 < 2 ? 0.03 : -0.03);
        set(x, y, 0.5 + tw + (n[y * size + x] - 0.5) * 0.22);
      }
    });
  },
};

// ---------- Менеджер ----------
export class Gfx {
  constructor(renderer, quality) {
    this.renderer = renderer;
    this.q = quality;
    this.aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    this.cache = {};
    this.time = { value: 0 };
    this.mats = {};
  }
  terrainTex(kind) {
    const key = 't_' + kind;
    if (!this.cache[key]) this.cache[key] = finishTex(TERRAIN_RECIPES[kind](512, 1000 + kind.length * 37), true, this.aniso);
    return this.cache[key];
  }
  detail(kind) {
    const key = 'd_' + kind;
    if (!this.cache[key]) this.cache[key] = finishTex(DETAIL_RECIPES[kind](kind === 'fabric' ? 128 : 256, 500 + kind.charCodeAt(0) * 7), false, this.aniso);
    return this.cache[key];
  }
  groundNormal() {
    if (!this.cache.gn) this.cache.gn = finishTex(normalTexture(256, 77), false, this.aniso);
    return this.cache.gn;
  }

  // Трипланарный материал: вершинный цвет × серая деталь (в мировых или локальных координатах)
  triplanar(kind, opts = {}) {
    const key = kind + (opts.local ? '_L' : '_W') + (opts.instColor ? '_i' : '') + (opts.key || '');
    if (this.mats[key] && !opts.unique) return this.mats[key];
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: opts.roughness ?? 0.9, metalness: opts.metalness ?? 0,
      flatShading: !!opts.flat, side: opts.side ?? THREE.FrontSide,
    });
    m.envMapIntensity = opts.env ?? 0.6;
    const tex = this.detail(kind);
    const scale = opts.scale ?? 0.5, strength = opts.strength ?? 1;
    m.defines = { TP_LOCAL: opts.local ? 1 : 0 };
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tpMap = { value: tex };
      sh.uniforms.tpScale = { value: scale };
      sh.uniforms.tpStrength = { value: strength };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTpPos;\nvarying vec3 vTpN;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #if TP_LOCAL == 1
            vTpPos = transformed; vTpN = objectNormal;
          #else
            vec4 tpW = vec4(transformed, 1.0);
            vec3 tpN = objectNormal;
            #ifdef USE_INSTANCING
              tpW = instanceMatrix * tpW; tpN = mat3(instanceMatrix) * tpN;
            #endif
            vTpPos = (modelMatrix * tpW).xyz; vTpN = normalize(mat3(modelMatrix) * tpN);
          #endif`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tpMap; uniform float tpScale; uniform float tpStrength;\nvarying vec3 vTpPos;\nvarying vec3 vTpN;')
        .replace('#include <map_fragment>', `
          vec3 tpw = pow(abs(normalize(vTpN)), vec3(4.0)); tpw /= (tpw.x + tpw.y + tpw.z + 1e-4);
          vec3 tpP = vTpPos * tpScale;
          float tpv = texture2D(tpMap, tpP.zy).r * tpw.x + texture2D(tpMap, tpP.xz).r * tpw.y + texture2D(tpMap, tpP.xy).r * tpw.z;
          diffuseColor.rgb *= mix(1.0, tpv * 2.0, tpStrength);`);
    };
    if (!opts.unique) this.mats[key] = m;
    return m;
  }

  // Рельеф: четыре слоя по весам вершин + цвет вершин как общий оттенок и затенение
  terrain(layers, opts = {}) {
    const texs = layers.map((k) => this.terrainTex(k));
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, normalMap: this.groundNormal() });
    m.normalScale.set(0.9, 0.9);
    m.envMapIntensity = 0.45;
    const rough = opts.rough || [0.95, 0.7, 0.9, 0.85];
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tL0 = { value: texs[0] }; sh.uniforms.tL1 = { value: texs[1] };
      sh.uniforms.tL2 = { value: texs[2] }; sh.uniforms.tL3 = { value: texs[3] };
      sh.uniforms.uRough = { value: new THREE.Vector4(...rough) };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splat;\nvarying vec4 vSplat;\nvarying vec2 vGround;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplat = splat;\nvGround = position.xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tL0; uniform sampler2D tL1; uniform sampler2D tL2; uniform sampler2D tL3; uniform vec4 uRough;\nvarying vec4 vSplat;\nvarying vec2 vGround;')
        .replace('#include <map_fragment>', `
          vec2 uvA = vGround * 0.21;
          vec2 uvB = vGround * 0.043 + vec2(0.37, 0.11);
          vec4 sw = vSplat / max(1e-3, dot(vSplat, vec4(1.0)));
          vec3 c0 = mix(texture2D(tL0, uvA).rgb, texture2D(tL0, uvB).rgb, 0.4);
          vec3 c1 = mix(texture2D(tL1, uvA).rgb, texture2D(tL1, uvB).rgb, 0.4);
          vec3 c2 = texture2D(tL2, uvA).rgb;
          vec3 c3 = texture2D(tL3, uvA * 0.7).rgb;
          diffuseColor.rgb *= c0 * sw.x + c1 * sw.y + c2 * sw.z + c3 * sw.w;`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = dot(sw, uRough);');
    };
    return m;
  }
}

// ---------- Небо ----------
const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999;
}`;
const SKY_FS = `
uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uGround; uniform vec3 uSunDir; uniform vec3 uSun;
uniform vec3 uCloudLight; uniform vec3 uCloudDark; uniform float uTime; uniform float uCover;
varying vec3 vDir;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < CLOUD_OCT; i++) { s += vnoise(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(-0.02, 0.65, h), 0.75));
  col = mix(col, uGround, smoothstep(0.0, -0.2, h));
  float s = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSun * (pow(s, 900.0) * 6.0 + pow(s, 40.0) * 0.18 + pow(s, 6.0) * 0.08);
  if (h > -0.01) {
    vec2 p = d.xz / (h + 0.18) * 0.9 + vec2(uTime * 0.006, uTime * 0.0025);
    float n = fbm(p * 1.4);
    float c = smoothstep(uCover, uCover + 0.32, n) * smoothstep(-0.01, 0.12, h);
    float lit = smoothstep(0.25, 0.9, fbm(p * 2.2 + 3.1)) * 0.6 + pow(s, 3.0) * 0.5;
    vec3 cc = mix(uCloudDark, uCloudLight, clamp(lit, 0.0, 1.0));
    col = mix(col, cc, c * 0.92);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
export function makeSky(T, quality) {
  const c = (h) => new THREE.Color(h);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: c(T.skyTop) }, uHorizon: { value: c(T.skyHorizon) }, uGround: { value: c(T.fog).multiplyScalar(0.8) },
      uSunDir: { value: new THREE.Vector3(...T.sunDir).normalize() }, uSun: { value: c(T.sun) },
      uCloudLight: { value: c(T.cloudLight || 0xe8e4dc) }, uCloudDark: { value: c(T.cloudDark || 0x8a8a88) },
      uTime: { value: 0 }, uCover: { value: T.cloudCover ?? 0.45 },
    },
    defines: { CLOUD_OCT: quality >= 2 ? 6 : 4 },
    vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), mat);
  m.renderOrder = -1;
  m.frustumCulled = false;
  return m;
}

// ---------- Трава ----------
function grassTuftTexture(dry) {
  const S = 256;
  const [cv, c] = canvasOf(S);
  const r = rng(dry ? 91 : 19);
  c.clearRect(0, 0, S, S);
  const cols = dry ? ['#b9a578', '#a38f62', '#cdbb8e', '#8f7d55'] : ['#d8e0a8', '#c2cc8a', '#e4e6b4', '#aab877', '#cfd59a'];
  for (let i = 0; i < (dry ? 26 : 70); i++) {
    const x0 = S * 0.1 + r() * S * 0.8, h = S * (0.45 + r() * 0.5), lean = (r() - 0.5) * S * 0.35, w = 2 + r() * 4;
    c.fillStyle = cols[Math.floor(r() * cols.length)];
    c.beginPath();
    c.moveTo(x0 - w, S);
    c.quadraticCurveTo(x0 + lean * 0.3, S - h * 0.6, x0 + lean, S - h);
    c.quadraticCurveTo(x0 + lean * 0.3 + w * 0.5, S - h * 0.6, x0 + w, S);
    c.closePath();
    c.fill();
  }
  const g = c.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
  c.globalCompositeOperation = 'source-atop';
  c.fillStyle = g; c.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export class Grass {
  constructor(scene, world, quality, gfx) {
    this.world = world;
    this.dry = world.def.theme === 'winter';
    const cfg = [null, { r: 22, d: 0.55, cap: 6000 }, { r: 36, d: 1.0, cap: 22000 }, { r: 52, d: 1.35, cap: 50000 }][quality];
    this.enabled = !!cfg;
    if (!cfg) return;
    this.R = cfg.r; this.density = cfg.d * (this.dry ? 0.35 : 1); this.cap = cfg.cap;
    const g = new THREE.BufferGeometry();
    const pos = [], uv = [], nor = [], idx = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI, cx = Math.cos(a) * 0.32, cz = Math.sin(a) * 0.32;
      const b = pos.length / 3;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx, 0.55, cz, -cx, 0.55, -cz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ map: grassTuftTexture(this.dry), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, metalness: 0 });
    mat.envMapIntensity = 0.3;
    this.uCam = { value: new THREE.Vector3() };
    this.uR = { value: this.R };
    const time = gfx.time;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = time; sh.uniforms.uCam = this.uCam; sh.uniforms.uR = this.uR;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uCam; uniform float uR;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          float gd = distance(ip.xz, uCam.xz);
          float fade = 1.0 - smoothstep(uR * 0.65, uR, gd);
          transformed.y *= fade;
          float hh = max(transformed.y, 0.0);
          float wv = sin(uTime * 1.7 + ip.x * 0.31 + ip.z * 0.23) + 0.5 * sin(uTime * 3.3 + ip.x * 0.9);
          transformed.x += wv * 0.09 * hh; transformed.z += wv * 0.05 * hh;`);
    };
    mat.customProgramCacheKey = () => 'grass';
    this.mesh = new THREE.InstancedMesh(g, mat, this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    scene.add(this.mesh);
    this.chunks = new Map();
    this.cx = 1e9; this.cz = 1e9;
    this.CS = 10;
  }
  chunk(i, j) {
    const key = i * 1000 + j;
    let ch = this.chunks.get(key);
    if (ch) return ch;
    const w = this.world, CS = this.CS, r = rng((i * 73856093) ^ (j * 19349663));
    const n = Math.round(CS * CS * this.density);
    const mats = [], cols = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let k = 0; k < n; k++) {
      const x = i * CS + r() * CS, z = j * CS + r() * CS;
      const gw = w.grassAt(x, z);
      if (gw < 0.35 || r() > gw) continue;
      const y = w.height(x, z);
      if (w.groundAt(x, z, y + 0.3) > y + 0.1) continue;
      const sc = 0.7 + r() * 0.75;
      e.set((r() - 0.5) * 0.2, r() * Math.PI * 2, (r() - 0.5) * 0.2);
      q.setFromEuler(e);
      m4.compose(p.set(x, y - 0.03, z), q, s.set(sc, sc * (0.8 + r() * 0.6), sc));
      mats.push(...m4.elements);
      const t = w.tintAt(x, z);
      const v = 0.75 + r() * 0.35;
      cols.push(t[0] * v, t[1] * v, t[2] * v);
    }
    ch = { mats: new Float32Array(mats), cols: new Float32Array(cols) };
    this.chunks.set(key, ch);
    return ch;
  }
  update(cam) {
    if (!this.enabled) return;
    this.uCam.value.copy(cam);
    const cx = Math.floor(cam.x / this.CS), cz = Math.floor(cam.z / this.CS);
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx; this.cz = cz;
    const rr = Math.ceil(this.R / this.CS);
    const M = this.mesh.instanceMatrix.array, C = this.mesh.instanceColor.array;
    let n = 0;
    for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) {
      if (Math.hypot(di, dj) > rr + 0.8) continue;
      const ch = this.chunk(cx + di, cz + dj);
      const cnt = ch.cols.length / 3;
      const take = Math.min(cnt, this.cap - n);
      if (take <= 0) continue;
      M.set(ch.mats.subarray(0, take * 16), n * 16);
      C.set(ch.cols.subarray(0, take * 3), n * 3);
      n += take;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---------- Пост-обработка ----------
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.9 }, uGrain: { value: 0.035 }, uSepia: { value: 0.12 }, uDamage: { value: 0 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uSepia, uDamage;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(c.rgb, vec3(l * 1.08, l * 0.99, l * 0.86), uSepia);
      c.rgb = (c.rgb - 0.5) * 1.05 + 0.5;
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * uVignette;
      c.rgb = mix(c.rgb, vec3(l * 0.9, l * 0.15, l * 0.1), uDamage * smoothstep(0.1, 0.7, length(d)));
      float n = fract(sin(dot(vUv * vec2(12.9898, 78.233) + fract(uTime) * 17.0, vec2(1.0, 1.7))) * 43758.5453);
      c.rgb += (n - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};
export class Post {
  constructor(renderer, scene, camera, vmScene, vmCam, quality) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: quality >= 3 ? 4 : 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.main = new RenderPass(scene, camera);
    this.vm = new RenderPass(vmScene, vmCam);
    this.vm.clear = false;
    this.vm.clearDepth = true;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.main);
    this.composer.addPass(this.vm);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(this.grade);
    if (quality < 3) {
      this.fxaa = new ShaderPass(FXAAShader);
      this.composer.addPass(this.fxaa);
    }
    this.setSize(renderer);
  }
  setScene(scene) { this.main.scene = scene; }
  setSize(renderer) {
    const pr = renderer.getPixelRatio();
    this.composer.setPixelRatio(pr);
    this.composer.setSize(innerWidth, innerHeight);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
  }
  render(showVm, time, damage) {
    this.vm.enabled = showVm;
    this.grade.uniforms.uTime.value = time;
    this.grade.uniforms.uDamage.value = damage;
    this.composer.render();
  }
  dispose() { this.composer.dispose(); }
}
