import sys
path = 'src/main.js'
src = open(path, encoding='utf-8').read()

def rep(old, new, tag):
    global src
    n = src.count(old)
    if n != 1:
        print('FAIL %s (found %d): %r' % (tag, n, old[:70]))
        sys.exit(1)
    src = src.replace(old, new)

# ---- A: asset loader: brighter sky HDRI only, keep it as the visible background; no character models
rep("""  const env = await new RGBELoader().loadAsync('assets/hdri/kloofendal_overcast_2k.hdr');
  env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = env;""",
"""  const env = await new RGBELoader().loadAsync('assets/hdri/kloofendal_48d_partly_cloudy_puresky_2k.hdr');
  env.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = env;
  envTex = env;""", 'A1')

rep("""  const loader = new GLTFLoader();
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
  collectEnvMats(scene);""",
"""  ASSETS.ready = true;
  const progressEl = document.getElementById('loadProgress');
  if (progressEl) progressEl.textContent = 'READY';
  collectEnvMats(scene);""", 'A2')

rep("const ASSETS = { models: {}, ready: false };",
    "const ASSETS = { models: {}, ready: false };\nlet envTex = null;", 'A3')

# ---- B: restore procedural NPCs at the outpost
rep("  // NPC visuals are GLB characters, created in buildNpcVisuals() once assets load",
"""  // NPCs
  const dot = buildHumanoid({ shirt: 0x4e6b3f, pants: 0x3c4436, cap: 0x2e4a2e });
  dot.g.position.set(OUTPOST.x - 8, 0, OUTPOST.z - 6); dot.g.rotation.y = 2.4;
  const dotName = nameSprite('RANGER DOT'); dotName.position.y = 2.35; dot.g.add(dotName);
  scene.add(dot.g); npcMeshes.push(dot);
  const doc = buildHumanoid({ skin: 0x8a6a50, shirt: 0x8a8a92, pants: 0x44484e, hair: 0x777777, hairStyle: 'shag' });
  doc.g.position.set(OUTPOST.x + 9, 0, OUTPOST.z + 8); doc.g.rotation.y = -2.2;
  const docName = nameSprite('DOC MERCER'); docName.position.y = 2.35; doc.g.add(docName);
  scene.add(doc.g); npcMeshes.push(doc);
  const sam = buildHumanoid({ skin: 0xa88a68, shirt: 0x7a5a38, pants: 0x4a4438, hair: 0xb04a20, hairStyle: 'shag' });
  sam.g.position.set(OUTPOST.x - 3, 0, OUTPOST.z + 12); sam.g.rotation.y = 3.0;
  const samName = nameSprite('SALVAGE SAM'); samName.position.y = 2.35; sam.g.add(samName);
  scene.add(sam.g); npcMeshes.push(sam);
  // defensive clutter: sandbags + crates around the fire
  const crateM = new THREE.MeshStandardMaterial({ color: 0x6a5233, roughness: 0.9 });
  for (const [cx, cz, s] of [[-5, 3, 1.2], [-4.1, 3.4, 0.9], [6, -4, 1.1], [12, 2, 1.3], [-10, 8, 1.0]]) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateM);
    crate.position.set(OUTPOST.x + cx, s / 2, OUTPOST.z + cz);
    crate.rotation.y = (cx * 13.7) % 1;
    crate.castShadow = crate.receiveShadow = !IS_TOUCH;
    scene.add(crate); staticTargets.push(crate);
    addObstacleBox(OUTPOST.x + cx, OUTPOST.z + cz, s * 1.1, s * 1.1, s);
  }
  const bagM = new THREE.MeshStandardMaterial({ color: 0x8a7a58, roughness: 1 });
  for (const [bx, bz, len, rot] of [[0, -16, 7, 0.2], [-14, -6, 6, 1.4], [13, 9, 6, -0.9]]) {
    const bags = new THREE.Mesh(new THREE.BoxGeometry(len, 1.0, 0.9), bagM);
    bags.position.set(OUTPOST.x + bx, 0.5, OUTPOST.z + bz); bags.rotation.y = rot;
    bags.castShadow = bags.receiveShadow = !IS_TOUCH;
    scene.add(bags); staticTargets.push(bags);
    const c = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
    addObstacleBox(OUTPOST.x + bx, OUTPOST.z + bz, len * c + 0.9 * sn, len * sn + 0.9 * c, 1.0);
  }""", 'B')

# ---- C: makeZombie back to grim procedural humanoids (replace the whole GLB block)
i = src.index('const ZMODEL = { shambler:')
endmark = 'zombies.push(zb);\n  return zb;\n}'
j = src.index(endmark, i) + len(endmark)
src = src[:i] + """function makeZombie(type, x, z, opts = {}) {
  const T = ZTYPES[type];
  const hair = HAIR_COLORS[Math.floor(Math.random() * HAIR_COLORS.length)];
  const hairStyle = Math.random() < 0.5 ? 'mohawk' : Math.random() < 0.7 ? 'spikes' : 'shag';
  const shirts = [0x3a3f44, 0x4a3a52, 0x52403a, 0x2e4a44, 0x54503a];
  const { g, parts } = buildHumanoid({
    skin: T.skin, shirt: shirts[Math.floor(Math.random() * shirts.length)],
    pants: 0x3a3830, hair, hairStyle, scale: T.scale * (0.95 + Math.random() * 0.1),
    zombie: true,
    eyeColor: type === 'brute' ? 0xff5040 : type === 'spitter' ? 0x8aff40 : 0x9fffd0,
  });
  parts.armL.rotation.x = -1.25;
  parts.armR.rotation.x = -1.25;
  g.position.set(x, 0, z);
  scene.add(g);
  const zb = {
    g, parts, type, hp: opts.hp || T.hp * (1 + (state.level - 1) * 0.06), maxHp: T.hp,
    speed: T.speed * (0.9 + Math.random() * 0.25) * (state.night ? 1.2 : 1),
    dmg: T.dmg, atkRate: T.atkRate, atkT: 1 + Math.random(),
    walkPhase: Math.random() * 6, dead: false, aggro: opts.aggro || false,
    growlT: Math.random() * 6, boss: opts.boss || false, name: opts.name,
  };
  if (opts.boss) { g.scale.multiplyScalar(1.25); zb.hp = opts.hp; const ns = nameSprite(opts.name, '#ff6b5b'); ns.position.y = 2.5; g.add(ns); }
  const hitParts = [parts.torso, parts.head, parts.legL, parts.legR, parts.armL, parts.armR];
  hitParts.forEach(m => m.userData.zombie = zb);
  zb.hitMeshes = hitParts; zb.head = parts.head;
  zombies.push(zb);
  return zb;
}""" + src[j:]
print('C ok')

# ---- D: killZombie fall effect back
rep("""  zb.idleA.fadeOut(0.08); zb.moveA.fadeOut(0.08); zb.attackA.fadeOut(0.08);
  zb.deathA.reset().play();
  effects.push({ obj: zb.g, life: 0, ttl: 2.0, update(dt2) { zb.mixer.update(dt2); } });""",
"""  const g = zb.g;
  effects.push({ obj: g, life: 0, ttl: 0.8, update(dt, k) { g.rotation.x = -k * Math.PI / 2; g.position.y = -k * 0.2; } });""", 'D')

# ---- E: updateZombies back to procedural animation
rep("""    zb.mixer.update(dt);
    if (zb.headBone) zb.headBone.scale.setScalar(0.62);
    if (zb.riseT > 0) { zb.riseT -= dt; if (zb.riseT <= 0) { zb.animState = 'rose'; zbSetAnim(zb, 'idle'); } continue; }
    if (!zb.aggro && dist < (state.night ? 34 : 24)) zb.aggro = true;""",
"""    if (!zb.aggro && dist < (state.night ? 34 : 24)) zb.aggro = true;""", 'E1')

rep("""          zb.atkT = zb.atkRate;
          damagePlayer(zb.dmg + Math.floor(Math.random() * 4));
          zb.idleA.fadeOut(0.08); zb.moveA.fadeOut(0.08);
          zb.attackA.reset().fadeIn(0.06).play();
          zb.animState = 'attack'; zb.animLockT = 0.7;""",
"""          zb.atkT = zb.atkRate;
          damagePlayer(zb.dmg + Math.floor(Math.random() * 4));
          zb.parts.armR.rotation.x = -2.2;
          setTimeout(() => { if (!zb.dead) zb.parts.armR.rotation.x = -1.25; }, 180);""", 'E2')

rep("""          zb.atkT = zb.atkRate;
          zb.idleA.fadeOut(0.08); zb.moveA.fadeOut(0.08);
          zb.attackA.reset().fadeIn(0.06).play();
          zb.animState = 'attack'; zb.animLockT = 0.8;
          const from = zp.clone().setY(1.4);""",
"""          zb.atkT = zb.atkRate;
          const from = zp.clone().setY(1.4);""", 'E3')

rep("""    const sp2 = Math.hypot(vx, vz);
    if (zb.animLockT > 0) zb.animLockT -= dt;
    else zbSetAnim(zb, sp2 > 0.3 ? 'move' : 'idle');
    if (zb.animState === 'move') zb.moveA.timeScale = Math.max(0.55, Math.min(2.2, sp2 / zb.animBase));""",
"""    const sp2 = Math.hypot(vx, vz);
    zb.walkPhase += dt * (2 + sp2 * 2.2);
    const swing = Math.sin(zb.walkPhase) * Math.min(0.55, 0.15 + sp2 * 0.12);
    zb.parts.legL.rotation.x = swing;
    zb.parts.legR.rotation.x = -swing;""", 'E4')

rep("{ aggro: true, rise: true });", "{ aggro: true });", 'E5')

# ---- F: Strike-Zone lighting — sun-dominant, hard shadows, HDRI sky visible by day
rep("  sun.intensity = 0.15 + dayK * 1.7;", "  sun.intensity = 0.2 + dayK * 2.4;", 'F1')
rep("  hemi.intensity = 0.22 + dayK * 0.75;", "  hemi.intensity = 0.18 + dayK * 0.5;", 'F2')
rep("""  const ei = 0.15 + dayK * 1.0;
  for (const m of envMats) m.envMapIntensity = ei;""",
"""  const ei = 0.1 + dayK * 0.55;
  for (const m of envMats) m.envMapIntensity = ei;
  if (envTex && dayK > 0.4) { if (scene.background !== envTex) scene.background = envTex; }
  else if (scene.background === envTex) scene.background = tmpC.clone();""", 'F3')
rep("  scene.background.copy(tmpC);", "  if (scene.background && scene.background.isColor) scene.background.copy(tmpC);", 'F4')

# ---- G: density — fewer empty lots, more wrecks and rubble
rep("    if (rng() < 0.22) continue;                                    // empty lot", "    if (rng() < 0.1) continue;                                     // empty lot", 'G1')
rep("for (let i = 0; i < 60; i++) {\n  const onX = rng() < 0.5;", "for (let i = 0; i < 100; i++) {\n  const onX = rng() < 0.5;", 'G2')
rep("for (let i = 0; i < 50; i++) {\n  const x = (rng() * 2 - 1) * 330, z = (rng() * 2 - 1) * 330;", "for (let i = 0; i < 85; i++) {\n  const x = (rng() * 2 - 1) * 330, z = (rng() * 2 - 1) * 330;", 'G3')

open(path, 'w', encoding='utf-8').write(src)
print('all patches applied')
