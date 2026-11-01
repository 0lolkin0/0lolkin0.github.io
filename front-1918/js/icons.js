// Иконки кнопок (SVG 24×24, цвет берётся из CSS currentColor)
const svg = (body) => `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  // Патрон
  fire: svg('<path d="M9.5 21h5v-9.5c0-3-1.2-5.6-2.5-7.5-1.3 1.9-2.5 4.5-2.5 7.5z" fill="currentColor" fill-opacity=".25"/><path d="M9.5 15.5h5"/><path d="M8.5 21h7"/>'),
  // Прицел
  ads: svg('<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>'),
  reload: svg('<path d="M19.5 8.5A8 8 0 1 0 20 13"/><path d="M20 3.5v5h-5"/>'),
  // Прыжок: стрелка над землёй
  jump: svg('<path d="M12 17V4M7 9l5-5 5 5"/><path d="M4 21h16"/>'),
  // Боец присел на колено
  crouch: svg('<circle cx="12" cy="4.5" r="2" fill="currentColor"/><path d="M12 7.5l-1 6 4 1.5 1 5.5"/><path d="M11 13.5l-4 2 1 4.5"/><path d="M12 8.5l4 2.5h4"/>'),
  // Боец лёжа с винтовкой
  prone: svg('<circle cx="5" cy="13" r="2" fill="currentColor"/><path d="M7.5 14.5h9l4 1.5"/><path d="M8 14.5l2-2.5h6"/><path d="M3 18.5h18" stroke-opacity=".5"/>'),
  // Штык
  melee: svg('<path d="M18.5 3.5l-9 9 2 2 9-9 .5-2.5z" fill="currentColor" fill-opacity=".25"/><path d="M8 12.5l3.5 3.5M5.5 15l3.5 3.5-2 2-3.5-3.5z"/>'),
  // Граната с кольцом
  grenade: svg('<ellipse cx="11" cy="14.5" rx="5.5" ry="6.5" fill="currentColor" fill-opacity=".25"/><path d="M5.5 14.5h11M11 8v13"/><path d="M9 8V5.5h4V8"/><path d="M13 6l4.5-1.5 1 3"/><circle cx="18.5" cy="9.5" r="1.8"/>'),
  // Связка гранат на ручке (противотанковая)
  at: svg('<path d="M12 22v-9"/><rect x="6" y="3" width="4" height="9" rx="1.5" fill="currentColor" fill-opacity=".25"/><rect x="10" y="2" width="4" height="10" rx="1.5" fill="currentColor" fill-opacity=".25"/><rect x="14" y="3" width="4" height="9" rx="1.5" fill="currentColor" fill-opacity=".25"/><path d="M5.5 8h13"/>'),
  // Санитарная сумка
  medkit: svg('<rect x="3.5" y="7" width="17" height="13" rx="2" fill="currentColor" fill-opacity=".2"/><path d="M9 7V4.5h6V7"/><path d="M12 10.5v6M9 13.5h6" stroke-width="2.4"/>'),
  // Ящик с патронами
  ammo: svg('<rect x="3" y="10" width="18" height="10" rx="1" fill="currentColor" fill-opacity=".2"/><path d="M3 13.5h18"/><path d="M7 10V5.5c0-1 .5-2 1-2.5.5.5 1 1.5 1 2.5V10M11 10V5.5c0-1 .5-2 1-2.5.5.5 1 1.5 1 2.5V10M15 10V5.5c0-1 .5-2 1-2.5.5.5 1 1.5 1 2.5V10"/>'),
  // Сигнальная ракетница
  flare: svg('<path d="M4 14h10v-3.5H4z" fill="currentColor" fill-opacity=".25"/><path d="M7 14l-1 5h3l1-5"/><path d="M14 12.2h2"/><path d="M19 5l1.5-1.5M19.5 9H22M17 3.5V1.5"/><circle cx="18.5" cy="7" r="1.6" fill="currentColor"/>'),
  // Смена оружия: пистолет и стрелки
  swap: svg('<path d="M3 9h11l1-2h3v4h-6l-1 3.5h-3l.5-3.5H3z" fill="currentColor" fill-opacity=".25"/><path d="M5 17h13M15 14.5l3 2.5-3 2.5"/>'),
  // Пулемёт танка
  mg: svg('<path d="M2 11h14v3H2z" fill="currentColor" fill-opacity=".25"/><path d="M16 12.5h6M5 14v4M10 14l1 4"/><circle cx="9" cy="8" r="2.5"/>'),
  exit: svg('<path d="M14 4H6v16h8"/><path d="M11 12h10M17 8l4 4-4 4"/>'),
  // Карта
  map: svg('<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" fill="currentColor" fill-opacity=".15"/><path d="M9 4v14M15 6v14"/>'),
};
