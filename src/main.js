import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';


/* ============================== SETUP / QUALITY ============================== */
const IS_TOUCH = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
if (IS_TOUCH) document.body.classList.add('touch');

function bootError(msg) {
  const elx = document.getElementById('saveInfo');
  if (elx) { elx.textContent = 'PROBLEM: ' + msg; elx.style.color = '#ff8a7a'; }
}
window.addEventListener('error', e => bootError(e.message || 'script error'));
window.addEventListener('unhandledrejection', e => bootError((e.reason && e.reason.message) || 'loading failed'));
const canvas = document.getElementById('c');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: !IS_TOUCH, powerPreference: 'high-performance' });
} catch (e) {
  bootError('this browser/computer has 3D (WebGL) disabled — try Chrome on your personal PC, not a virtual desktop');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = !IS_TOUCH;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5a6b78);
scene.fog = new THREE.Fog(0x5a6b78, 40, 240);

const camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 500);
const pitchObj = new THREE.Object3D(); pitchObj.add(camera);
const yawObj = new THREE.Object3D(); yawObj.position.set(0, 1.7, 96); yawObj.add(pitchObj);
scene.add(yawObj);

/* post-processing: bloom makes emissives (eyes, windows, lamps, neon) actually glow */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), IS_TOUCH ? 0.32 : 0.42, 0.55, 0.82);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());
let useComposer = true;
// adaptive: if a phone can't hold frame rate with bloom, drop back to the plain renderer
let perfAccum = 0, perfFrames = 0, perfChecked = false;

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
});

/* ============================== TIER-2 ASSETS: HDRI, PBR, GLB characters ============================== */
const texLoader = new THREE.TextureLoader();
function pbrTex(path, rx, ry, srgb) {
  const t = texLoader.load(path);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx, ry);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
const ASSETS = { models: {}, ready: false };
const envMats = [];
function collectEnvMats(root) {
  root.traverse(o => {
    if (o.isMesh) {
      const ms = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of ms) if (m.isMeshStandardMaterial && !envMats.includes(m)) envMats.push(m);
    }
  });
}
const assetsPromise = (async () => {
  const env = await new RGBELoader().loadAsync('assets/hdri/kloofendal_overcast_2k.hdr');
  env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = env;
  const loader = new GLTFLoader();
  let loaded = 0;
  const names = ['Skeleton_Minion', 'Skeleton_Rogue', 'Skeleton_Mage', 'Skeleton_Warrior', 'Rogue_Hooded', 'Barbarian', 'Knight'];
  const progressEl = document.getElementById('loadProgress');
  await Promise.all(names.map(async n => {
    ASSETS.models[n] = await loader.loadAsync(`assets/models/${n}.glb`);
    loaded++;
    if (progressEl) progressEl.textContent = `LOADING WORLD… ${loaded}/${names.length}`;
  }));
  ASSETS.ready = true;
  if (progressEl) progressEl.textContent = 'READY';
  buildNpcVisuals();
  collectEnvMats(scene);
})();
assetsPromise.catch(e => console.error('asset load failed', e));

const charScaleCache = {};
function charScale(name) {
  if (!charScaleCache[name]) {
    const box = new THREE.Box3().setFromObject(ASSETS.models[name].scene);
    charScaleCache[name] = 1.75 / (box.max.y - box.min.y);
  }
  return charScaleCache[name];
}
function spawnCharacter(name, { tint = null, eyeColor = null } = {}) {
  const src = ASSETS.models[name];
  const obj = SkeletonUtils.clone(src.scene);
  obj.scale.setScalar(charScale(name));
  obj.traverse(o => {
    if (o.isMesh) {
      o.castShadow = !IS_TOUCH;
      o.frustumCulled = false;
      o.material = o.material.clone();
      if (tint) o.material.color.multiply(new THREE.Color(tint));
      if (eyeColor && /eyes/i.test(o.name)) { o.material.emissive = new THREE.Color(eyeColor); o.material.emissiveIntensity = 2.2; }
    }
  });
  const mixer = new THREE.AnimationMixer(obj);
  const clip = n => src.animations.find(a => a.name === n);
  return { obj, mixer, clip };
}
const npcMixers = [];
function buildNpcVisuals() {
  const defs = [
    ['Rogue_Hooded', OUTPOST.x - 8, OUTPOST.z - 6, 2.4, 'RANGER DOT', null],
    ['Rogue_Hooded', OUTPOST.x + 9, OUTPOST.z + 8, -2.2, 'DOC MERCER', 0x9aa4b0],
    ['Knight', OUTPOST.x - 3, OUTPOST.z + 12, 3.0, 'SALVAGE SAM', 0xc8b89a],
  ];
  for (const [model, x, z, rot, label, tint] of defs) {
    const { obj, mixer, clip } = spawnCharacter(model, { tint });
    const grp = new THREE.Group();
    grp.add(obj);
    grp.position.set(x, 0, z); grp.rotation.y = rot;
    const ns = nameSprite(label); ns.position.y = 2.35; grp.add(ns);
    scene.add(grp);
    const idleAct = mixer.clipAction(clip('Idle'));
    idleAct.startAt(-Math.random() * 1.5).play();
    mixer.update(0.01);
    npcMixers.push(mixer);
  }
}

const rng = (() => { let a = 20260731; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; })();

/* ============================== MAP LAYOUT ============================== */
const MAP = 350;              // half-size; world is 700x700
const WATER_X = -262;         // west of this is Elliott Bay
const OUTPOST = { x: 0, z: 96, r: 34 };
const STADIUM = { x: 30, z: 250, r: 58 };
const NEEDLE = { x: -140, z: -225 };

const DISTRICTS = [
  { id: 'waterfront', name: 'THE WATERFRONT', x1: -262, x2: -205, z1: -280, z2: 200, danger: 2 },
  { id: 'market',     name: 'PIKE MARKET',    x1: -205, x2: -85,  z1: -120, z2: 10,  danger: 2 },
  { id: 'center',     name: 'SEATTLE CENTER', x1: -205, x2: -60,  z1: -300, z2: -130, danger: 3 },
  { id: 'downtown',   name: 'DOWNTOWN RUINS', x1: -60,  x2: 120,  z1: -250, z2: 30,  danger: 3 },
  { id: 'yards',      name: 'RAINIER YARDS',  x1: 120,  x2: 300,  z1: -80,  z2: 170, danger: 4 },
  { id: 'stadium',    name: 'THE YARD',       x1: -40,  x2: 100,  z1: 185,  z2: 315, danger: 0 },
  { id: 'outpost',    name: 'CASCADE OUTPOST', x1: OUTPOST.x - OUTPOST.r, x2: OUTPOST.x + OUTPOST.r, z1: OUTPOST.z - OUTPOST.r, z2: OUTPOST.z + OUTPOST.r, danger: 0 },
];
function districtAt(x, z) {
  if (x < WATER_X) return { id: 'bay', name: 'ELLIOTT BAY', danger: 0 };
  if (Math.hypot(x - OUTPOST.x, z - OUTPOST.z) < OUTPOST.r) return DISTRICTS[6];
  if (Math.hypot(x - STADIUM.x, z - STADIUM.z) < STADIUM.r + 14) return DISTRICTS[5];
  for (const d of DISTRICTS) if (x >= d.x1 && x < d.x2 && z >= d.z1 && z < d.z2) return d;
  return { id: 'fringe', name: 'THE SPRAWL', danger: 1 };
}

/* ============================== TEXTURES ============================== */
function makeCanvas(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d'); draw(ctx, w, h);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
function noise(ctx, w, h, alpha, dark) {
  for (let i = 0; i < w * h / 16; i++) {
    const s = 1 + Math.random() * 2.5;
    ctx.fillStyle = `rgba(${dark ? '0,0,0' : '255,255,255'},${Math.random() * alpha})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

// ground: whole-map texture with roads drawn to match the building grid
const groundTex = makeCanvas(2048, 2048, (ctx, w, h) => {
  const s = w / (MAP * 2);                       // world->tex scale
  const wx = x => (x + MAP) * s, wz = z => (z + MAP) * s;
  ctx.fillStyle = '#5d6150'; ctx.fillRect(0, 0, w, h);          // dead grass/dirt
  // rubble mottling
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${60 + Math.random() * 40 | 0},${58 + Math.random() * 34 | 0},${46 + Math.random() * 26 | 0},.5)`;
    ctx.beginPath(); ctx.ellipse(Math.random() * w, Math.random() * h, 6 + Math.random() * 40, 4 + Math.random() * 26, Math.random() * 3, 0, 7); ctx.fill();
  }
  // asphalt road grid every 60m, 12m wide
  ctx.fillStyle = '#33363a';
  for (let g = -300; g <= 300; g += 60) {
    ctx.fillRect(wx(g - 6), 0, 12 * s, h);
    ctx.fillRect(0, wz(g - 6), w, 12 * s);
  }
  // faded lane lines
  ctx.strokeStyle = 'rgba(200,190,90,.25)'; ctx.lineWidth = 2; ctx.setLineDash([14, 18]);
  for (let g = -300; g <= 300; g += 60) {
    ctx.beginPath(); ctx.moveTo(wx(g), 0); ctx.lineTo(wx(g), h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, wz(g)); ctx.lineTo(w, wz(g)); ctx.stroke();
  }
  ctx.setLineDash([]);
  // outpost concrete pad
  ctx.fillStyle = '#5c5a50';
  ctx.beginPath(); ctx.arc(wx(OUTPOST.x), wz(OUTPOST.z), OUTPOST.r * s, 0, 7); ctx.fill();
  // stadium pad
  ctx.fillStyle = '#55524a';
  ctx.beginPath(); ctx.arc(wx(STADIUM.x), wz(STADIUM.z), (STADIUM.r + 6) * s, 0, 7); ctx.fill();
  noise(ctx, w, h, 0.05, true);
});
groundTex.repeat.set(1, 1);

/* building facades: diffuse + matching emissive (lit windows) canvases */
function grime(ctx, w, h) {
  // streaks running down from window sills, rust stains, soot at the base
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * w, y = Math.random() * h * 0.7, len = 20 + Math.random() * 80;
    const grd = ctx.createLinearGradient(x, y, x, y + len);
    grd.addColorStop(0, 'rgba(20,18,14,.35)'); grd.addColorStop(1, 'rgba(20,18,14,0)');
    ctx.fillStyle = grd; ctx.fillRect(x - 2, y, 4 + Math.random() * 5, len);
  }
  const soot = ctx.createLinearGradient(0, h - 60, 0, h);
  soot.addColorStop(0, 'rgba(10,10,10,0)'); soot.addColorStop(1, 'rgba(10,10,10,.45)');
  ctx.fillStyle = soot; ctx.fillRect(0, h - 60, w, 60);
}
function crackle(ctx, w, h, n) {
  ctx.strokeStyle = 'rgba(15,15,15,.4)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < n; i++) {
    let x = Math.random() * w, y = Math.random() * h;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 5; s++) { x += (Math.random() - 0.5) * 26; y += Math.random() * 22; ctx.lineTo(x, y); }
    ctx.stroke();
  }
}
function facade(w, h, base, windowFn) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const gcv = document.createElement('canvas'); gcv.width = w; gcv.height = h;
  const ctx = cv.getContext('2d'), gctx = gcv.getContext('2d');
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  gctx.fillStyle = '#000'; gctx.fillRect(0, 0, w, h);
  windowFn(ctx, gctx, w, h);
  grime(ctx, w, h); crackle(ctx, w, h, 8); noise(ctx, w, h, 0.12, true); noise(ctx, w, h, 0.05, false);
  const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
  const emissiveMap = new THREE.CanvasTexture(gcv); emissiveMap.colorSpace = THREE.SRGBColorSpace;
  return { map, emissiveMap };
}
function drawWindow(ctx, gctx, x, y, ww, wh) {
  const state = Math.random();
  if (state < 0.22) {           // shattered, black hole
    ctx.fillStyle = '#0c0e10'; ctx.fillRect(x, y, ww, wh);
    ctx.strokeStyle = 'rgba(200,210,220,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + ww, y + wh); ctx.moveTo(x + ww, y); ctx.lineTo(x, y + wh); ctx.stroke();
  } else if (state < 0.5) {     // intact, sky reflection
    const grd = ctx.createLinearGradient(x, y, x + ww, y + wh);
    grd.addColorStop(0, '#3c4a58'); grd.addColorStop(0.5, '#6a7e90'); grd.addColorStop(1, '#2c3640');
    ctx.fillStyle = grd; ctx.fillRect(x, y, ww, wh);
  } else {                      // dark interior
    ctx.fillStyle = '#161a1e'; ctx.fillRect(x, y, ww, wh);
  }
  if (Math.random() < 0.3) {    // survivor squat / emergency light — glows at night
    const warm = Math.random() < 0.8;
    gctx.fillStyle = warm ? '#ffb45e' : '#7ddfb0';
    gctx.fillRect(x + 1, y + 1, ww - 2, wh - 2);
  }
  ctx.strokeStyle = 'rgba(30,30,32,.9)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, ww, wh);
}
const towerFac = facade(256, 512, '#59616b', (ctx, gctx, w, h) => {
  // concrete piers between glass columns
  ctx.fillStyle = '#4a5058';
  for (let x = 0; x < w; x += 40) ctx.fillRect(x, 0, 6, h);
  for (let y = 10; y < h - 14; y += 42) for (let x = 12; x < w - 20; x += 40) drawWindow(ctx, gctx, x, y, 26, 30);
});
const brickFac = facade(256, 256, '#6e4438', (ctx, gctx, w, h) => {
  ctx.fillStyle = 'rgba(0,0,0,.22)';
  for (let y = 0; y < h; y += 14) for (let x = (y / 14 % 2) * 14; x < w; x += 28) ctx.fillRect(x, y, 26, 12);
  ctx.fillStyle = 'rgba(255,255,255,.05)';
  for (let y = 0; y < h; y += 14) ctx.fillRect(0, y, w, 1);
  for (let y = 20; y < h - 40; y += 74) for (let x = 18; x < w - 40; x += 62) {
    ctx.fillStyle = '#3a2c22'; ctx.fillRect(x - 4, y - 4, 40, 52);   // stone lintel
    drawWindow(ctx, gctx, x, y, 32, 44);
  }
});
const warehouseFac = facade(256, 256, '#5e5a4c', (ctx, gctx, w, h) => {
  for (let x = 0; x < w; x += 20) {          // corrugated metal
    const grd = ctx.createLinearGradient(x, 0, x + 20, 0);
    grd.addColorStop(0, 'rgba(0,0,0,.25)'); grd.addColorStop(0.5, 'rgba(255,255,255,.06)'); grd.addColorStop(1, 'rgba(0,0,0,.25)');
    ctx.fillStyle = grd; ctx.fillRect(x, 0, 20, h);
  }
  ctx.fillStyle = 'rgba(130,70,40,.4)';      // rust blooms
  for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.ellipse(Math.random() * w, Math.random() * h, 6 + Math.random() * 22, 5 + Math.random() * 15, Math.random() * 3, 0, 7); ctx.fill(); }
  for (let x = 24; x < w - 40; x += 90) drawWindow(ctx, gctx, x, 26, 44, 22);  // high clerestory strip
});
const houseFac = facade(256, 256, '#7a7264', (ctx, gctx, w, h) => {
  ctx.fillStyle = 'rgba(0,0,0,.22)';         // clapboard siding
  for (let y = 0; y < h; y += 11) ctx.fillRect(0, y, w, 4);
  drawWindow(ctx, gctx, 34, 84, 52, 62); drawWindow(ctx, gctx, 158, 84, 52, 62);
  ctx.fillStyle = '#3a3026'; ctx.fillRect(104, 150, 44, 106);  // door
  ctx.fillStyle = '#8a8074'; ctx.fillRect(120, 196, 6, 10);
});
const brickTex = brickFac.map, towerTex = towerFac.map, warehouseTex = warehouseFac.map, houseTex = houseFac.map;
const concreteTex = makeCanvas(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#8a877c'; ctx.fillRect(0, 0, w, h);
  noise(ctx, w, h, 0.16, true); noise(ctx, w, h, 0.08, false);
});
const marketTex = makeCanvas(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#8a3a30'; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  for (let y = 0; y < h; y += 20) ctx.fillRect(0, y, w, 8);
  noise(ctx, w, h, 0.12, true);
});
const waterTex = makeCanvas(256, 256, (ctx, w, h) => {
  ctx.fillStyle = '#20343c'; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = `rgba(140,190,200,${0.05 + Math.random() * 0.1})`;
    ctx.lineWidth = 1 + Math.random() * 2;
    const y = Math.random() * h;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(w / 3, y - 8, 2 * w / 3, y + 8, w, y); ctx.stroke();
  }
});
waterTex.repeat.set(6, 6);

/* ============================== WORLD BUILD ============================== */
const obstacles = [];   // AABBs {minX,maxX,minZ,maxZ,height}
const interactables = []; // {id,pos,r,label,visible?,mesh?,action}
const staticTargets = []; // meshes bullets can hit

function addObstacleBox(x, z, sx, sz, h) {
  obstacles.push({ minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2, height: h });
}

const groundMat = new THREE.MeshStandardMaterial({
  map: pbrTex('assets/textures/Ground047/Ground047_1K-JPG_Color.jpg', 90, 90, true),
  normalMap: pbrTex('assets/textures/Ground047/Ground047_1K-JPG_NormalGL.jpg', 90, 90),
  roughnessMap: pbrTex('assets/textures/Ground047/Ground047_1K-JPG_Roughness.jpg', 90, 90),
  color: 0x8f948a,
});
const ground = new THREE.Mesh(new THREE.PlaneGeometry(MAP * 2, MAP * 2), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

// asphalt road strips on the 60m grid (PBR, replaces canvas-painted roads)
{
  const roadMat = new THREE.MeshStandardMaterial({
    map: pbrTex('assets/textures/Asphalt033/Asphalt033_1K-JPG_Color.jpg', 60, 1.4, true),
    normalMap: pbrTex('assets/textures/Asphalt033/Asphalt033_1K-JPG_NormalGL.jpg', 60, 1.4),
    roughnessMap: pbrTex('assets/textures/Asphalt033/Asphalt033_1K-JPG_Roughness.jpg', 60, 1.4),
    color: 0x9a9a9a, polygonOffset: true, polygonOffsetFactor: -2,
  });
  const roadGeoX = new THREE.PlaneGeometry(MAP * 2, 12); roadGeoX.rotateX(-Math.PI / 2);
  const roadGeoZ = roadGeoX.clone().rotateY(Math.PI / 2);
  for (let g = -300; g <= 300; g += 60) {
    const rx = new THREE.Mesh(roadGeoX, roadMat); rx.position.set(0, 0.02, g); rx.receiveShadow = true; scene.add(rx);
    const rz = new THREE.Mesh(roadGeoZ, roadMat); rz.position.set(g, 0.02, 0); rz.receiveShadow = true; scene.add(rz);
  }
  const padMat = new THREE.MeshStandardMaterial({
    map: pbrTex('assets/textures/Concrete034/Concrete034_1K-JPG_Color.jpg', 12, 12, true),
    normalMap: pbrTex('assets/textures/Concrete034/Concrete034_1K-JPG_NormalGL.jpg', 12, 12),
    roughnessMap: pbrTex('assets/textures/Concrete034/Concrete034_1K-JPG_Roughness.jpg', 12, 12),
    color: 0x6e6e66, polygonOffset: true, polygonOffsetFactor: -3,
  });
  const padGeo = new THREE.CircleGeometry(1, 28); padGeo.rotateX(-Math.PI / 2);
  const pad1 = new THREE.Mesh(padGeo, padMat); pad1.scale.setScalar(OUTPOST.r); pad1.position.set(OUTPOST.x, 0.035, OUTPOST.z); pad1.receiveShadow = true; scene.add(pad1);
  const pad2 = new THREE.Mesh(padGeo, padMat); pad2.scale.setScalar(STADIUM.r + 6); pad2.position.set(STADIUM.x, 0.035, STADIUM.z); pad2.receiveShadow = true; scene.add(pad2);
}

// Elliott Bay
const water = new THREE.Mesh(
  new THREE.PlaneGeometry(MAP - Math.abs(WATER_X) + 130, MAP * 2 + 100),
  new THREE.MeshStandardMaterial({ map: waterTex, color: 0x88aab4, roughness: 0.25, metalness: 0.35, transparent: true, opacity: 0.94 })
);
water.rotation.x = -Math.PI / 2;
water.position.set(WATER_X - (MAP - Math.abs(WATER_X) + 130) / 2, 0.06, 0);
scene.add(water);

const glowMats = [];   // facade materials whose windows light up after dark
function facadeMat(fac, rough) {
  const m = new THREE.MeshStandardMaterial({ map: fac.map, roughness: rough, emissive: 0xffffff, emissiveMap: fac.emissiveMap, emissiveIntensity: 0 });
  glowMats.push(m);
  return m;
}
const MATS = {
  brick: facadeMat(brickFac, 0.92),
  tower: facadeMat(towerFac, 0.55),
  warehouse: facadeMat(warehouseFac, 0.7),
  house: facadeMat(houseFac, 0.9),
  concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 1 }),
  market: new THREE.MeshStandardMaterial({ map: marketTex, roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x33362f, roughness: 1 }),
  rust: new THREE.MeshStandardMaterial({ color: 0x6e4a2e, roughness: 0.85, metalness: 0.25 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.6, metalness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x1c242c, roughness: 0.15, metalness: 0.9 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
};

const blinkerMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2020, emissiveIntensity: 0 });
function addBuilding(x, z, sx, sz, h, mat) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), [mat, mat, MATS.roof, MATS.roof, mat, mat]);
  b.position.set(x, h / 2, z);
  b.castShadow = b.receiveShadow = !IS_TOUCH;
  scene.add(b);
  staticTargets.push(b);
  addObstacleBox(x, z, sx, sz, h);
  // parapet lip breaks the flat-roof silhouette
  const lip = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.4, 0.5, sz + 0.4), MATS.concrete);
  lip.position.set(x, h + 0.2, z); scene.add(lip);
  // rooftop clutter: AC units, pipes, a water tank or antenna on taller buildings
  const clutter = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < clutter; i++) {
    const cx = x + (rng() - 0.5) * (sx - 3), cz = z + (rng() - 0.5) * (sz - 3);
    const kind = rng();
    if (kind < 0.5) {
      const ac = new THREE.Mesh(new THREE.BoxGeometry(1.4 + rng(), 0.9, 1.1 + rng() * 0.6), MATS.dark);
      ac.position.set(cx, h + 0.9, cz); ac.rotation.y = rng() * 3; scene.add(ac);
    } else if (kind < 0.8 && h > 14) {
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10), MATS.rust);
      tank.position.set(cx, h + 1.55, cz); scene.add(tank);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 0.7, 10), MATS.rust);
      cone.position.set(cx, h + 3, cz); scene.add(cone);
    } else {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.6, 6), MATS.dark);
      mast.position.set(cx, h + 2.1, cz); scene.add(mast);
      if (h > 24) {   // aviation blinker, pulses at night
        const bl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), blinkerMat);
        bl.position.set(cx, h + 3.95, cz); scene.add(bl);
      }
    }
  }
  return b;
}

// city blocks: one building candidate per 60m cell
for (let gx = -300; gx < 300; gx += 60) {
  for (let gz = -300; gz < 300; gz += 60) {
    const cx = gx + 30, cz = gz + 30;
    const d = districtAt(cx, cz);
    if (d.id === 'bay' || d.id === 'outpost' || d.id === 'stadium') continue;
    if (Math.hypot(cx - OUTPOST.x, cz - OUTPOST.z) < OUTPOST.r + 26) continue;
    if (Math.hypot(cx - STADIUM.x, cz - STADIUM.z) < STADIUM.r + 24) continue;
    if (Math.hypot(cx - NEEDLE.x, cz - NEEDLE.z) < 40) continue;
    if (rng() < 0.22) continue;                                    // empty lot
    const jx = cx + (rng() - 0.5) * 10, jz = cz + (rng() - 0.5) * 10;
    if (d.id === 'downtown') {
      const h = 22 + rng() * 46;
      addBuilding(jx, jz, 16 + rng() * 14, 16 + rng() * 14, h, MATS.tower);
      if (rng() < 0.35) {  // collapsed top slab
        const slab = new THREE.Mesh(new THREE.BoxGeometry(10 + rng() * 8, 1.6, 8 + rng() * 6), MATS.concrete);
        slab.position.set(jx + (rng() - 0.5) * 8, 1.2, jz + (rng() - 0.5) * 8);
        slab.rotation.set((rng() - 0.5) * 0.5, rng() * 3, (rng() - 0.5) * 0.4);
        scene.add(slab); staticTargets.push(slab);
      }
    } else if (d.id === 'yards') {
      addBuilding(jx, jz, 24 + rng() * 14, 18 + rng() * 12, 8 + rng() * 6, MATS.warehouse);
    } else if (d.id === 'market') {
      addBuilding(jx, jz, 14 + rng() * 10, 12 + rng() * 8, 7 + rng() * 5, rng() < 0.5 ? MATS.market : MATS.brick);
    } else if (d.id === 'center') {
      if (rng() < 0.5) addBuilding(jx, jz, 14 + rng() * 12, 12 + rng() * 10, 6 + rng() * 8, MATS.concrete);
    } else if (d.id === 'waterfront') {
      if (rng() < 0.6) addBuilding(jx, jz, 12 + rng() * 8, 10 + rng() * 8, 6 + rng() * 4, MATS.brick);
    } else {
      addBuilding(jx, jz, 10 + rng() * 6, 9 + rng() * 5, 4.5 + rng() * 2.5, MATS.house);
    }
  }
}

/* ============================== LANDMARKS ============================== */
// Observation tower (Space-Needle-like silhouette, generic build)
{
  const legMat = MATS.concrete;
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * Math.PI * 2;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 52, 8), legMat);
    leg.position.set(NEEDLE.x + Math.cos(a) * 5, 26, NEEDLE.z + Math.sin(a) * 5);
    leg.rotation.z = Math.cos(a) * 0.09; leg.rotation.x = -Math.sin(a) * 0.09;
    scene.add(leg); staticTargets.push(leg);
  }
  const core = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, 52, 10), legMat);
  core.position.set(NEEDLE.x, 26, NEEDLE.z); scene.add(core); staticTargets.push(core);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(13, 9, 4.5, 18), MATS.dark);
  disc.position.set(NEEDLE.x, 54, NEEDLE.z); scene.add(disc); staticTargets.push(disc);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(12.2, 0.7, 8, 24), MATS.rust);
  ring.rotation.x = Math.PI / 2; ring.position.set(NEEDLE.x, 52.4, NEEDLE.z); scene.add(ring);
  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.1, 12, 8), MATS.dark);
  spire.position.set(NEEDLE.x, 62, NEEDLE.z); scene.add(spire);
  addObstacleBox(NEEDLE.x, NEEDLE.z, 9, 9, 52);
}

// Waterfront piers + slow ferris wheel
const wheelGroup = new THREE.Group();
{
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x4a3d2c, roughness: 1 });
  for (const pz of [-60, 20, 110]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(46, 1.2, 10), pierMat);
    pier.position.set(WATER_X - 18, 0.6, pz);
    scene.add(pier); staticTargets.push(pier);
    // piers are walkable: no obstacle, but railings at far end
    const rail = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 10), pierMat);
    rail.position.set(WATER_X - 40.5, 1.6, pz); scene.add(rail);
    addObstacleBox(WATER_X - 40.5, pz, 1, 10, 2.4);
  }
  // wheel on middle pier
  const rim = new THREE.Mesh(new THREE.TorusGeometry(13, 0.5, 8, 28), MATS.rust);
  wheelGroup.add(rim);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 26, 6), MATS.rust);
    spoke.rotation.z = a; wheelGroup.add(spoke);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 2.2, 2), new THREE.MeshStandardMaterial({ color: [0xa04a4a, 0x4a7aa0, 0x7aa04a, 0xa08a3a][i % 4], roughness: 0.8 }));
    cab.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 0);
    wheelGroup.add(cab);
  }
  wheelGroup.position.set(WATER_X - 26, 15, 20);
  wheelGroup.rotation.y = Math.PI / 2;
  scene.add(wheelGroup);
  const axleBase = new THREE.Mesh(new THREE.BoxGeometry(3, 15, 3), MATS.dark);
  axleBase.position.set(WATER_X - 26, 7.5, 20); scene.add(axleBase);
  addObstacleBox(WATER_X - 26, 20, 3.4, 3.4, 15);
}

// Stadium ring (The Yard) with a gate on the north side
{
  const segs = 26;
  for (let i = 0; i < segs; i++) {
    const a = i / segs * Math.PI * 2;
    if (a > 4.5 && a < 4.95) continue;                             // gate gap (north)
    const x = STADIUM.x + Math.cos(a) * STADIUM.r;
    const z = STADIUM.z + Math.sin(a) * STADIUM.r;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(16, 13, 3), MATS.concrete);
    seg.position.set(x, 6.5, z);
    seg.rotation.y = -a + Math.PI / 2;
    scene.add(seg); staticTargets.push(seg);
    const c = Math.abs(Math.cos(-a + Math.PI / 2)), s = Math.abs(Math.sin(-a + Math.PI / 2));
    addObstacleBox(x, z, 16 * c + 3 * s, 16 * s + 3 * c, 13);
  }
  // light towers
  for (const [lx, lz] of [[STADIUM.x - 40, STADIUM.z - 40], [STADIUM.x + 40, STADIUM.z + 40]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 24, 8), MATS.dark);
    pole.position.set(lx, 12, lz); scene.add(pole);
    addObstacleBox(lx, lz, 1.4, 1.4, 24);
  }
}

/* ============================== PROPS: cars, rubble, barricades ============================== */
/* streetlamps at intersections; heads glow at night, a pooled set of real lights follows the player */
const lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x2a2a20, emissive: 0xffc878, emissiveIntensity: 0 });
const lampPositions = [];
{
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.14, 6.2, 8);
  const armGeo = new THREE.BoxGeometry(1.6, 0.12, 0.12);
  const headGeo = new THREE.BoxGeometry(0.7, 0.18, 0.3);
  for (let gx = -300; gx <= 300; gx += 60) for (let gz = -300; gz <= 300; gz += 120) {
    if (gx < WATER_X + 8) continue;
    if (Math.hypot(gx - OUTPOST.x, gz - OUTPOST.z) < OUTPOST.r + 4) continue;
    if (rng() < 0.35) continue;                                 // some knocked down
    const x = gx + 6.5, z = gz + 6.5;
    const tilt = rng() < 0.2 ? (rng() - 0.5) * 0.35 : 0;        // a few lean drunkenly
    const grp = new THREE.Group();
    const pole = new THREE.Mesh(poleGeo, MATS.dark); pole.position.y = 3.1; grp.add(pole);
    const arm = new THREE.Mesh(armGeo, MATS.dark); arm.position.set(-0.7, 6.1, 0); grp.add(arm);
    const head = new THREE.Mesh(headGeo, lampHeadMat); head.position.set(-1.4, 6.05, 0); grp.add(head);
    grp.position.set(x, 0, z); grp.rotation.z = tilt; grp.rotation.y = rng() * Math.PI * 2;
    scene.add(grp);
    const hw = new THREE.Vector3(); head.getWorldPosition(hw);
    lampPositions.push(hw);
    addObstacleBox(x, z, 0.4, 0.4, 6);
  }
}
const lampLights = [];
for (let i = 0; i < 4; i++) { const L = new THREE.PointLight(0xffc878, 0, 20, 1.8); scene.add(L); lampLights.push(L); }
let lampPoolT = 0;
function updateLampPool(dt) {
  lampPoolT -= dt;
  if (lampPoolT > 0) return;
  lampPoolT = 0.6;
  const glow = state.night ? 1 : 0;
  const p = yawObj.position;
  const near = lampPositions.map(lp => ({ lp, d: (lp.x - p.x) ** 2 + (lp.z - p.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, 4);
  lampLights.forEach((L, i) => {
    if (glow && near[i]) { L.position.copy(near[i].lp); L.intensity = 2.4; }
    else L.intensity = 0;
  });
}

/* rain puddles — tight glossy discs that catch the sky and bloom */
{
  const pudGeo = new THREE.CircleGeometry(1, 18);
  const pudMat = new THREE.MeshStandardMaterial({ color: 0x93aabb, roughness: 0.06, metalness: 0.85, transparent: true, opacity: 0.55 });
  for (let i = 0; i < 60; i++) {
    const onX = rng() < 0.5;
    const lane = (Math.floor(rng() * 11) - 5) * 60 + (rng() - 0.5) * 8;
    const along = (rng() * 2 - 1) * 320;
    const x = onX ? along : lane, z = onX ? lane : along;
    if (x < WATER_X + 6) continue;
    const pud = new THREE.Mesh(pudGeo, pudMat);
    pud.rotation.x = -Math.PI / 2;
    pud.position.set(x, 0.03, z);
    pud.scale.set(1.2 + rng() * 2.4, 0.7 + rng() * 1.6, 1);
    pud.rotation.z = rng() * 3;
    scene.add(pud);
  }
}

const carColors = [0x7a3b32, 0x36506a, 0x4e6338, 0x77664a, 0x565c63, 0x8a8578];
function addCar(x, z, rot) {
  const g = new THREE.Group();
  const burnt = rng() < 0.25;
  const paint = burnt
    ? new THREE.MeshStandardMaterial({ color: 0x1c1a18, roughness: 0.95 })
    : new THREE.MeshStandardMaterial({ color: carColors[Math.floor(rng() * carColors.length)], roughness: 0.35, metalness: 0.55 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(4.2, 0.95, 1.9, 2, 0.15), paint);
  body.position.y = 0.78; g.add(body);
  const hood = new THREE.Mesh(new RoundedBoxGeometry(1.3, 0.5, 1.7, 2, 0.12), paint);
  hood.position.set(1.6, 0.9, 0); g.add(hood);
  const cab = new THREE.Mesh(new RoundedBoxGeometry(2.1, 0.75, 1.65, 2, 0.18), burnt ? paint : MATS.glass);
  cab.position.set(-0.25, 1.55, 0); g.add(cab);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
  for (const [wx, wz] of [[1.35, 0.85], [1.35, -0.85], [-1.35, 0.85], [-1.35, -0.85]]) {
    const wheel = new THREE.Mesh(wheelGeo, MATS.tire);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    g.add(wheel);
  }
  if (burnt) {   // rusted-out shell with an ember glow in the engine bay
    const ember = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshStandardMaterial({ color: 0x220800, emissive: 0xff5a20, emissiveIntensity: 1.6 }));
    ember.position.set(1.6, 1.0, 0.3); g.add(ember);
  }
  g.position.set(x, 0, z); g.rotation.y = rot;
  g.traverse(o => { if (o.isMesh) { o.castShadow = !IS_TOUCH; staticTargets.push(o); } });
  scene.add(g);
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  addObstacleBox(x, z, 4.2 * c + 1.9 * s, 4.2 * s + 1.9 * c, 1.9);
}
for (let i = 0; i < 60; i++) {
  const onX = rng() < 0.5;
  const lane = (Math.floor(rng() * 11) - 5) * 60 + (rng() < 0.5 ? -3 : 3);
  const along = (rng() * 2 - 1) * 320;
  const x = onX ? along : lane, z = onX ? lane : along;
  if (x < WATER_X + 6 || Math.hypot(x - OUTPOST.x, z - OUTPOST.z) < OUTPOST.r + 6) continue;
  if (Math.hypot(x - STADIUM.x, z - STADIUM.z) < STADIUM.r + 6) continue;
  addCar(x, z, (onX ? 0 : Math.PI / 2) + (rng() - 0.5) * 0.7);
}
// rubble piles
const rubbleMat = new THREE.MeshStandardMaterial({ color: 0x6b675e, roughness: 1, flatShading: true });
for (let i = 0; i < 50; i++) {
  const x = (rng() * 2 - 1) * 330, z = (rng() * 2 - 1) * 330;
  if (x < WATER_X + 4 || Math.hypot(x - OUTPOST.x, z - OUTPOST.z) < OUTPOST.r + 4) continue;
  const s = 1.5 + rng() * 3;
  const pile = new THREE.Mesh(new THREE.ConeGeometry(s, s * 0.8, 6), rubbleMat);
  pile.position.set(x, s * 0.4 - 0.1, z); pile.rotation.y = rng() * 3;
  scene.add(pile); staticTargets.push(pile);
  addObstacleBox(x, z, s * 1.2, s * 1.2, s * 0.8);
}

/* ============================== CASCADE OUTPOST ============================== */
const npcMeshes = [];
/* shared rounded-body geometry (cached — dozens of characters reuse these) */
const BODY_GEO = {
  torso: new RoundedBoxGeometry(0.5, 0.6, 0.28, 2, 0.09),
  pelvis: new RoundedBoxGeometry(0.42, 0.22, 0.26, 2, 0.07),
  head: new RoundedBoxGeometry(0.26, 0.3, 0.27, 2, 0.09),
  jaw: new RoundedBoxGeometry(0.2, 0.08, 0.1, 1, 0.03),
  upperArm: new RoundedBoxGeometry(0.12, 0.32, 0.13, 1, 0.05),
  foreArm: new RoundedBoxGeometry(0.1, 0.3, 0.11, 1, 0.04),
  hand: new RoundedBoxGeometry(0.09, 0.12, 0.06, 1, 0.03),
  thigh: new RoundedBoxGeometry(0.17, 0.42, 0.19, 1, 0.06),
  shin: new RoundedBoxGeometry(0.14, 0.42, 0.16, 1, 0.05),
  foot: new RoundedBoxGeometry(0.14, 0.09, 0.26, 1, 0.03),
  eye: new THREE.SphereGeometry(0.028, 8, 8),
};
const matCache = new Map();
function cachedMat(color, rough = 0.9) {
  const key = color + '_' + rough;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough }));
  return matCache.get(key);
}
function buildHumanoid({ skin = 0x9a7455, shirt = 0x5a5f45, pants = 0x4a4438, hair = null, hairStyle = 'none', cap = null, scale = 1, zombie = false, eyeColor = 0x9fffd0 }) {
  const g = new THREE.Group();
  const skinM = cachedMat(skin), shirtM = cachedMat(shirt, 0.95), pantsM = cachedMat(pants, 0.95);
  // torso leans; zombies hunch forward
  const torso = new THREE.Mesh(BODY_GEO.torso, shirtM); torso.position.y = 1.18;
  if (zombie) { torso.rotation.x = 0.22; torso.position.z = 0.04; }
  g.add(torso);
  const pelvis = new THREE.Mesh(BODY_GEO.pelvis, pantsM); pelvis.position.y = 0.86; g.add(pelvis);
  const head = new THREE.Mesh(BODY_GEO.head, skinM); head.position.y = 1.65;
  if (zombie) { head.rotation.x = 0.15; head.position.z = 0.09; }
  g.add(head);
  const jaw = new THREE.Mesh(BODY_GEO.jaw, skinM); jaw.position.set(0, -0.15, 0.06); head.add(jaw);
  if (zombie) {
    const eyeM = new THREE.MeshStandardMaterial({ color: 0x061410, emissive: eyeColor, emissiveIntensity: 1.8 });
    for (const ex of [-0.065, 0.065]) {
      const eye = new THREE.Mesh(BODY_GEO.eye, eyeM);
      eye.position.set(ex, 0.03, 0.13); head.add(eye);
    }
  }
  // articulated limbs: group pivots at shoulder/hip so walk cycles read as joints
  function limb(upGeo, lowGeo, endGeo, upMat, lowMat, x, y, bend) {
    const root = new THREE.Group(); root.position.set(x, y, 0);
    const up = new THREE.Mesh(upGeo, upMat); up.position.y = -0.17; root.add(up);
    const lowG = new THREE.Group(); lowG.position.y = -0.34; lowG.rotation.x = bend; root.add(lowG);
    const low = new THREE.Mesh(lowGeo, lowMat); low.position.y = -0.16; lowG.add(low);
    const end = new THREE.Mesh(endGeo, lowMat === pantsM ? cachedMat(0x2a2622) : cachedMat(skin)); end.position.y = -0.34; lowG.add(end);
    if (endGeo === BODY_GEO.foot) end.position.set(0, -0.36, 0.05);
    g.add(root);
    return root;
  }
  const armL = limb(BODY_GEO.upperArm, BODY_GEO.foreArm, BODY_GEO.hand, shirtM, skinM, -0.34, 1.42, zombie ? -0.5 : -0.15);
  const armR = limb(BODY_GEO.upperArm, BODY_GEO.foreArm, BODY_GEO.hand, shirtM, skinM, 0.34, 1.42, zombie ? -0.5 : -0.15);
  const legL = limb(BODY_GEO.thigh, BODY_GEO.shin, BODY_GEO.foot, pantsM, pantsM, -0.14, 0.8, 0.12);
  const legR = limb(BODY_GEO.thigh, BODY_GEO.shin, BODY_GEO.foot, pantsM, pantsM, 0.14, 0.8, 0.12);
  const hairM = hair ? new THREE.MeshStandardMaterial({ color: hair, roughness: 0.6, emissive: hair, emissiveIntensity: zombie ? 0.55 : 0.1 }) : null;
  if (hair && hairStyle === 'mohawk') {
    for (let i = 0; i < 5; i++) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.2 + (2 - Math.abs(i - 2)) * 0.05, 5), hairM);
      fin.position.set(0, 0.17 + (2 - Math.abs(i - 2)) * 0.02, -0.1 + i * 0.055);
      fin.rotation.x = (i - 2) * 0.28;
      head.add(fin);
    }
  } else if (hair && hairStyle === 'spikes') {
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.17, 5), hairM);
      const a = (i / 7) * Math.PI - Math.PI / 2;
      sp.position.set(Math.sin(a) * 0.11, 0.15 + Math.cos(a) * 0.04, (Math.random() - 0.5) * 0.14);
      sp.rotation.z = -a * 0.8;
      head.add(sp);
    }
  } else if (hair && hairStyle === 'shag') {
    const m = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.14, 0.3, 1, 0.06), hairM);
    m.position.set(0, 0.16, -0.02); head.add(m);
  }
  if (cap) {
    const capM = cachedMat(cap, 0.8);
    const c = new THREE.Mesh(new RoundedBoxGeometry(0.3, 0.12, 0.3, 1, 0.06), capM);
    c.position.set(0, 0.17, 0); head.add(c);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, 0.14), capM);
    brim.position.set(0, 0.13, 0.2); head.add(brim);
  }
  g.scale.setScalar(scale);
  g.traverse(o => { if (o.isMesh) o.castShadow = !IS_TOUCH; });
  return { g, parts: { torso, head, legL, legR, armL, armR } };
}
function nameSprite(text, color = '#9fe3b4') {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 30px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(28, 8, 200, 46);
  ctx.fillStyle = color; ctx.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sp.scale.set(2.4, 0.6, 1);
  return sp;
}
{
  // walls: octagon of concrete + scrap
  const segs = 10;
  for (let i = 0; i < segs; i++) {
    const a = i / segs * Math.PI * 2;
    if (i === 7) continue;                                          // south gate
    const x = OUTPOST.x + Math.cos(a) * OUTPOST.r;
    const z = OUTPOST.z + Math.sin(a) * OUTPOST.r;
    const seg = new THREE.Mesh(new THREE.BoxGeometry(22, 4.4, 1.6), i % 2 ? MATS.rust : MATS.concrete);
    seg.position.set(x, 2.2, z); seg.rotation.y = -a + Math.PI / 2;
    scene.add(seg); staticTargets.push(seg);
    const c = Math.abs(Math.cos(-a + Math.PI / 2)), s = Math.abs(Math.sin(-a + Math.PI / 2));
    addObstacleBox(x, z, 22 * c + 1.6 * s, 22 * s + 1.6 * c, 4.4);
  }
  // watch tower + fire barrel
  const tower = new THREE.Mesh(new THREE.BoxGeometry(3, 7, 3), MATS.rust);
  tower.position.set(OUTPOST.x + 14, 3.5, OUTPOST.z - 12); scene.add(tower);
  addObstacleBox(OUTPOST.x + 14, OUTPOST.z - 12, 3, 3, 7);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.1, 10), MATS.rust);
  barrel.position.set(OUTPOST.x, 0.55, OUTPOST.z); scene.add(barrel);
  addObstacleBox(OUTPOST.x, OUTPOST.z, 1.1, 1.1, 1.1);
  const fire = new THREE.PointLight(0xff8a3a, 2.2, 26); fire.position.set(OUTPOST.x, 1.6, OUTPOST.z); scene.add(fire);
  // NPC visuals are GLB characters, created in buildNpcVisuals() once assets load
  // vendor stand
  const stand = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.1, 1.2), MATS.rust);
  stand.position.set(OUTPOST.x + 9, 0.55, OUTPOST.z + 6.6); scene.add(stand);
  addObstacleBox(OUTPOST.x + 9, OUTPOST.z + 6.6, 3.4, 1.2, 1.1);
}

/* ============================== LOOT CONTAINERS ============================== */
const containers = [];
const duffelMat = new THREE.MeshStandardMaterial({ color: 0x4e5b3a, roughness: 0.95 });
const coolerMat = new THREE.MeshStandardMaterial({ color: 0x3a5b6e, roughness: 0.8 });
const openMat = new THREE.MeshStandardMaterial({ color: 0x2a2d28, roughness: 1 });
for (let i = 0; i < 95; i++) {
  const x = (rng() * 2 - 1) * 330, z = (rng() * 2 - 1) * 330;
  if (x < WATER_X + 4) continue;
  if (Math.hypot(x - OUTPOST.x, z - OUTPOST.z) < OUTPOST.r + 3) continue;
  if (obstacles.some(o => x > o.minX - 1 && x < o.maxX + 1 && z > o.minZ - 1 && z < o.maxZ + 1)) continue;
  const isCooler = rng() < 0.4;
  const m = new THREE.Mesh(new THREE.BoxGeometry(isCooler ? 0.9 : 1.2, 0.55, 0.6), isCooler ? coolerMat : duffelMat);
  m.position.set(x, 0.28, z); m.rotation.y = rng() * 3;
  m.castShadow = !IS_TOUCH;
  scene.add(m);
  const c = { mesh: m, x, z, opened: false, respawnT: 0, mat: isCooler ? coolerMat : duffelMat };
  containers.push(c);
  interactables.push({ id: 'loot' + i, pos: new THREE.Vector3(x, 0.3, z), r: 2.4, label: 'SEARCH', active: () => !c.opened, action: () => openContainer(c) });
}

/* ============================== LIGHTS / DAY-NIGHT / RAIN ============================== */
const hemi = new THREE.HemisphereLight(0xbcd0e0, 0x5a6254, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2d8, 1.8);
sun.position.set(-60, 80, 30);
if (!IS_TOUCH) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -80;
  sun.shadow.camera.right = sun.shadow.camera.top = 80;
  sun.shadow.camera.far = 260;
}
scene.add(sun);
scene.add(sun.target);

const DAY_LEN = 480;                                   // seconds per full cycle
const skyDay = new THREE.Color(0x7c95a8), skyDusk = new THREE.Color(0x8a5648), skyNight = new THREE.Color(0x0a1018);
const fogNight = new THREE.Color(0x0c1218);
const tmpC = new THREE.Color();

/* celestial bodies + stars (bloom gives them halo) */
function discSprite(inner, outer) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const grd = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  grd.addColorStop(0, inner); grd.addColorStop(0.4, inner); grd.addColorStop(1, outer);
  ctx.fillStyle = grd; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
}
const sunSprite = discSprite('rgba(255,240,210,1)', 'rgba(255,190,110,0)'); sunSprite.scale.set(70, 70, 1); scene.add(sunSprite);
const moonSprite = discSprite('rgba(215,225,240,.95)', 'rgba(160,180,210,0)'); moonSprite.scale.set(34, 34, 1); scene.add(moonSprite);
const starGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(700 * 3);
  for (let i = 0; i < 700; i++) {
    const a = Math.random() * Math.PI * 2, e = Math.random() * Math.PI * 0.48;
    pos[i * 3] = Math.cos(a) * Math.cos(e) * 430;
    pos[i * 3 + 1] = Math.sin(e) * 430 + 10;
    pos[i * 3 + 2] = Math.sin(a) * Math.cos(e) * 430;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const starMat = new THREE.PointsMaterial({ color: 0xcfe0ff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
const stars = new THREE.Points(starGeo, starMat);
scene.add(stars);

/* low ragged rain clouds drifting over the city */
const cloudSprites = [];
{
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128;
  const cctx = cv.getContext('2d');
  for (let i = 0; i < 14; i++) {
    const grd = cctx.createRadialGradient(40 + Math.random() * 176, 40 + Math.random() * 48, 4, 40 + Math.random() * 176, 40 + Math.random() * 48, 34 + Math.random() * 26);
    grd.addColorStop(0, 'rgba(255,255,255,.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    cctx.fillStyle = grd; cctx.fillRect(0, 0, 256, 128);
  }
  const ctex = new THREE.CanvasTexture(cv); ctex.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < 22; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, opacity: 0.35 + Math.random() * 0.3, depthWrite: false, fog: false, color: 0x9aa8b4 }));
    sp.scale.set(140 + Math.random() * 180, 38 + Math.random() * 34, 1);
    const a = (i / 22) * Math.PI * 2 + Math.random();
    const r = 160 + Math.random() * 240;
    sp.position.set(Math.cos(a) * r, 60 + Math.random() * 70, Math.sin(a) * r);
    scene.add(sp);
    cloudSprites.push(sp);
  }
}

/* dead trees + debris scattered through open ground */
{
  const barkMat = new THREE.MeshStandardMaterial({ color: 0x3e332a, roughness: 1 });
  const branchGeo = new THREE.CylinderGeometry(0.03, 0.09, 1.6, 5);
  for (let i = 0; i < 90; i++) {
    const x = (rng() * 2 - 1) * 335, z = (rng() * 2 - 1) * 335;
    if (x < WATER_X + 5 || Math.hypot(x - OUTPOST.x, z - OUTPOST.z) < OUTPOST.r + 3) continue;
    if (Math.hypot(x - STADIUM.x, z - STADIUM.z) < STADIUM.r + 4) continue;
    if (obstacles.some(o => x > o.minX - 1.5 && x < o.maxX + 1.5 && z > o.minZ - 1.5 && z < o.maxZ + 1.5)) continue;
    const tree = new THREE.Group();
    const h = 3.5 + rng() * 3.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09 + rng() * 0.07, 0.24 + rng() * 0.1, h, 6), barkMat);
    trunk.position.y = h / 2; trunk.rotation.z = (rng() - 0.5) * 0.16;
    tree.add(trunk);
    const nb = 2 + Math.floor(rng() * 4);
    for (let b = 0; b < nb; b++) {
      const br = new THREE.Mesh(branchGeo, barkMat);
      const by = h * (0.5 + rng() * 0.45);
      br.position.set(0, by, 0);
      br.rotation.set((rng() - 0.5) * 2.4, rng() * Math.PI * 2, 0.7 + rng() * 0.9);
      br.translateY(0.7);
      tree.add(br);
    }
    tree.position.set(x, 0, z);
    tree.traverse(o => { if (o.isMesh) o.castShadow = !IS_TOUCH; });
    scene.add(tree);
    addObstacleBox(x, z, 0.5, 0.5, h);
  }
  // paper/junk debris flecks on the ground near roads
  const junkGeo = new THREE.PlaneGeometry(0.35, 0.5);
  const junkMats = [0x8a8478, 0x6a7078, 0x5a5044].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, side: THREE.DoubleSide }));
  for (let i = 0; i < 160; i++) {
    const x = (rng() * 2 - 1) * 330, z = (rng() * 2 - 1) * 330;
    if (x < WATER_X + 5) continue;
    const j = new THREE.Mesh(junkGeo, junkMats[Math.floor(rng() * 3)]);
    j.rotation.set(-Math.PI / 2 + (rng() - 0.5) * 0.4, 0, rng() * Math.PI * 2);
    j.position.set(x, 0.02 + rng() * 0.03, z);
    scene.add(j);
  }
}

let lightningT = 20, flashT = 0;
function updateDayNight() {
  const t = state.dayT;                                // 0..1, 0 = dawn
  const elev = Math.sin(t * Math.PI * 2);              // >0 day, <0 night
  state.night = elev < -0.08;
  const dayK = Math.max(0, Math.min(1, (elev + 0.15) / 0.5));
  const duskK = Math.max(0, 1 - Math.abs(elev) / 0.3);           // 1 at horizon
  sun.intensity = 0.1 + dayK * 2.1;
  sun.color.setHex(0xfff2d8).lerp(new THREE.Color(0xff8a50), duskK * 0.8);
  hemi.intensity = 0.16 + dayK * 0.95;
  const a = t * Math.PI * 2;
  const p = yawObj.position;
  // sun + shadow frustum follow the player so shadows exist everywhere on the map
  sun.position.set(p.x + Math.cos(a) * 90, Math.max(8, Math.sin(a) * 90), p.z + 40);
  sun.target.position.copy(p);
  sunSprite.position.set(p.x + Math.cos(a) * 380, Math.sin(a) * 380, p.z + 160);
  moonSprite.position.set(p.x + Math.cos(a + Math.PI) * 380, Math.sin(a + Math.PI) * 380, p.z - 120);
  sunSprite.material.opacity = Math.max(0, Math.min(1, elev * 4 + 0.4));
  moonSprite.material.opacity = Math.max(0, Math.min(0.9, -elev * 4));
  stars.position.set(p.x, 0, p.z);
  starMat.opacity = Math.max(0, -elev * 2.2 - 0.1) * 0.9;
  tmpC.copy(skyNight).lerp(skyDay, dayK).lerp(skyDusk, duskK * 0.55);
  scene.background.copy(tmpC);
  scene.fog.color.copy(tmpC).lerp(fogNight, (1 - dayK) * 0.5);
  scene.fog.near = state.night ? 22 : 46;
  scene.fog.far = state.night ? 160 : 260;
  // window glow, streetlamps, aviation blinkers fade in after dark
  const glow = Math.max(0, Math.min(1, -elev * 5 + 0.25));
  for (const m of glowMats) m.emissiveIntensity = glow * 1.5;
  const ei = 0.15 + dayK * 1.0;
  for (const m of envMats) m.envMapIntensity = ei;
  lampHeadMat.emissiveIntensity = glow * 2.2;
  blinkerMat.emissiveIntensity = glow * (Math.sin(state.time * 2.5) > 0.4 ? 3 : 0.1);
  // storm flashes
  if (flashT > 0) {
    flashT -= 1 / 60;
    const f = Math.max(0, flashT) * (0.7 + Math.random() * 0.6);
    hemi.intensity += f * 2.4;
    scene.background.lerp(new THREE.Color(0xcfd8e4), Math.min(1, f));
  }
}

// rain: slanted streaks (line segments), not dots
const RAIN_N = IS_TOUCH ? 320 : 650;
const rainGeo = new THREE.BufferGeometry();
const rainPos = new Float32Array(RAIN_N * 6);
const rainDrop = [];
for (let i = 0; i < RAIN_N; i++) {
  rainDrop.push({ x: (Math.random() * 2 - 1) * 40, y: Math.random() * 30, z: (Math.random() * 2 - 1) * 40 });
}
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xaac4d4, transparent: true, opacity: 0.34, fog: false }));
rain.frustumCulled = false;
scene.add(rain);
const RAIN_SLANT = 0.18;
function updateRain(dt) {
  for (let i = 0; i < RAIN_N; i++) {
    const d = rainDrop[i];
    d.y -= dt * 30;
    d.x += dt * 30 * RAIN_SLANT;
    if (d.y < 0) { d.x = (Math.random() * 2 - 1) * 40; d.y = 24 + Math.random() * 8; d.z = (Math.random() * 2 - 1) * 40; }
    const len = 0.55 + Math.random() * 0.1;
    rainPos[i * 6] = d.x; rainPos[i * 6 + 1] = d.y; rainPos[i * 6 + 2] = d.z;
    rainPos[i * 6 + 3] = d.x - RAIN_SLANT * len; rainPos[i * 6 + 4] = d.y + len; rainPos[i * 6 + 5] = d.z;
  }
  rainGeo.attributes.position.needsUpdate = true;
  rain.position.set(yawObj.position.x, 0, yawObj.position.z);
}

/* ============================== AUDIO ============================== */
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}
function noiseBuffer(dur) {
  const len = Math.floor(audioCtx.sampleRate * dur);
  const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
function sfx(type) {
  if (!audioCtx) return;
  const t = audioCtx.currentTime, out = audioCtx.destination;
  const noiseHit = (dur, freq, ftype, vol) => {
    const src = audioCtx.createBufferSource(); src.buffer = noiseBuffer(dur);
    const f = audioCtx.createBiquadFilter(); f.type = ftype; f.frequency.value = freq;
    const g = audioCtx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(out); src.start(t);
  };
  const tone = (type2, f0, f1, dur, vol, dt2 = 0) => {
    const o = audioCtx.createOscillator(); o.type = type2; o.frequency.setValueAtTime(f0, t + dt2);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dt2 + dur);
    const g = audioCtx.createGain(); g.gain.setValueAtTime(vol, t + dt2); g.gain.exponentialRampToValueAtTime(0.001, t + dt2 + dur);
    o.connect(g).connect(out); o.start(t + dt2); o.stop(t + dt2 + dur + 0.01);
  };
  if (type === 'shot') { noiseHit(0.09, 3000, 'lowpass', 0.45); tone('square', 190, 55, 0.08, 0.2); }
  else if (type === 'shotgun') { noiseHit(0.16, 1600, 'lowpass', 0.6); tone('square', 120, 40, 0.13, 0.3); }
  else if (type === 'rifle') { noiseHit(0.12, 2400, 'lowpass', 0.55); tone('square', 240, 50, 0.11, 0.26); }
  else if (type === 'melee') { noiseHit(0.06, 500, 'lowpass', 0.35); }
  else if (type === 'hit') { tone('sine', 880, null, 0.06, 0.15); }
  else if (type === 'zdie') { tone('sawtooth', 190, 40, 0.35, 0.22); noiseHit(0.25, 700, 'lowpass', 0.2); }
  else if (type === 'growl') { tone('sawtooth', 90 + Math.random() * 50, 45, 0.4, 0.12); }
  else if (type === 'spit') { noiseHit(0.14, 900, 'bandpass', 0.16); }
  else if (type === 'damage') { tone('sawtooth', 115, 50, 0.24, 0.28); }
  else if (type === 'reload') { [0, 0.12, 0.4].forEach((d, i) => { const src = audioCtx.createBufferSource(); src.buffer = noiseBuffer(0.03); const f = audioCtx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1800; const g = audioCtx.createGain(); g.gain.setValueAtTime(i === 2 ? 0.2 : 0.12, t + d); g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.03); src.connect(f).connect(g).connect(out); src.start(t + d); }); }
  else if (type === 'loot') { tone('triangle', 520, 780, 0.12, 0.14); tone('triangle', 780, 1040, 0.12, 0.12, 0.1); }
  else if (type === 'quest') { [[520, 0], [660, 0.14], [880, 0.28]].forEach(([f, d]) => tone('triangle', f, null, 0.22, 0.16, d)); }
  else if (type === 'levelup') { [[440, 0], [554, 0.12], [659, 0.24], [880, 0.36]].forEach(([f, d]) => tone('triangle', f, null, 0.26, 0.16, d)); }
  else if (type === 'focuson') { tone('sine', 900, 200, 0.5, 0.14); }
  else if (type === 'focusoff') { tone('sine', 200, 900, 0.3, 0.1); }
  else if (type === 'heal') { tone('sine', 400, 800, 0.3, 0.12); }
  else if (type === 'buy') { tone('triangle', 700, null, 0.08, 0.14); tone('triangle', 940, null, 0.1, 0.12, 0.09); }
  else if (type === 'wave') { [[440, 0], [660, 0.18]].forEach(([f, d]) => tone('triangle', f, null, 0.3, 0.16, d)); }
  else if (type === 'explosion') { noiseHit(0.45, 800, 'lowpass', 0.5); }
}

/* ============================== WEAPONS ============================== */
const WEAPONS = {
  bat:     { name: 'NAIL BAT', melee: true, dmg: 38, rate: 0.55, range: 2.6, key: 'B' },
  pistol:  { name: 'PISTOL', dmg: 16, rate: 0.26, mag: 12, ammo: 'light', spread: 0.012, auto: false, sfx: 'shot', key: 'P' },
  shotgun: { name: 'PUMP 12', dmg: 9, pellets: 8, rate: 0.95, mag: 6, ammo: 'shell', spread: 0.055, auto: false, sfx: 'shotgun', key: 'S' },
  smg:     { name: 'RAT-TAT SMG', dmg: 10, rate: 0.095, mag: 30, ammo: 'light', spread: 0.035, auto: true, sfx: 'shot', key: 'M' },
  rifle:   { name: 'CASCADE RIFLE', dmg: 62, rate: 1.15, mag: 5, ammo: 'rifle', spread: 0.003, auto: false, sfx: 'rifle', key: 'R' },
  gold:    { name: 'EMERALD SMG', dmg: 15, rate: 0.085, mag: 36, ammo: 'light', spread: 0.028, auto: true, sfx: 'shot', key: 'E' },
};
const AMMO_NAMES = { light: '9MM', shell: 'SHELLS', rifle: '.30 CAL' };

// viewmodels
const camoMat = new THREE.MeshStandardMaterial({ color: 0x53603f, roughness: 0.95 });
const skinMat = new THREE.MeshStandardMaterial({ color: 0xa07a58, roughness: 0.9 });
function armMesh(g) {
  const hand = new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.06, 0.09, 1, 0.02), skinMat); hand.position.set(0, -0.075, -0.13); g.add(hand);
  const arm = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.07, 0.24, 1, 0.02), camoMat); arm.position.set(0.045, -0.12, 0.04); arm.rotation.y = 0.28; g.add(arm);
}
function buildViewmodel(id) {
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: 0x1c1e20, roughness: 0.45, metalness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2e3134, roughness: 0.55, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6e4a2a, roughness: 0.85 });
  const gold = new THREE.MeshStandardMaterial({ color: 0x3fae7e, roughness: 0.35, metalness: 0.7, emissive: 0x0e4a30, emissiveIntensity: 0.4 });
  if (id === 'bat') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.75, 8), wood);
    shaft.rotation.x = -0.9; shaft.position.set(0.03, 0.06, -0.42); g.add(shaft);
    for (let i = 0; i < 3; i++) {
      const nail = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 4), black);
      nail.position.set(0.03 + (i - 1) * 0.02, 0.2 + i * 0.06, -0.6 - i * 0.03); nail.rotation.z = 0.9; g.add(nail);
    }
  } else {
    const main = id === 'gold' ? gold : black;
    const steel = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.35, metalness: 0.85 });
    const RB = (w, h, d, r = 0.012) => new RoundedBoxGeometry(w, h, d, 1, r);
    if (id === 'pistol') {
      const frame = new THREE.Mesh(RB(0.055, 0.06, 0.26), main); frame.position.set(0, -0.02, -0.2); g.add(frame);
      const slide = new THREE.Mesh(RB(0.06, 0.05, 0.3), steel); slide.position.set(0, 0.035, -0.21); g.add(slide);
      for (let i = 0; i < 6; i++) {  // slide serrations
        const cut = new THREE.Mesh(new THREE.BoxGeometry(0.063, 0.03, 0.006), dark);
        cut.position.set(0, 0.04, -0.09 - i * 0.012); g.add(cut);
      }
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.007, 6, 12, Math.PI), main);
      guard.rotation.y = Math.PI / 2; guard.position.set(0, -0.065, -0.16); g.add(guard);
      const fsight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.018, 0.01), main); fsight.position.set(0, 0.068, -0.35); g.add(fsight);
      const rsight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.014, 0.01), main); rsight.position.set(0, 0.066, -0.07); g.add(rsight);
    } else {
      const body = new THREE.Mesh(RB(0.075, 0.1, 0.55), main); body.position.z = -0.3; g.add(body);
      const top = new THREE.Mesh(RB(0.05, 0.035, 0.4), steel); top.position.set(0, 0.065, -0.32); g.add(top);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, id === 'rifle' ? 0.55 : 0.35, 10), steel);
      barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.03, id === 'rifle' ? -0.85 : -0.62); g.add(barrel);
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.06, 10), main);
      muzzle.rotation.x = Math.PI / 2; muzzle.position.set(0, 0.03, id === 'rifle' ? -1.1 : -0.77); g.add(muzzle);
      const fsight = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.03, 0.012), main); fsight.position.set(0, 0.075, id === 'rifle' ? -1.05 : -0.72); g.add(fsight);
    }
    const grip = new THREE.Mesh(RB(0.05, 0.15, 0.07), dark); grip.position.set(0, -0.12, -0.1); grip.rotation.x = 0.32; g.add(grip);
    if (id !== 'pistol') { const mag = new THREE.Mesh(RB(0.045, 0.16, 0.075), dark); mag.position.set(0, -0.13, -0.3); mag.rotation.x = -0.12; g.add(mag); }
    if (id === 'shotgun') { const pump = new THREE.Mesh(RB(0.065, 0.06, 0.2), wood); pump.position.set(0, -0.035, -0.5); g.add(pump); }
    if (id === 'rifle') {
      const stock = new THREE.Mesh(RB(0.06, 0.1, 0.22), wood); stock.position.set(0, -0.03, 0.05); g.add(stock);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.16, 10), black); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.1, -0.3); g.add(scope);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.02, 10), new THREE.MeshStandardMaterial({ color: 0x2a4a6a, roughness: 0.1, metalness: 0.8 }));
      lens.position.set(0, 0.1, -0.381); g.add(lens);
    }
  }
  armMesh(g);
  g.scale.setScalar(0.42);
  g.position.set(0.21, -0.19, -0.36);
  g.visible = false;
  camera.add(g);
  return g;
}
const viewmodels = {};
for (const id of Object.keys(WEAPONS)) viewmodels[id] = buildViewmodel(id);
const muzzleFlash = new THREE.PointLight(0xffcf8a, 0, 8);
muzzleFlash.position.set(0.26, -0.17, -1.0);
camera.add(muzzleFlash);

/* ============================== STATE / PROGRESSION ============================== */
const PERKS = [
  { id: 'tough', name: 'RAIN-TOUGH', desc: '+30 max health.' },
  { id: 'runner', name: 'CITY RUNNER', desc: '+15% move speed.' },
  { id: 'steady', name: 'STEADY HANDS', desc: '30% tighter spread.' },
  { id: 'scavenger', name: 'SCAVENGER', desc: '+40% tabs from loot.' },
  { id: 'headhunter', name: 'HEADHUNTER', desc: 'Headshots deal +50% bonus.' },
  { id: 'medic', name: 'FIELD MEDIC', desc: 'Medkits heal 50% more.' },
  { id: 'zen', name: 'RAIN ZEN', desc: '+50 focus meter, faster regen.' },
  { id: 'packrat', name: 'PACKRAT', desc: '+60% ammo carry capacity.' },
  { id: 'brawler', name: 'BRAWLER', desc: 'Melee damage doubled.' },
];
const state = {
  mode: 'menu',                       // menu | playing | paused | dialog | dead | perk
  hp: 100, focus: 60,
  tabs: 40, xp: 0, level: 1,
  perks: [],
  weapons: ['bat', 'pistol'], weapon: 'pistol',
  mags: { pistol: 12, shotgun: 6, smg: 30, rifle: 5, gold: 36 },
  ammo: { light: 48, shell: 0, rifle: 0 },
  items: { medkit: 1, shot: 1 },
  reloading: false, reloadT: 0, fireCooldown: 0,
  focusOn: false, timeScale: 1,
  dayT: 0.12, night: false, time: 0, lastDamageT: -99,
  shakeT: 0, shakeAmp: 0,
  kills: 0, deaths: 0,
  quest: { index: 0, stage: 0, data: {} },    // stage 0 = not accepted, 1 = active, 2 = return to giver
  job: null, jobsDone: 0,
  lastStand: { active: false, wave: 0, pend: 0, spawnT: 0, inter: 0 },
  bestWave: 0,
  saveT: 0,
};
const stat = {
  maxHp: () => 100 + (state.perks.includes('tough') ? 30 : 0),
  speedMul: () => state.perks.includes('runner') ? 1.15 : 1,
  spreadMul: () => state.perks.includes('steady') ? 0.7 : 1,
  lootMul: () => state.perks.includes('scavenger') ? 1.4 : 1,
  headMul: () => state.perks.includes('headhunter') ? 2.5 : 2,
  healMul: () => state.perks.includes('medic') ? 1.5 : 1,
  focusMax: () => state.perks.includes('zen') ? 150 : 100,
  ammoCap: t => Math.round((t === 'light' ? 120 : t === 'shell' ? 40 : 30) * (state.perks.includes('packrat') ? 1.6 : 1)),
  meleeMul: () => state.perks.includes('brawler') ? 2 : 1,
  xpNeed: () => 80 + (state.level - 1) * 60,
};
const keys = {};
const vel = new THREE.Vector3();
let onGround = true, yaw = Math.PI, pitch = 0, recoil = 0, fireHeld = false;

const zombies = [];
const projectiles = [];  // spitter globs
const effects = [];

/* ============================== ZOMBIES: THE FADED ============================== */
const HAIR_COLORS = [0xff3fa4, 0x8a3fff, 0x54ff3f, 0x3fd4ff, 0xff8a1f, 0xfff03f];
const ZTYPES = {
  shambler: { hp: 40, speed: 2.0, dmg: 10, atkRate: 1.3, score: 40, xp: 12, skin: 0x7a8a6a, scale: 1 },
  sprinter: { hp: 26, speed: 5.2, dmg: 8, atkRate: 0.9, score: 60, xp: 16, skin: 0x8a9a72, scale: 0.95 },
  spitter:  { hp: 34, speed: 1.6, dmg: 12, atkRate: 2.4, score: 70, xp: 18, skin: 0x6a9a5a, scale: 1, ranged: true },
  brute:    { hp: 220, speed: 1.5, dmg: 26, atkRate: 1.8, score: 220, xp: 60, skin: 0x5a7a52, scale: 1.5 },
};
function pickZombieType(danger) {
  const r = Math.random();
  const nightBoost = state.night ? 0.12 : 0;
  if (danger >= 3 && r < 0.06 + nightBoost * 0.5) return 'brute';
  if (r < 0.16 + danger * 0.03) return 'spitter';
  if (r < 0.45 + nightBoost + danger * 0.04) return 'sprinter';
  return 'shambler';
}
const ZMODEL = { shambler: 'Skeleton_Minion', sprinter: 'Skeleton_Rogue', spitter: 'Skeleton_Mage', brute: 'Skeleton_Warrior' };
const ZMOVE = { shambler: 'Walking_D_Skeletons', sprinter: 'Running_A', spitter: 'Walking_B', brute: 'Walking_A' };
const ZTINT = { shambler: 0x8a9878, sprinter: 0x7a8898, spitter: 0x7a9868, brute: 0x8a7462 };
const ZMOVE_BASE = { shambler: 1.6, sprinter: 4.2, spitter: 1.4, brute: 1.3 };
const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
const zbHeadBones = [];
function zbSetAnim(zb, name) {
  if (zb.animState === name) return;
  const next = name === 'move' ? zb.moveA : zb.idleA;
  const prev = name === 'move' ? zb.idleA : zb.moveA;
  prev.fadeOut(0.22);
  next.reset().fadeIn(0.22).play();
  zb.animState = name;
}
function makeZombie(type, x, z, opts = {}) {
  const T = ZTYPES[type];
  const hair = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
  const eyeColor = type === 'brute' ? 0xff5040 : type === 'spitter' ? 0x8aff40 : 0x9fffd0;
  const { obj, mixer, clip } = spawnCharacter(ZMODEL[type], { tint: ZTINT[type], eyeColor });
  const g = new THREE.Group();
  g.add(obj);
  // neon punk hair on the head bone (sized in bone space)
  const headBone = obj.getObjectByName('head');
  let hairGrp = null;
  if (headBone) {
    headBone.scale.setScalar(0.62);                       // de-chibi the skull
    zbHeadBones.push(headBone);
    const hairM = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.55, emissive: hair, emissiveIntensity: 0.8 });
    hairGrp = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24 + (2 - Math.abs(i - 2)) * 0.08, 5), hairM);
      fin.position.set(0, (2 - Math.abs(i - 2)) * 0.02, -0.14 + i * 0.07);
      fin.rotation.x = (i - 2) * 0.34;
      hairGrp.add(fin);
    }
    g.add(hairGrp);                                        // positioned once the bone pose settles
  }
  g.scale.setScalar(T.scale * (0.95 + Math.random() * 0.1));
  g.position.set(x, 0, z);
  scene.add(g);
  // invisible raycast proxies (skinned meshes are expensive to raycast)
  const bodyHit = new THREE.Mesh(new THREE.BoxGeometry(0.66, 1.5, 0.6), proxyMat);
  bodyHit.position.y = 0.75; g.add(bodyHit);
  const headHit = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.5, 0.44), proxyMat);
  headHit.position.y = 1.66; g.add(headHit);
  const idleA = mixer.clipAction(clip('Idle'));
  const moveA = mixer.clipAction(clip(ZMOVE[type]) || clip('Walking_A'));
  const attackA = mixer.clipAction(type === 'spitter' && clip('Spellcast_Shoot') ? clip('Spellcast_Shoot') : clip('Unarmed_Melee_Attack_Punch_A'));
  attackA.setLoop(THREE.LoopOnce);
  const deathA = mixer.clipAction(clip(Math.random() < 0.5 ? 'Death_A' : 'Death_B'));
  deathA.setLoop(THREE.LoopOnce); deathA.clampWhenFinished = true;
  const zb = {
    g, obj, mixer, type, idleA, moveA, attackA, deathA, headBone,
    animState: 'idle', animLockT: 0, animBase: ZMOVE_BASE[type], riseT: 0,
    hp: opts.hp || T.hp * (1 + (state.level - 1) * 0.06), maxHp: T.hp,
    speed: T.speed * (0.9 + Math.random() * 0.25) * (state.night ? 1.2 : 1),
    dmg: T.dmg, atkRate: T.atkRate, atkT: 1 + Math.random(),
    dead: false, aggro: opts.aggro || false,
    growlT: Math.random() * 6, boss: opts.boss || false, name: opts.name,
  };
  if (opts.rise && clip('Spawn_Ground_Skeletons')) {
    const riseA = mixer.clipAction(clip('Spawn_Ground_Skeletons'));
    riseA.setLoop(THREE.LoopOnce);
    riseA.play();
    zb.riseT = riseA.getClip().duration * 0.9;
    zb.animState = 'rise';
  } else {
    idleA.play();
  }
  mixer.update(0.001);
  if (headBone) {
    headBone.scale.setScalar(0.62);
    obj.updateMatrixWorld(true);
    const hw = new THREE.Vector3();
    headBone.getWorldPosition(hw);
    g.worldToLocal(hw);
    if (hairGrp) hairGrp.position.set(hw.x, hw.y + 0.42, hw.z);
  }
  if (opts.boss) { g.scale.multiplyScalar(1.25); zb.hp = opts.hp; const ns = nameSprite(opts.name, '#ff6b5b'); ns.position.y = 2.5; g.add(ns); }
  const hitParts = [bodyHit, headHit];
  hitParts.forEach(m => m.userData.zombie = zb);
  zb.hitMeshes = hitParts; zb.head = headHit;
  zombies.push(zb);
  return zb;
}
function damageZombie(zb, dmg, headshot) {
  if (zb.dead) return;
  zb.hp -= headshot ? dmg * stat.headMul() : dmg;
  zb.aggro = true;
  hud.crosshair.classList.add('hit');
  clearTimeout(damageZombie._t); damageZombie._t = setTimeout(() => hud.crosshair.classList.remove('hit'), 90);
  sfx('hit');
  spawnBlood(zb.g.position.clone().setY(1.2));
  if (zb.hp <= 0) killZombie(zb);
}
function killZombie(zb) {
  zb.dead = true;
  state.kills++;
  const T = ZTYPES[zb.type];
  addXp(T.xp + (zb.boss ? 150 : 0));
  state.focus = Math.min(stat.focusMax(), state.focus + 14);
  if (Math.random() < 0.3) { const amt = Math.round((2 + Math.random() * 5) * stat.lootMul()); state.tabs += amt; floater('+' + amt + ' TABS'); }
  sfx('zdie');
  zb.idleA.fadeOut(0.08); zb.moveA.fadeOut(0.08); zb.attackA.fadeOut(0.08);
  zb.deathA.reset().play();
  effects.push({ obj: zb.g, life: 0, ttl: 2.0, update(dt2) { zb.mixer.update(dt2); } });
  zombies.splice(zombies.indexOf(zb), 1);
  if (state.quest.stage === 1) questEvent('kill', zb);
  if (state.job && state.job.type === 'bounty') { state.job.done++; updateQuestHud(); if (state.job.done >= state.job.count) completeJobStage(); }
  if (state.lastStand.active) updateHudSoon();
}

/* spawner: keep pressure near the player */
let spawnT = 0;
function updateSpawns(dt) {
  if (state.lastStand.active) return;
  spawnT -= dt;
  if (spawnT > 0) return;
  spawnT = state.night ? 1.6 : 2.6;
  const cap = (IS_TOUCH ? 14 : 20) + (state.night ? 6 : 0);
  if (zombies.length >= cap) return;
  const p = yawObj.position;
  if (Math.hypot(p.x - OUTPOST.x, p.z - OUTPOST.z) < OUTPOST.r + 10) return;   // safe at home
  const d = districtAt(p.x, p.z);
  if (d.danger === 0) return;
  const a = Math.random() * Math.PI * 2;
  const dist = 34 + Math.random() * 36;
  const x = p.x + Math.cos(a) * dist, z = p.z + Math.sin(a) * dist;
  if (x < WATER_X + 3 || Math.abs(x) > MAP - 6 || Math.abs(z) > MAP - 6) return;
  if (Math.hypot(x - OUTPOST.x, z - OUTPOST.z) < OUTPOST.r + 6) return;
  if (obstacles.some(o => x > o.minX - 0.6 && x < o.maxX + 0.6 && z > o.minZ - 0.6 && z < o.maxZ + 0.6)) return;
  const n = Math.min(1 + Math.floor(Math.random() * d.danger), cap - zombies.length);
  for (let i = 0; i < n; i++) makeZombie(pickZombieType(d.danger), x + (Math.random() - 0.5) * 6, z + (Math.random() - 0.5) * 6);
}
function updateZombies(dt) {
  const p = yawObj.position;
  for (const zb of zombies) {
    const zp = zb.g.position;
    const dx = p.x - zp.x, dz = p.z - zp.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 130) { scene.remove(zb.g); zombies.splice(zombies.indexOf(zb), 1); continue; }
    zb.mixer.update(dt);
    if (zb.headBone) zb.headBone.scale.setScalar(0.62);
    if (zb.riseT > 0) { zb.riseT -= dt; if (zb.riseT <= 0) { zb.animState = 'rose'; zbSetAnim(zb, 'idle'); } continue; }
    if (!zb.aggro && dist < (state.night ? 34 : 24)) zb.aggro = true;
    zb.growlT -= dt;
    if (zb.aggro && zb.growlT <= 0 && dist < 30) { zb.growlT = 4 + Math.random() * 5; sfx('growl'); }
    let vx = 0, vz = 0;
    if (zb.aggro) {
      const inOutpost = Math.hypot(zp.x + dx / dist * 2 - OUTPOST.x, zp.z + dz / dist * 2 - OUTPOST.z) < OUTPOST.r;
      const standoff = zb.type === 'spitter' ? 14 : 1.3;
      if (dist > standoff && !inOutpost) { vx = dx / dist * zb.speed; vz = dz / dist * zb.speed; }
      zp.x += vx * dt; zp.z += vz * dt;
      collideCircle(zp, 0.5);
      zb.g.lookAt(p.x, 0, p.z);
      zb.atkT -= dt;
      if (zb.atkT <= 0) {
        if (zb.type === 'spitter' && dist < 30) {
          zb.atkT = zb.atkRate;
          zb.idleA.fadeOut(0.08); zb.moveA.fadeOut(0.08);
          zb.attackA.reset().fadeIn(0.06).play();
          zb.animState = 'attack'; zb.animLockT = 0.8;
          const from = zp.clone().setY(1.4);
          const dir = p.clone().setY(1.2).sub(from).normalize();
          const mesh = new THREE.Mesh(spitGeo, spitMat);
          mesh.position.copy(from);
          scene.add(mesh);
          projectiles.push({ mesh, dir, speed: 16, life: 3, dmg: zb.dmg });
          sfx('spit');
        } else if (!ZTYPES[zb.type].ranged && dist < (zb.type === 'brute' ? 2.6 : 1.9)) {
          zb.atkT = zb.atkRate;
          damagePlayer(zb.dmg + Math.floor(Math.random() * 4));
          zb.idleA.fadeOut(0.08); zb.moveA.fadeOut(0.08);
          zb.attackA.reset().fadeIn(0.06).play();
          zb.animState = 'attack'; zb.animLockT = 0.7;
        } else zb.atkT = 0.3;
      }
    } else if (Math.random() < dt * 0.4) {           // idle shuffle
      const a = Math.random() * Math.PI * 2;
      zp.x += Math.cos(a) * 0.4; zp.z += Math.sin(a) * 0.4;
      collideCircle(zp, 0.5);
    }
    const sp2 = Math.hypot(vx, vz);
    if (zb.animLockT > 0) zb.animLockT -= dt;
    else zbSetAnim(zb, sp2 > 0.3 ? 'move' : 'idle');
    if (zb.animState === 'move') zb.moveA.timeScale = Math.max(0.55, Math.min(2.2, sp2 / zb.animBase));
  }
}

/* spit globs */
const spitGeo = new THREE.SphereGeometry(0.14, 8, 8);
const spitMat = new THREE.MeshStandardMaterial({ color: 0x7aff3a, emissive: 0x3a8a10, emissiveIntensity: 2 });
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const pr = projectiles[i];
    pr.life -= dt;
    pr.mesh.position.addScaledVector(pr.dir, pr.speed * dt);
    const pp = pr.mesh.position;
    let dead = pr.life <= 0 || pp.y < 0;
    if (!dead) {
      const dx = pp.x - yawObj.position.x, dz = pp.z - yawObj.position.z;
      if (dx * dx + dz * dz < 0.4 && pp.y > 0.1 && pp.y < 2.1) { damagePlayer(pr.dmg); dead = true; }
    }
    if (!dead) for (const o of obstacles) if (pp.x > o.minX && pp.x < o.maxX && pp.z > o.minZ && pp.z < o.maxZ && pp.y < o.height) { dead = true; break; }
    if (dead) { spawnSparks(pp, 0x7aff3a); scene.remove(pr.mesh); projectiles.splice(i, 1); }
  }
}

/* ============================== EFFECTS ============================== */
function particleBurst(pos, color, count, size, speed, ttl, gravity) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(count * 3);
  const vels = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = pos.x; positions[i * 3 + 1] = pos.y; positions[i * 3 + 2] = pos.z;
    vels.push(new THREE.Vector3(Math.random() - .5, Math.random() - .25, Math.random() - .5).normalize().multiplyScalar(speed * (0.5 + Math.random())));
  }
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity: 1 });
  const pts = new THREE.Points(geo, mat);
  scene.add(pts);
  effects.push({
    obj: pts, life: 0, ttl,
    update(dt, k) {
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        vels[i].y -= gravity * dt;
        arr[i * 3] += vels[i].x * dt; arr[i * 3 + 1] += vels[i].y * dt; arr[i * 3 + 2] += vels[i].z * dt;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 1 - k;
    }
  });
}
const spawnSparks = (pos, color = 0xffd080) => particleBurst(pos, color, 8, 0.08, 3, 0.35, 12);
const spawnBlood = pos => particleBurst(pos, 0x4a6a2a, 10, 0.09, 2.5, 0.45, 10);   // the Faded bleed murky green
function spawnTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  effects.push({ obj: line, life: 0, ttl: 0.06, update(dt, k) { mat.opacity = 0.85 * (1 - k); } });
}
function updateEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    e.life += dt;
    const k = e.life / e.ttl;
    if (k >= 1) { scene.remove(e.obj); effects.splice(i, 1); }
    else e.update(dt, k);
  }
}
function addShake(amp) { state.shakeAmp = Math.min(0.2, state.shakeAmp + amp); state.shakeT = 0.25; }

/* ============================== SHOOTING / MELEE ============================== */
const raycaster = new THREE.Raycaster();
function currentWeapon() { return WEAPONS[state.weapon]; }
function shoot() {
  const W = currentWeapon();
  if (state.fireCooldown > 0 || state.reloading) return;
  if (W.melee) {
    state.fireCooldown = W.rate;
    sfx('melee');
    recoil = 1;
    let hitAny = false;
    for (const zb of [...zombies]) {
      const zp = zb.g.position;
      const dx = zp.x - yawObj.position.x, dz = zp.z - yawObj.position.z;
      const d = Math.hypot(dx, dz);
      if (d > W.range) continue;
      const ang = Math.atan2(-dx, -dz);
      let diff = ang - yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.85) { damageZombie(zb, W.dmg * stat.meleeMul(), false); hitAny = true; }
    }
    if (hitAny) addShake(0.03);
    return;
  }
  if (state.mags[state.weapon] <= 0) { reload(); return; }
  state.mags[state.weapon]--;
  state.fireCooldown = W.rate;
  sfx(W.sfx);
  recoil = 1; pitch += W.pellets ? 0.014 : 0.006;
  muzzleFlash.intensity = 24;
  addShake(0.012);
  const pellets = W.pellets || 1;
  const targets = [...staticTargets];
  zombies.forEach(z => targets.push(...z.hitMeshes));
  const muzzleWorld = new THREE.Vector3();
  viewmodels[state.weapon].getWorldPosition(muzzleWorld);
  for (let i = 0; i < pellets; i++) {
    const spread = W.spread * stat.spreadMul();
    raycaster.setFromCamera(new THREE.Vector2((Math.random() - 0.5) * spread * 8, (Math.random() - 0.5) * spread * 8), camera);
    raycaster.far = 160;
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length) {
      const h = hits[0];
      if (i < 2) spawnTracer(muzzleWorld, h.point);
      const zb = h.object.userData.zombie;
      const nest = h.object.userData.nest;
      if (zb) damageZombie(zb, W.dmg + Math.floor(Math.random() * 4), h.object === zb.head);
      else if (nest) damageNest(nest, W.dmg);
      else spawnSparks(h.point);
    } else if (i === 0) {
      spawnTracer(muzzleWorld, raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, 80));
    }
  }
  updateHudSoon();
  if (state.mags[state.weapon] === 0) reload();
}
function reload() {
  const W = currentWeapon();
  if (W.melee || state.reloading || state.mags[state.weapon] === W.mag) return;
  if (state.ammo[W.ammo] <= 0) { floater('NO ' + AMMO_NAMES[W.ammo]); return; }
  state.reloading = true; state.reloadT = 1.4;
  sfx('reload'); updateHudSoon();
}
function finishReload() {
  const W = currentWeapon();
  const need = W.mag - state.mags[state.weapon];
  const take = Math.min(need, state.ammo[W.ammo]);
  state.ammo[W.ammo] -= take;
  state.mags[state.weapon] += take;
  state.reloading = false;
  updateHudSoon();
}
function switchWeapon(id) {
  if (!state.weapons.includes(id) || state.weapon === id) return;
  viewmodels[state.weapon].visible = false;
  state.weapon = id;
  state.reloading = false; state.fireCooldown = 0.25;
  viewmodels[id].visible = true;
  updateHudSoon();
}

/* ============================== PLAYER ============================== */
function damagePlayer(dmg) {
  if (state.mode !== 'playing') return;
  state.hp -= dmg;
  state.lastDamageT = state.time;
  sfx('damage'); addShake(0.08);
  hud.vignette.style.opacity = 0.9;
  setTimeout(() => { if (state.hp > 0) hud.vignette.style.opacity = 0; }, 220);
  updateHudSoon();
  if (state.hp <= 0) playerDeath();
}
function playerDeath() {
  state.mode = 'dead';
  state.deaths++;
  const lost = Math.floor(state.tabs * 0.25);
  state.tabs -= lost;
  if (state.lastStand.active) endLastStand(false);
  el('deathStats').innerHTML = `Lost <b>${lost} tabs</b> in the mud. &nbsp;Kills so far: <b>${state.kills}</b>`;
  el('deathScreen').classList.remove('hidden');
  hud.vignette.style.opacity = 0.95;
  if (document.pointerLockElement) document.exitPointerLock();
  saveGame();
}
function respawn() {
  state.hp = stat.maxHp();
  state.focus = 50;
  state.focusOn = false;
  yawObj.position.set(OUTPOST.x, 1.7, OUTPOST.z + 6);
  yaw = Math.PI; pitch = 0;
  for (const zb of [...zombies]) { scene.remove(zb.g); }
  zombies.length = 0;
  projectiles.forEach(p => scene.remove(p.mesh)); projectiles.length = 0;
  hud.vignette.style.opacity = 0;
  el('deathScreen').classList.add('hidden');
  state.mode = 'playing';
  updateHudSoon();
}
function collideCircle(pos, radius) {
  for (const o of obstacles) {
    const cx = Math.max(o.minX, Math.min(pos.x, o.maxX));
    const cz = Math.max(o.minZ, Math.min(pos.z, o.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      const dist = Math.sqrt(distSq) || 0.001;
      const push = (radius - dist) / dist;
      pos.x += dx * push; pos.z += dz * push;
    }
  }
  pos.x = Math.max(WATER_X + 1, Math.min(MAP - 2, pos.x));
  pos.z = Math.max(-MAP + 2, Math.min(MAP - 2, pos.z));
}
function useMedkit() {
  if (state.items.medkit <= 0 || state.hp >= stat.maxHp()) return;
  state.items.medkit--;
  state.hp = Math.min(stat.maxHp(), state.hp + 55 * stat.healMul());
  sfx('heal'); floater('PATCHED UP'); updateHudSoon();
}
let shotBoostT = 0;
function useShot() {
  if (state.items.shot <= 0) return;
  state.items.shot--;
  state.hp = Math.min(stat.maxHp(), state.hp + 15);
  shotBoostT = 12;
  sfx('heal'); floater('DOUBLE SHOT! ☕'); updateHudSoon();
}
let pendingPerks = 0;
function addXp(n) {
  state.xp += n;
  while (state.xp >= stat.xpNeed()) {
    state.xp -= stat.xpNeed();
    state.level++;
    pendingPerks++;
    sfx('levelup');
    showBanner('LEVEL ' + state.level, 'Pick a perk');
  }
  if (pendingPerks > 0 && state.mode !== 'perk') offerPerks();
  updateHudSoon();
}
function offerPerks() {
  const pool = PERKS.filter(p => !state.perks.includes(p.id));
  if (!pool.length) return;
  const picks = [];
  while (picks.length < Math.min(3, pool.length)) {
    const p = pool[Math.floor(Math.random() * pool.length)];
    if (!picks.includes(p)) picks.push(p);
  }
  const row = el('perkRow'); row.innerHTML = '';
  for (const p of picks) {
    const card = document.createElement('div');
    card.className = 'perkcard';
    card.innerHTML = `<b>${p.name}</b><span>${p.desc}</span>`;
    card.onclick = () => {
      state.perks.push(p.id);
      if (p.id === 'tough') state.hp = Math.min(stat.maxHp(), state.hp + 30);
      pendingPerks = Math.max(0, pendingPerks - 1);
      el('perkScreen').classList.add('hidden');
      state.mode = 'playing';
      saveGame(); updateHudSoon();
      if (pendingPerks > 0) offerPerks();
    };
    row.appendChild(card);
  }
  state.mode = 'perk';
  el('perkScreen').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

/* ============================== LOOT ============================== */
function openContainer(c) {
  c.opened = true; c.respawnT = 200;
  c.mesh.material = openMat;
  sfx('loot');
  const roll = Math.random();
  if (roll < 0.34) { const amt = Math.round((8 + Math.random() * 22) * stat.lootMul()); state.tabs += amt; floater('+' + amt + ' TABS'); }
  else if (roll < 0.62) {
    const t = ['light', 'light', 'shell', 'rifle'][Math.floor(Math.random() * 4)];
    const amt = t === 'light' ? 12 + Math.floor(Math.random() * 14) : t === 'shell' ? 4 + Math.floor(Math.random() * 5) : 3 + Math.floor(Math.random() * 4);
    state.ammo[t] = Math.min(stat.ammoCap(t), state.ammo[t] + amt);
    floater('+' + amt + ' ' + AMMO_NAMES[t]);
  }
  else if (roll < 0.76) { state.items.medkit++; floater('+ MEDKIT'); }
  else if (roll < 0.88) { state.items.shot++; floater('+ DOUBLE SHOT ☕'); }
  else if (roll < 0.92 && !state.weapons.includes('shotgun')) { state.weapons.push('shotgun'); state.ammo.shell += 8; floater('FOUND: PUMP 12!'); sfx('quest'); }
  else if (roll < 0.94 && !state.weapons.includes('smg')) { state.weapons.push('smg'); state.ammo.light += 20; floater('FOUND: RAT-TAT SMG!'); sfx('quest'); }
  else { const amt = Math.round(15 * stat.lootMul()); state.tabs += amt; floater('+' + amt + ' TABS'); }
  if (state.job && state.job.type === 'salvage') { questEvent('salvageLoot'); }
  updateHudSoon(); saveGame();
}
function updateContainers(dt) {
  for (const c of containers) {
    if (c.opened) { c.respawnT -= dt; if (c.respawnT <= 0) { c.opened = false; c.mesh.material = c.mat; } }
  }
}

/* ============================== STORY QUESTS ============================== */
const nests = [];
function spawnNest(x, z, id) {
  const mound = new THREE.Mesh(new THREE.ConeGeometry(2.4, 2.6, 7), new THREE.MeshStandardMaterial({ color: 0x54663e, roughness: 1, flatShading: true }));
  mound.position.set(x, 1.2, z);
  scene.add(mound);
  const glow = new THREE.PointLight(0x9aff4a, 1.4, 14); glow.position.set(x, 2.4, z); scene.add(glow);
  const nest = { mesh: mound, glow, hp: 120, x, z, id, dead: false, spawnT: 3 };
  mound.userData.nest = nest;
  staticTargets.push(mound);
  nests.push(nest);
  return nest;
}
function damageNest(nest, dmg) {
  if (nest.dead) return;
  nest.hp -= dmg;
  spawnSparks(nest.mesh.position, 0x9aff4a);
  sfx('hit');
  if (nest.hp <= 0) {
    nest.dead = true;
    scene.remove(nest.mesh); scene.remove(nest.glow);
    staticTargets.splice(staticTargets.indexOf(nest.mesh), 1);
    particleBurst(nest.mesh.position, 0x9aff4a, 30, 0.18, 6, 0.8, 8);
    sfx('explosion'); addShake(0.1);
    floater('NEST DESTROYED');
    questEvent('nest');
  }
}
function updateNests(dt) {
  for (const nest of nests) {
    if (nest.dead) continue;
    nest.spawnT -= dt;
    const near = Math.hypot(yawObj.position.x - nest.x, yawObj.position.z - nest.z) < 40;
    if (nest.spawnT <= 0 && near && zombies.length < 22) {
      nest.spawnT = 7;
      makeZombie('shambler', nest.x + (Math.random() - 0.5) * 4, nest.z + (Math.random() - 0.5) * 4, { aggro: true, rise: true });
    }
  }
}

const QUESTS = [
  { title: 'BOOTS ON THE GROUND', giver: 'dot',
    accept: "New face. Good — we need trigger fingers. The Faded got half this city's population and all of its hair dye. Go put down 6 of them, then come back.",
    obj: () => `Put down Faded: ${state.quest.data.kills || 0}/6`, done: "Six down. You'll do fine here. Take these tabs — outpost pays its debts.",
    reward: { tabs: 40, xp: 40 } },
  { title: 'MARKET RUN', giver: 'dot',
    accept: "Doc's out of everything. There's a med cache under the old market awnings on the west side — red buildings, can't miss 'em. Grab it and hustle back.",
    obj: () => 'Retrieve the med cache at PIKE MARKET', done: "That's the good stuff. Doc says you get a medkit for the trouble. Don't spend it all in one ambush.",
    reward: { tabs: 50, xp: 60, medkit: 2 },
    setup() { placeQuestItem('medcache', -150, -55, 'MED CACHE', 'TAKE CACHE'); } },
  { title: 'NEST TROUBLE', giver: 'dot',
    accept: "The Faded are breeding — or whatever it is they do — downtown. Two nests, glowing green, ugly as sin. Burn 'em down.",
    obj: () => `Destroy nests: ${state.quest.data.nests || 0}/2`, done: "Two less nurseries for those things. City owes you one, not that it's writing checks these days.",
    reward: { tabs: 80, xp: 90 },
    setup() { spawnNest(20, -100, 'n1'); spawnNest(-30, -170, 'n2'); } },
  { title: 'STATIC ON THE WIRE', giver: 'dot',
    accept: "Old harbor beacon on the middle pier still has juice. Flip it on and maybe we can hail the boats — if anyone's still floating out there.",
    obj: () => 'Activate the harbor beacon on the WATERFRONT pier', done: "Beacon's blinking. Nothing answering yet... but it's blinking. That's hope, kid.",
    reward: { tabs: 70, xp: 80 },
    setup() { placeQuestItem('beacon', WATER_X - 34, 20, 'HARBOR BEACON', 'ACTIVATE'); } },
  { title: "THE DOC'S LIST", giver: 'doc',
    accept: "I can synthesize antitoxin for spitter acid, but I need solvent. Three chem cans, industrial district — Rainier Yards. Yellow cans. Don't drink them.",
    obj: () => `Collect chem cans in RAINIER YARDS: ${state.quest.data.cans || 0}/3`, done: "Perfect. And you didn't drink any — exceeds expectations. Here, antitoxin bonus: extra medkits.",
    reward: { tabs: 60, xp: 90, medkit: 2 },
    setup() { placeQuestItem('can1', 160, 20, 'CHEM CAN', 'TAKE CAN'); placeQuestItem('can2', 220, 90, 'CHEM CAN', 'TAKE CAN'); placeQuestItem('can3', 250, -30, 'CHEM CAN', 'TAKE CAN'); } },
  { title: 'THE NEEDLE UPLINK', giver: 'dot',
    accept: "The observation tower at Seattle Center still has a relay dish. Get to the base terminal, boot the uplink, and hold the plaza while it syncs. The noise WILL draw them.",
    obj: () => state.quest.data.defending ? `HOLD THE PLAZA: ${Math.ceil(state.quest.data.defendT)}s` : 'Boot the uplink at the OBSERVATION TOWER', done: "Uplink's live. We can see the whole grid from here now. You held the plaza like a wall, kid.",
    reward: { tabs: 120, xp: 140 },
    setup() { placeQuestItem('uplink', NEEDLE.x + 8, NEEDLE.z + 8, 'UPLINK TERMINAL', 'BOOT UPLINK'); } },
  { title: 'BIG SUR', giver: 'sam',
    accept: "There's a brute the scav crews call Big Sur — took over the stadium like it bought season tickets. Bounty's real. You in?",
    obj: () => 'Kill BIG SUR at THE YARD stadium', done: "You actually dropped Big Sur. I'd frame the poster if we still had printers. Bounty's yours.",
    reward: { tabs: 200, xp: 200 },
    setup() { const b = makeZombie('brute', STADIUM.x, STADIUM.z, { boss: true, name: 'BIG SUR', hp: 900 }); b.aggro = false; } },
  { title: 'EMERALD DAWN', giver: 'dot',
    accept: "Last piece: three grid relays — market, downtown, the yards. Light all three and the city's early-warning net comes back. Do this, and nights get a little less hungry.",
    obj: () => `Activate relays: ${state.quest.data.relays || 0}/3`, done: "All three relays humming. The Emerald City's got a heartbeat again. Take this — found it in an armory crate. You've earned the shine.",
    reward: { tabs: 300, xp: 300, weapon: 'gold' },
    setup() { placeQuestItem('relay1', -140, -40, 'GRID RELAY', 'ACTIVATE'); placeQuestItem('relay2', 60, -120, 'GRID RELAY', 'ACTIVATE'); placeQuestItem('relay3', 200, 130, 'GRID RELAY', 'ACTIVATE'); } },
];
const questItems = [];
function placeQuestItem(id, x, z, label, verb) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8),
    new THREE.MeshStandardMaterial({ color: 0xffd24d, emissive: 0xaa7a10, emissiveIntensity: 0.8, roughness: 0.4 }));
  m.position.set(x, 0.5, z);
  scene.add(m);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 30, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd24d, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  beam.position.set(x, 15, z);
  scene.add(beam);
  const qi = { id, mesh: m, beam, x, z, taken: false };
  questItems.push(qi);
  interactables.push({
    id: 'qi_' + id, pos: new THREE.Vector3(x, 0.5, z), r: 3, label: verb,
    active: () => !qi.taken && state.quest.stage === 1,
    action: () => { qi.taken = true; scene.remove(m); scene.remove(beam); sfx('quest'); questEvent('item', qi); },
  });
}
function clearQuestItems() {
  for (const qi of questItems) { scene.remove(qi.mesh); scene.remove(qi.beam); }
  questItems.length = 0;
}
function currentQuest() { return QUESTS[state.quest.index]; }
function acceptQuest() {
  const q = currentQuest();
  state.quest.stage = 1;
  state.quest.data = {};
  if (q.setup) q.setup();
  sfx('quest');
  showBanner('NEW QUEST', q.title);
  updateQuestHud(); saveGame();
}
function questEvent(kind, obj) {
  const q = currentQuest();
  if (!q || state.quest.stage !== 1) { if (kind === 'salvageLoot') jobSalvageLoot(); return; }
  const d = state.quest.data;
  const done = () => { state.quest.stage = 2; sfx('quest'); showBanner('OBJECTIVE COMPLETE', 'Return to ' + giverName(q.giver)); };
  if (state.quest.index === 0 && kind === 'kill') { d.kills = (d.kills || 0) + 1; if (d.kills >= 6) done(); }
  else if (state.quest.index === 1 && kind === 'item') done();
  else if (state.quest.index === 2 && kind === 'nest') { d.nests = (d.nests || 0) + 1; if (d.nests >= 2) done(); }
  else if (state.quest.index === 3 && kind === 'item') done();
  else if (state.quest.index === 4 && kind === 'item') { d.cans = (d.cans || 0) + 1; if (d.cans >= 3) done(); }
  else if (state.quest.index === 5 && kind === 'item') {
    d.defending = true; d.defendT = 60;
    showBanner('HOLD THE PLAZA', 'They heard the uplink');
    for (let i = 0; i < 6; i++) makeZombie(pickZombieType(3), NEEDLE.x + 30 + Math.random() * 10, NEEDLE.z + (Math.random() - 0.5) * 40, { aggro: true });
  }
  else if (state.quest.index === 6 && kind === 'kill' && obj && obj.boss) done();
  else if (state.quest.index === 7 && kind === 'item') { d.relays = (d.relays || 0) + 1; if (d.relays >= 3) done(); }
  if (kind === 'salvageLoot') jobSalvageLoot();
  updateQuestHud();
}
function updateQuestDefense(dt) {
  const d = state.quest.data;
  if (state.quest.index === 5 && state.quest.stage === 1 && d.defending) {
    d.defendT -= dt;
    if (Math.random() < dt * 0.5 && zombies.length < 16)
      makeZombie(pickZombieType(3), NEEDLE.x + (Math.random() - 0.5) * 70, NEEDLE.z + (Math.random() - 0.5) * 70, { aggro: true });
    if (d.defendT <= 0) { d.defending = false; state.quest.stage = 2; sfx('quest'); showBanner('PLAZA HELD', 'Return to Ranger Dot'); }
    updateQuestHud();
  }
}
function turnInQuest() {
  const q = currentQuest();
  const r = q.reward;
  if (r.tabs) { state.tabs += r.tabs; }
  if (r.xp) addXp(r.xp);
  if (r.medkit) state.items.medkit += r.medkit;
  if (r.weapon && !state.weapons.includes(r.weapon)) { state.weapons.push(r.weapon); state.ammo.light = Math.min(stat.ammoCap('light'), state.ammo.light + 40); floater('NEW WEAPON: ' + WEAPONS[r.weapon].name); }
  floater('+' + (r.tabs || 0) + ' TABS');
  clearQuestItems();
  state.quest.index++;
  state.quest.stage = 0;
  state.quest.data = {};
  sfx('levelup');
  if (state.quest.index >= QUESTS.length) showBanner('EMERALD DAWN', 'The city has a heartbeat again. Last Stand awaits.');
  updateQuestHud(); saveGame();
}
function giverName(id) { return id === 'dot' ? 'Ranger Dot' : id === 'doc' ? 'Doc Mercer' : 'Salvage Sam'; }

/* ============================== SIDE JOBS (Salvage Sam) ============================== */
function rollJob() {
  const n = state.jobsDone;
  const types = ['bounty', 'salvage', 'beacon'];
  const type = types[Math.floor(Math.random() * types.length)];
  if (type === 'bounty') {
    const count = 8 + Math.floor(n * 1.5);
    return { type, count, done: 0, reward: 45 + n * 12, desc: `Thin the herd: put down ${count} Faded anywhere in the city.` };
  } else if (type === 'salvage') {
    const count = 4 + Math.floor(n * 0.7);
    return { type, count, done: 0, reward: 50 + n * 12, desc: `Salvage sweep: search ${count} containers out in the ruins.` };
  }
  const spots = [[-120, -80], [80, -60], [180, 60], [-180, 60], [-60, -220]];
  const [x, z] = spots[Math.floor(Math.random() * spots.length)];
  return { type, x, z, done: 0, reward: 55 + n * 12, desc: 'Flip a relay beacon back on where the scavs marked it.' };
}
function acceptJob() {
  state.job = rollJob();
  if (state.job.type === 'beacon') {
    placeQuestItem('job_beacon', state.job.x, state.job.z, 'SCAV BEACON', 'ACTIVATE');
    const idx = interactables.findIndex(i => i.id === 'qi_job_beacon');
    if (idx >= 0) {
      interactables[idx].active = () => !questItems.find(q => q.id === 'job_beacon').taken;
      interactables[idx].action = () => {
        const qi = questItems.find(q => q.id === 'job_beacon');
        qi.taken = true; scene.remove(qi.mesh); scene.remove(qi.beam);
        completeJobStage();
      };
    }
  }
  sfx('quest');
  showBanner('SIDE JOB', state.job.desc.split(':')[0]);
  updateQuestHud(); saveGame();
}
function jobSalvageLoot() {
  if (state.job && state.job.type === 'salvage') {
    state.job.done++;
    updateQuestHud();
    if (state.job.done >= state.job.count) completeJobStage();
  }
}
function completeJobStage() {
  if (!state.job) return;
  state.job.ready = true;
  sfx('quest');
  showBanner('JOB DONE', 'See Salvage Sam for pay');
  updateQuestHud();
}
function turnInJob() {
  state.tabs += state.job.reward;
  addXp(30 + state.jobsDone * 8);
  floater('+' + state.job.reward + ' TABS');
  state.jobsDone++;
  state.job = null;
  sfx('buy'); updateQuestHud(); saveGame();
}

/* ============================== LAST STAND (endless) ============================== */
function startLastStand() {
  const LS = state.lastStand;
  LS.active = true; LS.wave = 0; LS.pend = 0; LS.inter = 1.5;
  yawObj.position.set(STADIUM.x, 1.7, STADIUM.z + 30);
  yaw = Math.PI;
  for (const zb of [...zombies]) scene.remove(zb.g);
  zombies.length = 0;
  showBanner('LAST STAND', 'Wave incoming — leave through the gate to bail');
  closeDialog();
  updateQuestHud();
}
function endLastStand(voluntary) {
  const LS = state.lastStand;
  LS.active = false;
  if (LS.wave > state.bestWave) { state.bestWave = LS.wave; floater('NEW BEST: WAVE ' + LS.wave); }
  if (voluntary) showBanner('STOOD DOWN', 'Best wave: ' + state.bestWave);
  updateQuestHud(); saveGame();
}
function updateLastStand(dt) {
  const LS = state.lastStand;
  if (!LS.active) return;
  // leaving the stadium ends the run
  if (Math.hypot(yawObj.position.x - STADIUM.x, yawObj.position.z - STADIUM.z) > STADIUM.r + 10) { endLastStand(true); return; }
  if (LS.pend > 0) {
    LS.spawnT -= dt;
    if (LS.spawnT <= 0) {
      LS.spawnT = 0.8;
      const a = Math.random() * Math.PI * 2;
      const r = STADIUM.r - 8;
      const danger = Math.min(4, 2 + Math.floor(LS.wave / 3));
      makeZombie(pickZombieType(danger), STADIUM.x + Math.cos(a) * r, STADIUM.z + Math.sin(a) * r, { aggro: true });
      LS.pend--;
    }
  } else if (zombies.length === 0) {
    LS.inter -= dt;
    if (LS.inter <= 0) {
      LS.wave++;
      LS.pend = 4 + LS.wave * 2;
      LS.inter = 4;
      sfx('wave');
      showBanner('WAVE ' + LS.wave);
      if (LS.wave % 4 === 0) makeZombie('brute', STADIUM.x, STADIUM.z - 40, { aggro: true });
      updateQuestHud();
    }
  }
}

/* ============================== HUD REFS ============================== */
const el = id => document.getElementById(id);
const hud = {
  crosshair: el('crosshair'), vignette: el('vignette'), focusTint: el('focusTint'),
  hpfill: el('hpfill'), focfill: el('focfill'), tabs: el('tabs'), xpfill: el('xpfill'), lvl: el('lvl'),
  wname: el('wname'), ammo: el('ammo'), wchips: el('wchips'),
  medChip: el('medChip'), shotChip: el('shotChip'),
  district: el('district'), questTrack: el('questTrack'),
  banner: el('banner'), subbanner: el('subbanner'), interact: el('interact'),
};
let bannerTimeout = null;
function showBanner(text, sub = '', ms = 2400) {
  hud.banner.textContent = text; hud.banner.style.opacity = 1;
  hud.subbanner.textContent = sub; hud.subbanner.style.opacity = sub ? 1 : 0;
  clearTimeout(bannerTimeout);
  bannerTimeout = setTimeout(() => { hud.banner.style.opacity = 0; hud.subbanner.style.opacity = 0; }, ms);
}
function floater(text) {
  const div = document.createElement('div');
  div.className = 'floater'; div.textContent = text;
  el('floaters').appendChild(div);
  setTimeout(() => div.remove(), 1450);
}
let hudDirty = true;
function updateHudSoon() { hudDirty = true; }
function updateHud() {
  hudDirty = false;
  const W = currentWeapon();
  hud.hpfill.style.width = Math.max(0, state.hp) / stat.maxHp() * 100 + '%';
  hud.hpfill.classList.toggle('low', state.hp < stat.maxHp() * 0.35);
  hud.focfill.style.width = state.focus / stat.focusMax() * 100 + '%';
  hud.tabs.textContent = state.tabs;
  hud.xpfill.style.width = state.xp / stat.xpNeed() * 100 + '%';
  hud.lvl.textContent = 'LVL ' + state.level;
  hud.wname.textContent = W.name;
  if (W.melee) hud.ammo.innerHTML = '—';
  else hud.ammo.innerHTML = state.reloading ? 'RELOADING…' : state.mags[state.weapon] + ' <small>/ ' + state.ammo[W.ammo] + '</small>';
  hud.ammo.classList.toggle('reloading', state.reloading);
  hud.medChip.textContent = 'MEDKIT ×' + state.items.medkit;
  hud.medChip.classList.toggle('dim', state.items.medkit === 0);
  hud.shotChip.textContent = '☕ ×' + state.items.shot;
  hud.shotChip.classList.toggle('dim', state.items.shot === 0);
  hud.wchips.innerHTML = '';
  for (const id of state.weapons) {
    const chip = document.createElement('div');
    chip.className = 'wchip' + (id === state.weapon ? ' on' : '');
    chip.textContent = WEAPONS[id].key;
    chip.onpointerdown = e => { e.preventDefault(); switchWeapon(id); };
    hud.wchips.appendChild(chip);
  }
}
function updateQuestHud() {
  let html = '';
  if (state.lastStand.active) html = `<b>LAST STAND</b><div class="obj">Wave ${state.lastStand.wave} — hostiles ${zombies.length + state.lastStand.pend}</div>`;
  else {
    if (state.quest.index < QUESTS.length) {
      const q = currentQuest();
      if (state.quest.stage === 0) html = `<b>${q.title}</b><div class="obj">Talk to ${giverName(q.giver)} at the Outpost</div>`;
      else if (state.quest.stage === 1) html = `<b>${q.title}</b><div class="obj">${q.obj()}</div><div class="dist" id="qdist"></div>`;
      else html = `<b>${q.title}</b><div class="obj">Return to ${giverName(q.giver)}</div><div class="dist" id="qdist"></div>`;
    } else html = `<b>THE CITY BREATHES</b><div class="obj">Side jobs from Sam • Last Stand at The Yard</div>`;
    if (state.job) {
      html += `<div style="margin-top:5px"><b style="color:#8fd3ff">SIDE JOB</b><div class="obj">${state.job.ready ? 'Collect pay from Sam' :
        state.job.type === 'bounty' ? `Faded down: ${state.job.done}/${state.job.count}` :
        state.job.type === 'salvage' ? `Containers: ${state.job.done}/${state.job.count}` : 'Activate the scav beacon'}</div></div>`;
    }
  }
  hud.questTrack.innerHTML = html;
}
function questTargetPos() {
  if (state.quest.index >= QUESTS.length) return null;
  const q = currentQuest(), st = state.quest.stage;
  if (st === 0 || st === 2) return { x: OUTPOST.x, z: OUTPOST.z };
  const untakenQI = questItems.find(qi => !qi.taken && !qi.id.startsWith('job_'));
  if (untakenQI) return { x: untakenQI.x, z: untakenQI.z };
  if (state.quest.index === 0) return null;
  if (state.quest.index === 2) { const n = nests.find(n => !n.dead); return n ? { x: n.x, z: n.z } : null; }
  if (state.quest.index === 5 && state.quest.data.defending) return { x: NEEDLE.x, z: NEEDLE.z };
  if (state.quest.index === 6) return { x: STADIUM.x, z: STADIUM.z };
  return null;
}

/* ============================== MINIMAP / COMPASS / BIG MAP ============================== */
const mmCtx = el('minimap').getContext('2d');
function drawDistrictBlocks(ctx, sc, ox, oz) {
  const colors = { waterfront: '#2a4a54', market: '#5a3230', center: '#3a4a3a', downtown: '#3c4250', yards: '#4e4630', stadium: '#44424a', outpost: '#2e5238' };
  for (const d of DISTRICTS) {
    if (d.id === 'outpost' || d.id === 'stadium') continue;
    ctx.fillStyle = colors[d.id] || '#3a3f38';
    ctx.fillRect(ox + d.x1 * sc, oz + d.z1 * sc, (d.x2 - d.x1) * sc, (d.z2 - d.z1) * sc);
  }
  ctx.fillStyle = '#1c3844';
  ctx.fillRect(0, 0, ox + WATER_X * sc, oz * 2);
  ctx.fillStyle = colors.stadium;
  ctx.beginPath(); ctx.arc(ox + STADIUM.x * sc, oz + STADIUM.z * sc, STADIUM.r * sc, 0, 7); ctx.fill();
  ctx.fillStyle = colors.outpost;
  ctx.beginPath(); ctx.arc(ox + OUTPOST.x * sc, oz + OUTPOST.z * sc, OUTPOST.r * sc, 0, 7); ctx.fill();
}
function drawMinimap() {
  const size = 132, ctx = mmCtx, range = 90;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, size, size); ctx.clip();
  const sc = size / (range * 2);
  const px = yawObj.position.x, pz = yawObj.position.z;
  const ox = size / 2 - px * sc, oz = size / 2 - pz * sc;
  ctx.globalAlpha = 0.85;
  drawDistrictBlocks(ctx, sc, ox, oz);
  ctx.globalAlpha = 1;
  // quest marker
  const qt = questTargetPos();
  if (qt) {
    ctx.fillStyle = '#ffd24d';
    const mx = Math.max(6, Math.min(size - 6, ox + qt.x * sc));
    const mz = Math.max(6, Math.min(size - 6, oz + qt.z * sc));
    ctx.beginPath(); ctx.moveTo(mx, mz - 5); ctx.lineTo(mx + 4, mz); ctx.lineTo(mx, mz + 5); ctx.lineTo(mx - 4, mz); ctx.fill();
  }
  // zombies nearby
  ctx.fillStyle = '#ff5a4b';
  for (const zb of zombies) {
    const zx = ox + zb.g.position.x * sc, zz = oz + zb.g.position.z * sc;
    if (zx > 0 && zx < size && zz > 0 && zz < size) { ctx.beginPath(); ctx.arc(zx, zz, 2, 0, 7); ctx.fill(); }
  }
  // player arrow
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-yaw + Math.PI);
  ctx.fillStyle = '#9fe3b4';
  ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4, 5); ctx.lineTo(-4, 5); ctx.fill();
  ctx.restore();
}
const cpCtx = el('compass').getContext('2d');
function drawCompass() {
  const w = 300, h = 24, ctx = cpCtx;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(5,14,9,.5)'; ctx.fillRect(0, 0, w, h);
  const fovPx = w / (Math.PI * 0.9);
  ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const dirs = [['N', Math.PI], ['E', Math.PI / 2], ['S', 0], ['W', -Math.PI / 2]];
  for (const [label, a] of dirs) {
    let diff = a - yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const x = w / 2 + diff * fovPx;
    if (x > -10 && x < w + 10) { ctx.fillStyle = label === 'N' ? '#ff8a6a' : '#cfe4d2'; ctx.fillText(label, x, h / 2); }
  }
  const qt = questTargetPos();
  if (qt) {
    const ang = Math.atan2(-(qt.x - yawObj.position.x), -(qt.z - yawObj.position.z));
    let diff = ang - yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    const x = Math.max(6, Math.min(w - 6, w / 2 + diff * fovPx));
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x + 5, 12); ctx.lineTo(x, 20); ctx.lineTo(x - 5, 12); ctx.fill();
    const dEl = document.getElementById('qdist');
    if (dEl) dEl.textContent = Math.round(Math.hypot(qt.x - yawObj.position.x, qt.z - yawObj.position.z)) + 'm';
  }
  ctx.strokeStyle = '#9fe3b4'; ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, 4); ctx.stroke();
}
function drawBigMap() {
  const cv = el('bigmap'), ctx = cv.getContext('2d'), size = 640;
  const sc = size / (MAP * 2), ox = size / 2, oz = size / 2;
  ctx.fillStyle = '#101812'; ctx.fillRect(0, 0, size, size);
  drawDistrictBlocks(ctx, sc, ox, oz);
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  for (let g = -300; g <= 300; g += 60) {
    ctx.beginPath(); ctx.moveTo(ox + g * sc, 0); ctx.lineTo(ox + g * sc, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, oz + g * sc); ctx.lineTo(size, oz + g * sc); ctx.stroke();
  }
  ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center'; ctx.fillStyle = '#cfe4d2';
  const labels = [['CASCADE OUTPOST', OUTPOST.x, OUTPOST.z], ['THE YARD', STADIUM.x, STADIUM.z], ['OBSERVATION TOWER', NEEDLE.x, NEEDLE.z - 14],
    ['PIKE MARKET', -145, -55], ['DOWNTOWN RUINS', 30, -110], ['RAINIER YARDS', 210, 45], ['ELLIOTT BAY', -305, -40], ['WATERFRONT', -233, 130]];
  for (const [t, x, z] of labels) ctx.fillText(t, ox + x * sc, oz + z * sc);
  ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 11px Segoe UI';
  ctx.beginPath(); ctx.arc(ox + NEEDLE.x * sc, oz + NEEDLE.z * sc, 4, 0, 7); ctx.fill();
  const qt = questTargetPos();
  if (qt) {
    ctx.beginPath(); ctx.moveTo(ox + qt.x * sc, oz + qt.z * sc - 9); ctx.lineTo(ox + qt.x * sc + 7, oz + qt.z * sc); ctx.lineTo(ox + qt.x * sc, oz + qt.z * sc + 9); ctx.lineTo(ox + qt.x * sc - 7, oz + qt.z * sc); ctx.fill();
    ctx.fillText('OBJECTIVE', ox + qt.x * sc, oz + qt.z * sc - 14);
  }
  ctx.save();
  ctx.translate(ox + yawObj.position.x * sc, oz + yawObj.position.z * sc);
  ctx.rotate(-yaw + Math.PI);
  ctx.fillStyle = '#9fe3b4';
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(5, 7); ctx.lineTo(-5, 7); ctx.fill();
  ctx.restore();
}

/* ============================== CHARACTER SHEET ============================== */
function drawPortrait() {
  const cv = el('portrait'), ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 200, 240);
  ctx.fillStyle = '#122018'; ctx.fillRect(0, 0, 200, 240);
  // camo torso
  const camo = ['#53603f', '#3e4a30', '#6a7350', '#2e3626'];
  ctx.fillStyle = camo[0]; ctx.fillRect(40, 150, 120, 90);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = camo[1 + Math.floor(Math.random() * 3)];
    ctx.beginPath(); ctx.ellipse(40 + Math.random() * 120, 150 + Math.random() * 90, 6 + Math.random() * 12, 4 + Math.random() * 8, Math.random() * 3, 0, 7);
    ctx.fill();
  }
  ctx.save(); ctx.beginPath(); ctx.rect(40, 150, 120, 90); ctx.clip(); ctx.restore();
  // flag patch (stylized stars & stripes)
  ctx.fillStyle = '#b22234'; ctx.fillRect(52, 162, 34, 22);
  ctx.fillStyle = '#fff';
  for (let i = 1; i < 4; i++) ctx.fillRect(52, 162 + i * 5.5 - 2, 34, 2.5);
  ctx.fillStyle = '#3c3b6e'; ctx.fillRect(52, 162, 14, 11);
  ctx.fillStyle = '#fff';
  for (let r = 0; r < 3; r++) for (let c2 = 0; c2 < 3; c2++) ctx.fillRect(54 + c2 * 4, 164 + r * 3, 1.6, 1.6);
  ctx.strokeStyle = '#d8c98a'; ctx.strokeRect(52, 162, 34, 22);
  // neck + face
  ctx.fillStyle = '#b98a62'; ctx.fillRect(85, 132, 30, 24);
  ctx.fillStyle = '#c69a70'; ctx.fillRect(66, 66, 68, 72);
  // short hair sides
  ctx.fillStyle = '#5a4630'; ctx.fillRect(62, 74, 6, 34); ctx.fillRect(132, 74, 6, 34);
  // red cap
  ctx.fillStyle = '#c0392b';
  ctx.beginPath(); ctx.moveTo(58, 74); ctx.quadraticCurveTo(100, 38, 142, 74); ctx.lineTo(142, 62); ctx.quadraticCurveTo(100, 30, 58, 62); ctx.fill();
  ctx.fillRect(58, 62, 84, 14);
  ctx.beginPath(); ctx.ellipse(100, 78, 52, 9, 0, 0, Math.PI, true); ctx.fill();
  ctx.fillStyle = '#8f2a20'; ctx.fillRect(58, 72, 84, 4);
  // face details
  ctx.fillStyle = '#2e2620';
  ctx.fillRect(78, 92, 10, 5); ctx.fillRect(112, 92, 10, 5);
  ctx.fillRect(94, 116, 14, 4);
  ctx.strokeStyle = '#8a6a4a'; ctx.beginPath(); ctx.moveTo(100, 98); ctx.lineTo(97, 110); ctx.lineTo(103, 110); ctx.stroke();
  // dog tags
  ctx.strokeStyle = '#c8c8c8'; ctx.beginPath(); ctx.moveTo(88, 156); ctx.quadraticCurveTo(100, 172, 112, 156); ctx.stroke();
  ctx.fillStyle = '#c8c8c8'; ctx.fillRect(96, 168, 9, 12);
  ctx.fillStyle = '#9fe3b4'; ctx.font = 'bold 12px Segoe UI'; ctx.textAlign = 'center';
  ctx.fillText('THE SURVIVOR', 100, 228);
}
function showCharSheet() {
  drawPortrait();
  const perkList = state.perks.length ? state.perks.map(id => PERKS.find(p => p.id === id).name).join('<br>&nbsp;&nbsp;') : '—';
  el('charstats').innerHTML =
    `<b>LEVEL</b> ${state.level} &nbsp; (${state.xp}/${stat.xpNeed()} XP)<br>` +
    `<b>HEALTH</b> ${Math.ceil(state.hp)}/${stat.maxHp()}<br>` +
    `<b>TABS</b> ${state.tabs}<br>` +
    `<b>KILLS</b> ${state.kills} &nbsp; <b>DEATHS</b> ${state.deaths}<br>` +
    `<b>BEST LAST STAND</b> ${state.bestWave ? 'Wave ' + state.bestWave : '—'}<br>` +
    `<b>STORY</b> ${Math.min(state.quest.index, QUESTS.length)}/${QUESTS.length} complete<br>` +
    `<b>PERKS</b><br>&nbsp;&nbsp;${perkList}`;
}
function showQuestLog() {
  let html = '';
  QUESTS.forEach((q, i) => {
    const cls = i < state.quest.index ? 'qdone' : '';
    const mark = i < state.quest.index ? '✔' : i === state.quest.index ? '▸' : '·';
    html += `<div class="${cls}"><b style="color:#ffd24d">${mark} ${q.title}</b>${i === state.quest.index && state.quest.stage > 0 ? ' — ' + (state.quest.stage === 2 ? 'return to ' + giverName(q.giver) : q.obj()) : ''}</div>`;
  });
  html += `<div style="margin-top:10px"><b style="color:#8fd3ff">SIDE JOBS COMPLETED:</b> ${state.jobsDone}</div>`;
  el('questlog').innerHTML = html;
}

/* ============================== DIALOG / VENDOR ============================== */
const VENDOR_STOCK = [
  { label: '9MM ×24', cost: 20, act: () => { state.ammo.light = Math.min(stat.ammoCap('light'), state.ammo.light + 24); } },
  { label: 'SHELLS ×8', cost: 25, act: () => { state.ammo.shell = Math.min(stat.ammoCap('shell'), state.ammo.shell + 8); } },
  { label: '.30 CAL ×8', cost: 30, act: () => { state.ammo.rifle = Math.min(stat.ammoCap('rifle'), state.ammo.rifle + 8); } },
  { label: 'MEDKIT', cost: 35, act: () => { state.items.medkit++; } },
  { label: 'DOUBLE SHOT ☕', cost: 15, act: () => { state.items.shot++; } },
  { label: 'PUMP 12 SHOTGUN', cost: 150, weapon: 'shotgun' },
  { label: 'RAT-TAT SMG', cost: 260, weapon: 'smg' },
  { label: 'CASCADE RIFLE', cost: 400, weapon: 'rifle' },
];
function openDialog(name, text, buttons, vendor = false) {
  state.mode = 'dialog';
  el('dlgName').textContent = name;
  el('dlgText').textContent = text;
  const row = el('dlgBtns'); row.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn small' + (b.ghost ? ' ghost' : '');
    btn.textContent = b.label;
    btn.onclick = b.act;
    row.appendChild(btn);
  }
  const vl = el('vendorList');
  vl.classList.toggle('hidden', !vendor);
  if (vendor) {
    vl.innerHTML = '';
    for (const item of VENDOR_STOCK) {
      if (item.weapon && state.weapons.includes(item.weapon)) continue;
      const div = document.createElement('div');
      div.className = 'vitem';
      div.innerHTML = `<span>${item.label}</span>`;
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = item.cost + ' TABS';
      btn.onclick = () => {
        if (state.tabs < item.cost) { floater('NOT ENOUGH TABS'); return; }
        state.tabs -= item.cost;
        if (item.weapon) { state.weapons.push(item.weapon); floater('BOUGHT: ' + WEAPONS[item.weapon].name); openNpcDialog('doc'); }
        else item.act();
        sfx('buy'); updateHudSoon(); saveGame();
      };
      div.appendChild(btn);
      vl.appendChild(div);
    }
  }
  el('dialogBox').classList.remove('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeDialog() {
  el('dialogBox').classList.add('hidden');
  if (state.mode === 'dialog') state.mode = 'playing';
}
function openNpcDialog(npc) {
  const q = state.quest.index < QUESTS.length ? currentQuest() : null;
  const closeBtn = { label: 'LATER', ghost: true, act: closeDialog };
  if (npc === 'dot') {
    if (q && q.giver === 'dot' && state.quest.stage === 0)
      openDialog('RANGER DOT', q.accept, [{ label: 'ACCEPT QUEST', act: () => { acceptQuest(); closeDialog(); } }, closeBtn]);
    else if (q && q.giver === 'dot' && state.quest.stage === 2)
      openDialog('RANGER DOT', q.done, [{ label: 'COLLECT REWARD', act: () => { turnInQuest(); closeDialog(); } }]);
    else if (q && state.quest.stage === 1)
      openDialog('RANGER DOT', "Quest's still open, kid. " + q.obj() + '. Rain waits for no one.', [closeBtn]);
    else if (!q)
      openDialog('RANGER DOT', "City's breathing again because of you. Go stretch your legs in the Last Stand — Sam's got jobs if you want tabs.", [closeBtn]);
    else
      openDialog('RANGER DOT', 'Talk to ' + giverName(q.giver) + " — it's their show this time.", [closeBtn]);
  } else if (npc === 'doc') {
    const btns = [{ label: 'TRADE', act: () => openNpcVendor() }, closeBtn];
    if (q && q.giver === 'doc' && state.quest.stage === 0)
      btns.unshift({ label: 'ACCEPT QUEST', act: () => { acceptQuest(); closeDialog(); } });
    if (q && q.giver === 'doc' && state.quest.stage === 2)
      btns.unshift({ label: 'COLLECT REWARD', act: () => { turnInQuest(); closeDialog(); } });
    openDialog('DOC MERCER', q && q.giver === 'doc' && state.quest.stage === 0 ? q.accept :
      q && q.giver === 'doc' && state.quest.stage === 2 ? q.done :
      'Stimulants, bandages, bullets. The three food groups. What do you need?', btns);
  } else if (npc === 'sam') {
    const btns = [closeBtn];
    if (q && q.giver === 'sam' && state.quest.stage === 0)
      btns.unshift({ label: 'ACCEPT QUEST', act: () => { acceptQuest(); closeDialog(); } });
    else if (q && q.giver === 'sam' && state.quest.stage === 2)
      btns.unshift({ label: 'COLLECT REWARD', act: () => { turnInQuest(); closeDialog(); } });
    if (state.job && state.job.ready)
      btns.unshift({ label: 'COLLECT PAY (' + state.job.reward + ')', act: () => { turnInJob(); closeDialog(); } });
    else if (!state.job)
      btns.unshift({ label: 'GIVE ME A JOB', act: () => { acceptJob(); closeDialog(); } });
    openDialog('SALVAGE SAM',
      state.job ? (state.job.ready ? "Heard you finished the job. Payday, friend." : 'Job board says: ' + state.job.desc) :
      "Odd jobs, decent pay, terrible dental. The scav network always needs boots. Want work?", btns);
  }
}
function openNpcVendor() {
  openDialog('DOC MERCER', "Take a look. Tabs only — the register doesn't take IOUs anymore.", [{ label: 'DONE', ghost: true, act: closeDialog }], true);
}

/* NPC + stadium interactables */
interactables.push(
  { id: 'npc_dot', pos: new THREE.Vector3(OUTPOST.x - 8, 1, OUTPOST.z - 6), r: 3, label: 'TALK — RANGER DOT', active: () => true, action: () => openNpcDialog('dot') },
  { id: 'npc_doc', pos: new THREE.Vector3(OUTPOST.x + 9, 1, OUTPOST.z + 8), r: 3, label: 'TALK — DOC MERCER', active: () => true, action: () => openNpcDialog('doc') },
  { id: 'npc_sam', pos: new THREE.Vector3(OUTPOST.x - 3, 1, OUTPOST.z + 12), r: 3, label: 'TALK — SALVAGE SAM', active: () => true, action: () => openNpcDialog('sam') },
  { id: 'laststand', pos: new THREE.Vector3(STADIUM.x + Math.cos(4.72) * STADIUM.r, 1, STADIUM.z + Math.sin(4.72) * STADIUM.r), r: 6, label: 'START LAST STAND', active: () => !state.lastStand.active, action: () => startLastStand() },
);

/* ============================== SAVE / LOAD ============================== */
const SAVE_KEY = 'emerald_wasteland_v1';
function saveGame() {
  if (state.mode === 'menu') return;
  const s = {
    hp: state.hp, tabs: state.tabs, xp: state.xp, level: state.level, perks: state.perks,
    weapons: state.weapons, weapon: state.weapon, mags: state.mags, ammo: state.ammo, items: state.items,
    kills: state.kills, deaths: state.deaths, dayT: state.dayT,
    quest: { index: state.quest.index, stage: state.quest.stage === 2 ? 2 : 0 },  // active-stage progress restarts at accept
    jobsDone: state.jobsDone, bestWave: state.bestWave,
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch (e) {}
}
function loadSave() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; }
}
function applySave(s) {
  Object.assign(state, {
    hp: s.hp, tabs: s.tabs, xp: s.xp, level: s.level, perks: s.perks || [],
    weapons: s.weapons, weapon: s.weapon, mags: s.mags, ammo: s.ammo, items: s.items,
    kills: s.kills || 0, deaths: s.deaths || 0, dayT: s.dayT || 0.12,
    jobsDone: s.jobsDone || 0, bestWave: s.bestWave || 0,
  });
  state.quest.index = s.quest ? s.quest.index : 0;
  state.quest.stage = 0;
  state.quest.data = {};
}
function startGame(fresh) {
  if (fresh) {
    localStorage.removeItem(SAVE_KEY);
    Object.assign(state, {
      hp: 100, focus: 60, tabs: 40, xp: 0, level: 1, perks: [],
      weapons: ['bat', 'pistol'], weapon: 'pistol',
      mags: { pistol: 12, shotgun: 6, smg: 30, rifle: 5, gold: 36 },
      ammo: { light: 48, shell: 0, rifle: 0 }, items: { medkit: 1, shot: 1 },
      kills: 0, deaths: 0, dayT: 0.12, quest: { index: 0, stage: 0, data: {} },
      job: null, jobsDone: 0, bestWave: 0,
    });
  } else {
    const s = loadSave();
    if (s) applySave(s);
  }
  clearQuestItems();
  for (const zb of [...zombies]) scene.remove(zb.g);
  zombies.length = 0;
  yawObj.position.set(OUTPOST.x, 1.7, OUTPOST.z + 6);
  yaw = Math.PI; pitch = 0;
  state.hp = Math.max(state.hp, 50);
  state.mode = 'playing';
  state.lastStand.active = false;
  viewmodels[state.weapon].visible = true;
  el('menu').classList.add('hidden');
  showBanner(fresh ? 'EMERALD WASTELAND' : 'WELCOME BACK', fresh ? 'Find Ranger Dot at the fire barrel' : 'The rain kept your seat warm');
  updateQuestHud(); updateHudSoon();
  if (!IS_TOUCH) canvas.requestPointerLock();
}

/* ============================== SCREEN NAV ============================== */
function showScreen(id) {
  for (const s of ['pause', 'charScreen', 'mapScreen', 'questScreen']) el(s).classList.add('hidden');
  if (id) {
    el(id).classList.remove('hidden');
    if (id === 'charScreen') showCharSheet();
    if (id === 'mapScreen') drawBigMap();
    if (id === 'questScreen') showQuestLog();
    if (state.mode === 'playing') state.mode = 'paused';
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (state.mode === 'paused') {
    state.mode = 'playing';
    if (!IS_TOUCH) canvas.requestPointerLock();
  }
}
el('resumeBtn').onclick = () => showScreen(null);
el('pQuestBtn').onclick = () => showScreen('questScreen');
el('pCharBtn').onclick = () => showScreen('charScreen');
el('pMapBtn').onclick = () => showScreen('mapScreen');
el('pMenuBtn').onclick = () => { saveGame(); location.reload(); };
el('charBack').onclick = () => showScreen('pause');
el('mapBack').onclick = () => showScreen('pause');
el('questBack').onclick = () => showScreen('pause');
el('respawnBtn').onclick = () => respawn();
el('mapBtn').onpointerdown = e => { e.preventDefault(); if (state.mode === 'playing') showScreen('mapScreen'); };
el('charBtn').onpointerdown = e => { e.preventDefault(); if (state.mode === 'playing') showScreen('charScreen'); };
el('pauseBtn').onpointerdown = e => { e.preventDefault(); if (state.mode === 'playing') showScreen('pause'); };
el('medChip').onpointerdown = e => { e.preventDefault(); useMedkit(); };
el('shotChip').onpointerdown = e => { e.preventDefault(); useShot(); };
{
  const s = loadSave();
  el('saveInfo').textContent = s ? `LEVEL ${s.level} SURVIVOR — ${s.tabs} TABS — STORY ${Math.min(s.quest ? s.quest.index : 0, QUESTS.length)}/${QUESTS.length}` : '';
  el('continueBtn').classList.toggle('hidden', !s);
  if (IS_TOUCH) el('keysHelp').textContent = 'Left thumb: move • Right thumb: look • FIRE / FOCUS / RELOAD buttons • Walk up to things and tap the prompt';
}
el('continueBtn').onclick = async () => { ensureAudio(); if (!ASSETS.ready) { el('continueBtn').textContent = 'LOADING...'; await assetsPromise; } startGame(false); };
el('newBtn').onclick = async () => { ensureAudio(); if (!ASSETS.ready) { el('newBtn').textContent = 'LOADING...'; await assetsPromise; } startGame(true); };

/* ============================== INTERACT ============================== */
let nearInteractable = null;
function updateInteract() {
  nearInteractable = null;
  let best = 999;
  const p = yawObj.position;
  for (const it of interactables) {
    if (!it.active()) continue;
    const d = Math.hypot(it.pos.x - p.x, it.pos.z - p.z);
    if (d < it.r && d < best) { best = d; nearInteractable = it; }
  }
  if (nearInteractable) {
    hud.interact.textContent = (IS_TOUCH ? '' : '[E] ') + nearInteractable.label;
    hud.interact.classList.remove('hidden');
  } else hud.interact.classList.add('hidden');
}
hud.interact.onpointerdown = e => { e.preventDefault(); if (nearInteractable && state.mode === 'playing') nearInteractable.action(); };

/* ============================== FOCUS MODE ============================== */
function toggleFocus() {
  if (state.focusOn) { state.focusOn = false; sfx('focusoff'); }
  else if (state.focus > 25) { state.focusOn = true; sfx('focuson'); }
  hud.focusTint.style.opacity = state.focusOn ? 1 : 0;
}
function updateFocus(dt) {
  if (state.focusOn) {
    state.focus -= 22 * dt;
    if (state.focus <= 0) { state.focus = 0; state.focusOn = false; sfx('focusoff'); hud.focusTint.style.opacity = 0; }
  } else {
    state.focus = Math.min(stat.focusMax(), state.focus + (state.perks.includes('zen') ? 4 : 2) * dt);
  }
  const target = state.focusOn ? 0.3 : 1;
  state.timeScale += (target - state.timeScale) * Math.min(1, dt * 8);
}

/* ============================== INPUT: DESKTOP ============================== */
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (state.mode !== 'playing') {
    if (e.code === 'Escape' && state.mode === 'paused') showScreen(null);
    return;
  }
  if (e.code === 'KeyR') reload();
  if (e.code === 'KeyE' && nearInteractable) nearInteractable.action();
  if (e.code === 'KeyQ') toggleFocus();
  if (e.code === 'KeyH') useMedkit();
  if (e.code === 'KeyJ') useShot();
  if (e.code === 'KeyM') showScreen('mapScreen');
  if (e.code === 'Tab') { e.preventDefault(); showScreen('charScreen'); }
  const order = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'];
  const idx = order.indexOf(e.code);
  if (idx >= 0 && state.weapons[idx]) switchWeapon(state.weapons[idx]);
});
document.addEventListener('keyup', e => { keys[e.code] = false; });
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('mousedown', e => {
  if (document.pointerLockElement !== canvas || state.mode !== 'playing') return;
  if (e.button === 0) { fireHeld = true; shoot(); }
});
document.addEventListener('mouseup', e => { if (e.button === 0) fireHeld = false; });
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas || state.mode !== 'playing') return;
  yaw -= e.movementX * 0.0022;
  pitch -= e.movementY * 0.0022;
  pitch = Math.max(-1.45, Math.min(1.45, pitch));
});
document.addEventListener('pointerlockchange', () => {
  if (!IS_TOUCH && document.pointerLockElement !== canvas && state.mode === 'playing') showScreen('pause');
});
canvas.addEventListener('click', () => {
  if (!IS_TOUCH && state.mode === 'playing' && document.pointerLockElement !== canvas) canvas.requestPointerLock();
});

/* ============================== INPUT: TOUCH ============================== */
const joy = { id: null, baseX: 0, baseY: 0, dx: 0, dy: 0 };
let lookId = null, lookLastX = 0, lookLastY = 0;
const joyBase = el('joyBase'), joyThumb = el('joyThumb');
function setJoyUI() {
  if (joy.id === null) { joyBase.style.display = 'none'; joyThumb.style.display = 'none'; return; }
  joyBase.style.display = 'block'; joyThumb.style.display = 'block';
  joyBase.style.left = joy.baseX - 55 + 'px'; joyBase.style.top = joy.baseY - 55 + 'px';
  joyThumb.style.left = joy.baseX + joy.dx * 55 - 24 + 'px'; joyThumb.style.top = joy.baseY + joy.dy * 55 - 24 + 'px';
}
document.addEventListener('touchstart', e => {
  if (state.mode !== 'playing') return;
  for (const t of e.changedTouches) {
    const target = t.target;
    if (target.closest && target.closest('#fireBtn,#focusBtn,#reloadBtn,#interact,.chip,.wchip,.sqbtn,#dialogBox,.screen')) continue;
    if (t.clientX < innerWidth * 0.45 && joy.id === null) {
      joy.id = t.identifier; joy.baseX = t.clientX; joy.baseY = t.clientY; joy.dx = joy.dy = 0;
      setJoyUI();
    } else if (lookId === null) {
      lookId = t.identifier; lookLastX = t.clientX; lookLastY = t.clientY;
    }
  }
  if (e.cancelable) e.preventDefault();
}, { passive: false });
document.addEventListener('touchmove', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) {
      let dx = (t.clientX - joy.baseX) / 55, dy = (t.clientY - joy.baseY) / 55;
      const m = Math.hypot(dx, dy);
      if (m > 1) { dx /= m; dy /= m; }
      joy.dx = dx; joy.dy = dy;
      setJoyUI();
    } else if (t.identifier === lookId) {
      yaw -= (t.clientX - lookLastX) * 0.0042;
      pitch -= (t.clientY - lookLastY) * 0.0042;
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
      lookLastX = t.clientX; lookLastY = t.clientY;
    }
  }
  if (e.cancelable) e.preventDefault();
}, { passive: false });
document.addEventListener('touchend', e => {
  for (const t of e.changedTouches) {
    if (t.identifier === joy.id) { joy.id = null; joy.dx = joy.dy = 0; setJoyUI(); }
    if (t.identifier === lookId) lookId = null;
  }
}, { passive: false });
el('fireBtn').addEventListener('touchstart', e => { e.preventDefault(); ensureAudio(); fireHeld = true; shoot(); }, { passive: false });
el('fireBtn').addEventListener('touchend', e => { e.preventDefault(); fireHeld = false; }, { passive: false });
el('focusBtn').addEventListener('touchstart', e => { e.preventDefault(); toggleFocus(); }, { passive: false });
el('reloadBtn').addEventListener('touchstart', e => { e.preventDefault(); reload(); }, { passive: false });

/* ============================== MAIN LOOP ============================== */
const clock = new THREE.Clock();
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3();

function updatePlayer(dt) {
  const sprint = keys['ShiftLeft'] || keys['ShiftRight'] || (IS_TOUCH && Math.hypot(joy.dx, joy.dy) > 0.92);
  let speed = (sprint ? 10.2 : 6.4) * stat.speedMul();
  if (shotBoostT > 0) { shotBoostT -= dt; speed *= 1.25; }
  fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  right.set(Math.cos(yaw), 0, -Math.sin(yaw));
  move.set(0, 0, 0);
  if (keys['KeyW']) move.add(fwd);
  if (keys['KeyS']) move.sub(fwd);
  if (keys['KeyD']) move.add(right);
  if (keys['KeyA']) move.sub(right);
  if (joy.id !== null) {
    move.addScaledVector(fwd, -joy.dy);
    move.addScaledVector(right, joy.dx);
  }
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
  vel.x += (move.x - vel.x) * Math.min(1, dt * 12);
  vel.z += (move.z - vel.z) * Math.min(1, dt * 12);
  vel.y -= 24 * dt;
  if (keys['Space'] && onGround) { vel.y = 8.2; onGround = false; }
  yawObj.position.x += vel.x * dt;
  yawObj.position.z += vel.z * dt;
  yawObj.position.y += vel.y * dt;
  if (yawObj.position.y <= 1.7) { yawObj.position.y = 1.7; vel.y = 0; onGround = true; }
  collideCircle(yawObj.position, 0.55);
  yawObj.rotation.y = yaw;
  pitchObj.rotation.x = pitch;

  const moving = Math.hypot(vel.x, vel.z) > 1 && onGround;
  const bob = moving ? Math.sin(state.time * (sprint ? 13 : 9)) * 0.024 : 0;
  camera.position.y = bob;
  const vm = viewmodels[state.weapon];
  vm.position.y = -0.24 + (moving ? Math.sin(state.time * (sprint ? 13 : 9) + 1.2) * 0.008 : 0);

  // slow regen out of combat
  if (state.hp > 0 && state.hp < stat.maxHp() && state.time - state.lastDamageT > 6) {
    state.hp = Math.min(stat.maxHp(), state.hp + 3 * dt);
    updateHudSoon();
  }
  // district label
  const d = districtAt(yawObj.position.x, yawObj.position.z);
  if (d.name !== hud.district.textContent) hud.district.textContent = d.name;
}

function updateCombat(dt) {
  state.fireCooldown -= dt;
  if (fireHeld && (currentWeapon().auto || currentWeapon().melee)) shoot();
  if (state.reloading) {
    state.reloadT -= dt;
    if (state.reloadT <= 0) finishReload();
  }
  recoil = Math.max(0, recoil - dt * 8);
  const vm = viewmodels[state.weapon];
  vm.position.z = -0.5 + recoil * 0.07;
  vm.rotation.x = recoil * (currentWeapon().melee ? 0.7 : 0.12);
  muzzleFlash.intensity = Math.max(0, muzzleFlash.intensity - dt * 380);
}

function updateCameraFX(dt) {
  if (state.shakeT > 0) {
    state.shakeT -= dt;
    const a = state.shakeAmp * (state.shakeT / 0.25);
    camera.position.x = (Math.random() - 0.5) * a;
    camera.rotation.z = (Math.random() - 0.5) * a * 0.4;
    if (state.shakeT <= 0) { state.shakeAmp = 0; camera.position.x = 0; camera.rotation.z = 0; }
  }
  const targetFov = state.focusOn ? 62 : 74;
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 8);
  camera.updateProjectionMatrix();
}

let uiTick = 0;
function tick() {
  requestAnimationFrame(tick);
  const raw = Math.min(clock.getDelta(), 0.05);
  if (state.mode === 'playing') {
    updateFocus(raw);
    const dt = raw * state.timeScale;              // world time (slowed by FOCUS)
    const pdt = raw * Math.max(state.timeScale, 0.72);  // player keeps most of their speed
    state.time += raw;
    state.dayT = (state.dayT + dt / DAY_LEN) % 1;
    updatePlayer(pdt);
    updateCombat(raw);
    updateZombies(dt);
    updateProjectiles(dt);
    updateSpawns(dt);
    updateNests(dt);
    updateContainers(dt);
    updateLastStand(dt);
    updateQuestDefense(dt);
    updateInteract();
    updateRain(raw);
    updateLampPool(raw);
    wheelGroup.rotation.z += dt * 0.06;
    // rolling thunder: occasional lightning, more at night
    lightningT -= dt;
    if (lightningT <= 0) { lightningT = 18 + Math.random() * 30; flashT = 0.45; sfx('explosion'); }
    state.saveT += raw;
    if (state.saveT > 10) { state.saveT = 0; saveGame(); }
    uiTick += raw;
    if (uiTick > 0.12) { uiTick = 0; drawMinimap(); drawCompass(); }
  }
  waterTex.offset.x += raw * 0.012; waterTex.offset.y += raw * 0.006;
  for (const c of cloudSprites) { c.position.x += raw * 2.2; if (c.position.x > 420) c.position.x = -420; }
  updateDayNight();
  for (const m of npcMixers) m.update(raw);
  updateEffects(raw * (state.mode === 'playing' ? state.timeScale : 0));
  updateCameraFX(raw);
  if (hudDirty) updateHud();
  if (useComposer) composer.render(); else renderer.render(scene, camera);
  // if bloom tanks the frame rate on this device, drop it once and stay dropped
  if (!perfChecked) {
    perfAccum += raw; perfFrames++;
    if (perfFrames >= 240) {
      perfChecked = true;
      if (perfAccum / perfFrames > 0.045) { useComposer = false; }
    }
  }
}
updateHud();
updateQuestHud();
updateDayNight();
tick();

/* ============================== DEBUG HANDLE ============================== */
window.game = {
  state, zombies, THREE, WEAPONS, QUESTS, interactables,
  player: yawObj,
  startNew: () => startGame(true),
  continueGame: () => startGame(false),
  teleport(x, z) { yawObj.position.set(x, 1.7, z); },
  lookAt(x, z) { yaw = Math.atan2(-(x - yawObj.position.x), -(z - yawObj.position.z)); yawObj.rotation.y = yaw; pitch = 0; pitchObj.rotation.x = 0; },
  setPitch(p) { pitch = p; pitchObj.rotation.x = p; },
  shoot, reload, switchWeapon, toggleFocus, useMedkit, useShot,
  spawn: (type, dx = 5) => makeZombie(type || 'shambler', yawObj.position.x + dx, yawObj.position.z, { aggro: true }),
  killAll: () => [...zombies].forEach(z => killZombie(z)),
  grantTabs: n => { state.tabs += n; updateHudSoon(); },
  addXp,
  interactNearest() { updateInteract(); if (nearInteractable) { nearInteractable.action(); return nearInteractable.id; } return null; },
  nearestInteractable() { updateInteract(); return nearInteractable && nearInteractable.id; },
  acceptQuest, turnInQuest, questEvent,
  setQuest(i) { clearQuestItems(); state.quest = { index: i, stage: 0, data: {} }; updateQuestHud(); },
  startLastStand, endLastStand,
  setDayT(t) { state.dayT = t; },
  save: saveGame, load: () => applySave(loadSave()),
  step(dt = 0.016) {
    if (state.mode === 'playing') {
      state.time += dt;
      updatePlayer(dt); updateCombat(dt); updateZombies(dt); updateProjectiles(dt);
      updateSpawns(dt); updateNests(dt); updateContainers(dt); updateLastStand(dt);
      updateQuestDefense(dt); updateInteract(); updateFocus(dt);
    }
    updateEffects(dt);
  },
  snapshot(w = 640, h = 360, q = 0.7) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const url = canvas.toDataURL('image/jpeg', q);
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    return url;
  },
};