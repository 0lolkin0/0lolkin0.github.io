// Карты: рельеф, флаги, постройки, окопы и проволока. Команда 0 — на юге (+Z), команда 1 — на севере (−Z)
const P = Math.PI;

export const THEMES = {
  autumn: {
    skyTop: 0x6f8296, skyHorizon: 0xc2baa8, fog: 0xaba493, fogNear: 35, fogFar: 270,
    cloudLight: 0xd9d3c6, cloudDark: 0x76746f, cloudCover: 0.42,
    sun: 0xfff0d2, sunIntensity: 1.9, sunDir: [-0.45, 0.7, -0.35], hemiSky: 0xc6c9cb, hemiGround: 0x5b4a37, hemiIntensity: 1.25,
    grass: 0x67753f, grass2: 0x7d8248, mud: 0x5f4b37, mud2: 0x4d3c2c, dark: 0x352a20, road: 0x7d6a52,
    stone: 0x9a9284, brick: 0x8c6a55, roof: 0x6e3f30, wood: 0x6b5238, woodDark: 0x4a3826, canvas: 0x8f8668,
    leaves: [0x6f7a3a, 0x8d8a3e, 0x9a7a35], water: 0x3d4a4c, weather: 'rain',
  },
  winter: {
    skyTop: 0x8aa0b8, skyHorizon: 0xdde3e9, fog: 0xd2d9e0, fogNear: 30, fogFar: 240,
    cloudLight: 0xf2f4f6, cloudDark: 0x9ba2ab, cloudCover: 0.36,
    sun: 0xfff6ea, sunIntensity: 1.7, sunDir: [0.4, 0.62, -0.5], hemiSky: 0xdfe8f0, hemiGround: 0x8d8a88, hemiIntensity: 1.35,
    grass: 0xe6ecf1, grass2: 0xd5dde5, mud: 0xb4b3ae, mud2: 0x8e877f, dark: 0x6a6058, road: 0xa79f95,
    stone: 0x8c8a86, brick: 0x7d6b60, roof: 0xdfe5ea, wood: 0x6a5137, woodDark: 0x4a3826, canvas: 0xb8b29c,
    leaves: [0x2f4a35, 0x3a5640, 0x29402f], water: 0x7c8c96, weather: 'snow',
  },
  // Рассвет в лесу: низкое тёплое солнце, длинные тени, туман между стволами, листопад
  forest: {
    skyTop: 0x7f9bb8, skyHorizon: 0xf0d9b0, fog: 0xd9c9a4, fogNear: 22, fogFar: 215,
    cloudLight: 0xfff0d8, cloudDark: 0xa39a8e, cloudCover: 0.5,
    sun: 0xffd9a0, sunIntensity: 2.4, sunDir: [-0.62, 0.36, -0.42], hemiSky: 0xc9d4d6, hemiGround: 0x4a4a32, hemiIntensity: 1.15,
    grass: 0x55702f, grass2: 0x6f8238, mud: 0x54432f, mud2: 0x45372a, dark: 0x2e2a1e, road: 0x77664c,
    stone: 0x8f8a7c, brick: 0x8a6650, roof: 0x5a4332, wood: 0x6b5238, woodDark: 0x4a3826, canvas: 0x8f8668,
    leaves: [0x4f7a32, 0x64883a, 0x7d8f3a, 0xa08a34], water: 0x3f4d48, weather: 'leaves', wind: 0.8, fogDensity: 0.0075,
  },
};

// Зигзаг окопа поперёк карты
function zigzag(z, x0, x1, step, amp, phase = 0) {
  const pts = [];
  let k = phase;
  for (let x = x0; x <= x1 + 0.01; x += step) {
    pts.push([x, z + (k % 2 ? amp : -amp)]);
    k++;
  }
  return pts;
}
function wireLine(z, ranges) {
  return ranges.map(([a, b]) => ({ pts: [[a, z], [b, z]] }));
}

export const MAPS = {
  field: {
    id: 'field', name: 'Изрытое поле', theme: 'autumn',
    desc: 'Изрытая воронками долина между двумя линиями окопов. В центре — разрушенная деревня с церковью.',
    noiseAmp: 3.2,
    hills: [
      { x: 0, z: 0, r: 42, h: 3.2 }, { x: 78, z: 30, r: 26, h: 3.6 }, { x: -78, z: -30, r: 26, h: 3.6 },
      { x: -110, z: 40, r: 30, h: 5 }, { x: 110, z: -40, r: 30, h: 5 }, { x: 40, z: -110, r: 30, h: 3 }, { x: -40, z: 110, r: 30, h: 3 },
    ],
    hq: [{ x: 0, z: 124, yaw: 0 }, { x: 0, z: -124, yaw: P }],
    tankSpawn: [{ x: 20, z: 118, yaw: 0 }, { x: -20, z: -118, yaw: P }],
    flags: [
      { id: 'A', name: 'Ферма', x: -62, z: 74, r: 14 },
      { id: 'B', name: 'Батарея', x: 60, z: 38, r: 15 },
      { id: 'C', name: 'Деревня', x: 0, z: 0, r: 17 },
      { id: 'D', name: 'Окопы', x: -60, z: -38, r: 15 },
      { id: 'E', name: 'Мельница', x: 62, z: -74, r: 14 },
    ],
    roads: [
      [[4, 140], [8, 100], [10, 78], [3, 40], [0, 0], [-5, -40], [-2, -80], [-6, -100], [-4, -140]],
      [[10, 78], [-25, 76], [-62, 74]],
      [[-2, -80], [30, -77], [62, -74]],
      [[0, 0], [30, 18], [60, 38]],
      [[0, 0], [-30, -20], [-60, -38]],
    ],
    trenches: [
      { pts: zigzag(102, -138, 138, 13, 3), side: -1 },
      { pts: zigzag(-102, -138, 138, 13, 3, 1), side: 1 },
      { pts: [[-30, 104], [-28, 116], [-12, 122]], side: 0 },
      { pts: [[34, 101], [30, 112], [14, 122]], side: 0 },
      { pts: [[30, -101], [28, -116], [12, -122]], side: 0 },
      { pts: [[-34, -103], [-30, -112], [-14, -122]], side: 0 },
      // Сеть окопов у флага D
      { pts: [[-84, -30], [-72, -27], [-60, -30], [-48, -26], [-36, -32]], side: 1 },
      { pts: [[-76, -52], [-64, -48], [-52, -52], [-42, -47]], side: -1 },
      { pts: [[-60, -30], [-61, -40], [-64, -48]], side: 0 },
      // Полукольцо у батареи B
      { pts: [[44, 50], [54, 54], [66, 52], [76, 46]], side: -1 },
      { pts: [[42, 26], [54, 22], [68, 25]], side: 1 },
    ],
    wires: [
      ...wireLine(91, [[-136, -95], [-80, -40], [-25, 18], [32, 75], [92, 136]]),
      ...wireLine(-91, [[-136, -92], [-76, -34], [-18, 26], [40, 82], [96, 136]]),
      { pts: [[-86, -20], [-70, -16], [-52, -18]] },
      { pts: [[-78, -62], [-60, -60], [-42, -60]] },
      { pts: [[38, 62], [58, 66], [80, 58]] },
      { pts: [[16, 30], [26, 40]] }, { pts: [[-16, -30], [-26, -40]] },
    ],
    structures: [
      // A — ферма
      { t: 'house', x: -68, z: 80, yaw: 0.25, w: 9, d: 7, h: 4.6, ruin: 0.35, mat: 'stone', roof: true },
      { t: 'barn', x: -52, z: 70, yaw: 0.2, w: 8, d: 12, h: 5.2 },
      { t: 'hay', x: -72, z: 64 }, { t: 'hay', x: -75, z: 68 }, { t: 'hay', x: -46, z: 84 },
      { t: 'cart', x: -60, z: 86, yaw: 1.2 },
      { t: 'well', x: -61, z: 75 },
      { t: 'fence', pts: [[-80, 60], [-80, 90], [-56, 92]] },
      { t: 'wall', x: -48, z: 60, yaw: 0.1, len: 12, h: 1.2 },
      { t: 'sandbags', x: -64, z: 62, yaw: 0, len: 6 }, { t: 'sandbags', x: -56, z: 88, yaw: 0.3, len: 5 },
      { t: 'crates', x: -70, z: 72 },
      // B — батарея
      { t: 'gun', x: 52, z: 36, yaw: -0.2 }, { t: 'gun', x: 64, z: 34, yaw: 0.1 }, { t: 'gun', x: 72, z: 42, yaw: 0.35 },
      { t: 'ring', x: 52, z: 36, r: 3.6 }, { t: 'ring', x: 64, z: 34, r: 3.6 }, { t: 'ring', x: 72, z: 42, r: 3.6 },
      { t: 'bunker', x: 58, z: 46, yaw: P, w: 6, d: 5 },
      { t: 'crates', x: 46, z: 42 }, { t: 'crates', x: 70, z: 30 }, { t: 'shells', x: 60, z: 30 },
      { t: 'house', x: 40, z: 30, yaw: -0.3, w: 6, d: 6, h: 3.8, ruin: 0.7, mat: 'brick' },
      // C — деревня
      { t: 'church', x: 0, z: -6, yaw: 0.05 },
      { t: 'house', x: -19, z: 10, yaw: 0.1, w: 8, d: 7, h: 5, ruin: 0.5, mat: 'stone', roof: true },
      { t: 'house', x: 19, z: 12, yaw: -0.15, w: 7, d: 9, h: 4.6, ruin: 0.6, mat: 'brick' },
      { t: 'house', x: -18, z: -20, yaw: 0.05, w: 7, d: 7, h: 4.4, ruin: 0.55, mat: 'brick' },
      { t: 'house', x: 20, z: -18, yaw: 0.2, w: 8, d: 6, h: 4.8, ruin: 0.45, mat: 'stone', roof: true },
      { t: 'house', x: -4, z: 22, yaw: -0.05, w: 6, d: 6, h: 4.2, ruin: 0.8, mat: 'stone' },
      { t: 'wall', x: -10, z: 16, yaw: 0, len: 7, h: 1.3 }, { t: 'wall', x: 11, z: -28, yaw: 0.2, len: 8, h: 1.3 },
      { t: 'wall', x: 30, z: 0, yaw: P / 2, len: 10, h: 1.1 }, { t: 'wall', x: -30, z: -2, yaw: P / 2, len: 9, h: 1.1 },
      { t: 'cart', x: 9, z: 18, yaw: 0.4 }, { t: 'crates', x: -9, z: -26 }, { t: 'well', x: 10, z: 4 },
      { t: 'sandbags', x: -6, z: 8, yaw: 0, len: 5 }, { t: 'sandbags', x: 7, z: -20, yaw: 0, len: 5 },
      // D — окопы
      { t: 'bunker', x: -58, z: -40, yaw: 0, w: 7, d: 5 },
      { t: 'sandbags', x: -70, z: -38, yaw: 0.1, len: 6 }, { t: 'sandbags', x: -48, z: -40, yaw: -0.2, len: 6 },
      { t: 'crates', x: -66, z: -44 }, { t: 'gun', x: -44, z: -44, yaw: P + 0.3 },
      { t: 'house', x: -78, z: -44, yaw: 0.4, w: 6, d: 6, h: 3.6, ruin: 0.85, mat: 'brick' },
      // E — мельница
      { t: 'windmill', x: 66, z: -80 },
      { t: 'house', x: 52, z: -72, yaw: -0.2, w: 8, d: 7, h: 4.6, ruin: 0.35, mat: 'stone', roof: true },
      { t: 'barn', x: 74, z: -66, yaw: -0.15, w: 7, d: 10, h: 4.8 },
      { t: 'hay', x: 56, z: -86 }, { t: 'hay', x: 60, z: -90 }, { t: 'cart', x: 64, z: -68, yaw: -1 },
      { t: 'fence', pts: [[44, -92], [76, -94], [82, -78]] },
      { t: 'sandbags', x: 62, z: -62, yaw: 0, len: 6 }, { t: 'crates', x: 70, z: -76 },
      // Нейтральная полоса
      { t: 'gun', x: -24, z: 50, yaw: 0.8, wreck: true }, { t: 'gun', x: 26, z: -46, yaw: 2.3, wreck: true },
      { t: 'house', x: -100, z: 6, yaw: 0.6, w: 6, d: 6, h: 3.4, ruin: 0.9, mat: 'brick' },
      { t: 'house', x: 100, z: -4, yaw: -0.4, w: 6, d: 6, h: 3.4, ruin: 0.9, mat: 'stone' },
      { t: 'sandbags', x: -30, z: 40, yaw: 0.4, len: 5 }, { t: 'sandbags', x: 32, z: -38, yaw: -0.3, len: 5 },
      { t: 'sandbags', x: 92, z: 70, yaw: 0, len: 6 }, { t: 'sandbags', x: -92, z: -70, yaw: 0, len: 6 },
      { t: 'tankwreck', x: 30, z: 60, yaw: 2.2 }, { t: 'tankwreck', x: -32, z: -62, yaw: -0.6 },
    ],
    craters: { count: 190, zMin: -96, zMax: 96 },
    trees: [
      { type: 'dead', count: 55, zMin: -95, zMax: 95 },
      { type: 'poplar', count: 55, zMin: 104, zMax: 141 },
      { type: 'poplar', count: 55, zMin: -141, zMax: -104 },
      { type: 'birch', count: 26, zMin: 100, zMax: 141 }, { type: 'birch', count: 26, zMin: -141, zMax: -100 },
      { type: 'oak', count: 34, xMin: 118, xMax: 141, zMin: -141, zMax: 141 },
      { type: 'oak', count: 34, xMin: -141, xMax: -118, zMin: -141, zMax: 141 },
      { type: 'willow', count: 6, xMin: -100, xMax: -40, zMin: 55, zMax: 100 }, { type: 'willow', count: 6, xMin: 40, xMax: 100, zMin: -100, zMax: -55 },
      { type: 'bush', count: 60, zMin: 60, zMax: 141 }, { type: 'bush', count: 60, zMin: -141, zMax: -60 }, { type: 'bush', count: 26, zMin: -60, zMax: 60 },
      { type: 'sapling', count: 22, zMin: 96, zMax: 141 }, { type: 'sapling', count: 22, zMin: -141, zMax: -96 },
    ],
    stumps: 26, fallen: 10,
    puddles: 0.35,
  },

  winter: {
    id: 'winter', name: 'Зимний перевал', theme: 'winter',
    desc: 'Заснеженный перевал в горах: лесопилка, старая каменная крепость на холме и хутор в ельнике.',
    noiseAmp: 4.5,
    hills: [
      { x: 0, z: 0, r: 38, h: 7 }, { x: -145, z: 0, r: 60, h: 22 }, { x: 145, z: 0, r: 60, h: 22 },
      { x: -120, z: 90, r: 35, h: 12 }, { x: 120, z: -90, r: 35, h: 12 }, { x: 120, z: 95, r: 30, h: 9 }, { x: -120, z: -95, r: 30, h: 9 },
      { x: 60, z: 50, r: 22, h: 3 }, { x: -60, z: -50, r: 22, h: 3 },
    ],
    hq: [{ x: 0, z: 124, yaw: 0 }, { x: 0, z: -124, yaw: P }],
    tankSpawn: [{ x: -18, z: 116, yaw: 0 }, { x: 18, z: -116, yaw: P }],
    flags: [
      { id: 'A', name: 'Лесопилка', x: -56, z: 72, r: 14 },
      { id: 'B', name: 'Блокгауз', x: 58, z: 50, r: 14 },
      { id: 'C', name: 'Крепость', x: 0, z: 0, r: 16 },
      { id: 'D', name: 'Хутор', x: -58, z: -50, r: 15 },
      { id: 'E', name: 'Часовня', x: 56, z: -72, r: 14 },
    ],
    roads: [
      [[-2, 140], [6, 96], [2, 50], [0, 18], [0, -18], [-3, -50], [-6, -96], [2, -140]],
      [[6, 96], [-24, 82], [-56, 72]],
      [[-6, -96], [24, -82], [56, -72]],
      [[2, 50], [30, 52], [58, 50]],
      [[-3, -50], [-30, -52], [-58, -50]],
    ],
    trenches: [
      { pts: zigzag(100, -110, 110, 14, 2.5), side: -1 },
      { pts: zigzag(-100, -110, 110, 14, 2.5, 1), side: 1 },
      { pts: [[30, 30], [20, 36], [-12, 34], [-28, 26]], side: -1 },
      { pts: [[-30, -30], [-20, -36], [12, -34], [28, -26]], side: 1 },
    ],
    wires: [
      ...wireLine(88, [[-110, -60], [-40, 10], [30, 80]]),
      ...wireLine(-88, [[-90, -30], [-10, 40], [60, 110]]),
      { pts: [[34, 22], [44, 30]] }, { pts: [[-34, -22], [-44, -30]] },
    ],
    structures: [
      // A — лесопилка
      { t: 'cabin', x: -60, z: 78, yaw: 0.2, w: 9, d: 6, h: 4 },
      { t: 'shed', x: -46, z: 66, yaw: 0.2, w: 10, d: 6, h: 4 },
      { t: 'logs', x: -66, z: 64, yaw: 0.3 }, { t: 'logs', x: -50, z: 80, yaw: 1.5 }, { t: 'logs', x: -42, z: 74, yaw: 0.1 },
      { t: 'crates', x: -58, z: 70 }, { t: 'sandbags', x: -54, z: 60, yaw: 0, len: 6 },
      // B — блокгауз
      { t: 'blockhouse', x: 58, z: 50, yaw: -0.2 },
      { t: 'sandbags', x: 46, z: 42, yaw: 0.5, len: 5 }, { t: 'sandbags', x: 70, z: 40, yaw: -0.5, len: 5 },
      { t: 'logs', x: 68, z: 60, yaw: 0.8 }, { t: 'crates', x: 50, z: 58 },
      // C — крепость
      { t: 'fort', x: 0, z: 0, yaw: 0 },
      // D — хутор
      { t: 'cabin', x: -62, z: -54, yaw: -0.1, w: 8, d: 6, h: 4 },
      { t: 'cabin', x: -48, z: -42, yaw: 0.3, w: 6, d: 5, h: 3.6 },
      { t: 'barn', x: -70, z: -40, yaw: 0.1, w: 7, d: 9, h: 4.6 },
      { t: 'fence', pts: [[-80, -64], [-44, -66], [-40, -56]] }, { t: 'cart', x: -56, z: -44, yaw: 0.7 },
      { t: 'well', x: -58, z: -48 }, { t: 'sandbags', x: -52, z: -34, yaw: 0, len: 5 },
      // E — часовня
      { t: 'chapel', x: 58, z: -74, yaw: -0.15 },
      { t: 'wall', x: 46, z: -64, yaw: -0.2, len: 10, h: 1.3 }, { t: 'wall', x: 68, z: -86, yaw: 0.4, len: 9, h: 1.3 },
      { t: 'crates', x: 48, z: -80 }, { t: 'sandbags', x: 60, z: -60, yaw: 0, len: 6 },
      // Разное
      { t: 'gun', x: -22, z: 52, yaw: 0.6, wreck: true }, { t: 'gun', x: 24, z: -52, yaw: 2.6, wreck: true },
      { t: 'tankwreck', x: 34, z: 70, yaw: 1.4 }, { t: 'tankwreck', x: -36, z: -70, yaw: -1.2 },
      { t: 'cabin', x: -96, z: 20, yaw: 1.1, w: 6, d: 5, h: 3.6 }, { t: 'cabin', x: 96, z: -20, yaw: -1.4, w: 6, d: 5, h: 3.6 },
    ],
    craters: { count: 90, zMin: -92, zMax: 92 },
    trees: [
      { type: 'pine', count: 95, xMin: -141, xMax: -78, zMin: -141, zMax: 141 }, { type: 'spruce', count: 70, xMin: -141, xMax: -78, zMin: -141, zMax: 141 },
      { type: 'pine', count: 95, xMin: 78, xMax: 141, zMin: -141, zMax: 141 }, { type: 'spruce', count: 70, xMin: 78, xMax: 141, zMin: -141, zMax: 141 },
      { type: 'pine', count: 65, xMin: -78, xMax: 78, zMin: -141, zMax: 141 }, { type: 'spruce', count: 50, xMin: -78, xMax: 78, zMin: -141, zMax: 141 },
      { type: 'deadpine', count: 30, zMin: -90, zMax: 90 },
    ],
    rocks: 55, stumps: 34, fallen: 14,
    puddles: 0,
  },

  forest: {
    id: 'forest', name: 'Туманный лес', theme: 'forest',
    desc: 'Рассвет в старом лесу: охотничий дом, лагерь, вышка на перекрёстке и укреплённая высота в центре.',
    noiseAmp: 3.6, mud: 0.35,
    hills: [
      { x: 0, z: 0, r: 34, h: 6.5 }, { x: -90, z: 20, r: 40, h: 6 }, { x: 90, z: -20, r: 40, h: 6 },
      { x: 70, z: 90, r: 30, h: 4 }, { x: -70, z: -90, r: 30, h: 4 }, { x: -120, z: 100, r: 30, h: 7 }, { x: 120, z: -100, r: 30, h: 7 },
    ],
    hq: [{ x: 0, z: 124, yaw: 0 }, { x: 0, z: -124, yaw: P }],
    tankSpawn: [{ x: 18, z: 118, yaw: 0 }, { x: -18, z: -118, yaw: P }],
    flags: [
      { id: 'A', name: 'Охотничий дом', x: -58, z: 68, r: 14 },
      { id: 'B', name: 'Вышка', x: 60, z: 42, r: 14 },
      { id: 'C', name: 'Высота', x: 0, z: 0, r: 16 },
      { id: 'D', name: 'Лагерь', x: -60, z: -42, r: 14 },
      { id: 'E', name: 'Хутор', x: 58, z: -68, r: 14 },
    ],
    roads: [
      [[2, 140], [6, 104], [-8, 70], [-4, 36], [0, 0], [4, -36], [8, -70], [-6, -104], [-2, -140]],
      [[-8, 70], [-30, 72], [-58, 68]],
      [[8, -70], [30, -72], [58, -68]],
      [[-4, 36], [26, 44], [60, 42]],
      [[4, -36], [-26, -44], [-60, -42]],
    ],
    trenches: [
      { pts: zigzag(104, -90, 90, 13, 2.5), side: -1 },
      { pts: zigzag(-104, -90, 90, 13, 2.5, 1), side: 1 },
      // Кольцо окопов вокруг высоты
      { pts: [[-16, 10], [-8, 17], [6, 18], [16, 10]], side: -1 },
      { pts: [[16, -10], [8, -17], [-6, -18], [-16, -10]], side: 1 },
      { pts: [[-16, 10], [-19, 0], [-16, -10]], side: 0 },
    ],
    wires: [
      ...wireLine(92, [[-88, -40], [-10, 44]]),
      ...wireLine(-92, [[-44, 10], [40, 88]]),
      { pts: [[-24, 22], [-10, 28]] }, { pts: [[24, -22], [10, -28]] },
    ],
    structures: [
      // A — охотничий дом
      { t: 'cabin', x: -62, z: 72, yaw: 0.15, w: 10, d: 7, h: 4.2 },
      { t: 'shed', x: -48, z: 62, yaw: 0.15, w: 7, d: 5, h: 3.2 },
      { t: 'logs', x: -70, z: 60, yaw: 0.4 }, { t: 'well', x: -54, z: 76 }, { t: 'cart', x: -66, z: 82, yaw: 1.0 },
      { t: 'fence', pts: [[-78, 58], [-78, 86], [-50, 88]] }, { t: 'crates', x: -56, z: 64 },
      { t: 'sandbags', x: -50, z: 74, yaw: 1.3, len: 5 },
      // B — вышка на перекрёстке
      { t: 'tower', x: 60, z: 42, yaw: 0.2 },
      { t: 'sandbags', x: 52, z: 36, yaw: 0.4, len: 6 }, { t: 'sandbags', x: 68, z: 48, yaw: -0.3, len: 6 },
      { t: 'tent', x: 67, z: 33, yaw: 0.3 }, { t: 'crates', x: 54, z: 49 }, { t: 'logs', x: 73, z: 41, yaw: 1.2 },
      // C — высота
      { t: 'bunker', x: 0, z: 0, yaw: 0, w: 7, d: 5 },
      { t: 'sandbags', x: -8, z: 7, yaw: 0.6, len: 5 }, { t: 'sandbags', x: 8, z: -7, yaw: 0.6, len: 5 },
      { t: 'gun', x: 10, z: 8, yaw: 0.4 }, { t: 'gun', x: -10, z: -8, yaw: P + 0.4 }, { t: 'shells', x: 6, z: 11 }, { t: 'shells', x: -6, z: -11 },
      { t: 'crates', x: -11, z: -2 },
      // D — лагерь
      { t: 'tent', x: -65, z: -37, yaw: 0.2 }, { t: 'tent', x: -58, z: -49, yaw: -0.4 }, { t: 'tent', x: -52, z: -37, yaw: 1.2 }, { t: 'tent', x: -69, z: -48, yaw: 0.9 },
      { t: 'crates', x: -60, z: -42 }, { t: 'cart', x: -49, z: -47, yaw: 0.3 }, { t: 'logs', x: -72, z: -33, yaw: 0.2 },
      { t: 'sandbags', x: -56, z: -31, yaw: 0, len: 6 },
      // E — хутор
      { t: 'cabin', x: 62, z: -72, yaw: -0.1, w: 8, d: 6, h: 4 }, { t: 'barn', x: 50, z: -61, yaw: 0.1, w: 7, d: 10, h: 4.8 },
      { t: 'hay', x: 69, z: -61 }, { t: 'hay', x: 72, z: -65 }, { t: 'well', x: 56, z: -76 },
      { t: 'fence', pts: [[44, -84], [74, -86], [80, -60]] }, { t: 'sandbags', x: 58, z: -57, yaw: 0, len: 5 },
      // Лес
      { t: 'tankwreck', x: 30, z: 66, yaw: 2.0 }, { t: 'tankwreck', x: -30, z: -66, yaw: -1.0 },
      { t: 'cabin', x: 100, z: 10, yaw: 0.8, w: 6, d: 5, h: 3.6 }, { t: 'cabin', x: -100, z: -10, yaw: -0.8, w: 6, d: 5, h: 3.6 },
      { t: 'logs', x: 27, z: 20, yaw: 0.9 }, { t: 'logs', x: -27, z: -20, yaw: 0.9 },
    ],
    craters: { count: 40, zMin: -60, zMax: 60 },
    trees: [
      { type: 'pine', count: 150 }, { type: 'spruce', count: 130 }, { type: 'birch', count: 150 }, { type: 'oak', count: 60 },
      { type: 'willow', count: 10 }, { type: 'sapling', count: 110 }, { type: 'bush', count: 220 }, { type: 'dead', count: 14, zMin: -40, zMax: 40 },
    ],
    rocks: 24, stumps: 60, fallen: 26,
    puddles: 0.2,
  },
};
export const MAP_LIST = Object.values(MAPS);
