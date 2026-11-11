// Пост-обработка и настройки графики.
// Конвейер: G-буфер (глубина + нормали) → затенение GTAO → отражения в лужах (SSR) → атмосферный туман
// с подсветкой от солнца → лучи солнца → размытие в движении → глубина резкости в прицеле → оружие →
// свечение → тональная кривая → плёнка и резкость → SMAA / FXAA.
import * as THREE from './three.module.min.js';
import { EffectComposer } from './addons/postprocessing/EffectComposer.js';
import { RenderPass } from './addons/postprocessing/RenderPass.js';
import { ShaderPass } from './addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from './addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './addons/postprocessing/OutputPass.js';
import { GTAOPass } from './addons/postprocessing/GTAOPass.js';
import { SMAAPass } from './addons/postprocessing/SMAAPass.js';
import { FXAAShader } from './addons/shaders/FXAAShader.js';

// ---------- Настройки графики ----------
// base — уровень «базовых» систем (облака, число частиц, рельеф в высоком качестве): 0..3
export const GFX_PRESETS = {
  low: { base: 0, res: 100, aa: 'off', shadows: 0, ao: false, ssr: false, atmo: false, godrays: false, mblur: false, dof: false, bloom: false, film: false, sharpen: 0, grass: 0, lights: 2, tex: 0, tone: 'aces' },
  medium: { base: 1, res: 100, aa: 'msaa4', shadows: 1, ao: false, ssr: false, atmo: false, godrays: false, mblur: false, dof: false, bloom: false, film: false, sharpen: 0, grass: 1, lights: 3, tex: 1, tone: 'aces' },
  high: { base: 2, res: 100, aa: 'msaa4', shadows: 2, ao: true, ssr: false, atmo: true, godrays: true, mblur: false, dof: true, bloom: true, film: true, sharpen: 0.3, grass: 2, lights: 4, tex: 1, tone: 'aces' },
  ultra: { base: 3, res: 100, aa: 'msaa4', shadows: 3, ao: true, ssr: true, atmo: true, godrays: true, mblur: true, dof: true, bloom: true, film: true, sharpen: 0.3, grass: 3, lights: 6, tex: 2, tone: 'aces' },
  epic: { base: 3, res: 125, aa: 'msaa8', shadows: 4, ao: true, ssr: true, atmo: true, godrays: true, mblur: true, dof: true, bloom: true, film: true, sharpen: 0.25, grass: 4, lights: 8, tex: 2, tone: 'aces' },
};
export const GFX_KEYS = Object.keys(GFX_PRESETS.ultra);
// Тени: размер карты, радиус вокруг камеры, как часто обновлять (в кадрах), мягкие
export const SHADOW_LEVELS = [
  null,
  { size: 1024, r: 45, every: 3, soft: false },
  { size: 2048, r: 60, every: 2, soft: true },
  { size: 4096, r: 80, every: 1, soft: true },
  { size: 8192, r: 110, every: 1, soft: true },
];
// Трава: радиус вокруг камеры, плотность, предел числа пучков
export const GRASS_LEVELS = [
  null,
  { r: 20, d: 0.45, cap: 5000 },
  { r: 30, d: 0.8, cap: 14000 },
  { r: 42, d: 1.1, cap: 30000 },
  { r: 58, d: 1.4, cap: 70000 },
];
export const TONE = {
  aces: { map: THREE.ACESFilmicToneMapping, exp: 1.05 },
  agx: { map: THREE.AgXToneMapping, exp: 1.3 },
  neutral: { map: THREE.NeutralToneMapping, exp: 1.0 },
};
export function needsPost(o) {
  return o.ao || o.ssr || o.atmo || o.godrays || o.mblur || o.dof || o.bloom || o.film || o.sharpen > 0 || o.aa === 'fxaa' || o.aa === 'smaa' || o.aa === 'msaa8';
}
// Слой 1 — объекты, которых нет в G-буфере: небо, частицы, трава, листва (у них прозрачные края)
export const LAYER_NO_GBUFFER = 1;

// ---------- Шейдеры ----------
const VS = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DEPTH_HELPERS = `
#include <packing>
uniform sampler2D tDepth;
uniform float cNear, cFar;
uniform mat4 uProj, uProjInv, uCamWorld;
float depthAt(vec2 uv) { return texture2D(tDepth, uv).x; }
vec3 viewPosFrom(vec2 uv, float d) { vec4 c = vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); vec4 v = uProjInv * c; return v.xyz / v.w; }
float viewZFrom(float d) { return perspectiveDepthToViewZ(d, cNear, cFar); }
`;
const DEPTH_UNIFORMS = () => ({
  tDepth: { value: null }, cNear: { value: 0.1 }, cFar: { value: 700 },
  uProj: { value: new THREE.Matrix4() }, uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
});

// Отражения в лужах и мокрой земле: лужи там, где земля ровная, маска — шум в мировых координатах.
// Луч отражения идёт по экрану (по буферу глубины); если ушёл за кадр — отражается небо. В дождь — рябь от капель.
const SSRShader = {
  uniforms: () => ({ tDiffuse: { value: null }, tNormal: { value: null }, uView: { value: new THREE.Matrix4() }, uTime: { value: 0 }, uWet: { value: 1 }, uRain: { value: 1 },
    uSkyTop: { value: new THREE.Color() }, uSkyHor: { value: new THREE.Color() }, ...DEPTH_UNIFORMS() }),
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tNormal; uniform mat4 uView; uniform float uTime, uWet, uRain; uniform vec3 uSkyTop, uSkyHor;
    varying vec2 vUv;
    ${DEPTH_HELPERS}
    float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y); }
    float fbm2(vec2 p) { return vn(p) * 0.55 + vn(p * 2.13 + 7.1) * 0.3 + vn(p * 4.7 + 3.3) * 0.15; }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float d = depthAt(vUv);
      if (d >= 1.0 || uWet <= 0.0) { gl_FragColor = col; return; }
      vec3 vp = viewPosFrom(vUv, d);
      vec3 n = normalize(unpackRGBToNormal(texture2D(tNormal, vUv).rgb));
      vec3 wn = normalize((uCamWorld * vec4(n, 0.0)).xyz);
      if (wn.y < 0.8 || -vp.z > 160.0) { gl_FragColor = col; return; }
      vec3 wp = (uCamWorld * vec4(vp, 1.0)).xyz;
      // Лужи: несколько метров в поперечнике, только на почти ровной земле; остальная земля чуть блестит
      float m = fbm2(wp.xz * 0.16 + 13.7);
      float th = 0.71 - uWet * 0.02;
      float puddle = smoothstep(th, th + 0.035, m) * smoothstep(0.95, 0.99, wn.y) * (1.0 - smoothstep(60.0, 120.0, -vp.z));
      float wetAll = uWet * 0.06 * smoothstep(0.85, 0.97, wn.y) * (1.0 - smoothstep(25.0, 70.0, -vp.z));
      if (puddle + wetAll <= 0.002) { gl_FragColor = col; return; }
      // Рябь от капель: расходящиеся кольца в ячейках
      vec3 rn = vec3(0.0, 1.0, 0.0);
      if (uRain > 0.0) {
        vec2 rp = wp.xz * 1.7; vec2 cell = floor(rp); vec2 f = fract(rp) - 0.5;
        vec2 off = vec2(h21(cell + 3.1), h21(cell + 7.7)) - 0.5;
        float t = fract(uTime * 0.9 + h21(cell));
        vec2 dv = f - off * 0.6; float r = length(dv);
        float wave = sin((r - t * 0.55) * 42.0) * exp(-r * 7.0) * (1.0 - t);
        rn = normalize(vec3(dv.x / max(r, 1e-3) * wave * 0.22, 1.0, dv.y / max(r, 1e-3) * wave * 0.22));
      }
      vec3 nn = normalize(mix(n, normalize((uView * vec4(rn, 0.0)).xyz), puddle));
      vec3 V = normalize(vp);
      vec3 R = normalize(reflect(V, nn));
      vec3 hit = vec3(0.0); float found = 0.0;
      float stepLen = 0.25 + (-vp.z) * 0.012;
      vec3 p = vp + nn * 0.03;
      vec2 suv = vUv;
      for (int i = 0; i < 40; i++) {
        p += R * stepLen; stepLen *= 1.07;
        vec4 cs = uProj * vec4(p, 1.0);
        if (cs.w <= 0.0) break;
        suv = cs.xy / cs.w * 0.5 + 0.5;
        if (suv.x < 0.0 || suv.y < 0.0 || suv.x > 1.0 || suv.y > 1.0) break;
        float sd = depthAt(suv);
        if (sd >= 1.0) continue;
        float sz = viewZFrom(sd);
        float diff = sz - p.z;
        if (diff > 0.0 && diff < stepLen * 2.5 + 0.3) {
          // Уточняем точку пересечения
          vec3 a = p - R * stepLen, b = p;
          for (int j = 0; j < 5; j++) {
            vec3 mid = (a + b) * 0.5;
            vec4 mc = uProj * vec4(mid, 1.0); vec2 muv = mc.xy / mc.w * 0.5 + 0.5;
            if (viewZFrom(depthAt(muv)) - mid.z > 0.0) { b = mid; suv = muv; } else a = mid;
          }
          vec2 e = smoothstep(vec2(0.0), vec2(0.08), suv) * smoothstep(vec2(0.0), vec2(0.08), 1.0 - suv);
          hit = texture2D(tDiffuse, suv).rgb; found = e.x * e.y;
          break;
        }
      }
      vec3 wr = normalize((uCamWorld * vec4(R, 0.0)).xyz);
      vec3 sky = mix(uSkyHor, uSkyTop, clamp(wr.y * 1.6, 0.0, 1.0));
      vec3 refl = mix(sky, hit, found);
      float fres = 0.03 + 0.97 * pow(1.0 - max(dot(-V, nn), 0.0), 5.0);
      float k = puddle * mix(0.35, 0.85, fres) + wetAll * fres;
      vec3 base = col.rgb * mix(1.0, 0.55, puddle);
      gl_FragColor = vec4(mix(base, refl, clamp(k, 0.0, 0.9)), col.a);
    }`,
};

// Атмосфера: стелющийся по низинам туман (по высоте) и рассеяние света в сторону солнца
const AtmoShader = {
  uniforms: () => ({ tDiffuse: { value: null }, uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color() },
    uFogCol: { value: new THREE.Color() }, uDensity: { value: 0.005 }, uFalloff: { value: 0.09 }, uBaseH: { value: 0 }, ...DEPTH_UNIFORMS() }),
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec3 uCamPos, uSunDir, uSunCol, uFogCol; uniform float uDensity, uFalloff, uBaseH;
    varying vec2 vUv;
    ${DEPTH_HELPERS}
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      float d = depthAt(vUv);
      if (d >= 1.0) { gl_FragColor = col; return; }
      vec3 wp = (uCamWorld * vec4(viewPosFrom(vUv, d), 1.0)).xyz;
      vec3 rd = wp - uCamPos; float dist = length(rd); rd /= max(dist, 1e-3);
      float b = uFalloff, oy = uCamPos.y - uBaseH;
      float t = dist * rd.y * b;
      float term = abs(t) < 1e-4 ? dist * b : (1.0 - exp(-t)) / rd.y;
      float amt = 1.0 - exp(-max((uDensity / b) * exp(-oy * b) * term, 0.0));
      float sun = max(dot(rd, uSunDir), 0.0);
      vec3 fc = uFogCol + uSunCol * (pow(sun, 10.0) * 0.5 + pow(sun, 2.0) * 0.1);
      vec3 c = mix(col.rgb, fc, clamp(amt, 0.0, 0.9));
      c += uSunCol * pow(sun, 28.0) * (1.0 - exp(-dist * 0.005)) * 0.3;
      gl_FragColor = vec4(c, col.a);
    }`,
};

// Лучи солнца: от яркого неба к солнцу, заслоняют их всё тёмное (стены, кроны, руины)
const GodRaysShader = {
  uniforms: () => ({ tDiffuse: { value: null }, tDepth: { value: null }, uSun: { value: new THREE.Vector2(0.5, 0.5) }, uFade: { value: 0 }, uSunCol: { value: new THREE.Color() }, uIntensity: { value: 0.8 }, uAspect: { value: 1.6 } }),
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uSun; uniform float uFade, uIntensity, uAspect; uniform vec3 uSunCol;
    varying vec2 vUv;
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      if (uFade <= 0.001) { gl_FragColor = col; return; }
      vec2 dir = uSun - vUv;
      float dsun = length(dir * vec2(uAspect, 1.0));
      vec2 st = dir / 56.0 * 0.92;
      vec2 uv = vUv; float illum = 1.0, acc = 0.0;
      for (int i = 0; i < 56; i++) {
        uv += st;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) break;
        float sky = step(0.99999, texture2D(tDepth, uv).x);
        float l = dot(texture2D(tDiffuse, uv).rgb, vec3(0.299, 0.587, 0.114));
        acc += sky * smoothstep(0.3, 1.4, l) * illum;
        illum *= 0.968;
      }
      acc /= 56.0;
      gl_FragColor = vec4(col.rgb + uSunCol * acc * uIntensity * uFade * (0.3 + exp(-dsun * 1.8)), col.a);
    }`,
};

// Размытие в движении камеры: восстанавливаем мировую точку по глубине и смотрим, где она была в прошлом кадре
const MotionBlurShader = {
  uniforms: () => ({ tDiffuse: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uStrength: { value: 0.5 }, ...DEPTH_UNIFORMS() }),
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform mat4 uPrevVP; uniform float uStrength;
    varying vec2 vUv;
    ${DEPTH_HELPERS}
    void main() {
      float d = min(depthAt(vUv), 0.99999);
      vec4 wp = uCamWorld * vec4(viewPosFrom(vUv, d), 1.0);
      vec4 pp = uPrevVP * wp;
      vec2 vel = (vUv - (pp.xy / pp.w * 0.5 + 0.5)) * uStrength;
      float L = length(vel);
      if (L < 0.0006 || pp.w <= 0.0) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      if (L > 0.02) vel *= 0.02 / L;
      vec4 acc = vec4(0.0);
      for (int i = 0; i < 10; i++) acc += texture2D(tDiffuse, vUv + vel * (float(i) / 9.0 - 0.5));
      gl_FragColor = acc / 10.0;
    }`,
};

// Глубина резкости при прицеливании: фокус по центру экрана, дальний и ближний план мягко размыты
const DofShader = {
  uniforms: () => ({ tDiffuse: { value: null }, uAmount: { value: 0 }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) }, uMaxPx: { value: 8 }, ...DEPTH_UNIFORMS() }),
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAmount, uMaxPx; uniform vec2 uTexel;
    varying vec2 vUv;
    ${DEPTH_HELPERS}
    float linZ(vec2 uv) { return -viewZFrom(min(depthAt(uv), 0.9999)); }
    float cocAt(float z, float fd) { return clamp(abs(z - fd) / max(z, 0.5) * 1.8, 0.0, 1.0); }
    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      if (uAmount <= 0.001) { gl_FragColor = col; return; }
      float fd = min(min(linZ(vec2(0.5)), linZ(vec2(0.5, 0.52))), linZ(vec2(0.5, 0.48)));
      float coc = cocAt(linZ(vUv), fd) * uAmount;
      if (coc < 0.03) { gl_FragColor = col; return; }
      float rad = coc * uMaxPx;
      vec3 acc = col.rgb; float w = 1.0;
      for (int i = 0; i < 24; i++) {
        float fi = float(i) + 0.5;
        float r = sqrt(fi / 24.0) * rad, a = fi * 2.39996;
        vec2 o = vec2(cos(a), sin(a)) * r * uTexel;
        float sw = mix(0.2, 1.0, cocAt(linZ(vUv + o), fd));
        acc += texture2D(tDiffuse, vUv + o).rgb * sw; w += sw;
      }
      gl_FragColor = vec4(acc / w, col.a);
    }`,
};

// Цветокоррекция и «плёнка»: резкость, хроматическая аберрация, сепия, виньетка, зерно, красный край при ранении
const GradeShader = {
  uniforms: () => ({ tDiffuse: { value: null }, uTime: { value: 0 }, uVignette: { value: 0.9 }, uGrain: { value: 0.012 }, uSepia: { value: 0.1 }, uDamage: { value: 0 },
    uSharp: { value: 0.3 }, uCA: { value: 0.0 }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) } }),
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uSepia, uDamage, uSharp, uCA; uniform vec2 uTexel;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      vec4 c = texture2D(tDiffuse, vUv);
      if (uCA > 0.0) { c.r = texture2D(tDiffuse, vUv - d * uCA).r; c.b = texture2D(tDiffuse, vUv + d * uCA).b; }
      if (uSharp > 0.0) {
        vec3 nb = texture2D(tDiffuse, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(uTexel.x, 0.0)).rgb
                + texture2D(tDiffuse, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, uTexel.y)).rgb;
        c.rgb = max(c.rgb + (c.rgb - nb * 0.25) * uSharp, 0.0);
      }
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      c.rgb = mix(c.rgb, vec3(l * 1.08, l * 0.99, l * 0.86), uSepia);
      c.rgb = (c.rgb - 0.5) * 1.05 + 0.5;
      c.rgb *= 1.0 - dot(d, d) * uVignette;
      c.rgb = mix(c.rgb, vec3(l * 0.9, l * 0.15, l * 0.1), uDamage * smoothstep(0.1, 0.7, length(d)));
      float n = fract(sin(dot(vUv * vec2(12.9898, 78.233) + fract(uTime) * 17.0, vec2(1.0, 1.7))) * 43758.5453);
      c.rgb += (n - 0.5) * uGrain;
      gl_FragColor = c;
    }`,
};

function shaderPass(def) {
  const p = new ShaderPass(new THREE.ShaderMaterial({ uniforms: def.uniforms(), vertexShader: VS, fragmentShader: def.fragmentShader, depthTest: false, depthWrite: false }));
  return p;
}

// ---------- Конвейер ----------
const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Matrix4();
export class Post {
  // o — настройки графики, env — свет и погода карты: { sunDir, sunCol, fogCol, skyTop, skyHor, wet, rain, fogDensity }
  constructor(renderer, scene, camera, vmScene, vmCam, o, env) {
    this.r = renderer; this.scene = scene; this.camera = camera; this.o = o; this.env = env;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const samples = o.aa === 'msaa8' ? 8 : o.aa === 'msaa4' ? 4 : 0;
    this.rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples });
    this.composer = new EffectComposer(renderer, this.rt);
    this.needG = !!(o.ao || o.ssr || o.atmo || o.godrays || o.mblur || o.dof);
    if (this.needG) {
      this.gDepth = new THREE.DepthTexture(size.x, size.y);
      this.gDepth.type = THREE.UnsignedIntType;
      this.gbuf = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthTexture: this.gDepth });
      this.normalMat = new THREE.MeshNormalMaterial();
      this.normalMat.blending = THREE.NoBlending;
    }
    this.depthPasses = [];
    const C = this.composer;
    this.main = new RenderPass(scene, camera);
    C.addPass(this.main);
    if (o.ao) {
      this.gtao = new GTAOPass(scene, camera, size.x, size.y);
      this.gtao.setGBuffer(this.gDepth, this.gbuf.texture);
      this.gtao.updateGtaoMaterial({ radius: 1.1, distanceExponent: 1.6, thickness: 1.5, scale: 1.15, samples: 16, distanceFallOff: 1 });
      this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      this.gtao.blendIntensity = 0.95;
      C.addPass(this.gtao);
    }
    const addDepth = (def) => { const p = shaderPass(def); p.uniforms.tDepth.value = this.gDepth; this.depthPasses.push(p); C.addPass(p); return p; };
    if (o.ssr && env.wet > 0) {
      this.ssr = addDepth(SSRShader);
      this.ssr.uniforms.tNormal.value = this.gbuf.texture;
      this.ssr.uniforms.uWet.value = env.wet; this.ssr.uniforms.uRain.value = env.rain ? 1 : 0;
      this.ssr.uniforms.uSkyTop.value.copy(env.skyTop); this.ssr.uniforms.uSkyHor.value.copy(env.skyHor);
    }
    if (o.atmo) {
      this.atmo = addDepth(AtmoShader);
      const u = this.atmo.uniforms;
      u.uSunDir.value.copy(env.sunDir); u.uSunCol.value.copy(env.sunCol); u.uFogCol.value.copy(env.fogCol); u.uDensity.value = env.fogDensity;
    }
    if (o.godrays) {
      this.rays = shaderPass(GodRaysShader);
      this.rays.uniforms.tDepth.value = this.gDepth;
      this.rays.uniforms.uSunCol.value.copy(env.sunCol);
      C.addPass(this.rays);
    }
    if (o.mblur) this.mblur = addDepth(MotionBlurShader);
    if (o.dof) this.dof = addDepth(DofShader);
    this.vm = new RenderPass(vmScene, vmCam);
    this.vm.clear = false;
    this.vm.clearDepth = true;
    C.addPass(this.vm);
    if (o.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.32, 0.55, 0.92);
      // Свечение считаем в половинном разрешении — его всё равно размывают
      const bs = this.bloom.setSize.bind(this.bloom);
      this.bloom.setSize = (w, h) => bs(Math.max(64, Math.round(w * 0.5)), Math.max(64, Math.round(h * 0.5)));
      C.addPass(this.bloom);
    }
    C.addPass(new OutputPass());
    this.grade = shaderPass(GradeShader);
    const g = this.grade.uniforms;
    g.uSharp.value = o.sharpen || 0;
    g.uGrain.value = o.film ? 0.014 : 0;
    g.uCA.value = o.film ? 0.0025 : 0;
    g.uVignette.value = o.film ? 0.95 : 0.55;
    g.uSepia.value = o.film ? 0.1 : 0.04;
    C.addPass(this.grade);
    if (o.aa === 'smaa') { this.smaa = new SMAAPass(size.x, size.y); C.addPass(this.smaa); }
    else if (o.aa === 'fxaa') { this.fxaa = new ShaderPass(FXAAShader); C.addPass(this.fxaa); }
    this.prevVP = new THREE.Matrix4();
    this.prevPos = new THREE.Vector3(1e9, 0, 0);
    this.prevDir = new THREE.Vector3(0, 0, -1);
    this.prevFov = 0;
    this.setSize(renderer);
  }
  setScene(scene) { this.main.scene = scene; this.scene = scene; if (this.gtao) this.gtao.scene = scene; }
  // Погода меняется по ходу боя: fog — множитель густоты тумана, sun — яркости солнца, wet — мокрой земли
  setWeather(fog, sun, wet) {
    const env = this.env;
    if (this.atmo) {
      this.atmo.uniforms.uDensity.value = env.fogDensity * fog;
      this.atmo.uniforms.uSunCol.value.copy(env.sunCol).multiplyScalar(sun);
    }
    if (this.rays) this.rays.uniforms.uSunCol.value.copy(env.sunCol).multiplyScalar(sun);
    if (this.ssr && wet !== undefined) this.ssr.uniforms.uWet.value = env.wet * wet;
  }
  setSize(renderer) {
    const pr = renderer.getPixelRatio();
    const w = Math.round(innerWidth * pr), h = Math.round(innerHeight * pr);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(innerWidth, innerHeight);
    if (this.gbuf) this.gbuf.setSize(w, h);
    if (this.gtao) this.gtao.setSize(w, h);
    this.grade.uniforms.uTexel.value.set(1 / w, 1 / h);
    if (this.dof) this.dof.uniforms.uTexel.value.set(1 / w, 1 / h), (this.dof.uniforms.uMaxPx.value = 7 * h / 1080 + 2);
    if (this.fxaa) this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
    if (this.rays) this.rays.uniforms.uAspect.value = w / h;
  }
  // Проход нормалей и глубины для эффектов: без неба, частиц, травы и листвы
  renderGBuffer() {
    const r = this.r, cam = this.camera, sc = this.scene;
    const mask = cam.layers.mask, bg = sc.background, ac = r.autoClear;
    const cc = r.getClearColor(this._cc || (this._cc = new THREE.Color())), ca = r.getClearAlpha();
    cam.layers.set(0);
    sc.overrideMaterial = this.normalMat; sc.background = null;
    r.setRenderTarget(this.gbuf);
    r.setClearColor(0x7777ff, 1); r.clear();
    r.render(sc, cam);
    sc.overrideMaterial = null; sc.background = bg;
    cam.layers.mask = mask;
    r.setClearColor(cc, ca);
    r.autoClear = ac;
    r.setRenderTarget(null);
  }
  // ctx: { time, damage, ads (0..1), showVm }
  render(ctx) {
    const cam = this.camera;
    if (this.needG) {
      this.renderGBuffer();
      const proj = cam.projectionMatrix, inv = cam.projectionMatrixInverse, wm = cam.matrixWorld;
      for (const p of this.depthPasses) {
        const u = p.uniforms;
        u.cNear.value = cam.near; u.cFar.value = cam.far;
        u.uProj.value.copy(proj); u.uProjInv.value.copy(inv); u.uCamWorld.value.copy(wm);
      }
      if (this.ssr) { this.ssr.uniforms.uView.value.copy(cam.matrixWorldInverse); this.ssr.uniforms.uTime.value = ctx.time; }
      if (this.atmo) this.atmo.uniforms.uCamPos.value.setFromMatrixPosition(wm);
      if (this.rays) {
        // Солнце на экране: если за спиной — лучей нет
        const sd = this.env.sunDir;
        cam.getWorldDirection(_f);
        _v.setFromMatrixPosition(wm).addScaledVector(sd, 1000).project(cam);
        const facing = _f.dot(sd);
        this.rays.uniforms.uSun.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
        this.rays.uniforms.uFade.value = facing > 0 ? THREE.MathUtils.smoothstep(facing, 0.05, 0.45) * THREE.MathUtils.smoothstep(sd.y, 0.0, 0.12) : 0;
      }
      if (this.mblur) {
        const pos = _v.setFromMatrixPosition(wm);
        // Резкий скачок камеры (возрождение, смена вида, рывок мышью) — без размытия в этом кадре
        cam.getWorldDirection(_f);
        const jump = pos.distanceToSquared(this.prevPos) > 4 || _f.dot(this.prevDir) < 0.9 || Math.abs(cam.fov - this.prevFov) > 0.3;
        this.prevFov = cam.fov;
        this.mblur.uniforms.uPrevVP.value.copy(jump ? _m.multiplyMatrices(proj, cam.matrixWorldInverse) : this.prevVP);
        this.mblur.uniforms.uStrength.value = 0.3;
        this.prevPos.copy(pos); this.prevDir.copy(_f);
      }
      if (this.dof) { this.dof.uniforms.uAmount.value = ctx.ads || 0; this.dof.enabled = (ctx.ads || 0) > 0.01; }
    }
    this.vm.enabled = !!ctx.showVm;
    this.grade.uniforms.uTime.value = ctx.time;
    this.grade.uniforms.uDamage.value = ctx.damage || 0;
    this.composer.render();
    this.prevVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
  }
  dispose() {
    this.composer.dispose();
    this.rt.dispose();
    if (this.gbuf) this.gbuf.dispose();
    if (this.gDepth) this.gDepth.dispose();
    if (this.gtao) this.gtao.dispose();
    if (this.smaa) this.smaa.dispose();
    if (this.bloom) this.bloom.dispose();
  }
}
