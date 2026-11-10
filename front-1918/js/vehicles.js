// Техника: лёгкий и тяжёлый танки, броневик, цеппелин поддержки для отстающей стороны и бипланы для атмосферы
import * as THREE from './three.module.min.js';
import { GeoBuilder, clamp, lerp, angleDiff, DEG, TAU, rand, dirFromYawPitch, raySphere, smoothstep } from './util.js';
import { TEAMS } from './config.js';
import { profile, lathe, latheZ } from './models.js';
import { PLAY } from './world.js';

const _push = {};
const _v = new THREE.Vector3(), _d = new THREE.Vector3();

// Модели танков: боковые профили, выдавленные по ширине, катки, гусеничные траки, заклёпки и навесное
const M = GeoBuilder.mat;
function rivets(b, n, ax, ay, az, bx, by, bz, r = 0.022) {
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0.5;
    b.sphere(r, ax + (bx - ax) * t, ay + (by - ay) * t, az + (bz - az) * t, 0x3b3a33, 1, 1, 1, 0, 0.02);
  }
}
// Гусеница: петля-профиль (u вперёд = −Z, v вверх), траки по нижней и верхней ветви, катки и ленивец
function track(b, x, loop, low, top, wheels, idler, sprocket, color) {
  b.add(profile(loop, 0.46, 0.03), M(x, 0, 0), 0x2a2622, 0.02);
  const [u0, u1] = low;
  for (let u = u0; u <= u1; u += 0.2) b.box(0.5, 0.05, 0.08, x, 0.02, -u, 0x1e1c19, 0, 0, 0, 0.03);
  const [a, c] = top;
  for (let t = 0; t <= 1.0001; t += 1 / 18) b.box(0.5, 0.05, 0.08, x, a[1] + (c[1] - a[1]) * t + 0.02, -(a[0] + (c[0] - a[0]) * t), 0x1e1c19, 0, Math.atan2(c[1] - a[1], c[0] - a[0]), 0, 0.03);
  const sx = Math.sign(x) || 1;
  for (const [u, v, r] of wheels) {
    b.cyl(r, r, 0.1, 12, x + sx * 0.24, v, -u, 0x34312b, 0, 0, Math.PI / 2, 0.02);
    b.cyl(r * 0.35, r * 0.35, 0.13, 8, x + sx * 0.25, v, -u, 0x24221e, 0, 0, Math.PI / 2, 0.02);
  }
  for (const [u, v, r] of [idler, sprocket]) {
    b.cyl(r, r, 0.12, 14, x + sx * 0.235, v, -u, color, 0, 0, Math.PI / 2, 0.02);
    for (let k = 0; k < 6; k++) {
      const an = k / 6 * TAU;
      b.box(0.135, r * 0.9, 0.05, x + sx * 0.24, v + Math.cos(an) * r * 0.45, -u + Math.sin(an) * r * 0.45, 0x24221e, 0, an, 0, 0.02);
    }
    b.cyl(r * 0.28, r * 0.28, 0.16, 8, x + sx * 0.25, v, -u, 0x3b3a33, 0, 0, Math.PI / 2, 0.02);
  }
}
export function tankGeos(team) {
  const T = TEAMS[team];
  const hull = new GeoBuilder(), tur = new GeoBuilder(), gun = new GeoBuilder();
  const c = T.tank, dk = T.tankDark, iron = 0x34322c, wood = 0x6a5236;
  if (team === 0) {
    // Лёгкий танк: узкий клёпаный корпус, высокий нос с ленивцами, «хвост» для перехода окопов
    hull.add(profile([[-2.0, 0.45], [2.05, 0.45], [2.45, 0.85], [2.45, 1.18], [1.85, 1.58], [1.2, 1.64], [-1.25, 1.64], [-1.95, 1.42], [-2.2, 1.0], [-2.0, 0.45]], 1.5, 0.035), M(0, 0, 0), c, 0.03);
    // Капот двигателя и жалюзи
    hull.add(profile([[-1.9, 1.4], [-0.6, 1.62], [-0.6, 1.72], [-1.75, 1.56], [-1.9, 1.4]], 1.2, 0.02), M(0, 0, 0), dk, 0.03);
    for (let i = 0; i < 6; i++) { const z = 0.75 + i * 0.18; hull.box(1.0, 0.025, 0.05, 0, 1.732 - (z - 0.6) * 0.139, z, iron, 0, 0.138, 0, 0.02); }
    // Люк механика-водителя: створки и смотровые щели
    hull.box(0.9, 0.05, 0.5, 0, 1.41, -2.13, dk, 0, -0.59, 0, 0.03);
    hull.box(0.02, 0.06, 0.5, 0, 1.44, -2.13, iron, 0, -0.59, 0, 0);
    for (const s of [-1, 1]) hull.box(0.24, 0.025, 0.02, s * 0.22, 1.47, -2.05, 0x111111, 0, -0.59, 0, 0);
    hull.box(1.4, 0.06, 0.06, 0, 1.18, -2.47, iron);
    // Заклёпки по швам
    for (const s of [-1, 1]) {
      rivets(hull, 14, s * 0.76, 1.6, -1.2, s * 0.76, 1.6, 1.25);
      rivets(hull, 8, s * 0.76, 0.55, -2.0, s * 0.76, 0.55, 1.9);
      rivets(hull, 5, s * 0.76, 0.9, -2.42, s * 0.76, 1.15, -2.42);
    }
    rivets(hull, 8, -0.6, 1.2, -2.47, 0.6, 1.2, -2.47);
    // Хвост-костыль
    for (const s of [-1, 1]) {
      hull.box(0.08, 0.12, 1.2, s * 0.5, 0.95, 2.55, dk, 0, 0.55, 0, 0.03);
      hull.box(0.08, 0.1, 0.9, s * 0.5, 0.48, 2.65, dk, 0, -0.25, 0, 0.03);
    }
    hull.box(1.08, 0.08, 0.1, 0, 0.6, 3.06, dk);
    // Глушитель, буксирный трос, шанцевый инструмент
    hull.cyl(0.09, 0.09, 0.9, 10, 0, 1.3, 2.2, iron, 0, 0, Math.PI / 2, 0.03);
    hull.cyl(0.04, 0.04, 0.3, 8, -0.4, 1.45, 2.2, 0x222120, 0, 0, 0, 0.02);
    hull.add(lathe([[0.0, 0], [0.16, 0.0], [0.18, 0.04], [0.16, 0.08], [0.0, 0.08]], 12), M(-0.4, 1.58, 1.5), 0x4a4434, 0.04);
    hull.box(0.06, 0.05, 1.1, -0.79, 1.42, -0.2, wood, 0, 0, 0, 0.04);
    hull.box(0.08, 0.2, 0.08, -0.79, 1.42, -0.8, iron);
    hull.cyl(0.09, 0.11, 0.16, 10, 0.5, 1.22, -2.5, 0x2c2a26, Math.PI / 2, 0, 0, 0.02);
    // Гусеницы: высокий передний ленивец, боковые бронеплиты
    const w = 1.05;
    for (const s of [-1, 1]) {
      track(hull, s * w,
        [[-2.2, 0.0], [1.9, 0.0], ['q', 2.6, 0.05, 2.78, 0.72], ['q', 2.88, 1.3, 2.38, 1.36], [-1.6, 1.16], ['q', -2.5, 1.12, -2.55, 0.6], ['q', -2.55, 0.02, -2.2, 0.0]],
        [-2.2, 1.9], [[2.38, 1.36], [-1.6, 1.16]],
        [[-1.6, 0.28, 0.22], [-1.0, 0.28, 0.22], [-0.4, 0.28, 0.22], [0.2, 0.28, 0.22], [0.8, 0.28, 0.22], [1.4, 0.28, 0.22]],
        [2.36, 0.78, 0.4], [-2.18, 0.58, 0.34], c);
      hull.add(profile([[-2.05, 0.52], [1.95, 0.52], ['q', 2.45, 0.56, 2.52, 0.95], ['q', 2.5, 1.18, 2.2, 1.2], [-1.55, 1.04], ['q', -2.2, 1.0, -2.25, 0.75], [-2.05, 0.52]], 0.07, 0.015), M(s * (w + 0.29), 0, 0), c, 0.03);
      rivets(hull, 12, s * (w + 0.33), 0.6, -1.9, s * (w + 0.33), 0.6, 1.95, 0.018);
      rivets(hull, 10, s * (w + 0.33), 1.08, -2.1, s * (w + 0.33), 0.98, 1.5, 0.018);
    }
    // Башня: литая, слегка коническая, с грибовидным колпаком
    tur.add(lathe([[0.0, 0.0], [0.8, 0.0], [0.8, 0.08], [0.74, 0.1], [0.7, 0.68], [0.6, 0.76], [0.0, 0.78]], 16), M(0, 0, 0), c, 0.03);
    tur.add(lathe([[0.0, 0.74], [0.24, 0.74], [0.24, 0.86], [0.3, 0.88], [0.27, 0.98], [0.12, 1.04], [0.0, 1.05]], 12), M(0, 0, 0.15), dk, 0.03);
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; tur.sphere(0.022, Math.sin(a) * 0.77, 0.06, Math.cos(a) * 0.77, 0x3b3a33, 1, 1, 1, 0, 0.02); }
    for (const a of [Math.PI / 2, -Math.PI / 2, 0]) tur.box(0.18, 0.025, 0.02, Math.sin(a) * 0.72, 0.5, Math.cos(a) * 0.72, 0x111111, 0, a, 0, 0);
    tur.add(profile([[-0.05, 0.12], [0.2, 0.18], [0.24, 0.38], [0.2, 0.6], [-0.05, 0.64]], 0.56, 0.03), M(0, 0, -0.72), dk, 0.03);
    tur.cyl(0.62, 0.62, 0.12, 14, 0, -0.03, 0, iron);
  } else {
    // Тяжёлый «коробчатый» танк: высокая рубка, бронированные фальшборта до земли, амбразуры пулемётов
    hull.add(profile([[-2.45, 0.42], [2.4, 0.42], [2.8, 0.85], [2.62, 1.4], [2.2, 1.9], [1.65, 2.05], [-1.85, 2.05], [-2.4, 1.82], [-2.65, 1.3], [-2.45, 0.42]], 3.0, 0.04), M(0, 0, 0), c, 0.03);
    hull.add(profile([[-1.7, 2.0], [1.55, 2.0], [1.4, 2.2], [-1.55, 2.2], [-1.7, 2.0]], 2.2, 0.03), M(0, 0, 0.1), dk, 0.03);
    // Рубка командира и водителя спереди
    hull.add(profile([[1.0, 2.15], [1.75, 2.15], [1.62, 2.36], [1.05, 2.37], [1.0, 2.15]], 0.9, 0.03), M(0, 0, 0), c, 0.03);
    for (const s of [-1, 0, 1]) hull.box(0.2, 0.03, 0.02, s * 0.28, 2.27, -1.69, 0x111111, 0, 0, 0, 0);
    // Амбразуры пулемётов по бортам и в лобовом листе
    for (const s of [-1, 1]) {
      for (const u of [-1.4, -0.2, 1.0]) {
        hull.add(lathe([[0.0, 0], [0.17, 0.0], [0.17, 0.05], [0.12, 0.09], [0.0, 0.1]], 10), M(s * 1.5, 1.35, -u, 0, 0, -s * Math.PI / 2), dk, 0.03);
        hull.cyl(0.028, 0.028, 0.5, 6, s * 1.72, 1.35, -u, 0x1b1a18, 0, 0, Math.PI / 2, 0.02);
      }
      hull.box(0.03, 0.6, 0.9, s * 1.51, 1.05, 0.4, dk, 0, 0, 0, 0.03);
      rivets(hull, 4, s * 1.53, 0.8, -0.03, s * 1.53, 1.3, -0.03, 0.02);
      rivets(hull, 20, s * 1.52, 0.5, -2.35, s * 1.52, 0.5, 2.35);
      rivets(hull, 18, s * 1.52, 1.97, -1.85, s * 1.52, 1.97, 1.7);
      rivets(hull, 12, s * 1.52, 1.0, -1.95 + 0.0, s * 1.52, 1.0, -0.6);
    }
    rivets(hull, 12, -1.3, 1.6, -2.62, 1.3, 1.6, -2.62);
    rivets(hull, 12, -1.3, 0.75, -2.72, 1.3, 0.75, -2.72);
    hull.add(lathe([[0.0, 0], [0.18, 0.0], [0.18, 0.06], [0.12, 0.1], [0.0, 0.11]], 10), M(0, 1.2, -2.66, -Math.PI / 2), dk, 0.03);
    hull.cyl(0.03, 0.03, 0.45, 6, 0, 1.2, -2.85, 0x1b1a18, Math.PI / 2, 0, 0, 0.02);
    // Груз на корме: ящики, мешки, брезент; бревно для самовытаскивания
    hull.box(0.6, 0.35, 0.45, -0.6, 2.38, 1.35, wood, 0.0, 0.1, 0, 0.05);
    hull.box(0.5, 0.3, 0.4, 0.55, 2.36, 1.45, 0x5d4a33, 0.0, -0.2, 0, 0.05);
    hull.cyl(0.12, 0.12, 1.6, 10, 0, 2.17, 1.72, 0x6b6450, 0, 0, Math.PI / 2, 0.05);
    for (const x of [-0.5, 0.5]) hull.cyl(0.125, 0.125, 0.04, 10, x, 2.17, 1.72, 0x3a3020, 0, 0, Math.PI / 2, 0.02);
    hull.cyl(0.13, 0.13, 2.6, 10, 0, 1.55, 2.62, 0x5a4a36, 0, 0, Math.PI / 2, 0.05);
    for (const s of [-1, 1]) hull.box(0.06, 0.4, 0.06, s * 0.9, 1.55, 2.6, iron, 0, 0, 0, 0.02);
    // Гусеницы прячутся под бронёй — видны траки внизу
    const w = 1.2;
    for (const s of [-1, 1]) {
      track(hull, s * w,
        [[-2.4, 0.0], [2.35, 0.0], ['q', 2.7, 0.04, 2.72, 0.4], ['q', 2.7, 0.75, 2.35, 0.75], [-2.35, 0.75], ['q', -2.72, 0.75, -2.72, 0.4], ['q', -2.72, 0.04, -2.4, 0.0]],
        [-2.4, 2.35], [[2.35, 0.75], [-2.35, 0.75]],
        [[-1.8, 0.26, 0.2], [-1.0, 0.26, 0.2], [-0.2, 0.26, 0.2], [0.6, 0.26, 0.2], [1.4, 0.26, 0.2]],
        [2.38, 0.38, 0.34], [-2.38, 0.38, 0.34], dk);
    }
    // Башня: шестигранная, с командирской башенкой
    tur.add(lathe([[0.0, 0.0], [0.86, 0.0], [0.86, 0.06], [0.8, 0.08], [0.74, 0.58], [0.0, 0.62]], 6), M(0, 0, 0, 0, Math.PI / 6), c, 0.03);
    tur.add(lathe([[0.0, 0.55], [0.22, 0.55], [0.22, 0.78], [0.25, 0.8], [0.25, 0.84], [0.0, 0.85]], 10), M(0.22, 0, 0.25), dk, 0.03);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; tur.box(0.12, 0.025, 0.02, 0.22 + Math.sin(a) * 0.225, 0.72, 0.25 + Math.cos(a) * 0.225, 0x111111, 0, a, 0, 0); }
    for (let k = 0; k < 12; k++) { const a = (k + 0.5) / 12 * TAU; tur.sphere(0.022, Math.sin(a) * 0.8, 0.12, Math.cos(a) * 0.8, 0x3b3a33, 1, 1, 1, 0, 0.02); }
    tur.add(profile([[-0.05, 0.08], [0.22, 0.12], [0.26, 0.34], [0.22, 0.56], [-0.05, 0.58]], 0.7, 0.03), M(0, 0, -0.74), dk, 0.03);
    tur.box(0.06, 0.4, 0.06, -0.55, 0.85, 0.35, iron);
    tur.box(0.5, 0.3, 0.02, -0.55, 0.95, 0.35, T.banner, 0, 0.4, 0, 0.03);
  }
  // Пушка: ствол-тело вращения с дульным утолщением и противооткатным цилиндром
  gun.add(latheZ([[0.13, -0.04], [0.13, 0.16], [0.09, 0.22], [0.075, 0.3], [0.068, 1.36], [0.088, 1.4], [0.09, 1.55], [0.04, 1.555]], 14), M(0, 0, 0), 0x34332e, 0.02);
  gun.cyl(0.04, 0.04, 0.02, 10, 0, 0, -1.552, 0x0a0a0a, Math.PI / 2, 0, 0, 0);
  gun.cyl(0.06, 0.06, 0.6, 10, 0, -0.13, -0.42, 0x2c2b27, Math.PI / 2, 0, 0, 0.02);
  gun.box(0.05, 0.1, 0.14, 0.11, 0.06, -0.2, 0x2c2b27);
  return { hull: hull.build(), tur: tur.build(), gun: gun.build() };
}

// Тяжёлый танк: ромбовидные гусеничные обводы во всю высоту борта, спонсоны с пулемётами, башня на рубке
function heavyGeos(team) {
  const T = TEAMS[team];
  const hull = new GeoBuilder(), tur = new GeoBuilder(), gun = new GeoBuilder();
  const c = T.tank, dk = T.tankDark, iron = 0x34322c;
  const loop = [[-3.25, 0.6], [-2.5, 0.0], [2.1, 0.0], ['q', 3.2, 0.1, 3.6, 1.25], ['q', 3.8, 2.35, 2.9, 2.5], [-2.5, 2.05], ['q', -3.5, 1.95, -3.55, 1.25], [-3.25, 0.6]];
  for (const s of [-1, 1]) {
    track(hull, s * 1.5, loop, [-2.5, 2.1], [[2.9, 2.5], [-2.5, 2.05]], [], [3.02, 1.38, 0.5], [-2.98, 1.28, 0.42], dk);
    hull.add(profile([[-2.95, 0.72], [-2.4, 0.32], [2.0, 0.32], ['q', 2.9, 0.42, 3.22, 1.28], ['q', 3.35, 2.02, 2.8, 2.17], [-2.4, 1.76], ['q', -3.15, 1.7, -3.2, 1.25], [-2.95, 0.72]], 0.5, 0.02), M(s * 1.5, 0, 0), c, 0.03);
    rivets(hull, 16, s * 1.77, 0.45, -1.9, s * 1.77, 0.45, 2.3, 0.024);
    rivets(hull, 14, s * 1.77, 1.95, -2.6, s * 1.77, 1.72, 2.2, 0.024);
    // Спонсон с пулемётом и дверцей
    hull.add(profile([[-0.95, 0.95], [0.95, 0.95], [1.2, 1.25], [1.2, 1.72], [0.95, 2.0], [-0.95, 2.0], [-1.2, 1.72], [-1.2, 1.25], [-0.95, 0.95]], 0.5, 0.03), M(s * 2.0, 0, 0.15), c, 0.03);
    hull.add(lathe([[0, 0], [0.2, 0], [0.2, 0.05], [0.13, 0.1], [0, 0.11]], 10), M(s * 2.24, 1.5, -0.35, 0, 0, -s * Math.PI / 2), dk, 0.03);
    hull.cyl(0.03, 0.03, 0.6, 6, s * 2.5, 1.5, -0.35, 0x1b1a18, 0, 0, Math.PI / 2, 0.02);
    hull.box(0.03, 0.5, 0.7, s * 2.26, 1.45, 0.6, dk, 0, 0, 0, 0.03);
    rivets(hull, 6, s * 2.27, 1.9, -0.7, s * 2.27, 1.9, 1.0, 0.02);
  }
  // Корпус между гусеницами и рубка
  hull.add(profile([[-3.0, 0.62], [2.6, 0.62], [3.15, 1.3], [2.85, 2.1], [2.2, 2.44], [-2.4, 2.2], [-3.15, 1.6], [-3.0, 0.62]], 2.6, 0.04), M(0, 0, 0), c, 0.03);
  hull.add(profile([[-1.7, 2.18], [1.75, 2.4], [1.55, 2.74], [-1.45, 2.64], [-1.7, 2.18]], 2.1, 0.03), M(0, 0, 0), dk, 0.03);
  for (const k of [-1, 0, 1]) hull.box(0.28, 0.035, 0.02, k * 0.5, 2.6, -1.67, 0x111111, 0, 0.53, 0, 0);
  rivets(hull, 10, -1.0, 2.3, -2.55, 1.0, 2.3, -2.55);
  rivets(hull, 10, -1.2, 1.0, -2.92, 1.2, 1.0, -2.92);
  // Выхлопная труба с глушителем, бревно самовытаскивания, фара, буксирный крюк
  hull.cyl(0.07, 0.07, 1.5, 8, 0.65, 2.76, 0.9, iron, Math.PI / 2, 0, 0, 0.03);
  hull.cyl(0.12, 0.12, 0.5, 10, 0.65, 2.76, 1.25, 0x2c2a26, Math.PI / 2, 0, 0, 0.03);
  hull.cyl(0.14, 0.14, 3.0, 10, 0, 1.92, 3.02, 0x5a4a36, 0, 0, Math.PI / 2, 0.05);
  for (const k of [-1, 1]) hull.box(0.07, 0.36, 0.07, k * 1.0, 1.9, 3.0, iron, 0, 0, 0, 0.02);
  hull.cyl(0.1, 0.12, 0.16, 10, 0.75, 1.75, -3.0, 0x2c2a26, Math.PI / 2, 0, 0, 0.02);
  hull.box(0.3, 0.1, 0.12, 0, 0.75, -2.75, iron);
  // Башня: гранёная, с командирским колпаком
  tur.add(lathe([[0, 0], [0.98, 0], [0.98, 0.07], [0.92, 0.09], [0.86, 0.6], [0.7, 0.68], [0, 0.7]], 8), M(0, 0, 0, 0, Math.PI / 8), c, 0.03);
  tur.add(lathe([[0, 0.66], [0.26, 0.66], [0.26, 0.84], [0.3, 0.86], [0.28, 0.93], [0, 0.95]], 10), M(-0.3, 0, 0.25), dk, 0.03);
  for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * TAU; tur.sphere(0.024, Math.sin(a) * 0.93, 0.14, Math.cos(a) * 0.93, 0x3b3a33, 1, 1, 1, 0, 0.02); }
  tur.add(profile([[-0.05, 0.1], [0.24, 0.14], [0.28, 0.36], [0.24, 0.58], [-0.05, 0.62]], 0.8, 0.03), M(0, 0, -0.84), dk, 0.03);
  tur.cyl(0.7, 0.7, 0.1, 14, 0, -0.04, 0, iron);
  tur.box(0.06, 0.4, 0.06, 0.6, 0.9, 0.4, iron);
  tur.box(0.5, 0.3, 0.02, 0.6, 1.0, 0.4, T.banner, 0, 0.4, 0, 0.03);
  // Короткая толстая пушка
  gun.add(latheZ([[0.16, -0.04], [0.16, 0.18], [0.115, 0.24], [0.1, 0.3], [0.09, 1.2], [0.115, 1.24], [0.115, 1.42], [0.05, 1.425]], 14), M(0, 0, 0), 0x34332e, 0.02);
  gun.cyl(0.05, 0.05, 0.02, 10, 0, 0, -1.42, 0x0a0a0a, Math.PI / 2, 0, 0, 0);
  gun.cyl(0.07, 0.07, 0.6, 10, 0, -0.16, -0.42, 0x2c2b27, Math.PI / 2, 0, 0, 0.02);
  return { hull: hull.build(), tur: tur.build(), gun: gun.build() };
}

// Броневик: клёпаный корпус на автомобильном шасси, башня с пулемётом
function carGeos(team) {
  const T = TEAMS[team];
  const hull = new GeoBuilder(), tur = new GeoBuilder(), gun = new GeoBuilder();
  const c = T.tank, dk = T.tankDark, iron = 0x34322c, tire = 0x1f1d1a;
  // Корпус: капот, наклонный лобовой лист, боевое отделение; рама и радиатор с жалюзи
  hull.add(profile([[-2.15, 0.78], [2.2, 0.78], [2.28, 1.2], [1.15, 1.4], [0.95, 1.98], [-1.95, 1.98], [-2.25, 1.55], [-2.15, 0.78]], 1.7, 0.035), M(0, 0, 0), c, 0.03);
  hull.box(1.1, 0.16, 4.3, 0, 0.66, 0, iron);
  hull.box(1.2, 0.42, 0.05, 0, 1.0, -2.27, dk);
  for (let i = 0; i < 5; i++) hull.box(1.1, 0.025, 0.07, 0, 0.84 + i * 0.08, -2.29, iron, 0, 0.3, 0, 0.02);
  for (const s of [-1, 1]) {
    // Лючки водителя на лобовом листе
    hull.box(0.5, 0.26, 0.04, s * 0.4, 1.7, -1.08, dk, 0, 0.33, 0, 0.03);
    hull.box(0.3, 0.03, 0.02, s * 0.4, 1.72, -1.11, 0x111111, 0, 0.33, 0, 0);
    // Колёса со спицами и крылья
    for (const u of [1.45, -1.3]) {
      const x = s * 0.98, z = -u;
      hull.cyl(0.5, 0.5, 0.22, 16, x, 0.5, z, tire, 0, 0, Math.PI / 2, 0.02);
      hull.cyl(0.34, 0.34, 0.24, 12, x, 0.5, z, dk, 0, 0, Math.PI / 2, 0.03);
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; hull.box(0.26, 0.3, 0.05, x, 0.5 + Math.cos(a) * 0.2, z + Math.sin(a) * 0.2, iron, 0, a, 0, 0.02); }
      hull.cyl(0.09, 0.09, 0.3, 8, x, 0.5, z, 0x3b3a33, 0, 0, Math.PI / 2, 0.02);
      hull.add(profile([[u - 0.72, 0.86], ['q', u - 0.7, 1.2, u, 1.22], ['q', u + 0.7, 1.2, u + 0.72, 0.86], [u + 0.66, 0.86], ['q', u + 0.62, 1.14, u, 1.16], ['q', u - 0.62, 1.14, u - 0.66, 0.86], [u - 0.72, 0.86]], 0.36, 0.01), M(x, 0, 0), dk, 0.03);
    }
    // Подножка, фара, заклёпки, дверь
    hull.box(0.3, 0.05, 1.2, s * 1.0, 0.62, 0.1, iron);
    hull.cyl(0.1, 0.12, 0.14, 10, s * 0.62, 1.32, -2.2, 0x2c2a26, Math.PI / 2, 0, 0, 0.02);
    rivets(hull, 10, s * 0.87, 1.9, -0.8, s * 0.87, 1.9, 1.85, 0.02);
    rivets(hull, 8, s * 0.87, 0.9, -0.9, s * 0.87, 0.9, 1.9, 0.02);
    hull.box(0.03, 0.62, 0.55, s * 0.865, 1.38, 0.2, dk, 0, 0, 0, 0.03);
  }
  // Запасное колесо на корме
  hull.cyl(0.46, 0.46, 0.2, 14, 0, 1.3, 2.32, tire, Math.PI / 2, 0, 0, 0.02);
  hull.cyl(0.3, 0.3, 0.22, 10, 0, 1.3, 2.33, dk, Math.PI / 2, 0, 0, 0.03);
  // Башня с люком и щитком пулемёта
  tur.add(lathe([[0, 0], [0.74, 0], [0.74, 0.06], [0.7, 0.08], [0.66, 0.56], [0.5, 0.62], [0, 0.64]], 14), M(0, 0, 0), c, 0.03);
  for (let k = 0; k < 12; k++) { const a = k / 12 * TAU; tur.sphere(0.02, Math.sin(a) * 0.71, 0.12, Math.cos(a) * 0.71, 0x3b3a33, 1, 1, 1, 0, 0.02); }
  tur.box(0.5, 0.04, 0.5, 0, 0.66, 0.1, dk, 0, 0, 0, 0.03);
  tur.box(0.34, 0.3, 0.1, 0, 0.3, -0.68, dk, 0, 0, 0, 0.03);
  for (const a of [Math.PI / 2, -Math.PI / 2]) tur.box(0.16, 0.025, 0.02, Math.sin(a) * 0.69, 0.42, Math.cos(a) * 0.69, 0x111111, 0, a, 0, 0);
  // Пулемёт с кожухом
  gun.add(latheZ([[0.05, -0.1], [0.05, 0.5], [0.045, 0.52], [0.022, 0.54], [0.02, 0.86], [0.028, 0.87], [0.028, 0.92], [0.01, 0.925]], 12), M(0, 0, 0), 0x33362e, 0.02);
  gun.box(0.07, 0.1, 0.2, 0, 0, 0.12, 0x2c2b27);
  return { hull: hull.build(), tur: tur.build(), gun: gun.build() };
}

// Типы наземной техники. len / wid — полубаза для наклона по рельефу, hit — половины размеров корпуса для попаданий
export const VEHICLES = {
  light: {
    name: 'Лёгкий танк', short: 'ТАНК', inside: 'Вы в танке', hp: 1000, speed: 6.8, rev: 3.2, acc: 3.2, brake: 6, turn: 0.85, radius: 2.3, len: 2.1, wid: 1.2, turretTurn: 1.3,
    reload: 3.4, shell: { dmg: 115, radius: 5.5, direct: 260 }, mg: { dmg: 22, cd: 0.1 }, hit: [1.5, 1.3, 2.8], hitY: 1.3, cam: [9, 3.6], respawn: 50, score: 500, muzzleZ: -1.6, mass: 2,
    geos: tankGeos, turret: (t) => [0, t === 0 ? 1.72 : 2.2, t === 0 ? 0.3 : 0], pivot: [0, 0.38, -0.82],
  },
  heavy: {
    name: 'Тяжёлый танк', short: 'ТЯЖ. ТАНК', inside: 'Вы в тяжёлом танке', hp: 1800, speed: 4.3, rev: 2.4, acc: 2.2, brake: 5, turn: 0.55, radius: 3.1, len: 3.0, wid: 1.6, turretTurn: 0.95,
    reload: 4.4, shell: { dmg: 140, radius: 6.5, direct: 340 }, mg: { dmg: 24, cd: 0.085 }, hit: [2.2, 1.6, 3.6], hitY: 1.6, cam: [12, 4.6], respawn: 80, score: 800, muzzleZ: -1.48, mass: 3,
    geos: heavyGeos, turret: () => [0, 2.68, 0.2], pivot: [0, 0.36, -0.92],
  },
  car: {
    name: 'Броневик', short: 'БРОНЕВИК', inside: 'Вы в броневике', hp: 520, speed: 11.5, rev: 5, acc: 5.5, brake: 9, turn: 1.3, radius: 2.1, len: 1.6, wid: 0.95, turretTurn: 2.4, wheeled: true,
    reload: 0, shell: null, mg: { dmg: 24, cd: 0.08 }, hit: [1.0, 1.1, 2.3], hitY: 1.2, cam: [7.5, 3.0], respawn: 40, score: 300, muzzleZ: -0.95, mass: 1, bulletMul: 2.5,
    geos: carGeos, turret: () => [0, 1.98, 0.6], pivot: [0, 0.3, -0.66],
  },
};

export class Tank {
  constructor(game, team, spawn, type = 'light') {
    this.game = game;
    this.team = team;
    this.spawnPt = spawn;
    this.type = type;
    const cfg = (this.cfg = VEHICLES[type]);
    this.maxHp = cfg.hp;
    this.kind = 'tank';
    this.wname = type === 'car' ? 'car' : 'tank';
    const g = cfg.geos(team);
    this.mat = game.gfx.triplanar('metal', { local: true, scale: 1.2, roughness: 0.6, metalness: 0.3, strength: 0.8, unique: true });
    this.root = new THREE.Group();
    this.hull = new THREE.Mesh(g.hull, this.mat);
    this.turret = new THREE.Group();
    this.turret.position.set(...cfg.turret(team));
    const tm = new THREE.Mesh(g.tur, this.mat);
    this.gunPivot = new THREE.Group();
    this.gunPivot.position.set(...cfg.pivot);
    this.gun = new THREE.Mesh(g.gun, this.mat);
    this.gunPivot.add(this.gun);
    this.turret.add(tm, this.gunPivot);
    this.root.add(this.hull, this.turret);
    for (const m of [this.hull, tm, this.gun]) { m.castShadow = true; m.receiveShadow = true; }
    game.scene.add(this.root);
    this.pos = new THREE.Vector3();
    this.input = { throttle: 0, steer: 0, aimYaw: 0, aimPitch: 0, fire: false, mg: false };
    this.emitter = null;
    this.respawn();
  }
  respawn() {
    const w = this.game.world, s = this.spawnPt;
    this.pos.set(s.x, w.height(s.x, s.z), s.z);
    this.yaw = s.yaw; this.speed = 0;
    this.turretYaw = s.yaw; this.gunPitch = 0;
    this.pitch = 0; this.roll = 0; this.pitchV = 0; this.rollV = 0;
    this.hp = this.maxHp;
    this.alive = true;
    this.driver = null;
    this.reload = 0; this.mgCd = 0; this.recoil = 0;
    this.respawnT = 0;
    this.spottedUntil = 0;
    this.lastDriverExit = -99;
    this.mat.color.setHex(0xffffff);
    this.root.visible = true;
    this.setEmitter(0);
  }
  setEmitter(level) {
    const fx = this.game.effects;
    if (this.emitter) { fx.emitters.splice(fx.emitters.indexOf(this.emitter), 1); this.emitter = null; }
    if (level > 0) { this.emitter = { x: 0, y: 0, z: 0, rate: level, size: 1 }; fx.emitters.push(this.emitter); }
  }
  // Чтобы бот с противотанковым ружьём мог целиться в технику как в обычную цель
  get state() { return this.alive ? 'alive' : 'dead'; }
  get aimY() { return this.pos.y + this.cfg.hitY; }
  get moving() { return Math.abs(this.speed) > 0.5; }
  get forwardX() { return -Math.sin(this.yaw); }
  get forwardZ() { return -Math.cos(this.yaw); }
  muzzle(out) {
    this.gun.updateWorldMatrix(true, false);
    return out.set(0, 0, this.cfg.muzzleZ).applyMatrix4(this.gun.matrixWorld);
  }
  gunDir(out) {
    this.gun.updateWorldMatrix(true, false);
    return out.set(0, 0, -1).transformDirection(this.gun.matrixWorld);
  }
  // Урон от пули: броню танка пуля почти не берёт, броневик — берёт
  bulletDmg(w) { return w && w.vehicleDmg ? w.vehicleDmg : 2 * (this.cfg.bulletMul || 1); }
  // Игрок садится даже в машину, занятую ботом: бот вылезает и воюет пешком
  takeOver(s) {
    if (!this.alive) return false;
    const d = this.driver;
    if (d === s) return true;
    if (d) {
      if (!d.bot || d.isPlayer) return false;
      this.exit();
      d.bot.wantTank = null; d.bot.path = null; d.bot.goal = null;
    }
    return this.enter(s);
  }
  enter(s) {
    if (!this.alive || this.driver) return false;
    this.driver = s;
    s.vehicle = this;
    s.reloadT = 0; s.adsT = 0;
    this.input.aimYaw = this.turretYaw; this.input.aimPitch = this.gunPitch;
    return true;
  }
  exit() {
    const s = this.driver;
    if (!s) return;
    this.driver = null;
    s.vehicle = null;
    this.lastDriverExit = this.game.time;
    const w = this.game.world, off = this.cfg.radius + 0.4;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let px = this.pos.x + rx * off, pz = this.pos.z + rz * off;
    if (w.blockedAt(px, pz, w.height(px, pz), 0.5)) { px = this.pos.x - rx * off; pz = this.pos.z - rz * off; }
    s.pos.set(px, w.groundAt(px, pz, w.height(px, pz) + 1), pz);
    s.vel.set(0, 0, 0);
    s.yaw = this.turretYaw;
    this.input.throttle = 0; this.input.steer = 0; this.input.fire = false; this.input.mg = false;
  }
  update(dt) {
    const g = this.game, w = g.world, cfg = this.cfg;
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.emitter) { this.emitter.x = this.pos.x; this.emitter.y = this.pos.y + 2; this.emitter.z = this.pos.z; }
      if (Math.random() < dt * 6) g.effects.fire(this.pos.x, this.pos.y + 1.8, this.pos.z, 1.2);
      if (this.respawnT <= 0) this.respawn();
      return;
    }
    const inp = this.input;
    if (!this.driver) { inp.throttle = 0; inp.steer = 0; inp.fire = false; inp.mg = false; }
    const tgt = inp.throttle * (inp.throttle > 0 ? cfg.speed : cfg.rev);
    const acc = Math.abs(tgt) > Math.abs(this.speed) ? cfg.acc : cfg.brake;
    const prevSpeed = this.speed;
    this.speed += clamp(tgt - this.speed, -acc * dt, acc * dt);
    // Колёсная машина не разворачивается на месте
    const grip = cfg.wheeled ? clamp(Math.abs(this.speed) / 3, 0, 1) : 1;
    const turn = inp.steer * cfg.turn * grip * (this.speed < -0.2 ? -1 : 1);
    this.yaw -= turn * dt;
    const p = this.pos;
    p.x += this.forwardX * this.speed * dt;
    p.z += this.forwardZ * this.speed * dt;
    w.pushCircle(p, cfg.radius, p.y + 0.9, p.y + 2.6, _push);
    if (_push.hits) {
      // Ломаем деревья, заборы и мешки с песком, если наехали с разгона
      if (Math.abs(this.speed) > 1.2 && _push.block && w.crush) {
        const sg = Math.sign(this.speed);
        w.crush(_push.block, this.forwardX * sg, this.forwardZ * sg, cfg.mass);
      }
      w.pushCircle(p, cfg.radius, p.y + 0.9, p.y + 2.6, _push);
      this.speed *= Math.pow(0.1, dt);
    }
    p.x = clamp(p.x, -PLAY + 2, PLAY - 2); p.z = clamp(p.z, -PLAY + 2, PLAY - 2);
    // Заборы под гусеницами и колёсами ломаются
    if (Math.abs(this.speed) > 0.8) {
      const sg = Math.sign(this.speed);
      w.crushAround(p.x + this.forwardX * cfg.len * sg, p.z + this.forwardZ * cfg.len * sg, cfg.radius * 0.7);
    }
    // Наклон по рельефу
    const fx = this.forwardX, fz = this.forwardZ, rx = -fz, rz = fx, L = cfg.len, Wd = cfg.wid;
    const hf = w.height(p.x + fx * L, p.z + fz * L), hb = w.height(p.x - fx * L, p.z - fz * L);
    const hl = w.height(p.x - rx * Wd, p.z - rz * Wd), hr = w.height(p.x + rx * Wd, p.z + rz * Wd);
    const hc = w.height(p.x, p.z);
    const ty = Math.max(hc, (hf + hb + hl + hr) / 4);
    p.y = lerp(p.y, ty, Math.min(1, dt * 10));
    // Подвеска: корпус качается на пружинах — приседает при разгоне, клюёт носом при торможении, вздрагивает от отдачи
    const accel = (this.speed - prevSpeed) / Math.max(dt, 1e-3);
    const tp = Math.atan2(hf - hb, L * 2) + clamp(accel * 0.006, -0.05, 0.05);
    const tr = Math.atan2(hr - hl, Wd * 2);
    this.pitchV += ((tp - this.pitch) * 70 - this.pitchV * 7.5) * dt;
    this.rollV += ((tr - this.roll) * 70 - this.rollV * 7.5) * dt;
    this.pitch = clamp(this.pitch + this.pitchV * dt, -0.7, 0.7);
    this.roll = clamp(this.roll + this.rollV * dt, -0.7, 0.7);
    // Наводка башни
    const dy = angleDiff(this.turretYaw, inp.aimYaw);
    this.turretYaw += clamp(dy, -cfg.turretTurn * dt, cfg.turretTurn * dt);
    const pTarget = clamp(inp.aimPitch - this.pitch, -0.15, 0.4);
    this.gunPitch += clamp(pTarget - this.gunPitch, -0.9 * dt, 0.9 * dt);
    this.reload -= dt; this.mgCd -= dt;
    this.recoil = Math.max(0, this.recoil - dt * 2.5);
    if (inp.fire) {
      if (cfg.shell) { if (this.reload <= 0) this.fireCannon(); }
      else if (this.mgCd <= 0) this.fireMG();
    }
    if (inp.mg && this.mgCd <= 0) this.fireMG();
    // Давим врагов
    if (Math.abs(this.speed) > 1.5) {
      const r2 = (cfg.radius + 0.25) ** 2;
      for (const s of g.soldiers) {
        if (s.state === 'dead' || s.vehicle) continue;
        const dx = s.pos.x - p.x, dz = s.pos.z - p.z;
        if (dx * dx + dz * dz > r2 || Math.abs(s.pos.y - p.y) > 2) continue;
        if (s.team !== this.team) g.combat.damage(s, 200, this.driver, 'tank', false, dx, dz, true);
      }
      // Пыль и грязь из-под гусениц и колёс
      if (Math.random() < dt * 6) g.effects.dust(p.x - fx * L * 0.9 * Math.sign(this.speed) + rand(-1, 1), p.y + 0.3, p.z - fz * L * 0.9 * Math.sign(this.speed) + rand(-1, 1));
    }
    this.sync();
    if (this.emitter) { this.emitter.x = p.x; this.emitter.y = p.y + 2.2; this.emitter.z = p.z; }
    if (this.driver && this.driver.isPlayer) g.audio.engine(0.2 + Math.min(1, Math.abs(this.speed) / cfg.speed) * 0.8);
  }
  sync() {
    this.root.position.copy(this.pos);
    this.root.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.turret.rotation.set(0, this.turretYaw - this.yaw, 0);
    this.gunPivot.rotation.set(this.gunPitch, 0, 0);
    this.gun.position.z = this.recoil * 0.35;
  }
  fireCannon() {
    const g = this.game;
    this.reload = this.cfg.reload;
    this.recoil = 1;
    // Отдача качает корпус в сторону, противоположную выстрелу
    const rel = angleDiff(this.yaw, this.turretYaw), kick = 2.2 / this.cfg.mass;
    this.pitchV += Math.cos(rel) * kick; this.rollV -= Math.sin(rel) * kick;
    const m = this.muzzle(_v.clone());
    const d = this.gunDir(_d);
    g.combat.spawnShell(this, m, d);
    g.effects.muzzle(m.x, m.y, m.z, d.x, d.y, d.z, true);
    for (let i = 0; i < 4; i++) g.effects.smokePuff(m.x + d.x * i * 0.6, m.y, m.z + d.z * i * 0.6, 0.8);
    g.effects.flash(m.x, m.y, m.z, 25, 20, 0.15);
    g.audio.shot('cannon', m.x, m.y, m.z, this.driver && this.driver.isPlayer);
    if (this.driver && this.driver.isPlayer) g.shake(0.5);
    if (this.driver) this.driver.spottedUntil = g.time + 4;
  }
  fireMG() {
    const g = this.game, mg = this.cfg.mg;
    this.mgCd = mg.cd;
    const m = this.muzzle(_v.clone());
    m.y -= 0.02;
    const d = this.gunDir(_d.clone());
    const sp = 1.8 * DEG;
    d.x += (Math.random() - 0.5) * sp * 2; d.y += (Math.random() - 0.5) * sp * 2; d.z += (Math.random() - 0.5) * sp * 2;
    d.normalize();
    g.combat.mgShot(this.driver, this, m, d, mg.dmg, 170);
    g.audio.shot('mg', m.x, m.y, m.z, this.driver && this.driver.isPlayer);
  }
  // Пересечение луча с корпусом (без учёта наклона)
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const rx = ox - this.pos.x, rz = oz - this.pos.z, ry = oy - (this.pos.y + this.cfg.hitY);
    const lx = rx * c - rz * s, lz = rx * s + rz * c;
    const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
    const H = this.cfg.hit, O = [lx, ry, lz], D = [ldx, dy, ldz];
    let tmin = 0, tmax = maxT;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(D[a]) < 1e-9) { if (O[a] < -H[a] || O[a] > H[a]) return -1; continue; }
      let t1 = (-H[a] - O[a]) / D[a], t2 = (H[a] - O[a]) / D[a];
      if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
    return tmin;
  }
  damage(amount, attacker) {
    if (!this.alive) return;
    const g = this.game;
    amount = Math.min(amount, this.hp);
    this.hp -= amount;
    if (attacker && attacker.team !== this.team) {
      g.addScore(attacker, Math.round(amount / 10) * 2, null);
      if (attacker.isPlayer) g.hud.hitMarker(false, false, true);
    }
    if (this.driver && this.driver.bot) this.driver.bot.onDamaged(attacker);
    if (this.driver && this.driver.isPlayer) { g.onPlayerHurt(0, attacker, 0, 0); g.shake(0.4); }
    this.setEmitter(this.hp < this.maxHp * 0.25 ? 3 : this.hp < this.maxHp * 0.55 ? 1.2 : 0);
    if (this.hp <= 0) this.destroy(attacker);
  }
  destroy(attacker) {
    const g = this.game, cfg = this.cfg;
    this.alive = false;
    this.hp = 0;
    this.respawnT = cfg.respawn;
    this.mat.color.setHex(0x3a3633);
    g.effects.explosion(this.pos.x, this.pos.y + 1.2, this.pos.z, 1.8);
    g.audio.explosion(this.pos.x, this.pos.y, this.pos.z, 1.6);
    this.setEmitter(2.5);
    const d = this.driver;
    if (d) {
      this.exit();
      g.combat.damage(d, 999, attacker, 'tank', false, 0, 0, true);
      g.combat.finishOff(d, attacker);
    }
    if (attacker && attacker.team !== this.team) {
      g.addScore(attacker, cfg.score, cfg.name + ' уничтожен');
      g.hud.killfeed(attacker, 'at', { name: cfg.name + ' ' + TEAMS[this.team].adj, team: this.team }, false);
    }
    g.combat.explode(this.pos.x, this.pos.y + 1, this.pos.z, 6, 80, attacker, 'tank', 0);
    if (g.player && g.player.team === this.team) g.hud.announce('Наш ' + cfg.name.toLowerCase() + ' уничтожен', false);
  }
}

// ---------- Цеппелин ----------
function airshipGeo(team) {
  const T = TEAMS[team];
  const b = new GeoBuilder();
  b.sphere(1, 0, 0, 0, 0x8e8b82, 8, 7.5, 30, 2, 0.04);
  for (const z of [-14, -4, 6, 16]) b.cyl(7.6 * Math.sqrt(1 - (z / 30) ** 2), 7.6 * Math.sqrt(1 - (z / 30) ** 2), 0.4, 14, 0, 0, z, 0x77746c, Math.PI / 2, 0, 0, 0.02);
  b.box(2.2, 2.0, 12, 0, -8.5, 2, 0x5a5348);
  b.box(0.3, 1.5, 0.3, 0, -7.3, -2, 0x3a3630);
  b.box(0.3, 1.5, 0.3, 0, -7.3, 6, 0x3a3630);
  for (const s of [-1, 1]) {
    b.box(1.0, 1.0, 2.6, s * 4.5, -6.6, 6, 0x4a463e);
  }
  b.box(0.3, 9, 6, 0, 0, 27, 0x6d6a62);
  b.box(13, 0.3, 6, 0, 0, 27, 0x6d6a62);
  b.box(8.3, 0.6, 3, 0, 4.5, -10, T.banner);
  b.box(8.3, 0.6, 3, 0, 4.5, 14, T.banner);
  return b.build();
}

export class Airship {
  constructor(game, team) {
    this.game = game;
    this.team = team;
    this.kind = 'airship';
    this.maxHp = 5200;
    this.hp = this.maxHp;
    this.alive = true;
    this.crashing = false;
    const hq = game.world.def.hq[team];
    this.pos = new THREE.Vector3(hq.x + rand(-40, 40), 95, hq.z + (team === 0 ? 40 : -40));
    this.yaw = hq.yaw;
    this.mesh = new THREE.Mesh(airshipGeo(team), game.gfx.triplanar('cloth', { local: true, scale: 0.25, roughness: 0.9 }));
    this.mesh.castShadow = true;
    game.scene.add(this.mesh);
    this.bombCd = 0;
    this.gunCd = [0, 0, 0];
    this.crashT = 0;
    this.target = null;
    this.sync();
  }
  sync() {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(-this.crashT * 0.05, this.yaw, this.crashT * 0.03, 'YXZ');
  }
  update(dt) {
    const g = this.game, w = g.world;
    if (this.crashing) {
      this.crashT += dt;
      this.pos.y -= dt * (3 + this.crashT * 2.2);
      this.pos.x += -Math.sin(this.yaw) * 4 * dt; this.pos.z += -Math.cos(this.yaw) * 4 * dt;
      for (let i = 0; i < 3; i++) g.effects.fire(this.pos.x + rand(-6, 6), this.pos.y + rand(-3, 5), this.pos.z + rand(-20, 20), 3);
      if (Math.random() < dt * 8) g.effects.smokePuff(this.pos.x + rand(-6, 6), this.pos.y, this.pos.z + rand(-20, 20), 3, true);
      if (this.pos.y < w.height(this.pos.x, this.pos.z) + 4) {
        g.combat.explode(this.pos.x, this.pos.y, this.pos.z, 18, 220, this.killer, 'airship', 600, 2.5, -1);
        for (let i = 0; i < 4; i++) g.effects.explosion(this.pos.x + rand(-10, 10), this.pos.y, this.pos.z + rand(-25, 25), 2.2);
        g.scene.remove(this.mesh);
        this.alive = false;
      }
      this.sync();
      return;
    }
    // Цель — вражеский флаг (или центр)
    let best = null, bd = Infinity;
    for (const f of g.flags) {
      if (f.owner === this.team) continue;
      const d = Math.hypot(f.x - this.pos.x, f.z - this.pos.z) + (f.owner === -1 ? 60 : 0);
      if (d < bd) { bd = d; best = f; }
    }
    const tx = best ? best.x : 0, tz = best ? best.z : 0;
    const dx = tx - this.pos.x, dz = tz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    const want = Math.atan2(-dx, -dz);
    const turn = dist < 35 ? 0.05 : 0.16;
    this.yaw += clamp(angleDiff(this.yaw, want), -turn * dt, turn * dt);
    const sp = 8.5;
    this.pos.x += -Math.sin(this.yaw) * sp * dt;
    this.pos.z += -Math.cos(this.yaw) * sp * dt;
    this.pos.x = clamp(this.pos.x, -PLAY - 20, PLAY + 20); this.pos.z = clamp(this.pos.z, -PLAY - 20, PLAY + 20);
    this.pos.y = lerp(this.pos.y, Math.max(85, w.height(this.pos.x, this.pos.z) + 75), dt * 0.3);
    // Бомбы над целью
    this.bombCd -= dt;
    if (best && dist < 26 && this.bombCd <= 0) {
      this.bombCd = 0.55;
      g.combat.spawnBomb(this, this.pos.x + rand(-4, 4), this.pos.y - 9, this.pos.z + rand(-8, 8));
    }
    // Бортовые пулемёты
    const guns = [[0, -9.5, 8], [4.5, -6.6, 6], [-4.5, -6.6, 6]];
    for (let i = 0; i < 3; i++) {
      this.gunCd[i] -= dt;
      if (this.gunCd[i] > 0) continue;
      this.gunCd[i] = 0.14;
      const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
      const [lx, ly, lz] = guns[i];
      const gx = this.pos.x + lx * c + lz * s, gy = this.pos.y + ly, gz = this.pos.z - lx * s + lz * c;
      let tgt = null, td = 115;
      for (const so of g.soldiers) {
        if (so.team === this.team || so.state !== 'alive' || so.vehicle) continue;
        const d = Math.hypot(so.pos.x - gx, so.pos.y - gy, so.pos.z - gz);
        if (d < td) { td = d; tgt = so; }
      }
      if (!tgt) { this.gunCd[i] = 0.6; continue; }
      if (!w.los(gx, gy, gz, tgt.pos.x, tgt.pos.y + 1.2, tgt.pos.z)) { this.gunCd[i] = 0.5; continue; }
      _d.set(tgt.pos.x - gx, tgt.pos.y + 1.1 - gy, tgt.pos.z - gz).normalize();
      const sp2 = 3.2 * DEG;
      _d.x += rand(-sp2, sp2); _d.y += rand(-sp2, sp2); _d.z += rand(-sp2, sp2);
      _d.normalize();
      g.combat.mgShot(null, this, _v.set(gx, gy, gz), _d, 13, 160);
      g.audio.shot('aa', gx, gy, gz, false);
    }
    this.sync();
  }
  rayHit(ox, oy, oz, dx, dy, dz, maxT) {
    // Эллипсоид 8 × 7.5 × 30 вдоль курса
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const rx = ox - this.pos.x, ry = oy - this.pos.y, rz = oz - this.pos.z;
    const lx = (rx * c - rz * s) / 8, ly = ry / 7.5, lz = (rx * s + rz * c) / 30;
    let ldx = (dx * c - dz * s) / 8, ldy = dy / 7.5, ldz = (dx * s + dz * c) / 30;
    const L = Math.hypot(ldx, ldy, ldz);
    ldx /= L; ldy /= L; ldz /= L;
    const t = raySphere(lx, ly, lz, ldx, ldy, ldz, 0, 0, 0, 1);
    if (t < 0) return -1;
    const tw = t / L;
    return tw <= maxT ? tw : -1;
  }
  damage(amount, attacker) {
    if (this.crashing) return;
    const g = this.game;
    amount = Math.min(amount, this.hp);
    this.hp -= amount;
    if (attacker && attacker.isPlayer) g.hud.hitMarker(false, false, true);
    if (attacker && attacker.team !== this.team) g.addScore(attacker, Math.max(1, Math.round(amount / 25)), null);
    if (this.hp <= 0) {
      this.crashing = true;
      this.killer = attacker;
      if (attacker && attacker.team !== this.team) g.addScore(attacker, 800, 'Цеппелин сбит');
      g.hud.announce(this.team === g.player.team ? 'Наш цеппелин сбит!' : 'Вражеский цеппелин сбит!', this.team !== g.player.team);
      g.audio.explosion(this.pos.x, this.pos.y, this.pos.z, 2);
      g.effects.airburst(this.pos.x, this.pos.y, this.pos.z);
    }
  }
}

// ---------- Бипланы для атмосферы ----------
export class Biplane {
  constructor(game, team, phase) {
    this.game = game;
    const T = TEAMS[team];
    const b = new GeoBuilder();
    b.box(0.9, 0.9, 5.5, 0, 0, 0, T.tank);
    b.box(9, 0.12, 1.4, 0, 0.9, -0.6, 0xb7ab8a);
    b.box(8.4, 0.12, 1.3, 0, -0.35, -0.5, 0xb7ab8a);
    for (const s of [-3.4, 3.4]) b.box(0.08, 1.25, 0.08, s, 0.28, -0.5, 0x3a3630);
    b.box(3, 0.1, 0.9, 0, 0.2, 2.5, 0xb7ab8a);
    b.box(0.1, 1.1, 0.9, 0, 0.7, 2.6, T.banner);
    b.cyl(0.35, 0.35, 0.3, 8, 0, 0, -2.9, 0x3a3630, Math.PI / 2);
    this.mesh = new THREE.Mesh(b.build(), game.gfx.triplanar('wood', { local: true, scale: 1, roughness: 0.8, key: 'plane' }));
    const pb = new GeoBuilder();
    pb.box(0.15, 2.6, 0.06, 0, 0, 0, 0x4a3826);
    this.prop = new THREE.Mesh(pb.build(), this.mesh.material);
    this.prop.position.z = -3.1;
    this.mesh.add(this.prop);
    game.scene.add(this.mesh);
    this.t = phase;
    this.r = rand(70, 110);
    this.cx = rand(-30, 30); this.cz = rand(-30, 30);
    this.h = rand(70, 105);
    this.speed = 0.17 * (team ? -1 : 1);
  }
  update(dt) {
    this.t += dt * this.speed;
    const x = this.cx + Math.cos(this.t) * this.r, z = this.cz + Math.sin(this.t * 2) * this.r * 0.5;
    const nx = this.cx + Math.cos(this.t + 0.01 * Math.sign(this.speed)) * this.r, nz = this.cz + Math.sin((this.t + 0.01 * Math.sign(this.speed)) * 2) * this.r * 0.5;
    const yaw = Math.atan2(-(nx - x), -(nz - z));
    const bank = clamp(angleDiff(this.lastYaw ?? yaw, yaw) * 60, -0.8, 0.8);
    this.lastYaw = yaw;
    this.mesh.position.set(x, this.h + Math.sin(this.t * 3) * 6, z);
    this.mesh.rotation.set(0, yaw, -bank, 'YXZ');
    this.prop.rotation.z += dt * 40;
  }
}
