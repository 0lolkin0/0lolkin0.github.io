// Баланс и справочники: стороны, классы, оружие, сложность, звания
export const TEAMS = [
  {
    id: 0, name: 'Антанта', adj: 'Антанты',
    uniform: 0x7e7552, uniformDark: 0x5f5838, puttee: 0x6d6646, helmet: 'brodie', helmetColor: 0x5c5a3b,
    tank: 0x6f6a47, tankDark: 0x4b4831, banner: 0x3f6fb5, sidearm: 'revolver',
  },
  {
    id: 1, name: 'Центральные державы', adj: 'Центральных держав',
    uniform: 0x666b5e, uniformDark: 0x4a4f45, puttee: 0x50554a, helmet: 'stahl', helmetColor: 0x585f58,
    tank: 0x5f6658, tankDark: 0x3f453b, banner: 0xa33b31, sidearm: 'pistol',
  },
];

// Разброс — в градусах (половина угла конуса). Урон: [вблизи, вдали], спад между fall[0] и fall[1] метров
export const WEAPONS = {
  smg: {
    id: 'smg', name: 'Пистолет-пулемёт обр. 1918', short: 'ПП-18', auto: true, rpm: 560,
    dmg: [24, 14], fall: [10, 38], range: 220, mag: 32, reserve: 160, reload: 2.3,
    hip: 2.4, ads: 0.9, moveAdd: 1.3, bloom: 0.22, bloomMax: 2.0, recover: 7,
    recoil: 0.5, recoilYaw: 0.32, head: 1.6, ironZoom: 1.45, sights: ['iron', 'opt2'], adsTime: 0.16, speedMul: 1.0, snd: 'smg', tracerEvery: 2,
  },
  semi: {
    id: 'semi', name: 'Самозарядная винтовка обр. 1916', short: 'СВ-16', auto: false, rpm: 270,
    dmg: [46, 34], fall: [25, 75], range: 320, mag: 10, reserve: 70, reload: 2.7,
    hip: 2.8, ads: 0.25, moveAdd: 1.5, bloom: 0.55, bloomMax: 2.4, recover: 5,
    recoil: 1.2, recoilYaw: 0.35, head: 1.85, ironZoom: 1.8, sights: ['iron', 'opt3'], adsTime: 0.24, speedMul: 1.0, snd: 'rifle', tracerEvery: 1,
  },
  lmg: {
    id: 'lmg', name: 'Ручной пулемёт обр. 1915', short: 'РП-15', auto: true, rpm: 480,
    dmg: [27, 20], fall: [20, 60], range: 320, mag: 47, reserve: 188, reload: 4.0,
    hip: 3.6, ads: 1.0, moveAdd: 1.9, bloom: 0.1, bloomMax: 1.4, recover: 3,
    recoil: 0.45, recoilYaw: 0.42, head: 1.6, ironZoom: 1.55, sights: ['iron', 'opt2'], adsTime: 0.3, speedMul: 0.92, snd: 'lmg', tracerEvery: 2,
  },
  bolt: {
    id: 'bolt', name: 'Снайперская винтовка обр. 1898', short: 'СН-98', auto: false, rpm: 50,
    dmg: [80, 75], fall: [80, 160], sweet: [45, 85], range: 520, mag: 5, reserve: 35, reload: 3.2,
    hip: 6.5, ads: 0.0, moveAdd: 2.6, bloom: 0, bloomMax: 0, recover: 10,
    recoil: 4.0, recoilYaw: 0.6, head: 2.2, ironZoom: 2.0, sights: ['sc6', 'sc10', 'iron'], adsTime: 0.34, speedMul: 1.0, snd: 'sniper', tracerEvery: 1,
  },
  // Личное оружие: у Антанты револьвер, у Центральных держав самозарядный пистолет
  revolver: {
    id: 'revolver', name: 'Револьвер', short: 'Револьвер', auto: false, rpm: 170, side: true,
    dmg: [44, 26], fall: [10, 32], range: 140, mag: 6, reserve: 36, reload: 2.6,
    hip: 1.5, ads: 0.45, moveAdd: 0.9, bloom: 0.6, bloomMax: 2.2, recover: 6,
    recoil: 2.0, recoilYaw: 0.5, head: 2.0, ironZoom: 1.3, sights: ['iron'], adsTime: 0.13, speedMul: 1.05, snd: 'pistol', tracerEvery: 1,
  },
  pistol: {
    id: 'pistol', name: 'Самозарядный пистолет', short: 'Пистолет', auto: false, rpm: 320, side: true,
    dmg: [31, 19], fall: [10, 30], range: 130, mag: 8, reserve: 48, reload: 1.8,
    hip: 1.6, ads: 0.55, moveAdd: 0.9, bloom: 0.45, bloomMax: 2.2, recover: 7,
    recoil: 1.3, recoilYaw: 0.4, head: 2.0, ironZoom: 1.3, sights: ['iron'], adsTime: 0.12, speedMul: 1.05, snd: 'pistol', tracerEvery: 1,
  },
};

// Прицелы. zoom — кратность; у открытого прицела кратность берётся из оружия (ironZoom)
export const SIGHTS = {
  iron: { id: 'iron', name: 'Открытый прицел', optic: false },
  opt2: { id: 'opt2', name: 'Оптика ×2', optic: true, zoom: 2, reticle: 'post' },
  opt3: { id: 'opt3', name: 'Оптика ×3', optic: true, zoom: 3, reticle: 'post' },
  sc6: { id: 'sc6', name: 'Оптика ×6', optic: true, zoom: 6, reticle: 'cross' },
  sc10: { id: 'sc10', name: 'Оптика ×10', optic: true, zoom: 10, reticle: 'cross' },
};
export function sightZoom(w, sightId) {
  const s = SIGHTS[sightId] || SIGHTS.iron;
  return s.optic ? s.zoom : w.ironZoom;
}

export const GADGETS = {
  at: { id: 'at', name: 'Противотанковая граната', short: 'ПТ-граната' },
  medkit: { id: 'medkit', name: 'Медицинская сумка', short: 'Аптечка' },
  ammo: { id: 'ammo', name: 'Ящик с патронами', short: 'Патроны' },
  flare: { id: 'flare', name: 'Сигнальная ракета', short: 'Ракета' },
};

export const CLASSES = [
  {
    id: 'assault', name: 'Штурмовик', weapon: 'smg', gadget: 'at', gadgetCount: 2, grenades: 2, speed: 1.0,
    desc: 'Ближний бой и охота на танки. Пистолет-пулемёт и противотанковые гранаты.',
  },
  {
    id: 'medic', name: 'Медик', weapon: 'semi', gadget: 'medkit', gadgetCount: 2, grenades: 1, speed: 1.0, revive: true,
    desc: 'Поднимает раненых и ставит аптечки. Самозарядная винтовка.',
  },
  {
    id: 'support', name: 'Поддержка', weapon: 'lmg', gadget: 'ammo', gadgetCount: 2, grenades: 2, speed: 0.93,
    desc: 'Ручной пулемёт и ящики с патронами для товарищей.',
  },
  {
    id: 'scout', name: 'Разведчик', weapon: 'bolt', gadget: 'flare', gadgetCount: 3, grenades: 1, speed: 1.0,
    desc: 'Снайперская винтовка с оптикой и ракеты, подсвечивающие врагов.',
  },
];
export const CLASS_BY_ID = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

export const GRENADE = {
  frag: { dmg: 115, radius: 7, fuse: 3.0, speed: 17 },
  at: { dmg: 90, radius: 3.5, vehicle: 340, speed: 14 },
  flare: { radius: 38, time: 12, speed: 30 },
};

export const DIFFICULTY = [
  { id: 0, name: 'Новобранец', reaction: [0.75, 1.2], aimErr: 7.5, converge: 1.5, floor: 0.9, turn: 3.2, spreadMul: 1.5, dmgMul: 0.7, fov: 100, view: 75, burst: [2, 4] },
  { id: 1, name: 'Солдат', reaction: [0.45, 0.8], aimErr: 5.5, converge: 0.95, floor: 0.55, turn: 4.6, spreadMul: 1.2, dmgMul: 0.88, fov: 115, view: 90, burst: [3, 6] },
  { id: 2, name: 'Ветеран', reaction: [0.25, 0.5], aimErr: 3.8, converge: 0.6, floor: 0.32, turn: 6.5, spreadMul: 1.0, dmgMul: 1.0, fov: 125, view: 110, burst: [4, 8] },
];

export const RANKS = [
  [0, 'Рядовой'], [1500, 'Ефрейтор'], [4000, 'Младший унтер-офицер'], [8000, 'Унтер-офицер'],
  [14000, 'Фельдфебель'], [22000, 'Прапорщик'], [32000, 'Подпоручик'], [45000, 'Поручик'],
  [60000, 'Штабс-капитан'], [80000, 'Капитан'], [105000, 'Подполковник'], [135000, 'Полковник'],
];
export function rankFor(xp) {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1][0]) i++;
  const next = RANKS[i + 1];
  return { index: i, name: RANKS[i][1], from: RANKS[i][0], to: next ? next[0] : RANKS[i][0], next: next ? next[1] : null };
}

export const SCORE = {
  kill: 100, head: 25, assist: 40, revive: 100, capture: 200, neutralize: 80, defend: 50,
  tank: 500, heal: 10, resupply: 10, spot: 15, airship: 800, vehicleDamage: 20,
};

export const NAMES = [
  ['Смит', 'Дюбуа', 'Томпсон', 'Моро', 'Бейкер', 'Леруа', 'Хьюз', 'Бернар', 'Кларк', 'Фурнье', 'Росси', 'Уокер',
    'Марсо', 'Эванс', 'Конти', 'Гарнье', 'Тейлор', 'Риччи', 'Райт', 'Мартен', 'Харрис', 'Бруно', 'Купер', 'Ламбер'],
  ['Мюллер', 'Шмидт', 'Хофман', 'Ковач', 'Вебер', 'Фишер', 'Бауэр', 'Новак', 'Вагнер', 'Хубер', 'Шульц', 'Келлер',
    'Беккер', 'Хорват', 'Кох', 'Лехнер', 'Майер', 'Рихтер', 'Фогель', 'Шнайдер', 'Брандт', 'Гросс', 'Зайлер', 'Винтер'],
];
export const SQUAD_NAMES = ['Альфа', 'Браво', 'Чарли', 'Дельта'];

export const DEFAULT_SETTINGS = {
  map: 'field', mode: 'conquest', team: 0, bots: 12, difficulty: 1, length: 1,
  sens: 1.0, mouseSens: 1.0, aimAssist: 0.6, quality: 'auto', volume: 0.8, vibration: true, fov: 75, leftFire: true, invertY: false,
};
// Названия оружия для ленты убийств
export const WNAME = {
  smg: 'ПП-18', semi: 'СВ-16', lmg: 'РП-15', bolt: 'СН-98', revolver: 'револьвер', pistol: 'пистолет', frag: 'граната', at: 'ПТ-граната',
  melee: 'штык', tank: 'танк', mg: 'пулемёт', airship: 'цеппелин', fall: 'падение', flare: 'ракета',
};
export const MATCH_LENGTH = [
  { name: 'Короткий', tickets: 130, tdm: 50, time: 10 * 60 },
  { name: 'Обычный', tickets: 230, tdm: 90, time: 18 * 60 },
  { name: 'Долгий', tickets: 400, tdm: 150, time: 30 * 60 },
];
