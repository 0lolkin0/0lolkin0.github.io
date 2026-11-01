// Главный модуль: меню, подготовка матча, игровой цикл, режимы «Захват» и «Схватка», камера и экраны
import * as THREE from './three.module.min.js';
import { World, PLAY, HALF } from './world.js';
import { MAPS, MAP_LIST, THEMES } from './maps.js';
import { Effects } from './effects.js';
import { GameAudio } from './audio.js';
import { Soldier, SoldierRenderer } from './soldier.js';
import { BotBrain } from './ai.js';
import { Tank, Airship, Biplane } from './vehicles.js';
import { Combat } from './combat.js';
import { ViewModel } from './viewmodel.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Gfx, makeSky, Grass, Post } from './gfx.js';
import { ICONS } from './icons.js';
import { TEAMS, CLASSES, CLASS_BY_ID, DIFFICULTY, NAMES, SQUAD_NAMES, SCORE, DEFAULT_SETTINGS, MATCH_LENGTH, rankFor, WEAPONS, GADGETS, SIGHTS } from './config.js';
import { clamp, lerp, angleDiff, yawTo, DEG, TAU, rand, pick, dirFromYawPitch, fmtTime, smoothstep } from './util.js';

const $ = (id) => document.getElementById(id);
const SAVE_KEY = 'front1918-save';
const params = new URLSearchParams(location.search);
const AUTOPLAY = params.has('autoplay');
const SPEED = clamp(parseFloat(params.get('speed')) || 1, 0.1, 20);

// Поле зрения при заданной кратности
const zoomFov = (fov, zoom) => (2 * Math.atan(Math.tan((fov * Math.PI) / 360) / zoom) * 180) / Math.PI;

function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch (_) { return {}; }
}
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _d = new THREE.Vector3();

class Game {
  constructor() {
    this.save = loadSave();
    this.save.xp ||= 0;
    this.save.totals ||= { matches: 0, wins: 0, kills: 0, deaths: 0, revives: 0, caps: 0 };
    this.settings = { ...DEFAULT_SETTINGS, ...(this.save.settings || {}) };
    for (const k of ['map', 'quality']) if (params.get(k)) this.settings[k] = params.get(k);
    if (!MAPS[this.settings.map]) this.settings.map = 'field';
    this.save.sights ||= {};
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.quality = this.pickQuality();
    const canvas = $('game');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.quality >= 1, powerPreference: 'high-performance' });
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.gfx = new Gfx(this.renderer, this.quality);
    this.camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 700);
    this.camera.rotation.order = 'YXZ';
    this.audio = new GameAudio();
    this.audio.setVolume(this.settings.volume);
    this.viewmodel = new ViewModel(this.gfx);
    this.viewmodel.mainCam = this.camera;
    this.input = new Input(this);
    this.hud = new Hud(this);
    this.state = 'menu';
    this.running = false;
    this.time = 0;
    this.shakeK = 0;
    this.viewYaw = 0;
    this.fpsAcc = 0; this.fpsN = 0; this.fpsT = 0;
    this.applyQuality();
    this.setupIcons();
    this.bindUI();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('pointerlockchange', () => {
      if (!document.pointerLockElement && this.state === 'play' && !this.input.touchMode && this.player && this.player.state !== 'dead' && !AUTOPLAY) this.pause(true);
      this.updatePcHint();
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'play') this.pause(true); });
    this.resize();
    this.prepareWorld(MAPS[this.settings.map]);
    this.renderMenu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    if (AUTOPLAY) setTimeout(() => this.startMatch(), 300);
  }

  // ---------- Качество графики ----------
  pickQuality() {
    const q = this.settings.quality;
    const map = { low: 0, medium: 1, high: 2, ultra: 3 };
    if (q in map) return map[q];
    return this.touch ? 2 : 3;
  }
  // 0 — низкая, 1 — средняя, 2 — высокая (свечение, трава, мягкие тени), 3 — ультра (сглаживание MSAA, больше травы и теней)
  applyQuality() {
    const dpr = window.devicePixelRatio || 1;
    const q = this.quality;
    const pr = [Math.min(dpr, 0.8), Math.min(dpr, 1.1), Math.min(dpr, 1.5), Math.min(dpr, 2)][q];
    this.renderer.setPixelRatio(pr);
    this.renderer.shadowMap.enabled = q >= 1;
    this.renderer.shadowMap.type = q >= 2 ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.gfx.q = q;
    if (this.sun) {
      this.sun.castShadow = q >= 1;
      const ms = [512, 1024, 2048, 4096][q];
      if (this.sun.shadow.mapSize.x !== ms) {
        this.sun.shadow.mapSize.set(ms, ms);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
      const R = [40, 50, 70, 90][q];
      const sc = this.sun.shadow.camera;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.updateProjectionMatrix();
      this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
    }
    if (this.post) { this.post.dispose(); this.post = null; }
    if (q >= 2 && this.scene) this.post = new Post(this.renderer, this.scene, this.camera, this.viewmodel.scene, this.viewmodel.camera, q);
    if (this.scene && this.world) {
      if (this.grass && this.grass.mesh) this.scene.remove(this.grass.mesh);
      this.grass = new Grass(this.scene, this.world, q, this.gfx);
    }
    $('mood').hidden = q >= 2;
    this.resize();
  }
  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize();
    if (this.post) this.post.setSize(this.renderer);
    if (this.effects) this.effects.setScale(h * this.renderer.getPixelRatio(), this.camera.fov);
    $('rotate').hidden = !(this.touch && h > w && this.state !== 'menu');
    if (this.state === 'deploy') this.drawDeployMap();
  }

  // ---------- Мир ----------
  prepareWorld(def) {
    if (this.world && this.world.def === def) return;
    const scene = (this.scene = new THREE.Scene());
    const T = THEMES[def.theme];
    this.world = new World(def, this.quality, this.gfx);
    scene.add(this.world.group);
    scene.fog = new THREE.Fog(T.fog, T.fogNear, T.fogFar);
    scene.background = new THREE.Color(T.fog);
    this.hemi = new THREE.HemisphereLight(T.hemiSky, T.hemiGround, T.hemiIntensity * 0.55);
    this.sun = new THREE.DirectionalLight(T.sun, T.sunIntensity * 1.35);
    this.sunDir = new THREE.Vector3(...T.sunDir).normalize();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 400;
    scene.add(this.hemi, this.sun, this.sun.target);
    this.sky = makeSky(T, this.quality);
    scene.add(this.sky);
    // Отражения и рассеянный свет от неба
    const pm = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.add(makeSky(T, 1));
    if (this.envRT) this.envRT.dispose();
    this.envRT = pm.fromScene(envScene, 0.02, 1, 600);
    pm.dispose();
    scene.environment = this.envRT.texture;
    this.viewmodel.setEnv(this.world, this.envRT.texture);
    this.effects = new Effects(scene, this.quality, T.weather, def.theme === 'winter');
    this.effects.setScale(innerHeight * this.renderer.getPixelRatio(), this.camera.fov);
    for (const sm of this.world.smokers) this.effects.emitters.push({ ...sm, size: 1 });
    this.soldierR = new SoldierRenderer(scene, 20, this.gfx);
    this.flagObjs = this.world.def.flags.map((f, i) => this.makeFlag(f, this.world.flagPoles[i]));
    this.hqCloth = this.world.hqBanners.map((b) => this.makeCloth(b.x, b.y, b.z, 2.6, 1.6));
    this.planes = [new Biplane(this, 0, 0), new Biplane(this, 1, Math.PI)];
    this.combat = new Combat(this);
    this.soldiers = [];
    this.vehicles = [];
    this.tanks = [];
    this.flags = [];
    this.applyQuality();
  }
  makeCloth(x, y, z, w = 1.9, h = 1.15) {
    const geo = new THREE.PlaneGeometry(w, h, 8, 3);
    geo.translate(w / 2, 0, 0);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xe8e2d0, side: THREE.DoubleSide }));
    mesh.position.set(x + 0.06, y, z);
    mesh.castShadow = true;
    this.scene.add(mesh);
    mesh.userData.base = Float32Array.from(geo.attributes.position.array);
    mesh.userData.w = w;
    return mesh;
  }
  makeFlag(f, pole) {
    const cloth = this.makeCloth(pole.x, pole.y + 7.8, pole.z);
    const pts = [];
    for (let i = 0; i <= 56; i++) {
      const a = (i / 56) * TAU, x = f.x + Math.cos(a) * f.r, z = f.z + Math.sin(a) * f.r;
      pts.push(new THREE.Vector3(x, this.world.groundAt(x, z, this.world.height(x, z) + 2) + 0.25, z));
    }
    const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe8e2d0, transparent: true, opacity: 0.55 }));
    this.scene.add(ring);
    return { cloth, ring };
  }
  waveCloth(m, t, k = 1) {
    const pa = m.geometry.attributes.position, b = m.userData.base, w = m.userData.w;
    for (let i = 0; i < pa.count; i++) {
      const x = b[i * 3], y = b[i * 3 + 1];
      const f = x / w;
      pa.array[i * 3 + 2] = Math.sin(x * 2.6 - t * 5 + y) * 0.16 * f * k;
      pa.array[i * 3 + 1] = y - f * f * 0.12;
    }
    pa.needsUpdate = true;
  }
  relColor(team) {
    if (team < 0) return 0xe8e2d0;
    return team === this.player.team ? 0x3f6fb5 : 0xa33b31;
  }

  // ---------- Матч ----------
  startMatch() {
    const st = this.settings;
    document.body.classList.remove('ended', 'downed');
    this.audio.init();
    this.goFullscreen();
    const def = MAPS[st.map];
    this.prepareWorld(def);
    this.clearMatch();
    this.diff = DIFFICULTY[st.difficulty] || DIFFICULTY[1];
    this.playerAggro = [1.25, 1.12, 1.0][st.difficulty] || 1;
    this.mode = st.mode;
    const len = MATCH_LENGTH[st.length] || MATCH_LENGTH[1];
    const perTeam = clamp(st.bots | 0, 4, 20);
    this.maxTickets = this.mode === 'tdm' ? Math.round(len.tdm * perTeam / 12) : Math.round(len.tickets * perTeam / 12 / 10) * 10;
    this.teams = [0, 1].map(() => ({ tickets: this.maxTickets, airship: false }));
    this.timeLeft = len.time;
    this.time = 0;
    this.endT = 0;
    this.winner = -1;
    this.flags = this.mode === 'tdm' ? [] : this.world.def.flags.map((f, i) => ({
      ...f, owner: -1, control: 0, cnt: [0, 0], contested: false, pole: this.world.flagPoles[i], obj: this.flagObjs[i],
    }));
    for (const fo of this.flagObjs) { fo.cloth.visible = this.mode !== 'tdm'; fo.ring.visible = this.mode !== 'tdm'; }
    // Солдаты
    const pteam = st.team === 1 ? 1 : 0;
    this.soldiers = [];
    let id = 0;
    const names = [NAMES[0].slice().sort(() => Math.random() - 0.5), NAMES[1].slice().sort(() => Math.random() - 0.5)];
    const classPool = ['assault', 'assault', 'medic', 'medic', 'support', 'scout', 'assault', 'support', 'medic', 'scout'];
    for (let t = 0; t < 2; t++) {
      for (let i = 0; i < perTeam; i++) {
        const isPlayer = t === pteam && i === 0;
        const nm = isPlayer ? 'Вы' : names[t][i % names[t].length] + (i >= names[t].length ? ' ' + (i + 1) : '');
        const s = new Soldier(this, t, id++, nm, isPlayer);
        if (!isPlayer || AUTOPLAY) s.bot = new BotBrain(s, this);
        s.setClass(isPlayer ? (this.save.lastClass || 'assault') : classPool[(i + t * 3) % classPool.length]);
        if (t === pteam && i >= 1 && i <= 3) s.squad = true;
        this.soldiers.push(s);
        if (isPlayer) { this.player = s; s.sights = this.save.sights; }
      }
    }
    this.squadName = pick(SQUAD_NAMES);
    // Танки
    this.tanks = [0, 1].map((t) => new Tank(this, t, this.world.def.tankSpawn[t]));
    this.vehicles = [...this.tanks];
    // Боты появляются в штабе
    for (const s of this.soldiers) if (!s.isPlayer || AUTOPLAY) this.spawnSoldier(s, this.botSpawnChoice(s, true));
    for (const fo of this.hqCloth) fo.material.color.setHex(0xe8e2d0);
    this.world.hqBanners.forEach((b, i) => this.hqCloth[i].material.color.setHex(this.relColor(b.team)));
    this.hud.setup();
    this.running = true;
    this.paused = false;
    this.assignT = 0; this.artyT = 3; this.objT = 0; this.airT = 5;
    this.playerObjective = null;
    this.playerFlag = null;
    this.firstDeploy = true;
    this.deathT = 0;
    $('menu').hidden = true;
    $('end').hidden = true;
    this.audio.setRain(this.world.theme.weather === 'rain');
    if (AUTOPLAY) { this.enterPlay(); this.audio.whistle(); }
    else this.showDeploy();
  }
  clearMatch() {
    if (this.combat) this.combat.clear();
    for (const v of this.vehicles || []) {
      if (v.root) this.scene.remove(v.root);
      if (v.mesh) this.scene.remove(v.mesh);
      if (v.setEmitter) v.setEmitter(0);
    }
    this.vehicles = []; this.tanks = [];
    this.effects.emitters = this.world.smokers.map((sm) => ({ ...sm, size: 1 }));
    this.audio.engine(0);
  }
  goFullscreen() {
    if (!this.touch || AUTOPLAY) return;
    const el = document.documentElement;
    try {
      const r = el.requestFullscreen ? el.requestFullscreen({ navigationUI: 'hide' }) : null;
      if (r && r.then) r.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch (_) {}
  }
  get airshipList() { return this.vehicles.filter((v) => v.kind === 'airship'); }

  // ---------- Появление ----------
  spawnOptions(team) {
    const hq = this.world.def.hq[team];
    const opts = [{ kind: 'hq', label: 'Штаб', x: hq.x, z: hq.z }];
    for (const f of this.flags) {
      if (f.owner === team && f.cnt[1 - team] === 0) opts.push({ kind: 'flag', label: `Флаг ${f.id}`, x: f.x, z: f.z, flag: f });
    }
    for (const s of this.soldiers) {
      if (!s.squad || s.team !== team || s.state !== 'alive' || s.vehicle) continue;
      if (this.time - s.lastDamage < 5 || this.time - s.lastShot < 3) continue;
      if (Math.hypot(s.pos.x - hq.x, s.pos.z - hq.z) < 35) continue;
      opts.push({ kind: 'squad', label: s.name, x: s.pos.x, z: s.pos.z, mate: s });
    }
    const tk = this.tanks[team];
    if (tk && tk.alive && !tk.driver) opts.push({ kind: 'tank', label: 'Танк', x: tk.pos.x, z: tk.pos.z, tank: tk });
    return opts;
  }
  botSpawnChoice(s, initial = false) {
    const team = s.team;
    const opts = this.spawnOptions(team).filter((o) => o.kind !== 'squad' || s.squad);
    if (initial) return opts[0];
    const tk = opts.find((o) => o.kind === 'tank');
    if (tk && this.time - tk.tank.lastDriverExit > 8 && Math.random() < 0.4 && !s.squad) return tk;
    if (s.squad) {
      const pl = this.player;
      if (pl && pl.state === 'alive' && !pl.vehicle && this.time - pl.lastDamage > 4 && Math.random() < 0.6) return { kind: 'squad', x: pl.pos.x, z: pl.pos.z, mate: pl };
    }
    const flagOpts = opts.filter((o) => o.kind === 'flag');
    if (flagOpts.length && Math.random() < 0.75) {
      // Ближе к врагу — чаще
      const ez = this.world.def.hq[1 - team].z;
      flagOpts.sort((a, b) => Math.abs(a.z - ez) - Math.abs(b.z - ez));
      return Math.random() < 0.6 ? flagOpts[0] : pick(flagOpts);
    }
    return opts[0];
  }
  spawnSoldier(s, opt) {
    const w = this.world;
    const hq = w.def.hq[s.team];
    let x, z;
    if (opt.kind === 'tank' && opt.tank.alive && !opt.tank.driver) {
      s.spawn(opt.tank.pos.x, opt.tank.pos.z, opt.tank.yaw);
      opt.tank.enter(s);
      return;
    }
    if (opt.kind === 'hq') [x, z] = w.randomFreePoint(hq.x + rand(-16, 16), hq.z + rand(-6, 6), 5);
    else if (opt.kind === 'flag') [x, z] = w.randomFreePoint(opt.flag.x, opt.flag.z, opt.flag.r * 0.85);
    else if (opt.kind === 'squad' && opt.mate.state === 'alive') {
      const m = opt.mate;
      [x, z] = w.randomFreePoint(m.pos.x + Math.sin(m.yaw) * 1.5, m.pos.z + Math.cos(m.yaw) * 1.5, 2);
    } else [x, z] = w.randomFreePoint(hq.x, hq.z, 12);
    s.spawn(x, z, hq.yaw + rand(-0.3, 0.3));
  }

  // ---------- Экран развёртывания ----------
  showDeploy() {
    this.state = 'deploy';
    this.input.enabled = false;
    this.input.reset();
    document.exitPointerLock && document.pointerLockElement && document.exitPointerLock();
    $('hud').hidden = true;
    $('deploy').hidden = false;
    $('pause').hidden = true;
    $('rotate').hidden = !(this.touch && innerHeight > innerWidth);
    this.audio.engine(0);
    this.deploySel = this.deploySel && this.spawnOptions(this.player.team).find((o) => o.kind === this.deploySel.kind && o.label === this.deploySel.label) || null;
    this.renderClassList();
    this.updateDeploy();
    this.drawDeployMap();
  }
  renderClassList() {
    const box = $('classList');
    box.innerHTML = '';
    for (const c of CLASSES) {
      const w = WEAPONS[c.weapon], gd = GADGETS[c.gadget];
      const b = document.createElement('button');
      b.className = 'classBtn' + (this.player.cls.id === c.id ? ' sel' : '');
      const side = WEAPONS[TEAMS[this.player.team].sidearm];
      b.innerHTML = `<b>${c.name}</b><span>${w.short} + ${side.short.toLowerCase()} · ${gd.short} ×${c.gadgetCount} · гранат ×${c.grenades}</span><small>${c.desc}</small>`;
      b.onclick = () => { this.audio.ui(); this.player.setClass(c.id); this.save.lastClass = c.id; this.persist(); this.renderClassList(); };
      box.appendChild(b);
    }
    // Выбор прицела для основного оружия выбранного класса
    const w = WEAPONS[this.player.cls.weapon];
    const sb = $('sightList');
    sb.innerHTML = '<span>Прицел:</span>';
    const cur = this.save.sights[w.id] && w.sights.includes(this.save.sights[w.id]) ? this.save.sights[w.id] : w.sights[0];
    for (const id of w.sights) {
      const sg = SIGHTS[id];
      const bt = document.createElement('button');
      const z = sg.optic ? sg.zoom : w.ironZoom;
      bt.textContent = (sg.optic ? sg.name : 'Открытый') + (sg.optic ? '' : ` ×${z}`);
      bt.className = id === cur ? 'on' : '';
      bt.onclick = () => { this.audio.ui(); this.save.sights[w.id] = id; this.persist(); this.renderClassList(); };
      sb.appendChild(bt);
    }
  }
  updateDeploy() {
    const p = this.player;
    const wait = Math.max(0, (p.deadAt || -99) + 5 - this.time);
    const btn = $('btnDeploy');
    const opts = this.spawnOptions(p.team);
    if (!this.deploySel || !opts.some((o) => o.kind === this.deploySel.kind && o.label === this.deploySel.label)) {
      // По умолчанию — флаг ближе к фронту, иначе штаб
      const fl = opts.filter((o) => o.kind === 'flag');
      const ez = this.world.def.hq[1 - p.team].z;
      fl.sort((a, b) => Math.abs(a.z - ez) - Math.abs(b.z - ez));
      this.deploySel = fl[0] || opts[0];
    }
    this.deployOpts = opts;
    btn.disabled = wait > 0 && !this.firstDeploy;
    btn.textContent = btn.disabled ? `Подкрепление через ${Math.ceil(wait)}…` : `В бой: ${this.deploySel.label}`;
    const my = p.team;
    $('dTk0').textContent = Math.max(0, Math.ceil(this.teams[my].tickets));
    $('dTk1').textContent = Math.max(0, Math.ceil(this.teams[1 - my].tickets));
    $('dTeam0').textContent = TEAMS[my].name;
    $('dTeam1').textContent = TEAMS[1 - my].name;
    $('dMode').textContent = (this.mode === 'tdm' ? 'Схватка' : 'Захват') + ' · ' + this.world.def.name + ' · ' + fmtTime(this.timeLeft);
  }
  deployXform() {
    const cv = $('deployMap');
    const r = cv.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S = Math.min(r.width, r.height);
    const flip = this.player.team === 1;
    return { cv, r, dpr, S, flip, k: S / (PLAY * 2 + 8), ox: (r.width - S) / 2, oy: (r.height - S) / 2 };
  }
  drawDeployMap() {
    if (this.state !== 'deploy' || !this.world) return;
    const X = this.deployXform();
    const { cv, r, dpr, S, k } = X;
    cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, r.width, r.height);
    c.save();
    c.translate(X.ox + S / 2, X.oy + S / 2);
    if (X.flip) c.rotate(Math.PI);
    c.scale(k, k);
    c.drawImage(this.world.minimap, -HALF, -HALF);
    c.restore();
    const toS = (x, z) => {
      let px = x * k, pz = z * k;
      if (X.flip) { px = -px; pz = -pz; }
      return [X.ox + S / 2 + px, X.oy + S / 2 + pz];
    };
    this.deployToS = toS;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const p = this.player;
    // Флаги
    for (const f of this.flags) {
      const [x, y] = toS(f.x, f.z);
      c.fillStyle = 'rgba(15,12,10,0.65)';
      c.beginPath(); c.arc(x, y, 15, 0, TAU); c.fill();
      c.strokeStyle = f.owner < 0 ? '#e8e2d0' : f.owner === p.team ? '#5fb4ff' : '#ff4a3d';
      c.lineWidth = 3;
      c.beginPath(); c.arc(x, y, 13, 0, TAU); c.stroke();
      c.fillStyle = c.strokeStyle;
      c.font = '700 15px Oswald, sans-serif';
      c.fillText(f.id, x, y + 1);
    }
    // Свои
    for (const s of this.soldiers) {
      if (s.team !== p.team || s.state !== 'alive' || s.isPlayer) continue;
      const [x, y] = toS(s.pos.x, s.pos.z);
      c.fillStyle = s.squad ? '#7dff8a' : 'rgba(95,180,255,0.85)';
      c.beginPath(); c.arc(x, y, s.squad ? 4 : 3, 0, TAU); c.fill();
    }
    // Точки высадки
    for (const o of this.deployOpts || []) {
      const [x, y] = toS(o.x, o.z);
      const sel = this.deploySel && o.kind === this.deploySel.kind && o.label === this.deploySel.label;
      c.strokeStyle = sel ? '#ffd45c' : 'rgba(255,255,255,0.75)';
      c.lineWidth = sel ? 4 : 2;
      const rr = o.kind === 'flag' ? 20 : 12;
      c.beginPath(); c.arc(x, y, rr, 0, TAU); c.stroke();
      if (o.kind !== 'flag') {
        c.fillStyle = sel ? '#ffd45c' : '#fff';
        c.font = '700 11px Oswald, sans-serif';
        c.fillText(o.kind === 'hq' ? 'ШТАБ' : o.kind === 'tank' ? 'ТАНК' : o.label, x, o.kind === 'tank' ? y + rr + 9 : y - rr - 9);
      }
    }
  }
  deployClick(e) {
    if (!this.deployToS || !this.deployOpts) return;
    const X = this.deployXform();
    const mx = e.clientX - X.r.left, my = e.clientY - X.r.top;
    let best = null, bd = 40;
    for (const o of this.deployOpts) {
      const [x, y] = this.deployToS(o.x, o.z);
      const d = Math.hypot(mx - x, my - y);
      if (d < bd) { bd = d; best = o; }
    }
    if (best) { this.deploySel = best; this.audio.ui(); this.updateDeploy(); this.drawDeployMap(); }
  }
  deploy() {
    const p = this.player;
    if ($('btnDeploy').disabled) return;
    this.audio.init();
    const opts = this.spawnOptions(p.team);
    const sel = opts.find((o) => o.kind === this.deploySel.kind && o.label === this.deploySel.label) || opts[0];
    this.spawnSoldier(p, sel);
    if (this.firstDeploy) { this.audio.whistle(); this.hud.announce(this.mode === 'tdm' ? 'Уничтожьте врага!' : 'Захватите флаги!', true); }
    this.firstDeploy = false;
    this.enterPlay();
  }
  enterPlay() {
    const p = this.player;
    this.state = 'play';
    $('deploy').hidden = true;
    $('hud').hidden = false;
    this.input.enabled = true;
    this.input.reset();
    this.input.setAds(false);
    this.input.setCrouch(false);
    this.input.setProne(false);
    this.tankZoom = false;
    this.viewmodel.set(p.team, p.weapon.id, p.sight.optic);
    this.camYaw = p.yaw;
    this.camPitch = 0;
    this.updateControls();
    $('rotate').hidden = !(this.touch && innerHeight > innerWidth);
  }
  updateControls() {
    const p = this.player;
    const inTank = !!p.vehicle;
    document.body.classList.toggle('in-tank', inTank);
    document.body.classList.toggle('touch', this.input.touchMode);
    document.body.classList.toggle('left-fire', !!this.settings.leftFire);
    const gb = document.querySelector('[data-btn="gadget"] span');
    if (gb && gb.dataset.k !== p.cls.gadget) { gb.innerHTML = ICONS[p.cls.gadget]; gb.dataset.k = p.cls.gadget; }
    const ge = document.querySelector('[data-btn="gadget"] em');
    if (ge) ge.textContent = GADGETS[p.cls.gadget].short.toLowerCase();
    const ae = document.querySelector('[data-btn="ads"] em');
    if (ae) ae.textContent = p.vehicle ? 'оптика' : 'прицел';
    this.updatePcHint();
  }
  setupIcons() {
    document.querySelectorAll('.cbtn[data-btn]').forEach((b) => {
      const k = b.dataset.btn === 'fire2' ? 'fire' : b.dataset.icon || b.dataset.btn;
      const sp = b.querySelector('span');
      if (sp && ICONS[k]) sp.innerHTML = ICONS[k];
    });
  }
  onInputMode(touch) {
    if (this.state === 'play' || this.state === 'pause') this.updateControls();
    document.body.classList.toggle('touch', touch);
  }
  // На ПК мышь захватывается щелчком; Esc отпускает её и ставит паузу
  lockPointer() {
    if (this.input.touchMode || AUTOPLAY) return;
    const c = this.renderer.domElement;
    if (document.pointerLockElement === c || !c.requestPointerLock) return;
    try { const r = c.requestPointerLock({ unadjustedMovement: true }); if (r && r.catch) r.catch(() => { try { c.requestPointerLock(); } catch (_) {} }); } catch (_) {}
  }
  updatePcHint() {
    const pc = !this.input.touchMode && this.state === 'play';
    $('clickPlay').hidden = !(pc && !document.pointerLockElement && this.player && this.player.state !== 'dead');
    $('pcKeys').hidden = !pc || !!this.player.vehicle;
    $('pcKeysTank').hidden = !pc || !this.player.vehicle;
  }
  toggleMap(on = $('bigmap').hidden) {
    if (this.state !== 'play') on = false;
    $('bigmap').hidden = !on;
    if (on) { this.hud.drawFullMap($('bigmapCv')); this.mapT = 0.3; }
  }

  // ---------- Пауза и меню ----------
  pause(on) {
    if (this.state !== 'play' && this.state !== 'pause') return;
    this.paused = on;
    this.state = on ? 'pause' : 'play';
    $('pause').hidden = !on;
    this.input.enabled = !on;
    this.input.reset();
    if (on && document.pointerLockElement) document.exitPointerLock();
    this.audio.suspend(on);
    if (on) { this.hud.showScores(false); this.toggleMap(false); }
    else this.lockPointer();
    this.updatePcHint();
  }
  toMenu() {
    this.running = false;
    this.state = 'menu';
    this.paused = false;
    this.audio.suspend(false);
    this.audio.engine(0);
    this.audio.setRain(false);
    this.input.enabled = false;
    if (document.pointerLockElement) document.exitPointerLock();
    for (const id of ['hud', 'deploy', 'pause', 'end', 'settings', 'help']) $(id).hidden = true;
    $('menu').hidden = false;
    $('rotate').hidden = true;
    this.clearMatch();
    this.soldiers = [];
    this.flags = [];
    this.soldierR.update([], 0, null, null);
    for (const fo of this.flagObjs) { fo.cloth.visible = true; fo.ring.visible = true; fo.cloth.material.color.setHex(0xe8e2d0); fo.ring.material.color.setHex(0xe8e2d0); }
    document.body.classList.remove('ended', 'downed', 'in-tank');
    this.renderMenu();
  }
  persist() {
    this.save.settings = this.settings;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(this.save)); } catch (_) {}
  }

  // ---------- Игровые события ----------
  addScore(s, pts, reason) {
    if (!s || !pts) return;
    s.stats.score += pts;
    if (s.isPlayer) this.hud.scorePop(pts, reason);
  }
  flagAt(x, z) {
    for (const f of this.flags) if ((x - f.x) ** 2 + (z - f.z) ** 2 < f.r * f.r) return f;
    return null;
  }
  hearShot(src) {
    for (const s of this.soldiers) {
      if (s.bot && s.team !== src.team && s.state === 'alive' && !s.vehicle) {
        const dx = s.pos.x - src.pos.x, dz = s.pos.z - src.pos.z;
        if (dx * dx + dz * dz < 3600) s.bot.hear(src);
      }
    }
  }
  onPlayerHurt(amount, attacker, dx, dz) {
    const p = this.player;
    if (attacker && attacker !== p) {
      const ap = attacker.vehicle ? attacker.vehicle.pos : attacker.pos;
      this.hud.damageFrom(yawTo(ap.x - p.pos.x, ap.z - p.pos.z));
    } else if (dx || dz) this.hud.damageFrom(yawTo(-dx, -dz));
    if (amount > 0) {
      const el = $('dmgFlash');
      el.style.opacity = Math.min(0.7, 0.2 + amount / 80);
      clearTimeout(this._df);
      this._df = setTimeout(() => (el.style.opacity = 0), 120);
      if (amount > 12) this.audio.hurt();
      this.vibrate(amount > 40 ? 60 : 25);
    }
  }
  vibrate(ms) {
    if (!this.settings.vibration || !navigator.vibrate) return;
    try { navigator.vibrate(ms); } catch (_) {}
  }
  shake(k) { this.shakeK = Math.min(1.2, Math.max(this.shakeK, k)); }
  onDowned(t, attacker) {
    if (t.vehicle) t.vehicle.exit();
    if (t.isPlayer) {
      this.input.setAds(false);
      this.hud.killer = attacker;
      $('downed').hidden = false;
      $('killerName').textContent = attacker && attacker !== t ? `Вас ранил: ${attacker.name}` : 'Вы тяжело ранены';
      this.vibrate(120);
    }
  }
  onDeath(t) {
    this.teams[t.team].tickets -= 1;
    if (t.vehicle) t.vehicle.exit();
    if (t.isPlayer) {
      $('downed').hidden = true;
      this.deathT = 2.2;
      this.input.enabled = false;
      this.input.reset();
    }
  }
  onRevived(t, medic) {
    if (t.isPlayer) {
      $('downed').hidden = true;
      this.hud.announce(`Вас поднял ${medic.name}`, true);
      this.input.enabled = true;
      this.camPitch = 0;
    }
    if (medic.isPlayer) this.hud.announce(`Вы подняли: ${t.name}`, true);
  }
  assigned(team, flag) {
    if (this._asgT !== this.time) {
      this._asgT = this.time;
      this._asg = [new Map(), new Map()];
      for (const s of this.soldiers) if (s.bot && s.bot.flag) this._asg[s.team].set(s.bot.flag, (this._asg[s.team].get(s.bot.flag) || 0) + 1);
    }
    return this._asg[team].get(flag) || 0;
  }
  hotspot(team) {
    const en = this.soldiers.filter((s) => s.team !== team && s.state === 'alive');
    if (!en.length) return [rand(-40, 40), rand(-40, 40)];
    const s = pick(en);
    return [clamp(s.pos.x + rand(-20, 20), -PLAY + 5, PLAY - 5), clamp(s.pos.z + rand(-20, 20), -PLAY + 5, PLAY - 5)];
  }

  // ---------- Управление игроком ----------
  playerControl(dt, inp) {
    const p = this.player, st = this.settings;
    if (AUTOPLAY) { if (p.state === 'alive' && p.bot) p.bot.update(dt); return; }
    const touch = this.input.touchMode;
    let k = touch ? 0.0052 * st.sens : 0.0024 * (st.mouseSens || 1);
    const inv = st.invertY ? -1 : 1;
    this.lookDX = inp.dx; this.lookDY = inp.dy;
    if (inp.ev.has('map')) this.toggleMap();
    if (inp.ev.has('help') && !touch) { this.pcHelp = !this.pcHelp; $('pcKeys').classList.toggle('big', this.pcHelp); }
    if (p.state === 'downed') {
      if (inp.ev.has('giveup')) this.combat.finishOff(p, null);
      return;
    }
    if (p.state !== 'alive') return;
    if (inp.ev.has('pause')) { this.pause(true); return; }
    if (p.vehicle) { this.tankControl(dt, inp, k); return; }
    // Чем сильнее приближение, тем медленнее обзор
    k *= lerp(1, 1 / p.zoom, p.adsT);
    // Помощь в прицеливании на сенсоре
    let aaSlow = 1;
    const aa = touch ? st.aimAssist : 0;
    if (aa > 0) {
      const t = this.aimTarget(p);
      if (t) {
        aaSlow = 1 - 0.45 * aa;
        if (inp.fire || p.adsT > 0.3 || inp.mx || inp.my) {
          const pull = Math.min(1, dt * 3.5 * aa * (p.adsT > 0.3 ? 1.6 : 1));
          p.yaw += angleDiff(p.yaw, t.yaw) * pull;
          p.pitch += (t.pitch - p.pitch) * pull * 0.7;
        }
      }
    }
    p.yaw -= inp.dx * k * aaSlow;
    p.pitch = clamp(p.pitch - inp.dy * k * aaSlow * inv, -1.45, 1.45);
    // Отдача: часть возвращается сама
    if (p.recoilP || p.recoilY) {
      p.pitch += p.recoilP; p.yaw += p.recoilY;
      this.recoilDebt = (this.recoilDebt || 0) + p.recoilP * 0.65;
      p.recoilP = 0; p.recoilY = 0;
    }
    if (this.recoilDebt > 0 && !inp.fire) {
      const r = Math.min(this.recoilDebt, (this.recoilDebt * 7 + 0.3 * DEG) * dt);
      p.pitch -= r; this.recoilDebt -= r;
    }
    p.pitch = clamp(p.pitch, -1.45, 1.45);
    // Движение
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    p.input.mx = fx * -inp.my + rx * inp.mx;
    p.input.mz = fz * -inp.my + rz * inp.mx;
    // Бег поднимает с колена и с земли; прицел бег прерывает
    if (inp.sprint && !inp.ads && (this.input.crouch || this.input.prone) && Math.hypot(inp.mx, inp.my) > 0.5) { this.input.setCrouch(false); this.input.setProne(false); }
    p.input.sprint = inp.sprint;
    p.input.fire = inp.fire;
    p.input.ads = inp.ads;
    p.input.hold = inp.hold;
    p.input.crouch = this.input.crouch;
    p.input.prone = this.input.prone;
    const ev = inp.ev;
    if (ev.has('jump')) {
      if (this.input.crouch || this.input.prone) { this.input.setCrouch(false); this.input.setProne(false); }
      else p.input.jump = true;
    }
    if (ev.has('swap') || (ev.has('slot1') && p.slot !== 0) || (ev.has('slot2') && p.slot !== 1)) p.input.swap = true;
    if (ev.has('reload')) p.input.reload = true;
    if (ev.has('grenade')) p.input.grenade = true;
    if (ev.has('gadget')) p.input.gadget = true;
    if (ev.has('melee')) p.input.melee = true;
    // Взаимодействие
    const ctx = this.interactTarget();
    this.ctxAction = ctx;
    if (ev.has('interact') && ctx) {
      if (ctx.kind === 'tank') { ctx.tank.enter(p); this.updateControls(); this.camYaw = ctx.tank.turretYaw; this.camPitch = 0.1; this.input.setAds(false); }
      else if (ctx.kind === 'revive') { this.reviveT = 0; this.reviving = ctx.target; }
    }
    if (this.reviving) {
      const t = this.reviving;
      if (t.state !== 'downed' || t.pos.distanceTo(p.pos) > 2.4 || p.state !== 'alive') this.reviving = null;
      else {
        this.reviveT += dt;
        p.input.mx = 0; p.input.mz = 0; p.input.fire = false;
        if (this.reviveT >= 1.1) { this.combat.revive(t, p); this.reviving = null; }
      }
    }
    // Подбор патронов с павших
    const pw = WEAPONS[p.slots[0]], pa = p.ammo[pw.id];
    if (pa && pa.reserve < pw.reserve) {
      for (const s of this.soldiers) {
        if (s.state !== 'dead' || s.looted || s === p) continue;
        if ((s.pos.x - p.pos.x) ** 2 + (s.pos.z - p.pos.z) ** 2 < 2.5) {
          s.looted = true;
          pa.reserve = Math.min(pw.reserve, pa.reserve + pw.mag);
          this.hud.announce('+патроны', true);
        }
      }
    }
  }
  aimTarget(p) {
    if (this._aaT > this.time - 0.1) return this._aa;
    this._aaT = this.time;
    this._aa = null;
    const ex = p.pos.x, ey = p.eyeY, ez = p.pos.z;
    let best = 7 * DEG;
    for (const s of this.soldiers) {
      if (s.team === p.team || s.state !== 'alive' || s.vehicle) continue;
      const dx = s.pos.x - ex, dz = s.pos.z - ez, dy = s.aimY - ey;
      const d = Math.hypot(dx, dz);
      if (d > 90 || d < 1) continue;
      const yw = yawTo(dx, dz), pt = Math.atan2(dy, d);
      const ang = Math.hypot(angleDiff(p.yaw, yw), pt - p.pitch);
      const lim = Math.max(2.5 * DEG, Math.atan2(1.4, d));
      if (ang < Math.min(best, lim) && this.world.los(ex, ey, ez, s.pos.x, s.aimY, s.pos.z)) { best = ang; this._aa = { yaw: yw, pitch: pt, s }; }
    }
    return this._aa;
  }
  interactTarget() {
    const p = this.player;
    if (p.state !== 'alive') return null;
    if (p.cls.revive) {
      let best = null, bd = 2.3;
      for (const s of this.soldiers) {
        if (s.team !== p.team || s.state !== 'downed') continue;
        const d = s.pos.distanceTo(p.pos);
        if (d < bd) { bd = d; best = s; }
      }
      if (best) return { kind: 'revive', target: best, label: 'Поднять' };
    }
    for (const t of this.tanks) {
      if (!t || t.team !== p.team || !t.alive || t.driver) continue;
      if (Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z) < 4.2) return { kind: 'tank', tank: t, label: 'В танк' };
    }
    return null;
  }
  tankControl(dt, inp, k) {
    const p = this.player, t = p.vehicle, st = this.settings;
    const inv = st.invertY ? -1 : 1;
    this.tankZoom = !!inp.ads;
    if (this.tankZoom) k *= 0.3;
    this.camYaw -= inp.dx * k * 0.9;
    this.camPitch = clamp(this.camPitch - inp.dy * k * 0.9 * inv, -0.35, 0.6);
    t.input.throttle = -inp.my;
    t.input.steer = inp.mx;
    t.input.fire = inp.fire;
    t.input.mg = inp.mg;
    if (inp.ev.has('interact') || inp.ev.has('exit')) {
      t.exit();
      this.audio.engine(0);
      this.tankZoom = false;
      this.input.setAds(false);
      this.updateControls();
      p.pitch = 0;
      return;
    }
    // Куда смотрит камера — туда наводится башня
    const cam = this.camera;
    cam.getWorldDirection(_d);
    const hit = this.world.raycast(cam.position.x, cam.position.y, cam.position.z, _d.x, _d.y, _d.z, 300, null);
    const dist = Math.min(hit, 300);
    _v.copy(cam.position).addScaledVector(_d, dist);
    const m = t.muzzle(_v2);
    const dx = _v.x - m.x, dz = _v.z - m.z, dh = Math.hypot(dx, dz);
    const drop = 0.5 * 9.8 * (dh / 150) ** 2;
    t.input.aimYaw = yawTo(dx, dz);
    t.input.aimPitch = Math.atan2(_v.y - m.y + drop, dh);
    // Точка, куда реально смотрит ствол
    t.gunDir(_d);
    const gh = this.world.raycast(m.x, m.y, m.z, _d.x, _d.y, _d.z, 250, null);
    this.tankAim = (this.tankAim || new THREE.Vector3()).copy(m).addScaledVector(_d, Math.min(gh, 250));
    this.tankAimDist = dist < 300 ? dist : 0;
    p.yaw = t.turretYaw;
  }

  // ---------- Обновление ----------
  update(dt) {
    const p = this.player;
    this.time += dt;
    if (this.state !== 'end') this.timeLeft -= dt;
    const inp = this.input.read();
    if (this.state === 'play' || this.state === 'deploy') this.playerControl(dt, this.state === 'play' ? inp : { ...inp, ev: new Set(), dx: 0, dy: 0 });
    for (const s of this.soldiers) if (s.bot && !s.isPlayer) s.bot.update(dt);
    for (const s of this.soldiers) s.update(dt);
    // Расталкиваем солдат
    const S = this.soldiers;
    for (let i = 0; i < S.length; i++) {
      const a = S[i];
      if (a.state !== 'alive' || a.vehicle) continue;
      for (let j = i + 1; j < S.length; j++) {
        const b = S[j];
        if (b.state !== 'alive' || b.vehicle) continue;
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 0.56 && Math.abs(a.pos.y - b.pos.y) < 1.5 && d2 > 1e-6) {
          const d = Math.sqrt(d2), k = (0.75 - d) / d * 0.5;
          a.pos.x -= dx * k; a.pos.z -= dz * k; b.pos.x += dx * k; b.pos.z += dz * k;
        }
      }
      for (const v of this.tanks) {
        if (!v) continue;
        const dx = a.pos.x - v.pos.x, dz = a.pos.z - v.pos.z, d2 = dx * dx + dz * dz;
        if (d2 < 6.25 && d2 > 1e-6 && Math.abs(a.pos.y - v.pos.y) < 2.5) {
          const d = Math.sqrt(d2);
          a.pos.x = v.pos.x + (dx / d) * 2.5; a.pos.z = v.pos.z + (dz / d) * 2.5;
        }
      }
    }
    for (const v of this.vehicles) v.update(dt);
    for (const s of S) if (s.vehicle) { s.pos.copy(s.vehicle.pos); s.pos.y += 1.5; }
    for (let i = this.vehicles.length - 1; i >= 0; i--) if (!this.vehicles[i].alive && this.vehicles[i].kind === 'airship') this.vehicles.splice(i, 1);
    for (const pl of this.planes) pl.update(dt);
    this.combat.updateProjectiles(dt);
    this.combat.updateDeployables(dt);
    if (this.state !== 'end') {
      this.updateFlags(dt);
      this.respawnBots(dt);
      this.director(dt);
    }
    this.world.update(dt);
    // Смерть игрока → экран развёртывания
    if (p.state === 'dead' && this.state === 'play') {
      this.deathT -= dt;
      if (this.deathT <= 0) {
        if (AUTOPLAY) { p.respawnT -= dt; if (p.respawnT <= 0) this.spawnSoldier(p, this.botSpawnChoice(p)); }
        else this.showDeploy();
      }
    }
    if (this.state === 'deploy') {
      this.deployRefresh = (this.deployRefresh || 0) - dt;
      if (this.deployRefresh <= 0) { this.deployRefresh = 0.5; this.updateDeploy(); this.drawDeployMap(); }
    }
    this.checkEnd(dt);
  }
  respawnBots(dt) {
    for (const s of this.soldiers) {
      if (s.state !== 'dead' || (s.isPlayer && !AUTOPLAY)) continue;
      if (s.isPlayer) continue;
      s.respawnT -= dt;
      if (s.respawnT > 0) continue;
      if (Math.random() < 0.2) s.setClass(pick(['assault', 'assault', 'medic', 'medic', 'support', 'scout']));
      this.spawnSoldier(s, this.botSpawnChoice(s));
    }
  }
  updateFlags(dt) {
    const T = this.teams;
    if (this.mode === 'tdm') return;
    const p = this.player;
    this.playerFlag = null;
    const held = [0, 0];
    for (const f of this.flags) {
      f.cnt[0] = 0; f.cnt[1] = 0;
      for (const s of this.soldiers) {
        if (s.state !== 'alive') continue;
        const dx = s.pos.x - f.x, dz = s.pos.z - f.z;
        if (dx * dx + dz * dz < f.r * f.r && Math.abs(s.pos.y - f.pole.y) < 10) {
          f.cnt[s.team]++;
          if (s === p) this.playerFlag = f;
        }
      }
      const diff = f.cnt[0] - f.cnt[1];
      const prevOwner = f.owner;
      if (diff !== 0) {
        const rate = 0.07 * (1 + 0.35 * (Math.min(Math.abs(diff), 4) - 1));
        f.control = clamp(f.control + Math.sign(diff) * rate * dt, -1, 1);
      } else if (!f.cnt[0] && !f.cnt[1]) {
        const tgt = f.owner === 0 ? 1 : f.owner === 1 ? -1 : 0;
        f.control += clamp(tgt - f.control, -0.03 * dt, 0.03 * dt);
      }
      if (f.control >= 1 && f.owner !== 0) f.owner = 0;
      else if (f.control <= -1 && f.owner !== 1) f.owner = 1;
      else if (f.owner === 0 && f.control <= 0) f.owner = -1;
      else if (f.owner === 1 && f.control >= 0) f.owner = -1;
      f.contested = f.owner >= 0 && f.cnt[1 - f.owner] > 0;
      if (f.owner !== prevOwner) this.onFlagChange(f, prevOwner);
      if (f.owner >= 0) held[f.owner]++;
      // Флаг ползёт по флагштоку
      const fo = f.obj;
      fo.cloth.position.y = f.pole.y + 1.6 + Math.abs(f.control) * 6.6;
      const side = f.control > 0.001 ? 0 : f.control < -0.001 ? 1 : -1;
      fo.cloth.material.color.setHex(this.relColor(Math.abs(f.control) < 0.02 ? -1 : side));
      fo.ring.material.color.setHex(this.relColor(f.owner));
    }
    // Утечка очков подкрепления
    for (let t = 0; t < 2; t++) {
      const o = 1 - t;
      if (held[o] > held[t] && held[o] >= 3) T[t].tickets -= (0.08 + 0.08 * (held[o] - held[t])) * dt;
    }
    // Цель отряда: флаг, где игрок, или ближайший не наш
    this.objT -= dt;
    if (this.objT <= 0) {
      this.objT = 2;
      if (this.playerFlag && (this.playerFlag.owner !== p.team || this.playerFlag.contested)) this.playerObjective = this.playerFlag;
      else {
        let best = null, bd = Infinity;
        for (const f of this.flags) {
          if (f.owner === p.team && !f.contested) continue;
          const d = Math.hypot(f.x - p.pos.x, f.z - p.pos.z);
          if (d < bd) { bd = d; best = f; }
        }
        this.playerObjective = best;
      }
    }
  }
  onFlagChange(f, prev) {
    const p = this.player;
    const capTeam = f.owner >= 0 ? f.owner : prev >= 0 ? 1 - prev : -1;
    for (const s of this.soldiers) {
      if (s.state !== 'alive' || s.team !== capTeam) continue;
      if ((s.pos.x - f.x) ** 2 + (s.pos.z - f.z) ** 2 > f.r * f.r) continue;
      if (f.owner >= 0) { s.stats.caps++; this.addScore(s, SCORE.capture, `Флаг ${f.id} захвачен`); }
      else this.addScore(s, SCORE.neutralize, `Флаг ${f.id} нейтрализован`);
    }
    if (f.owner >= 0) {
      const good = f.owner === p.team;
      this.hud.announce(good ? `Мы захватили флаг ${f.id} «${f.name}»` : `Враг захватил флаг ${f.id} «${f.name}»`, good);
      this.audio.capture(good);
    } else if (prev === p.team) {
      this.hud.announce(`Мы теряем флаг ${f.id}!`, false);
      this.audio.announce(false);
    }
  }
  director(dt) {
    const T = this.teams;
    // Танкисты
    this.assignT -= dt;
    if (this.assignT <= 0) {
      this.assignT = 4;
      for (let t = 0; t < 2; t++) {
        const tk = this.tanks[t];
        if (!tk || !tk.alive || tk.driver) continue;
        const has = this.soldiers.some((s) => s.team === t && s.bot && s.bot.wantTank && s.state === 'alive' && !s.isPlayer);
        if (has || this.time - tk.lastDriverExit < 10) continue;
        const pl = this.player;
        if (pl.team === t && pl.state === 'alive' && Math.hypot(pl.pos.x - tk.pos.x, pl.pos.z - tk.pos.z) < 25) continue;
        const cands = this.soldiers.filter((s) => s.team === t && s.bot && !s.squad && !s.isPlayer && s.state === 'alive' && s.pos.distanceTo(tk.pos) < 60);
        if (cands.length) pick(cands).bot.wantTank = true;
      }
    }
    // Цеппелин для отстающих
    this.airT -= dt;
    if (this.airT <= 0 && this.mode === 'conquest') {
      this.airT = 5;
      for (let t = 0; t < 2; t++) {
        const o = 1 - t;
        if (T[t].airship) continue;
        if (T[t].tickets < T[o].tickets * 0.62 && T[o].tickets - T[t].tickets > this.maxTickets * 0.18 && this.time > 90) {
          T[t].airship = true;
          const a = new Airship(this, t);
          this.vehicles.push(a);
          const good = t === this.player.team;
          this.hud.announce(good ? 'На подмогу летит наш цеппелин!' : 'Враг вызвал цеппелин!', good);
          this.audio.announce(good);
        }
      }
    }
    // Далёкая артиллерия для атмосферы
    this.artyT -= dt;
    if (this.artyT <= 0) {
      this.artyT = rand(2.5, 7);
      if (Math.random() < 0.55) this.audio.distantArtillery();
      else {
        for (let k = 0; k < 6; k++) {
          const x = rand(-PLAY + 10, PLAY - 10), z = rand(-80, 80);
          if (this.soldiers.some((s) => s.state !== 'dead' && (s.pos.x - x) ** 2 + (s.pos.z - z) ** 2 < 45 * 45)) continue;
          if (this.flags.some((f) => (f.x - x) ** 2 + (f.z - z) ** 2 < 30 * 30)) continue;
          const y = this.world.height(x, z);
          this.effects.explosion(x, y, z, 1.3);
          this.audio.explosion(x, y, z, 1.2);
          break;
        }
      }
    }
  }
  checkEnd(dt) {
    if (this.state === 'end') {
      this.endT -= dt;
      if (this.endT <= 0 && $('end').hidden) this.showEnd();
      return;
    }
    if (this.state !== 'play' && this.state !== 'deploy' && this.state !== 'pause') return;
    const T = this.teams;
    let w = -1;
    if (T[0].tickets <= 0) w = 1;
    else if (T[1].tickets <= 0) w = 0;
    else if (this.timeLeft <= 0) w = T[0].tickets >= T[1].tickets ? 0 : 1;
    if (w < 0) return;
    this.winner = w;
    this.state = 'end';
    this.endT = 1.0;
    document.body.classList.add('ended');
    this.input.enabled = false;
    this.input.reset();
    $('deploy').hidden = true;
    $('downed').hidden = true;
    const good = w === this.player.team;
    this.hud.announce(good ? 'ПОБЕДА!' : 'ПОРАЖЕНИЕ', good);
    this.audio.capture(good);
    this.audio.whistle();
  }
  showEnd() {
    const p = this.player, good = this.winner === p.team;
    if (document.pointerLockElement) document.exitPointerLock();
    $('hud').hidden = true;
    $('end').hidden = false;
    const xpGain = p.stats.score + (good ? 500 : 150);
    const before = rankFor(this.save.xp);
    this.save.xp += xpGain;
    const after = rankFor(this.save.xp);
    const tt = this.save.totals;
    tt.matches++; if (good) tt.wins++;
    tt.kills += p.stats.kills; tt.deaths += p.stats.deaths; tt.revives += p.stats.revives; tt.caps += p.stats.caps;
    this.persist();
    $('endTitle').textContent = good ? 'Победа' : 'Поражение';
    $('endTitle').className = good ? 'good' : 'bad';
    $('endSub').textContent = `${TEAMS[this.winner].name} побеждают · ${this.world.def.name}`;
    const all = this.soldiers.slice().sort((a, b) => b.stats.score - a.stats.score);
    const place = all.indexOf(p) + 1;
    $('endStats').innerHTML = [
      ['Очки', p.stats.score], ['Место', `${place} из ${all.length}`], ['Убийства', p.stats.kills], ['Смерти', p.stats.deaths],
      ['В голову', p.stats.heads], ['Захваты', p.stats.caps], ['Оживления', p.stats.revives], ['Помощь', p.stats.assists],
    ].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
    const rk = after;
    const prog = rk.to > rk.from ? (this.save.xp - rk.from) / (rk.to - rk.from) : 1;
    $('endRank').innerHTML = `<div class="rk">${rk.name}${after.index > before.index ? ' <em>— новое звание!</em>' : ''}</div>
      <div class="xpbar"><i style="width:${clamp(prog, 0, 1) * 100}%"></i></div><small>+${xpGain} опыта${rk.next ? ` · до звания «${rk.next}»: ${rk.to - this.save.xp}` : ''}</small>`;
    this.hud.fillScores();
    $('endScores').innerHTML = $('scoresBody').innerHTML;
    if (AUTOPLAY) window.__ended = { winner: this.winner, tickets: this.teams.map((t) => t.tickets), time: this.time };
  }

  // ---------- Камера ----------
  updateCamera(dt) {
    const cam = this.camera, p = this.player, st = this.settings;
    let fov = st.fov;
    this.shakeK = Math.max(0, this.shakeK - dt * 2.2);
    const sk = this.shakeK * this.shakeK;
    const sx = (Math.random() - 0.5) * sk * 0.06, sy = (Math.random() - 0.5) * sk * 0.06;
    if (this.state === 'deploy' || (this.state === 'end' && p.state !== 'alive') || this.state === 'menu') {
      const t = performance.now() / 1000 * 0.04;
      const r = 150;
      cam.position.set(Math.sin(t) * r, 85, Math.cos(t) * r);
      cam.lookAt(0, 0, 0);
      this.viewYaw = cam.rotation.y;
    } else if (p.vehicle && this.tankZoom) {
      // Прицел наводчика: камера на башне, приближение ×3.5
      const v = p.vehicle;
      v.turret.updateWorldMatrix(true, false);
      _v.set(0, 0.85, -0.2).applyMatrix4(v.turret.matrixWorld);
      cam.position.copy(_v);
      cam.rotation.set(this.camPitch + sy * 0.3, this.camYaw + sx * 0.3, 0);
      this.viewYaw = this.camYaw;
      fov = zoomFov(st.fov, 3.5);
    } else if (p.vehicle) {
      const v = p.vehicle;
      dirFromYawPitch(this.camYaw, this.camPitch, _d);
      const back = 9, up = 3.6;
      const target = _v.set(v.pos.x, v.pos.y + 2.6, v.pos.z);
      cam.position.set(target.x - _d.x * back, target.y + up - _d.y * back, target.z - _d.z * back);
      const gy = this.world.height(cam.position.x, cam.position.z) + 0.8;
      if (cam.position.y < gy) cam.position.y = gy;
      cam.rotation.set(this.camPitch - 0.18 + sy, this.camYaw + sx, 0);
      this.viewYaw = this.camYaw;
      fov = st.fov;
    } else if (p.state === 'dead' && this.deathT > 0) {
      const k = p.killer;
      cam.position.set(p.pos.x, p.pos.y + 1.2, p.pos.z);
      if (k && k !== p) {
        const kp = k.vehicle ? k.vehicle.pos : k.pos;
        _v.set(kp.x, kp.y + 1.3, kp.z);
        const q0 = cam.quaternion.clone();
        cam.lookAt(_v);
        cam.quaternion.slerpQuaternions(q0, cam.quaternion, Math.min(1, dt * 4));
        fov = 45;
      }
      this.viewYaw = cam.rotation.y;
    } else if (p.state === 'downed') {
      cam.position.set(p.pos.x + Math.sin(p.yaw) * 1.2, p.pos.y + 0.45, p.pos.z + Math.cos(p.yaw) * 1.2);
      cam.rotation.set(0.5 + Math.sin(this.time) * 0.03, p.yaw, Math.sin(this.time * 0.7) * 0.1);
      this.viewYaw = p.yaw;
    } else {
      const bob = p.onGround ? Math.sin(p.walkPhase * 2) * 0.035 * Math.min(1, Math.hypot(p.vel.x, p.vel.z) / 5) * (1 - p.adsT) * (1 - p.proneT * 0.6) : 0;
      cam.position.set(p.pos.x, p.eyeY + bob, p.pos.z);
      // Покачивание оптики: меньше присев и лёжа, почти нет при задержке дыхания (Shift)
      let sway = 0, swayY = 0;
      if (p.sight.optic && p.adsT > 0.8) {
        this.breath = clamp((this.breath ?? 1) + (p.input.hold && this.breath > 0.05 ? -dt / 4 : dt / 3), 0, 1);
        const calm = p.input.hold && this.breath > 0.05 ? 0.12 : 1;
        const k = (0.0022 + p.zoom * 0.00022) * (1 - p.crouchT * 0.45 - p.proneT * 0.7) * calm;
        sway = Math.sin(this.time * 0.9) * k; swayY = Math.sin(this.time * 1.3) * k * 0.8;
      }
      cam.rotation.set(p.pitch + sy + swayY, p.yaw + sx + sway, p.chargeT > 0 ? Math.sin(this.time * 14) * 0.03 : 0);
      fov = lerp(st.fov, zoomFov(st.fov, p.zoom), p.adsT);
      if (p.sprinting) fov += 5;
      if (p.chargeT > 0) fov += 9;
      this.viewYaw = p.yaw;
    }
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = lerp(cam.fov, fov, Math.min(1, dt * 14));
      cam.updateProjectionMatrix();
      this.effects.setScale(innerHeight * this.renderer.getPixelRatio(), cam.fov);
    }
    cam.updateMatrixWorld();
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, this.viewYaw);
    // Тень следует за камерой
    if (this.sun) {
      const c = cam.position;
      const sx2 = Math.round(c.x / 4) * 4, sz2 = Math.round(c.z / 4) * 4;
      this.sun.target.position.set(sx2, 0, sz2);
      this.sun.position.set(sx2 + this.sunDir.x * 150, this.sunDir.y * 150, sz2 + this.sunDir.z * 150);
      this.sun.target.updateMatrixWorld();
    }
    this.sky.position.copy(cam.position);
  }

  // ---------- Цикл ----------
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.state === 'menu') {
      this.updateCamera(dt);
      this.effects.update(dt, this.camera.position);
      this.world.update(dt);
      for (const pl of this.planes) pl.update(dt);
      for (const fo of this.flagObjs) this.waveCloth(fo.cloth, now / 1000);
      this.render(false);
      return;
    }
    if (this.state === 'pause') { this.render(true); return; }
    let sdt = dt * SPEED * (this.state === 'end' ? 0.35 : 1);
    const steps = Math.ceil(sdt / 0.034);
    for (let i = 0; i < steps; i++) this.update(sdt / steps);
    this.effects.update(dt * (this.state === 'end' ? 0.35 : 1), this.camera.position);
    const t = this.time;
    for (const fo of this.flagObjs) this.waveCloth(fo.cloth, t);
    for (const c of this.hqCloth) this.waveCloth(c, t + 1);
    this.updateCamera(dt);
    const p = this.player;
    const hideSelf = p.state !== 'dead' && !p.vehicle ? p : null;
    this.soldierR.update(this.soldiers, t, (this.state === 'play' || this.state === 'pause' || this.state === 'end') && p.state === 'alive' ? hideSelf : null, this.camera.position);
    const fp = (this.state === 'play' || this.state === 'end') && p.state === 'alive' && !p.vehicle;
    if (fp) {
      const vc = this.viewmodel.cur;
      if (!vc || vc.wid !== p.weapon.id || vc.optic !== p.sight.optic) this.viewmodel.set(p.team, p.weapon.id, p.sight.optic);
      this.viewmodel.update(dt, p, (this.lookDX || 0) * 0.004, (this.lookDY || 0) * 0.004, this.camera.aspect);
    }
    const scopeKind = fp && p.scoped ? p.sight.reticle : this.state === 'play' && p.vehicle && this.tankZoom ? 'tank' : null;
    this.hud.setScope(scopeKind);
    if (!$('bigmap').hidden) { this.mapT -= dt; if (this.mapT <= 0) { this.mapT = 0.3; this.hud.drawFullMap($('bigmapCv')); } }
    this.render(fp && this.viewmodel.visible);
    if (this.state === 'play' || this.state === 'end') this.hud.update(dt);
    this.updateContextUI();
    // Авто-качество
    if (this.settings.quality === 'auto' && this.state === 'play') {
      this.fpsAcc += dt; this.fpsN++;
      if (this.fpsAcc > 4) {
        const fps = this.fpsN / this.fpsAcc;
        this.fpsAcc = 0; this.fpsN = 0;
        if (fps < 38 && this.quality > 0) { this.quality--; this.applyQuality(); }
      }
    }
  }
  render(fp) {
    const r = this.renderer;
    this.gfx.time.value = performance.now() / 1000;
    this.sky.material.uniforms.uTime.value = performance.now() / 1000;
    if (this.grass) this.grass.update(this.camera.position);
    if (this.post) {
      const p = this.player;
      const dmg = this.state === 'play' && p && p.state === 'alive' ? clamp((45 - p.hp) / 45, 0, 1) * 0.6 : 0;
      this.post.render(fp, this.time, dmg);
      return;
    }
    r.clear();
    r.render(this.scene, this.camera);
    if (fp) this.viewmodel.render(r);
  }
  updateContextUI() {
    if (this.state !== 'play') return;
    const p = this.player;
    const ctx = p.state === 'alive' && !p.vehicle ? this.ctxAction : null;
    const b = $('btnInteract');
    const want = ctx ? ctx.label : '';
    if (b.dataset.label !== want) { b.dataset.label = want; b.textContent = want; b.hidden = !want; }
    const rv = $('reviveBar');
    rv.hidden = !this.reviving;
    if (this.reviving) rv.firstChild.style.width = clamp(this.reviveT / 1.1, 0, 1) * 100 + '%';
    if (p.state === 'downed') {
      $('downTimer').style.width = clamp(p.downT / 15, 0, 1) * 100 + '%';
      let near = null, nd = 60;
      for (const s of this.soldiers) {
        if (s.team !== p.team || !s.cls.revive || s.state !== 'alive' || s === p) continue;
        const d = s.pos.distanceTo(p.pos);
        if (d < nd) { nd = d; near = s; }
      }
      const txt = near ? `Медик ${near.name} рядом: ${Math.round(nd)} м` : 'Медиков поблизости нет';
      if ($('medicNear').textContent !== txt) $('medicNear').textContent = txt;
    }
    const inTank = !!p.vehicle;
    if (document.body.classList.contains('in-tank') !== inTank) this.updateControls();
    document.body.classList.toggle('downed', p.state === 'downed');
  }

  // ---------- Интерфейс меню ----------
  renderMenu() {
    const st = this.settings;
    const rk = rankFor(this.save.xp);
    $('rankName').textContent = rk.name;
    $('rankXp').style.width = (rk.to > rk.from ? clamp((this.save.xp - rk.from) / (rk.to - rk.from), 0, 1) : 1) * 100 + '%';
    const tt = this.save.totals;
    $('rankInfo').textContent = `Опыт: ${this.save.xp}${rk.next ? ` · следующее: ${rk.next}` : ''} · боёв: ${tt.matches}, побед: ${tt.wins}`;
    const seg = (id, items, key) => {
      const box = $(id);
      box.innerHTML = '';
      for (const [val, label] of items) {
        const b = document.createElement('button');
        b.textContent = label;
        b.className = String(st[key]) === String(val) ? 'on' : '';
        b.onclick = () => {
          this.audio.init(); this.audio.ui();
          st[key] = val;
          this.persist();
          if (key === 'map') this.prepareWorld(MAPS[val]);
          this.renderMenu();
        };
        box.appendChild(b);
      }
    };
    seg('optMap', MAP_LIST.map((m) => [m.id, m.name]), 'map');
    seg('optMode', [['conquest', 'Захват'], ['tdm', 'Схватка']], 'mode');
    seg('optTeam', [[0, TEAMS[0].name], [1, TEAMS[1].name]], 'team');
    seg('optBots', [[6, '6×6'], [10, '10×10'], [12, '12×12'], [16, '16×16']], 'bots');
    seg('optDiff', DIFFICULTY.map((d) => [d.id, d.name]), 'difficulty');
    seg('optLen', MATCH_LENGTH.map((l, i) => [i, l.name]), 'length');
    $('mapDesc').textContent = MAPS[st.map].desc + (st.mode === 'tdm' ? ' Схватка: побеждает сторона, первой выбившая врага.' : ' Захват: держите больше флагов, чтобы враг терял подкрепления.');
  }
  renderSettings() {
    const st = this.settings;
    const box = $('settingsBody');
    const row = (label, html) => `<label class="srow"><span>${label}</span>${html}</label>`;
    const range = (key, min, max, step) => `<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${st[key]}"><output>${st[key]}</output>`;
    const check = (key) => `<input type="checkbox" data-k="${key}" ${st[key] ? 'checked' : ''}>`;
    const sel = (key, items) => `<select data-k="${key}">${items.map(([v, l]) => `<option value="${v}" ${String(st[key]) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
    box.innerHTML = [
      row('Чувствительность обзора (экран)', range('sens', 0.3, 2.5, 0.05)),
      row('Чувствительность мыши', range('mouseSens', 0.2, 3, 0.05)),
      row('Помощь в прицеливании', range('aimAssist', 0, 1, 0.05)),
      row('Поле зрения', range('fov', 60, 95, 1)),
      row('Графика', sel('quality', [['auto', 'Авто'], ['low', 'Низкая'], ['medium', 'Средняя'], ['high', 'Высокая'], ['ultra', 'Ультра']])),
      row('Громкость', range('volume', 0, 1, 0.05)),
      row('Вибрация', check('vibration')),
      row('Кнопка огня слева', check('leftFire')),
      row('Инверсия по вертикали', check('invertY')),
    ].join('');
    box.querySelectorAll('[data-k]').forEach((el) => {
      el.oninput = el.onchange = () => {
        const k = el.dataset.k;
        let v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
        st[k] = v;
        if (el.nextElementSibling && el.nextElementSibling.tagName === 'OUTPUT') el.nextElementSibling.textContent = v;
        if (k === 'volume') this.audio.setVolume(v);
        if (k === 'quality') { this.quality = this.pickQuality(); this.applyQuality(); }
        if (k === 'leftFire') this.updateControls();
        this.persist();
      };
    });
  }
  bindUI() {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', (e) => { e.preventDefault(); this.audio.init(); fn(e); }); };
    on('btnPlay', () => this.startMatch());
    on('btnSettings', () => { this.renderSettings(); $('settings').hidden = false; });
    on('btnSettings2', () => { this.renderSettings(); $('settings').hidden = false; });
    on('btnSettingsClose', () => { $('settings').hidden = true; });
    on('btnHelp', () => { $('help').hidden = false; });
    on('btnHelpClose', () => { $('help').hidden = true; });
    on('btnDeploy', () => this.deploy());
    on('btnDeployMenu', () => this.toMenu());
    on('btnPause', () => this.pause(true));
    on('btnResume', () => this.pause(false));
    on('btnScores', () => { const el = $('scores'); this.hud.showScores(el.hidden); });
    on('btnScoresClose', () => this.hud.showScores(false));
    on('btnRedeploy', () => {
      this.pause(false);
      const p = this.player;
      if (p.vehicle) p.vehicle.exit();
      if (p.state !== 'dead') { this.combat.finishOff(p, null); this.teams[p.team].tickets += 1; p.stats.deaths = Math.max(0, p.stats.deaths); p.deadAt = this.time - 5; }
      this.deathT = 0;
      this.showDeploy();
    });
    on('btnQuit', () => this.toMenu());
    on('btnAgain', () => this.startMatch());
    on('btnEndMenu', () => this.toMenu());
    on('btnGiveUp', () => { if (this.player.state === 'downed') this.combat.finishOff(this.player, null); });
    $('deployMap').addEventListener('click', (e) => this.deployClick(e));
    $('minimap').addEventListener('click', (e) => { e.preventDefault(); this.toggleMap(true); });
    $('bigmap').addEventListener('click', (e) => { e.preventDefault(); this.toggleMap(false); });
    $('clickPlay').addEventListener('click', (e) => { e.preventDefault(); this.audio.init(); this.lockPointer(); });
    // Установка на телефон
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installEv = e; $('btnInstall').hidden = false; });
    on('btnInstall', async () => {
      if (this.installEv) { this.installEv.prompt(); try { await this.installEv.userChoice; } catch (_) {} this.installEv = null; $('btnInstall').hidden = true; }
    });
    const standalone = matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone;
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (!standalone && ios) $('iosHint').hidden = false;
    if (!standalone && !ios && this.touch) $('androidHint').hidden = false;
    if (!standalone && !this.touch) $('pcHint').hidden = false;
  }
}

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !AUTOPLAY) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

try {
  window.__game = new Game();
  document.body.classList.add('ready');
} catch (e) {
  console.error(e);
  const el = document.getElementById('fatal');
  if (el) { el.hidden = false; el.querySelector('pre').textContent = String(e && e.stack || e); }
}
