/* ============================================================================
   core.js — 死灵防线 3D · 战场基座
   日照草甸 + 圣光防线 + 可动战斗法师（保留法术试验场的程序化模型）。
   ACES tone mapping + 克制的高光 bloom；显式主循环契约与试验场一致：
   game.update(时间/移动) → 法术/实体 → 粒子 → game.lateUpdate(姿态/镜头/装饰)
   → UI → game.render(动态分辨率)。game.dispose 统一回收，幂等。
   ========================================================================== */
(function (global) {
  'use strict';
  const V3 = BABYLON.Vector3;
  const C3 = BABYLON.Color3;
  const C4 = BABYLON.Color4;
  const FIELD = CONFIG.FIELD;
  const HERO = CONFIG.HERO;

  /* ------------------------------ 施法者（复用） ------------------------------ */
  const P = (n) => Math.PI * n;
  class Mage {
    constructor(scene) {
      const root = new BABYLON.TransformNode('mage', scene);
      const visual = new BABYLON.TransformNode('mageVisual', scene);
      visual.parent = root;
      this.root = root; this.visual = visual;
      this.scene = scene;

      const matArmor = new BABYLON.StandardMaterial('matArmor', scene);
      matArmor.diffuseColor = new C3(0.88, 0.92, 0.98);
      matArmor.specularColor = new C3(0.26, 0.30, 0.36);
      matArmor.specularPower = 32;

      const matCloth = new BABYLON.StandardMaterial('matCloth', scene);
      matCloth.diffuseColor = new C3(0.08, 0.28, 0.64);
      matCloth.specularColor = new C3(0.06, 0.10, 0.16);

      const matGold = new BABYLON.StandardMaterial('matGold', scene);
      matGold.diffuseColor = new C3(0.96, 0.67, 0.22);
      matGold.specularColor = new C3(0.66, 0.50, 0.22);
      matGold.specularPower = 40;
      matGold.emissiveColor = new C3(0.025, 0.016, 0.004);

      const matTrim = new BABYLON.StandardMaterial('matTrim', scene);
      matTrim.diffuseColor = new C3(0.22, 0.51, 0.71);
      matTrim.emissiveColor = new C3(0.04, 0.10, 0.14);
      matTrim.specularColor = new C3(0.17, 0.29, 0.40);
      this.matTrim = matTrim;
      this._ownMaterials = [matArmor, matCloth, matGold, matTrim];

      const torso = BABYLON.MeshBuilder.CreateCapsule('torso', { height: 1.42, radius: 0.40, tessellation: 16 }, scene);
      torso.position.y = 1.30; torso.material = matArmor; torso.parent = visual;

      const chest = BABYLON.MeshBuilder.CreateSphere('chest', { diameter: 0.78, segments: 12, slice: 0.5 }, scene);
      chest.position.set(0, 1.52, 0.05); chest.scaling.set(1.05, 0.7, 0.8);
      chest.rotation.x = 0.12; chest.material = matArmor; chest.parent = visual;

      const robe = BABYLON.MeshBuilder.CreateCylinder('robe', { diameterTop: 0.80, diameterBottom: 1.22, height: 1.2, tessellation: 18 }, scene);
      robe.position.y = 0.60; robe.material = matCloth; robe.parent = visual;

      const hem = BABYLON.MeshBuilder.CreateTorus('hem', { diameter: 1.22, thickness: 0.05, tessellation: 24 }, scene);
      hem.position.y = 0.06; hem.material = matTrim; hem.parent = visual;

      const belt = BABYLON.MeshBuilder.CreateTorus('belt', { diameter: 0.86, thickness: 0.06, tessellation: 22 }, scene);
      belt.position.y = 1.08; belt.material = matGold; belt.parent = visual;
      const brooch = BABYLON.MeshBuilder.CreatePolyhedron('brooch', { type: 1, size: 0.11 }, scene);
      brooch.position.set(0, 1.52, 0.38); brooch.material = matTrim; brooch.parent = visual;
      this.brooch = brooch;

      const head = BABYLON.MeshBuilder.CreateSphere('head', { diameter: 0.46, segments: 14 }, scene);
      head.position.y = 2.20; head.material = matArmor; head.parent = visual;
      const hood = BABYLON.MeshBuilder.CreateSphere('hood', { diameter: 0.74, segments: 14, slice: 0.60 }, scene);
      hood.position.set(0, 2.28, -0.10); hood.rotation.x = -0.32; hood.material = matCloth; hood.parent = visual;
      const hoodTip = BABYLON.MeshBuilder.CreateCylinder('hoodTip', { height: 0.34, diameterTop: 0, diameterBottom: 0.22, tessellation: 10 }, scene);
      hoodTip.position.set(0, 2.62, -0.22); hoodTip.rotation.x = -0.5; hoodTip.material = matCloth; hoodTip.parent = visual;
      const visor = BABYLON.MeshBuilder.CreateBox('visor', { width: 0.26, height: 0.06, depth: 0.05 }, scene);
      visor.position.set(0, 2.20, 0.22); visor.material = matTrim; visor.parent = visual;

      const shoulderM = [], spikeM = [];
      for (const s of [-1, 1]) {
        const sh = BABYLON.MeshBuilder.CreateSphere('shoulder', { diameter: 0.46, segments: 12, slice: 0.5 }, scene);
        sh.position.set(s * 0.52, 1.88, 0); sh.rotation.z = s * 0.5; sh.material = matArmor; sh.parent = visual;
        shoulderM.push(sh);
        const spike = BABYLON.MeshBuilder.CreateCylinder('shSpike', { height: 0.26, diameterTop: 0, diameterBottom: 0.12, tessellation: 8 }, scene);
        spike.position.set(s * 0.56, 2.06, 0); spike.rotation.z = s * 0.62; spike.material = matGold; spike.parent = visual;
        spikeM.push(spike);
      }

      const mergeStatic = (list, mat) => {
        for (const m of list) m.bakeCurrentTransformIntoVertices();
        const merged = BABYLON.Mesh.MergeMeshes(list, true, true);
        merged.material = mat; merged.parent = visual; merged.isPickable = false;
        return merged;
      };
      this.bodyMeshes = [
        mergeStatic([torso, chest, head, shoulderM[0], shoulderM[1]], matArmor),
        mergeStatic([robe, hood, hoodTip], matCloth),
        mergeStatic([belt, spikeM[0], spikeM[1]], matGold),
        mergeStatic([hem, visor], matTrim),
      ];

      this.legs = [];
      for (const s of [-1, 1]) {
        const leg = new BABYLON.TransformNode('leg' + s, scene);
        leg.position.set(s * 0.20, 0.72, 0); leg.parent = visual;
        const limb = BABYLON.MeshBuilder.CreateCapsule('legMesh', { height: 0.78, radius: 0.12, tessellation: 8 }, scene);
        limb.position.y = -0.38; limb.material = matCloth; limb.parent = leg;
        const boot = BABYLON.MeshBuilder.CreateBox('boot', { width: 0.20, height: 0.12, depth: 0.32 }, scene);
        boot.position.set(0, -0.72, 0.05); boot.material = matArmor; boot.parent = leg;
        this.legs.push({ node: leg, side: s });
      }

      this.arms = [];
      for (const s of [1, -1]) {
        const shoulder = new BABYLON.TransformNode('arm' + s, scene);
        shoulder.position.set(s * 0.56, 1.84, 0); shoulder.parent = visual;
        const up = BABYLON.MeshBuilder.CreateCapsule('armUp', { height: 0.62, radius: 0.125, tessellation: 10 }, scene);
        up.position.y = -0.30; up.material = matArmor; up.parent = shoulder;
        const elbow = new BABYLON.TransformNode('elbow' + s, scene);
        elbow.position.y = -0.60; elbow.parent = shoulder;
        const fore = BABYLON.MeshBuilder.CreateCapsule('armFore', { height: 0.56, radius: 0.105, tessellation: 10 }, scene);
        fore.position.y = -0.26; fore.material = matCloth; fore.parent = elbow;
        const cuff = BABYLON.MeshBuilder.CreateTorus('cuff', { diameter: 0.26, thickness: 0.045, tessellation: 16 }, scene);
        cuff.position.y = -0.50; cuff.rotation.x = P(0.5); cuff.material = matGold; cuff.parent = elbow;
        const hand = BABYLON.MeshBuilder.CreateSphere('hand', { diameter: 0.20, segments: 10 }, scene);
        hand.position.y = -0.62; hand.material = matCloth; hand.parent = elbow;
        shoulder.rotation.z = s * 0.14;
        this.arms.push({ shoulder, elbow, hand, side: s });
      }
      this.armR = this.arms[0].shoulder; this.armL = this.arms[1].shoulder;
      this.handR = this.arms[0].hand;

      const staffR = this.arms[0].elbow;
      const staff = BABYLON.MeshBuilder.CreateCylinder('staff', { diameter: 0.07, height: 2.05, tessellation: 8 }, scene);
      staff.position.set(0.02, -0.52, 0.14); staff.rotation.x = 0.18; staff.material = matArmor; staff.parent = staffR;
      const staffHead = BABYLON.MeshBuilder.CreateTorus('staffHead', { diameter: 0.30, thickness: 0.04, tessellation: 18 }, scene);
      staffHead.position.set(0.02, 0.52, 0.32); staffHead.rotation.x = P(0.35); staffHead.material = matGold; staffHead.parent = staffR;
      const gem = BABYLON.MeshBuilder.CreatePolyhedron('gem', { type: 1, size: 0.15 }, scene);
      gem.position.set(0.02, 0.56, 0.32); gem.material = matTrim; gem.parent = staffR;
      gem.enableEdgesRendering();
      gem.edgesColor = new C4(0.6, 0.9, 1, 0.9);
      this.gem = gem;

      this.cape = [];
      let capeParent = visual;
      for (let i = 0; i < 4; i++) {
        const seg = new BABYLON.TransformNode('cape' + i, scene);
        seg.position.y = i === 0 ? 1.92 : -0.34;
        if (i === 0) seg.position.z = -0.24; else seg.position.z = -0.02;
        seg.parent = capeParent;
        const w = 0.72 - i * 0.07;
        const panel = BABYLON.MeshBuilder.CreateBox('capePanel' + i, { width: w, height: 0.4, depth: 0.045 }, scene);
        panel.position.y = -0.2; panel.material = matCloth; panel.parent = seg;
        this.cape.push(seg);
        capeParent = seg;
      }

      this.crystals = [];
      for (let i = 0; i < 3; i++) {
        const c = BABYLON.MeshBuilder.CreatePolyhedron('crystal' + i, { type: 1, size: 0.09 }, scene);
        c.material = matTrim; c.parent = visual; c.setEnabled(false);
        this.crystals.push(c);
      }

      const pl = new BABYLON.PointLight('mageLight', new V3(0, 2.6, 0.6), scene);
      pl.intensity = 0.16; pl.range = 9;
      pl.diffuse = new C3(0.48, 0.72, 1.0);
      pl.parent = root;
      this.light = pl;

      this.castAmount = 0;
      this.walkPhase = 0;
      this.facing = 0;                 // 面朝 +z：亡灵来向
      this.targetFacing = this.facing;
      this.yOffset = 0;
      this.speedLean = 0;
      this.spell = { phase: 'idle', progress: 0, level: 3, color: '#79d2ff', skillId: 0, lastCall: -9 };
      this.poseCur = { armRx: 0.12, armRz: 0.14, elbowR: 0.35, armLx: 0.10, armLz: -0.14, elbowL: 0.3, torso: 0, hover: 0, spread: 0 };
      this.tintCur = new C3(0.48, 0.72, 1.0);
    }

    worldHand(out) {
      this.handR.computeWorldMatrix(true);
      const p = this.handR.getAbsolutePosition();
      if (out) return out.copyFrom(p);
      return p.clone();
    }

    setCast(k) { this.castAmount = k; }

    setSpellPose(phase, progress, level, colorHex, skillId) {
      this.spell.phase = phase;
      this.spell.progress = progress;
      this.spell.level = level || 3;
      if (colorHex) this.spell.color = colorHex;
      this.spell.skillId = skillId || 0;
      this.spell.lastCall = FX.time;
    }

    faceTo(x, z) {
      const d = new V3(x, 0, z);
      if (d.lengthSquared() > 0.0001) this.targetFacing = Math.atan2(d.x, d.z);
    }

    _poseTarget() {
      const sp = this.spell;
      const k = Math.min(1, sp.progress);
      const cast = Math.max(this.castAmount, sp.phase === 'idle' ? 0 : k);
      const t = { armRx: 0.12, armRz: 0.14, elbowR: 0.35, armLx: 0.10, armLz: -0.14, elbowL: 0.30, torso: 0, hover: 0, spread: 0 };
      if (cast > 0.01 && sp.phase === 'idle') {
        t.armRx = 0.12 + (-1.98 - 0.12) * cast; t.armRz = 0.14 + cast * 0.28; t.elbowR = 0.35 - cast * 0.2;
        t.armLx = 0.10 + (-0.75 - 0.10) * cast * 0.85; t.armLz = -0.14 - cast * 0.22;
        t.torso = cast * 0.06;
      }
      const ph = sp.phase;
      if (ph === 'windup') {
        const raise = -2.35 - k * 0.25;
        t.armRx = 0.12 + (raise - 0.12) * k; t.armRz = 0.14 + k * 0.34; t.elbowR = 0.35 - k * 0.28;
        t.armLx = 0.10 + (-1.15 - 0.10) * k; t.armLz = -0.14 - k * 0.3;
        t.elbowL = 0.30 - k * 0.22; t.torso = -k * 0.10;
      } else if (ph === 'release') {
        t.armRx = -1.15; t.armRz = 0.30; t.elbowR = 0.06; t.armLx = -0.55; t.armLz = -0.24; t.torso = 0.14;
      } else if (ph === 'travel') {
        t.armRx = -1.45; t.armRz = 0.26; t.elbowR = 0.16; t.armLx = -0.6; t.armLz = -0.2; t.torso = 0.08;
      } else if (ph === 'impact') {
        t.armRx = -0.55; t.armRz = 0.10; t.elbowR = 0.5; t.armLx = -0.2; t.armLz = -0.1; t.torso = 0.22;
      } else if (ph === 'aftermath') {
        t.armRx = -0.1; t.armRz = 0.14; t.elbowR = 0.4; t.torso = 0.05;
      }
      return t;
    }

    update(dt, time, moving) {
      const sp = this.spell;
      if (sp.phase !== 'idle' && FX.time - sp.lastCall > 0.28) { sp.phase = 'idle'; sp.progress = 0; }

      const t = this._poseTarget();
      const cur = this.poseCur;
      const blend = 1 - Math.exp(-dt * 9);
      for (const key in t) cur[key] += (t[key] - cur[key]) * blend;

      this.armR.rotation.x = cur.armRx; this.armR.rotation.z = cur.armRz;
      this.arms[0].elbow.rotation.x = cur.elbowR;
      this.armL.rotation.x = cur.armLx; this.armL.rotation.z = cur.armLz;
      this.arms[1].elbow.rotation.x = cur.elbowL;
      this.visual.rotation.x = cur.torso;

      const castK = Math.max(Math.abs(cur.armRx) / 2, sp.phase !== 'idle' ? 0.4 : 0);
      if (moving) this.walkPhase += dt * 8.4;
      const swing = moving ? Math.sin(this.walkPhase) : 0;
      for (const leg of this.legs) leg.node.rotation.x = swing * 0.55 * leg.side;
      this.visual.rotation.x += moving ? 0.06 : 0;
      if (castK < 0.3) {
        this.armR.rotation.x += swing * 0.25 * (1 - castK * 3);
        this.armL.rotation.x -= swing * 0.25 * (1 - castK * 3);
      }
      this.speedLean += ((moving ? 1 : 0) - this.speedLean) * Math.min(1, dt * 6);

      for (let i = 0; i < this.cape.length; i++) {
        const seg = this.cape[i];
        seg.rotation.x = 0.18 + Math.sin(time * 2.6 - i * 0.85) * 0.05
          + this.speedLean * (0.28 + i * 0.1) + Math.sin(this.walkPhase - i * 0.7) * 0.06 * this.speedLean;
        seg.rotation.z = Math.sin(time * 1.7 - i * 0.6) * 0.03;
      }

      const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.07 : Math.sin(time * 1.7) * 0.028;
      this.visual.position.y = bob + (this.yOffset || 0) + cur.hover + Math.sin(time * 2.1) * cur.hover * 0.18;
      this.root.rotation.z = moving ? Math.sin(this.walkPhase) * 0.02 : Math.sin(time * 1.1) * 0.012;

      let diff = this.targetFacing - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 11);
      this.root.rotation.y = this.facing;

      const [r, g, b] = FX.hexToRgb(sp.color);
      const tc = this.tintCur;
      tc.r += (r - tc.r) * blend; tc.g += (g - tc.g) * blend; tc.b += (b - tc.b) * blend;
      const charge = Math.max(this.castAmount, sp.phase === 'windup' ? sp.progress : 0);
      tc.scaleToRef(0.16 + charge * 0.34, this.matTrim.emissiveColor);
      const pulse = 0.9 + Math.sin(time * 2.3) * 0.1 + charge * 0.6;
      this.gem.scaling.setAll(pulse);
      this.brooch.rotation.y += dt * 1.2;
      const showCrystals = sp.phase !== 'idle';
      for (let i = 0; i < this.crystals.length; i++) {
        const c = this.crystals[i];
        c.setEnabled(showCrystals);
        if (!showCrystals) continue;
        const a = time * (1.3 + i * 0.22) + i * (Math.PI * 2 / 3);
        const rad = 1.05 + Math.sin(time * 1.8 + i * 2.1) * 0.12;
        c.position.set(Math.cos(a) * rad, 2.1 + Math.sin(time * 2.4 + i) * 0.16, Math.sin(a) * rad);
        c.rotation.x += dt * 2.2; c.rotation.y += dt * 1.6;
        c.scaling.setAll(0.8 + charge * 0.9);
      }

      this.light.diffuse.copyFrom(tc);
      this.light.intensity = 0.16 + charge * 0.65 + cur.hover * 0.25;
    }

    dispose() {
      if (this.gem) this.gem.disableEdgesRendering();
      this.root.getChildMeshes().forEach(m => m.dispose());
      this.visual.dispose();
      this.root.dispose();
      const alive = (mat) => (typeof mat.isDisposed === 'function' ? !mat.isDisposed() : true);
      for (const mat of this._ownMaterials) if (alive(mat)) mat.dispose();
      for (const mat of this.scene.materials.slice()) {
        if (mat.name === 'lineShader' && alive(mat)) mat.dispose();
      }
    }
  }

  /* ------------------------------ 地面落点圈（复用） ------------------------------ */
  class TargetRing {
    constructor(scene) {
      this.scene = scene;
      const ring = FX.makeSprite(scene, 'aimRing', FX.textures.ring, 'add', new C4(0.3, 1, 0.6, 1));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.05;
      ring.scaling.set(6, 6, 1);
      const disc = FX.makeSprite(scene, 'aimDisc', FX.textures.softDisc, 'add', new C4(0.3, 1, 0.6, 0.5));
      disc.rotation.x = Math.PI / 2;
      disc.position.y = 0.035;
      disc.scaling.set(5.2, 5.2, 1);
      this.ring = ring; this.disc = disc;
      this.spin = 0;
      this.visible = false;
      this.setVisible(false);
    }
    setVisible(v) {
      this.visible = v;
      this.ring.setEnabled(v);
      this.disc.setEnabled(v);
    }
    update(dt, pos, inRange, radius, colorHex) {
      if (!this.visible) return;
      this.spin += dt * 0.55 * (inRange ? 1 : -1.6);
      this.ring.rotation.z = this.spin;
      this.disc.rotation.z = -this.spin * 0.35;
      this.ring.position.x = pos.x; this.ring.position.z = pos.z;
      this.disc.position.x = pos.x; this.disc.position.z = pos.z;
      const s = radius * 2;
      this.ring.scaling.x = this.ring.scaling.y = s;
      this.disc.scaling.x = this.disc.scaling.y = s * 0.86;
      const col = inRange ? colorHex : '#ff5f5f';
      const [r, g, b] = FX.hexToRgb(col);
      const pulse = 0.82 + Math.sin(FX.time * 6) * 0.12;
      this.ring._spriteMat.setColor4('uColor', new C4(r * 1.6, g * 1.6, b * 1.6, 0.95 * pulse));
      this.disc._spriteMat.setColor4('uColor', new C4(r, g, b, 0.32));
    }
  }

  /* ------------------------------ 场景创建 ------------------------------ */
  function createGame(canvas) {
    const engine = new BABYLON.Engine(canvas, true, {
      preserveDrawingBuffer: /[?&]probe\b/.test(location.search),
      stencil: true,
      adaptToDeviceRatio: true,
    }, true);
    const hwBest = 1 / Math.min(window.devicePixelRatio || 1, 1.6);
    let hwLevel = hwBest;
    const hwMax = Math.max(hwBest, 1.15);
    engine.setHardwareScalingLevel(hwLevel);

    const scene = new BABYLON.Scene(engine);
    const initialTheme = CONFIG.THEMES[0].theme;
    const sky = C3.FromHexString(initialTheme.fog);
    scene.clearColor = new C4(sky.r, sky.g, sky.b, 1);
    scene.ambientColor = new C3(0.20, 0.23, 0.25);

    FX.init(scene);

    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = initialTheme.fogDensity;
    scene.fogColor = sky;

    const hemi = new BABYLON.HemisphericLight('hemi', new V3(0.15, 1, -0.12), scene);
    hemi.intensity = 0.78;
    hemi.diffuse = new C3(0.86, 0.93, 1.0);
    hemi.groundColor = new C3(0.46, 0.43, 0.31);

    /* 保留 moon API/主题字段；视觉上作为温暖日光，不新增配置键。 */
    const moon = new BABYLON.DirectionalLight('moon', new V3(-0.45, -1, 0.32), scene);
    moon.intensity = 0.92;
    moon.diffuse = C3.FromHexString(initialTheme.moon);

    /* 大地面(唯一输入拾取面)，彩色草地使用轻量主题染色，避免二次乘绿变暗。 */
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 260, height: 320, subdivisions: 2 }, scene);
    const gmat = new BABYLON.StandardMaterial('matGround', scene);
    const gnoise = FX.textures.daylightGrass || FX.textures.groundNoise;
    const coloredGrass = gnoise === FX.textures.daylightGrass;
    gnoise.uScale = 32;
    gnoise.vScale = 40;
    gnoise.wrapU = gnoise.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
    gmat.diffuseTexture = gnoise;
    gmat.specularColor = new C3(0.015, 0.02, 0.01);
    gmat.specularPower = 8;
    gmat.diffuseColor = C3.FromHexString(initialTheme.ground);
    gmat.emissiveColor = new C3(0, 0, 0);
    ground.material = gmat;
    ground.isPickable = true;

    /* —— 圣光防线：奶油色石台 + 蓝金集结纹饰 + 侧柱阵 —— */
    const matStone = new BABYLON.StandardMaterial('matStone', scene);
    matStone.diffuseColor = new C3(0.88, 0.79, 0.60);
    matStone.specularColor = new C3(0.12, 0.11, 0.08);
    matStone.specularPower = 18;
    const matRune = new BABYLON.StandardMaterial('matRune', scene);
    matRune.diffuseColor = new C3(0.76, 0.54, 0.20);
    matRune.emissiveColor = new C3(0.035, 0.027, 0.008);
    matRune.specularColor = new C3(0.28, 0.23, 0.12);
    const matBoneStone = new BABYLON.StandardMaterial('matBoneStone', scene);
    matBoneStone.diffuseColor = new C3(0.82, 0.84, 0.72);
    matBoneStone.specularColor = new C3(0.10, 0.12, 0.10);
    matBoneStone.specularPower = 18;
    const matNecro = new BABYLON.StandardMaterial('matNecro', scene);
    matNecro.diffuseColor = C3.FromHexString(initialTheme.gate);
    matNecro.emissiveColor = matNecro.diffuseColor.scale(0.16);
    matNecro.specularColor = new C3(0.12, 0.15, 0.12);

    /* 英雄石台（圣光锚点） */
    const platform = BABYLON.MeshBuilder.CreateCylinder('platform', { diameter: 11, height: 0.12, tessellation: 48 }, scene);
    platform.position.set(0, -0.042, FIELD.heroZ); platform.material = matStone;
    const rim = BABYLON.MeshBuilder.CreateTorus('rim', { diameter: 11, thickness: 0.09, tessellation: 64 }, scene);
    rim.position.set(0, 0.13, FIELD.heroZ); rim.material = matRune;
    const inner = BABYLON.MeshBuilder.CreateTorus('inner', { diameter: 7, thickness: 0.05, tessellation: 48 }, scene);
    inner.position.set(0, 0.13, FIELD.heroZ); inner.scaling.y = 1.6; inner.material = matRune;
    const runeDisc = FX.makeSprite(scene, 'heroRune', FX.textures.rune, 'normal', new C4(0.16, 0.40, 0.68, 0.26));
    runeDisc.rotation.x = Math.PI / 2;
    runeDisc.position.set(0, 0.135, FIELD.heroZ);
    runeDisc.scaling.set(9.8, 9.8, 1);

    /* 集结行标线 + 三路引路符 */
    const rallyMarks = [];
    for (const z of FIELD.rallyZ) {
      const line = BABYLON.MeshBuilder.CreateBox('rallyLine', { width: FIELD.rallySpreadX * 2 + 3, height: 0.04, depth: 0.34 }, scene);
      line.position.set(0, 0.05, z); line.material = matRune;
      rallyMarks.push(line);
      for (let k = -2; k <= 2; k++) {
        const pip = BABYLON.MeshBuilder.CreateCylinder('rallyPip', { diameter: 0.28, height: 0.06, tessellation: 6 }, scene);
        pip.position.set(k * (FIELD.rallySpreadX / 2), 0.05, z + 0.42); pip.material = matRune;
        rallyMarks.push(pip);
      }
    }
    for (const laneX of [-7, 0, 7]) {
      for (let i = 0; i < 6; i++) {
        const dash = BABYLON.MeshBuilder.CreateBox('laneDash', { width: 0.10, height: 0.02, depth: 2.2 }, scene);
        dash.position.set(laneX, 0.03, FIELD.rallyZ[1] + 6 + i * 6.2); dash.material = matRune;
        rallyMarks.push(dash);
      }
    }

    /* 侧柱阵：两列断柱夹出战场走廊 */
    const pillars = [], bandMeshes = [];
    for (let i = 0; i < 12; i++) {
      const z = -34 + i * 7.4;
      for (const sx of [-1, 1]) {
        const h = 2.4 + ((i * 37 + (sx + 1) * 13) % 10) * 0.30;
        const col = BABYLON.MeshBuilder.CreateCylinder('pillar', { diameterTop: 0.8, diameterBottom: 1.15, height: h, tessellation: 10 }, scene);
        col.position.set(sx * 13.6, h / 2 - 0.1, z);
        col.rotation.z = (((i * 53 + (sx + 1) * 7) % 10) / 10 - 0.5) * 0.14;
        col.material = matStone;
        pillars.push(col);
        const band = BABYLON.MeshBuilder.CreateTorus('pillarBand', { diameter: 1.02, thickness: 0.05, tessellation: 16 }, scene);
        band.position.set(col.position.x, h * 0.62, z);
        band.rotation.x = Math.PI / 2; band.material = matRune;
        bandMeshes.push(band);
      }
    }
    /* 战场两侧低矮路缘 */
    for (const sx of [-1, 1]) {
      const curb = BABYLON.MeshBuilder.CreateBox('curb', { width: 0.7, height: 0.5, depth: 86 }, scene);
      curb.position.set(sx * 12.6, 0.2, 1); curb.material = matStone;
      pillars.push(curb);
    }
    /* 中央浅石板路：两列共 28 个双三角面，合入现有石材批次，无新增绘制调用。
       y 低于落点圈/法术残留；不可拾取，输入仍只命中 game.ground。 */
    const pathStart = FIELD.heroZ + 5.6, pathEnd = FIELD.spawnZ + 5;
    const pathStep = (pathEnd - pathStart) / 14;
    for (let i = 0; i < 14; i++) {
      for (const sx of [-1, 1]) {
        const slab = BABYLON.MeshBuilder.CreateGround('pathSlab', { width: 3.45, height: pathStep - 0.12, subdivisions: 1 }, scene);
        slab.position.set(sx * 1.78, 0.012, pathStart + (i + 0.5) * pathStep);
        slab.material = matStone;
        slab.isPickable = false;
        pillars.push(slab);
      }
    }
    {
      const mergeAt = (list) => {
        for (const m of list) m.bakeCurrentTransformIntoVertices();
        const merged = BABYLON.Mesh.MergeMeshes(list, true, true);
        merged.isPickable = false;
        return merged;
      };
      mergeAt([platform, ...pillars]);
      mergeAt([rim, inner, ...bandMeshes, ...rallyMarks]);
    }

    /* —— 亡灵之门：日光雾中的象牙石门与淡彩魔力 —— */
    const gate = new BABYLON.TransformNode('necroGate', scene);
    const obelisks = [];
    for (const sx of [-1, 1]) {
      const ob = BABYLON.MeshBuilder.CreateCylinder('obelisk', { diameterTop: 1.0, diameterBottom: 2.0, height: 9.5, tessellation: 6 }, scene);
      ob.position.set(sx * 6.4, 4.2, FIELD.spawnZ + 5);
      ob.rotation.z = -sx * 0.06;
      ob.material = matBoneStone; ob.parent = gate;
      obelisks.push(ob);
      const eye = BABYLON.MeshBuilder.CreateTorus('gateEye', { diameter: 1.5, thickness: 0.12, tessellation: 18 }, scene);
      eye.position.set(sx * 6.4, 7.0, FIELD.spawnZ + 3.6);
      eye.material = matNecro; eye.parent = gate;
      bandMeshes.push(eye);
    }
    const arch = BABYLON.MeshBuilder.CreateTorus('gateArch', { diameter: 13.6, thickness: 0.85, tessellation: 24, arc: 0.5 }, scene);
    arch.position.set(0, 0.4, FIELD.spawnZ + 5); arch.rotation.x = Math.PI / 2; arch.rotation.y = Math.PI;
    arch.material = matBoneStone; arch.parent = gate;
    const gateGlow = FX.makeSprite(scene, 'gateGlow', FX.textures.vortex, 'add', new C4(0.52, 0.78, 0.62, 0.12));
    gateGlow.position.set(0, 3.4, FIELD.spawnZ + 3.2);
    gateGlow.scaling.set(11, 11, 1);
    const gateLight = new BABYLON.PointLight('gateLight', new V3(0, 4.2, FIELD.spawnZ + 2), scene);
    gateLight.intensity = 0.28; gateLight.range = 18;
    gateLight.diffuse = C3.FromHexString(initialTheme.gate);
    gateLight.parent = gate;

    /* 悬浮碎石 */
    const floaters = [];
    for (let i = 0; i < 7; i++) {
      const rock = BABYLON.MeshBuilder.CreatePolyhedron('floater' + i, { type: 3, size: 0.26 + (i % 3) * 0.12 }, scene);
      const a = i * 2.1;
      rock.position.set(Math.cos(a) * (11 + (i % 3) * 1.6), 3.0 + (i % 4) * 0.9, FIELD.spawnZ - 2 + Math.sin(i * 1.3) * 5);
      rock.material = matBoneStone; rock.parent = gate;
      floaters.push({ mesh: rock, baseY: rock.position.y, phase: i * 1.7, spin: 0.2 + (i % 3) * 0.1 });
    }

    const mage = new Mage(scene);
    mage.root.position.set(HERO.position[0], 0, HERO.position[1]);

    /* 相机：自英雄身后俯瞰北面战场 */
    const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2, 0.58, 90, new V3(0, 1.5, -2), scene);
    camera.lowerRadiusLimit = 72;
    camera.upperRadiusLimit = 110;
    camera.lowerBetaLimit = 0.44;
    camera.upperBetaLimit = 0.78;
    camera.fov = 0.82;
    camera.minZ = 0.4;
    camera.maxZ = 320;
    camera.panningSensibility = 0;
    camera.wheelDeltaPercentage = 0.021;
    camera.attachControl(canvas, true);
    if (camera.inputs && camera.inputs.attached && camera.inputs.attached.pointers) {
      camera.inputs.attached.pointers.buttons = [2];
    }

    /* 清晰日光 + 只让白热核心泛光：阈值压低、权重适中，亮背景下光效靠
       分层光晕与暗衬底保对比（skills.js），曝光略收避免全场过曝。 */
    const post = new BABYLON.DefaultRenderingPipeline('post', true, scene, [camera]);
    post.fxaaEnabled = true;
    post.bloomEnabled = true;
    post.bloomThreshold = 0.9;
    post.bloomWeight = 0.3;
    post.bloomKernel = 32;
    post.bloomScale = 0.5;
    post.imageProcessingEnabled = true;
    post.imageProcessing.toneMappingEnabled = true;
    post.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    post.imageProcessing.exposure = 0.93;
    post.imageProcessing.contrast = 1.05;
    post.vignetteEnabled = false;
    post.grainEnabled = false;

    const ring = new TargetRing(scene);

    /* 电影化镜头状态（技能系统写入，Core 只叠加不累积） */
    const cinematic = { focus: null, intensity: 0, shake: 0, shakeEnabled: false };
    let camShakeY = 0;

    /* 环境粒子：少量门前微光与暖金浮尘，给战斗特效留出亮度余量。 */
    const wispEmitter = new FX.Emitter(FX.layers.glow, {
      life: [2.2, 4.2], size0: [0.12, 0.28], size1: [0.02, 0.07], alpha: [0.06, 0.16],
      color: [0.52, 0.78, 0.62], drag: 0.25, turb: 0.8, envType: 1,
    });
    const moteEmitter = new FX.Emitter(FX.layers.glow, {
      life: [2.6, 4.6], size0: [0.05, 0.12], size1: [0.01, 0.04], alpha: [0.06, 0.14],
      color: [0.95, 0.82, 0.52], drag: 0.2, turb: 0.5, envType: 1,
    });

    const game = {
      engine, scene, camera, post, mage, ground, ring, hemi, moon,
      cinematic, gate: { node: gate, glow: gateGlow, light: gateLight },
      time: 0,
      frameDt: 0,
      paused: false,
      _gateBase: [0.52, 0.78, 0.62],
      /* 初始/动态主题共用：天空与雾同色；ground/moon 始终取自 THEMES[].theme。 */
      applyTheme(theme) {
        if (!theme) return;
        const fogC = C3.FromHexString(theme.fog);
        scene.fogColor.copyFrom(fogC);
        scene.clearColor.set(fogC.r, fogC.g, fogC.b, 1);
        scene.fogDensity = theme.fogDensity;
        const groundC = C3.FromHexString(theme.ground);
        const groundTint = coloredGrass ? C3.Lerp(C3.White(), groundC, 0.14) : groundC;
        gmat.diffuseColor.copyFrom(groundTint);
        groundTint.scaleToRef(0.025, gmat.emissiveColor);
        const gateC = C3.FromHexString(theme.gate);
        game._gateBase = [gateC.r, gateC.g, gateC.b];
        gateLight.diffuse.copyFrom(gateC);
        matNecro.diffuseColor.copyFrom(gateC);
        gateC.scaleToRef(0.16, matNecro.emissiveColor);
        gateGlow._spriteMat.setColor4('uColor', new C4(gateC.r, gateC.g, gateC.b, 0.12));
        moon.diffuse.copyFrom(C3.FromHexString(theme.moon));
        wispEmitter.cfg.color = [gateC.r * 0.9, gateC.g * 0.9, gateC.b * 0.9];
      },
    };
    game.applyTheme(initialTheme);

    game.update = function (dt) {
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      game.time += dt;
      FX.time = game.time;
    };

    /* —— 姿态/镜头/装饰：在实体与粒子更新之后、渲染之前执行 —— */
    const sTarget = new V3();
    game.lateUpdate = function (dt) {
      if (!Number.isFinite(dt) || dt < 0) dt = 0;

      /* 相机目标静置在战场中部；震屏与冲击只做叠加不累积 */
      const cine = game.cinematic;
      sTarget.set(0, 1.5, -2);
      if (!cine.shakeEnabled) cine.shake = 0;
      if (cine.shake > 0.001) {
        const s = cine.shake * 0.32;
        sTarget.x += (Math.random() * 2 - 1) * s;
        sTarget.z += (Math.random() * 2 - 1) * s;
        camShakeY = (Math.random() * 2 - 1) * s * 0.6;
      } else {
        camShakeY *= Math.exp(-dt * 8);
      }
      sTarget.y += camShakeY;
      camera.target.copyFrom(sTarget);
      cine.shake *= Math.exp(-dt * 7);
      cine.intensity *= Math.exp(-dt * 3);

      mage.update(dt, game.time, false);

      /* 亡灵之门脉动与幽火 */
      const pulse = 0.9 + Math.sin(game.time * 1.4) * 0.1 + Math.sin(game.time * 4.1) * 0.04;
      gateLight.intensity = 0.28 * pulse;
      gateGlow.rotation.z += dt * 0.22;
      const gb = game._gateBase;
      gateGlow._spriteMat.setColor4('uColor', new C4(gb[0], gb[1], gb[2], 0.12 + (pulse - 0.9) * 0.12));
      runeDisc.rotation.z += dt * 0.05;
      for (const f of floaters) {
        f.mesh.position.y = f.baseY + Math.sin(game.time * 0.8 + f.phase) * 0.3;
        f.mesh.rotation.y += dt * f.spin;
      }
      wispEmitter.stream(dt * 3, Math.sin(game.time * 0.4) * 6, 1.2 + Math.sin(game.time * 0.9) * 0.5, FIELD.spawnZ + 1, () => ({
        x: FX.randSpread(3.2), y: FX.rand(0.4, 1.3), z: -FX.rand(0.4, 1.8),
      }));
      moteEmitter.stream(dt * 2, FX.randSpread(FIELD.rallySpreadX + 2), 0.4, FIELD.heroZ + FX.randSpread(9), () => ({
        x: FX.randSpread(0.16), y: FX.rand(0.10, 0.28), z: FX.randSpread(0.16),
      }));

      const halfH = engine.getRenderHeight() * 0.5;
      FX.setPointScale(halfH / Math.max(0.2, Math.tan(camera.fov * 0.5)));
    };

    game.render = function () {
      const realDt = Math.min(engine.getDeltaTime() / 1000, 0.05);
      game.fpsEma = (game.fpsEma || 60) * 0.96 + (realDt > 1e-5 ? 1 / realDt : 60) * 0.04;
      game._resTimer = (game._resTimer || 0) + realDt;
      if (game._resTimer >= 1) {
        game._resTimer = 0;
        if (game.fpsEma < 45 && hwLevel < hwMax) {
          hwLevel = Math.min(hwMax, hwLevel + 0.18);
          engine.setHardwareScalingLevel(hwLevel);
        } else if (game.fpsEma > 57 && hwLevel > hwBest) {
          hwLevel = Math.max(hwBest, hwLevel - 0.12);
          engine.setHardwareScalingLevel(hwLevel);
        }
      }
      scene.render();
    };

    /* —— 统一销毁：渲染循环/监听/法术/场景/引擎，幂等 —— */
    const onWindowResize = () => engine.resize();
    window.addEventListener('resize', onWindowResize);
    let disposed = false;
    game.dispose = function () {
      if (disposed) return;
      disposed = true;
      engine.stopRenderLoop();
      if (game.__watchdog) { clearInterval(game.__watchdog); game.__watchdog = null; }
      if (global.SPELLS) SPELLS.abortAll();
      if (global.Units) Units.clear();
      window.removeEventListener('resize', onWindowResize);
      scene.dispose();
      engine.dispose();
    };

    return game;
  }

  global.Core = { createGame, Mage, TargetRing, V3, C3, C4 };
})(window);
