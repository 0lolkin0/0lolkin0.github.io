// Офлайн-кэш: игра целиком сохраняется на телефоне после первого запуска
const VERSION = 'front1918-v2';
const CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'js/main.js', 'js/three.module.min.js', 'js/util.js', 'js/config.js', 'js/maps.js', 'js/world.js', 'js/effects.js',
  'js/audio.js', 'js/soldier.js', 'js/ai.js', 'js/vehicles.js', 'js/combat.js', 'js/viewmodel.js', 'js/input.js', 'js/hud.js',
  'js/gfx.js', 'js/models.js', 'js/icons.js',
  'js/addons/postprocessing/EffectComposer.js', 'js/addons/postprocessing/RenderPass.js', 'js/addons/postprocessing/ShaderPass.js',
  'js/addons/postprocessing/MaskPass.js', 'js/addons/postprocessing/Pass.js', 'js/addons/postprocessing/UnrealBloomPass.js',
  'js/addons/postprocessing/OutputPass.js', 'js/addons/shaders/CopyShader.js', 'js/addons/shaders/LuminosityHighPassShader.js',
  'js/addons/shaders/OutputShader.js', 'js/addons/shaders/FXAAShader.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
// Свои файлы: сначала сеть (чтобы обновления доходили), при её отсутствии — кэш. Шрифты: кэш, затем сеть
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
    );
  } else if (url.host.includes('fonts.googleapis.com') || url.host.includes('fonts.gstatic.com')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
  }
});
