// Модели: оружие (с настоящими целиками и мушками), части солдат для отрисовки инстансами
import * as THREE from './three.module.min.js';
import { GeoBuilder } from './util.js';
import { TEAMS } from './config.js';

const WOOD = 0x6d4a2c, WOOD2 = 0x553a22, METAL = 0x2c2c2a, METAL2 = 0x3b3b37, SIGHT = 0x181816, DOT = 0xe8e0c8;
const SKIN = 0xc99a76, LEATHER = 0x3d2e20, BOOT = 0x241c16, BRASS = 0x9a7d43;

// Геометрия прицела каждого ствола (в локальных координатах ствола, ствол смотрит в −Z):
// H — высота линии прицеливания, rearZ — где стоит целик, grip/fore — точки хвата правой и левой рукой
export const GUN = {
  smg: { H: 0.052, opticH: 0.078, muzzle: [0, 0, -0.71], grip: [0, -0.05, -0.03], fore: [0, -0.034, -0.36], rearZ: -0.08 },
  semi: { H: 0.062, opticH: 0.088, muzzle: [0, 0, -1.03], grip: [0, -0.045, -0.01], fore: [0, -0.04, -0.44], rearZ: -0.04 },
  bolt: { H: 0.058, opticH: 0.09, muzzle: [0, 0, -1.09], grip: [0, -0.045, -0.01], fore: [0, -0.04, -0.47], rearZ: -0.3 },
  lmg: { H: 0.112, opticH: 0.15, muzzle: [0, 0, -1.0], grip: [0, -0.075, 0.0], fore: [0, -0.06, -0.42], rearZ: 0.02 },
  revolver: { H: 0.032, muzzle: [0, 0.004, -0.215], grip: [0, -0.06, 0.025], fore: [-0.004, -0.078, 0.03], rearZ: -0.02, pistol: true },
  pistol: { H: 0.03, muzzle: [0, 0.002, -0.225], grip: [0, -0.065, 0.015], fore: [-0.004, -0.082, 0.025], rearZ: 0.0, pistol: true },
};
export const WEAPON_IDS = Object.keys(GUN);

// Цилиндр между двумя точками (руки, ноги): радиус rA у точки a, rB у точки b
const _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _dir = new THREE.Vector3(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _m = new THREE.Matrix4();
const LIMB = {};
export function limb(b, ax, ay, az, bx, by, bz, rA, rB, color, seg = 8) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz);
  _q.setFromUnitVectors(_up, _dir.set(dx / len, dy / len, dz / len));
  const key = seg + '_' + (rB / rA).toFixed(2);
  if (!LIMB[key]) LIMB[key] = new THREE.CylinderGeometry(rB / rA, 1, 1, seg, 1).toNonIndexed();
  _m.compose(_p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), _q, _s.set(rA, len, rA));
  b.add(LIMB[key], _m, color, 0.03);
  b.sphere(rB * 0.98, bx, by, bz, color, 1, 1, 1, 1, 0.03);
}

// Оружие вдоль −Z. opts.optic — поставить оптический прицел
export function addWeaponGeo(b, id, ox, oy, oz, opts = {}) {
  const B = (w, h, d, x, y, z, c, rx = 0, j = 0.04) => b.box(w, h, d, ox + x, oy + y, oz + z, c, 0, rx, 0, j);
  const Cz = (r, len, x, y, z, c, seg = 10, r2 = r) => b.cyl(r2, r, len, seg, ox + x, oy + y, oz + z, c, -Math.PI / 2, 0, 0, 0.03);
  const Cy = (r, h, x, y, z, c, seg = 14) => b.cyl(r, r, h, seg, ox + x, oy + y, oz + z, c, 0, 0, 0, 0.03);
  const Cx = (r, len, x, y, z, c, seg = 8) => b.cyl(r, r, len, seg, ox + x, oy + y, oz + z, c, 0, 0, Math.PI / 2, 0.03);
  const notch = (z, top, h, gap = 0.003) => {
    B(0.007, h, 0.012, -(gap + 0.0035), top - h / 2, z, SIGHT, 0, 0);
    B(0.007, h, 0.012, gap + 0.0035, top - h / 2, z, SIGHT, 0, 0);
  };
  const post = (z, top, h) => {
    B(0.0028, h, 0.005, 0, top - h / 2, z, SIGHT, 0, 0);
    B(0.0032, 0.0032, 0.0042, 0, top - 0.0016, z + 0.0012, DOT, 0, 0);
  };
  const hood = (z, bottom, top) => {
    const h = top - bottom;
    B(0.003, h, 0.02, -0.0125, bottom + h / 2, z, METAL, 0, 0);
    B(0.003, h, 0.02, 0.0125, bottom + h / 2, z, METAL, 0, 0);
    B(0.028, 0.003, 0.02, 0, top, z, METAL, 0, 0);
  };
  const scope = (y, z0, z1, r = 0.019) => {
    const len = z1 - z0;
    Cz(r, len, 0, y, (z0 + z1) / 2, 0x1c1c1a, 12);
    Cz(r * 1.3, 0.055, 0, y, z1 + 0.02, 0x1c1c1a, 12);
    Cz(r * 1.4, 0.07, 0, y, z0 - 0.025, 0x1c1c1a, 12);
    b.cyl(r * 1.15, r * 1.15, 0.006, 14, ox, oy + y, oz + z0 - 0.06, 0x4a5a6a, -Math.PI / 2, 0, 0, 0);
    B(0.014, y - 0.03, 0.02, 0, 0.03 + (y - 0.03) / 2 - 0.004, z0 + len * 0.2, METAL);
    B(0.014, y - 0.03, 0.02, 0, 0.03 + (y - 0.03) / 2 - 0.004, z1 - len * 0.2, METAL);
  };
  if (id === 'smg') {
    B(0.044, 0.1, 0.26, 0, -0.042, 0.19, WOOD, 0.05);
    B(0.046, 0.104, 0.012, 0, -0.048, 0.325, METAL, 0.05);
    B(0.04, 0.062, 0.13, 0, -0.024, 0.03, WOOD);
    Cz(0.024, 0.28, 0, 0, -0.19, METAL2);
    Cz(0.026, 0.33, 0, 0, -0.495, METAL);
    for (let i = 0; i < 4; i++) B(0.056, 0.012, 0.03, 0, 0, -0.38 - i * 0.07, 0x111110, 0, 0);
    Cz(0.011, 0.05, 0, 0, -0.685, METAL);
    B(0.1, 0.034, 0.034, -0.08, 0, -0.2, METAL2);
    B(0.02, 0.042, 0.042, -0.03, 0, -0.2, METAL);
    B(0.008, 0.008, 0.06, 0, -0.045, -0.06, METAL);
    B(0.008, 0.03, 0.008, 0, -0.035, -0.09, METAL);
    B(0.032, 0.012, 0.012, 0.034, 0.006, -0.12, METAL);
    B(0.03, 0.012, 0.02, 0, 0.03, -0.08, METAL);
    notch(-0.08, 0.052, 0.016);
    B(0.012, 0.008, 0.012, 0, 0.028, -0.64, METAL);
    post(-0.64, 0.052, 0.022);
    if (opts.optic) scope(GUN.smg.opticH, -0.36, -0.08, 0.017);
  } else if (id === 'semi' || id === 'bolt') {
    const bolt = id === 'bolt', end = bolt ? -1.09 : -1.03, fs = bolt ? -1.05 : -0.99, H = GUN[id].H;
    B(0.05, 0.12, 0.28, 0, -0.047, 0.17, WOOD, 0.06);
    B(0.052, 0.124, 0.012, 0, -0.052, 0.315, METAL, 0.06);
    B(0.042, 0.075, 0.12, 0, -0.022, 0.02, WOOD);
    const fz0 = -0.08, fz1 = bolt ? -0.8 : -0.7;
    B(0.048, 0.055, fz0 - fz1, 0, -0.016, (fz0 + fz1) / 2, WOOD);
    B(0.04, 0.045, 0.2, 0, 0.008, -0.12, METAL2);
    B(0.034, 0.016, bolt ? 0.42 : 0.36, 0, 0.026, bolt ? -0.56 : -0.46, WOOD2);
    Cz(0.011, -fz1 + end, 0, 0, (fz1 + end) / 2, METAL);
    B(0.052, 0.06, 0.014, 0, -0.012, fz1 + 0.12, METAL);
    B(0.052, 0.06, 0.014, 0, -0.012, fz1 + 0.01, METAL);
    if (bolt) {
      Cx(0.008, 0.06, 0.04, 0.012, -0.03, METAL);
      b.sphere(0.012, ox + 0.072, oy + (opts.optic ? -0.01 : 0.012), oz - 0.03, METAL, 1, 1, 1, 1, 0.02);
      B(0.03, 0.012, 0.04, 0, 0.034, -0.3, METAL);
      notch(-0.3, H, 0.018);
    } else {
      B(0.034, 0.07, 0.07, 0, -0.07, -0.13, METAL2);
      B(0.012, 0.012, 0.035, 0.03, 0.018, -0.07, METAL);
      b.sphere(0.011, ox + 0.05, oy + 0.018, oz - 0.07, METAL, 1, 1, 1, 1, 0.02);
      B(0.03, 0.01, 0.024, 0, 0.036, -0.04, METAL);
      notch(-0.04, H, 0.021);
    }
    B(0.014, 0.024, 0.03, 0, 0.022, fs, METAL);
    post(fs, H, H - 0.034);
    hood(fs, 0.032, H + 0.011);
    if (opts.optic) scope(GUN[id].opticH, bolt ? -0.34 : -0.3, bolt ? 0.0 : -0.02, bolt ? 0.02 : 0.018);
  } else if (id === 'lmg') {
    B(0.044, 0.11, 0.25, 0, -0.052, 0.2, WOOD, 0.05);
    B(0.046, 0.114, 0.012, 0, -0.058, 0.325, METAL, 0.05);
    B(0.035, 0.085, 0.04, 0, -0.075, 0.0, WOOD, 0.3);
    B(0.06, 0.075, 0.24, 0, -0.002, -0.08, METAL2);
    Cz(0.05, 0.68, 0, 0, -0.54, METAL, 14);
    for (let i = 0; i < 6; i++) Cz(0.0515, 0.012, 0, 0, -0.26 - i * 0.1, 0x1e1e1c, 14);
    Cz(0.05, 0.08, 0, 0, -0.92, METAL, 12, 0.02);
    Cz(0.012, 0.1, 0, 0, -0.98, METAL);
    Cy(0.11, 0.045, 0, 0.06, -0.12, METAL2, 18);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      b.box(0.012, 0.004, 0.085, ox + Math.sin(a) * 0.06, oy + 0.0845, oz - 0.12 + Math.cos(a) * 0.06, 0x252522, a, 0, 0, 0);
    }
    Cy(0.026, 0.012, 0, 0.088, -0.12, METAL, 10);
    B(0.008, 0.008, 0.05, 0, -0.05, -0.04, METAL);
    B(0.03, 0.012, 0.012, 0.04, 0.01, -0.02, METAL);
    B(0.012, 0.064, 0.008, 0, 0.068, 0.02, METAL);
    B(0.006, 0.026, 0.006, -0.008, 0.112, 0.02, SIGHT, 0, 0);
    B(0.006, 0.026, 0.006, 0.008, 0.112, 0.02, SIGHT, 0, 0);
    B(0.022, 0.005, 0.006, 0, 0.1245, 0.02, SIGHT, 0, 0);
    B(0.022, 0.005, 0.006, 0, 0.0995, 0.02, SIGHT, 0, 0);
    B(0.012, 0.01, 0.012, 0, 0.054, -0.86, METAL);
    post(-0.86, 0.112, 0.055);
    B(0.01, 0.01, 0.34, 0.03, -0.055, -0.62, METAL);
    B(0.01, 0.01, 0.34, -0.03, -0.055, -0.62, METAL);
    if (opts.optic) scope(GUN.lmg.opticH, -0.3, -0.04, 0.018);
  } else if (id === 'revolver') {
    B(0.028, 0.085, 0.036, 0, -0.06, 0.03, WOOD2, -0.25);
    B(0.026, 0.04, 0.06, 0, -0.008, -0.01, METAL2);
    Cz(0.021, 0.045, 0, -0.012, -0.058, METAL, 12);
    B(0.024, 0.012, 0.075, 0, 0.018, -0.055, METAL2);
    Cz(0.0085, 0.12, 0, 0.004, -0.15, METAL);
    B(0.012, 0.01, 0.12, 0, -0.008, -0.15, METAL2);
    B(0.01, 0.025, 0.016, 0, 0.026, 0.02, METAL);
    B(0.006, 0.006, 0.04, 0, -0.04, -0.02, METAL);
    notch(-0.02, 0.032, 0.01, 0.0025);
    post(-0.205, 0.032, 0.02);
  } else if (id === 'pistol') {
    B(0.026, 0.095, 0.04, 0, -0.06, 0.02, WOOD2, -0.38);
    B(0.024, 0.035, 0.13, 0, -0.008, -0.055, METAL2);
    Cz(0.0085, 0.11, 0, 0.002, -0.165, METAL);
    Cx(0.009, 0.03, 0, 0.018, 0.0, METAL);
    Cx(0.009, 0.03, 0, 0.018, -0.03, METAL);
    B(0.022, 0.01, 0.03, 0, -0.105, 0.035, METAL, -0.38);
    B(0.006, 0.006, 0.04, 0, -0.035, -0.04, METAL);
    notch(0.0, 0.03, 0.01, 0.0025);
    post(-0.215, 0.03, 0.02);
  }
}

// ---------- Части солдата ----------
export function torsoGeo(team) {
  const T = TEAMS[team], b = new GeoBuilder();
  const U = T.uniform, UD = T.uniformDark;
  b.box(0.4, 0.3, 0.24, 0, 0.17, 0, U);
  b.box(0.45, 0.3, 0.26, 0, 0.44, 0, U);
  b.sphere(0.085, -0.215, 0.55, 0, U, 1, 0.8, 1.1);
  b.sphere(0.085, 0.215, 0.55, 0, U, 1, 0.8, 1.1);
  b.box(0.42, 0.12, 0.25, 0, -0.01, 0, UD);
  b.box(0.2, 0.06, 0.2, 0, 0.615, 0, U);
  b.box(0.46, 0.06, 0.27, 0, 0.08, 0, LEATHER);
  b.box(0.05, 0.045, 0.02, 0, 0.08, -0.138, BRASS, 0, 0, 0, 0);
  for (let i = 0; i < 4; i++) b.box(0.016, 0.016, 0.012, 0, 0.2 + i * 0.11, -0.13, BRASS, 0, 0, 0, 0);
  for (const s of [-1, 1]) {
    b.box(0.1, 0.1, 0.02, s * 0.11, 0.45, -0.135, UD);
    for (let i = 0; i < 2; i++) b.box(0.07, 0.075, 0.05, s * (0.1 + i * 0.075), 0.12, -0.15, LEATHER);
  }
  limb(b, -0.2, 0.6, -0.13, 0.18, 0.1, -0.14, 0.018, 0.018, LEATHER, 5);
  limb(b, -0.2, 0.6, 0.13, 0.18, 0.1, 0.14, 0.018, 0.018, LEATHER, 5);
  b.box(0.3, 0.3, 0.12, 0, 0.36, 0.18, UD);
  if (T.helmet === 'brodie') {
    b.cyl(0.065, 0.065, 0.34, 10, 0, 0.56, 0.2, T.puttee, 0, 0, Math.PI / 2);
    b.box(0.14, 0.12, 0.06, 0.18, 0.06, 0.12, UD);
  } else {
    b.cyl(0.055, 0.055, 0.22, 12, 0.2, 0.1, 0.11, 0x5a6052, 0, 0, 0);
    b.dome(0.055, 0.2, 0.21, 0.11, 0x5a6052);
    b.box(0.2, 0.08, 0.1, 0, 0.56, 0.2, 0x4a3a2a);
  }
  b.cyl(0.05, 0.05, 0.13, 10, -0.2, 0.06, 0.1, 0x4f5440, 0, 0, Math.PI / 2);
  b.cyl(0.058, 0.062, 0.08, 10, 0, 0.66, 0, SKIN);
  b.box(0.19, 0.22, 0.2, 0, 0.78, 0, SKIN);
  b.box(0.16, 0.06, 0.16, 0, 0.68, -0.01, SKIN);
  b.box(0.032, 0.05, 0.035, 0, 0.765, -0.11, 0xb88a68);
  for (const s of [-1, 1]) {
    b.box(0.022, 0.05, 0.035, s * 0.103, 0.78, 0, 0xb88a68);
    b.box(0.03, 0.014, 0.01, s * 0.045, 0.795, -0.101, 0x2a2018, 0, 0, 0, 0);
    b.box(0.045, 0.01, 0.01, s * 0.045, 0.815, -0.101, 0x4a3a2a, 0, 0, 0, 0);
  }
  b.box(0.06, 0.008, 0.01, 0, 0.725, -0.103, 0x8a5a4a, 0, 0, 0, 0);
  if (T.helmet === 'brodie') {
    b.cyl(0.262, 0.255, 0.022, 20, 0, 0.885, 0, T.helmetColor, 0, 0, 0, 0.02);
    b.dome(0.155, 0, 0.89, 0, T.helmetColor, 1, 0.72, 1.05, 16);
    limb(b, -0.11, 0.88, 0, -0.08, 0.68, -0.05, 0.006, 0.006, LEATHER, 4);
    limb(b, 0.11, 0.88, 0, 0.08, 0.68, -0.05, 0.006, 0.006, LEATHER, 4);
  } else {
    b.dome(0.162, 0, 0.84, 0.005, T.helmetColor, 1, 0.98, 1.1, 16);
    b.cyl(0.166, 0.2, 0.11, 20, 0, 0.8, 0.015, T.helmetColor, 0, 0, 0, 0.02);
    b.box(0.18, 0.02, 0.05, 0, 0.845, -0.16, T.helmetColor, 0, 0.35, 0, 0.02);
    for (const s of [-1, 1]) b.cyl(0.012, 0.012, 0.02, 8, s * 0.165, 0.86, 0, 0x3d403b, 0, 0, Math.PI / 2);
  }
  return b.build();
}
export function thighGeo(team) {
  const b = new GeoBuilder(), U = TEAMS[team].uniform;
  limb(b, 0, 0.02, 0, 0, -0.44, 0, 0.1, 0.082, U, 10);
  b.box(0.06, 0.1, 0.03, 0.08, -0.15, 0, TEAMS[team].uniformDark);
  return b.build();
}
export function shinGeo(team) {
  const T = TEAMS[team], b = new GeoBuilder();
  limb(b, 0, 0.0, 0, 0, -0.36, 0, 0.078, 0.064, T.puttee, 10);
  for (let i = 0; i < 4; i++) b.cyl(0.08 - i * 0.004, 0.082 - i * 0.004, 0.012, 10, 0, -0.06 - i * 0.08, 0, T.uniformDark, 0.3, 0, 0, 0);
  b.box(0.13, 0.12, 0.24, 0, -0.41, -0.03, BOOT);
  b.sphere(0.065, 0, -0.425, -0.14, BOOT, 1, 0.8, 1, 1);
  b.box(0.14, 0.025, 0.27, 0, -0.465, -0.035, 0x15110d);
  return b.build();
}
// Руки с оружием (точка вращения — середина плеч)
export function armsGeo(team, wid) {
  const T = TEAMS[team], b = new GeoBuilder(), g = GUN[wid], U = T.uniform;
  const pist = !!g.pistol;
  const G = pist ? [0, -0.1, -0.5] : [0.08, -0.14, -0.2];
  const grip = [G[0] + g.grip[0], G[1] + g.grip[1], G[2] + g.grip[2]];
  const fore = [G[0] + g.fore[0], G[1] + g.fore[1], G[2] + g.fore[2]];
  const eR = pist ? [0.14, -0.08, -0.24] : [0.25, -0.26, -0.06];
  const eL = pist ? [-0.13, -0.1, -0.26] : [-0.15, -0.23, -0.3];
  limb(b, 0.2, -0.02, 0.02, ...eR, 0.06, 0.052, U, 9);
  limb(b, ...eR, grip[0] + 0.01, grip[1] + 0.02, grip[2] + 0.04, 0.05, 0.042, U, 9);
  b.box(0.07, 0.085, 0.09, grip[0] + 0.012, grip[1] + 0.005, grip[2], SKIN);
  limb(b, -0.2, -0.02, 0.02, ...eL, 0.06, 0.052, U, 9);
  limb(b, ...eL, fore[0] - 0.02, fore[1] - 0.02, fore[2] + 0.04, 0.05, 0.042, U, 9);
  b.box(0.075, 0.07, 0.1, fore[0] - 0.005, fore[1] - 0.01, fore[2], SKIN);
  addWeaponGeo(b, wid, ...G);
  return b.build();
}
// Руки и оружие для вида от первого лица (координаты камеры: ствол в начале координат)
export function viewArmsGeo(team, wid, optic) {
  const T = TEAMS[team], b = new GeoBuilder(), g = GUN[wid], U = T.uniform;
  addWeaponGeo(b, wid, 0, 0, 0, { optic });
  const [gx, gy, gz] = g.grip, [fx, fy, fz] = g.fore;
  if (g.pistol) {
    limb(b, 0.2, -0.36, 0.25, gx + 0.012, gy - 0.03, gz + 0.06, 0.05, 0.04, U, 10);
    b.sphere(0.034, gx + 0.006, gy - 0.004, gz + 0.004, SKIN, 0.95, 1.25, 1.2, 1);
    limb(b, -0.18, -0.38, 0.2, fx - 0.03, fy - 0.035, fz + 0.05, 0.05, 0.04, U, 10);
    b.sphere(0.032, fx - 0.012, fy - 0.012, fz + 0.006, SKIN, 1.15, 0.85, 1.25, 1);
  } else {
    limb(b, 0.22, -0.33, 0.28, gx + 0.012, gy - 0.025, gz + 0.07, 0.055, 0.042, U, 10);
    b.sphere(0.036, gx + 0.012, gy - 0.004, gz + 0.006, SKIN, 1.0, 1.25, 1.3, 1);
    limb(b, -0.27, -0.35, 0.05, fx - 0.035, fy - 0.03, fz + 0.07, 0.055, 0.042, U, 10);
    b.sphere(0.036, fx - 0.008, fy - 0.014, fz + 0.006, SKIN, 1.2, 0.85, 1.4, 1);
  }
  return b.build();
}
