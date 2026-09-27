/* ============================================================================
   core.js — 场景基座 v2
   黑曜石奥术试炼场 + 可动战斗法师(分节手臂/披风/悬浮水晶/姿态混合)
   ACES tone mapping + UnrealBloom(DefaultRenderingPipeline.bloom)
   等级契约: params.skills[id] = { color,count,speed,size,period, level, tiers:{1..5} }
   ========================================================================== */
(function (global) {
  'use strict';
  const V3 = BABYLON.Vector3;
  const C3 = BABYLON.Color3;
  const C4 = BABYLON.Color4;

  /* ------------------------------ 参数注册表 ------------------------------ */
  function mkTiers() {
    /* 每级独立倍率对象(UI 编辑 tiers[当前等级], 切级互不影响) */
    return {
      1: { count: 1, size: 1, speed: 1, period: 1 },
      2: { count: 1, size: 1, speed: 1, period: 1 },
      3: { count: 1, size: 1, speed: 1, period: 1 },
      4: { count: 1, size: 1, speed: 1, period: 1 },
      5: { count: 1, size: 1, speed: 1, period: 1 },
    };
  }
  function defaultParams() {
    return {
      global: {
        fogDensity: 0.011,
        fogColor: '#16233a',
        exposure: 1.12,
        contrast: 1.08,
        ambient: 0.42,
      },
      aim: {
        enabled: true,
        radius: 1.0,
        colorOk: '#4dff9a',
        colorBad: '#ff5f5f',
        opacity: 0.95,
        spin: 0.55,
      },
      env: {
        groundColor: '#6b7787',
        groundSpec: 0.1,
        noiseScale: 26,
        moon: 0.5,
        moonColor: '#9fc4ff',
      },
      post: {
        bloom: true,
        threshold: 0.85,
        weight: 0.9,
        kernel: 64,
        vignette: 1.35,
        grain: 7,
        fxaa: true,
      },
      camera: {
        distance: 19.5,
        beta: 0.80,
        fov: 0.74,
        smooth: 0.12,
      },
      skills: {
        1: { color: '#79d2ff', count: 1, speed: 1, size: 1, period: 1, level: 3, tiers: mkTiers() },
        2: { color: '#c9a6ff', count: 1, speed: 1, size: 1, period: 1, level: 3, tiers: mkTiers() },
        3: { color: '#ff9440', count: 1, speed: 1, size: 1, period: 1, level: 5, tiers: mkTiers() },
        4: { color: '#8fe0ff', count: 1, speed: 1, size: 1, period: 1, level: 3, tiers: mkTiers() },
        5: { color: '#7b6bff', count: 1, speed: 1, size: 1, period: 1, level: 3, tiers: mkTiers() },
        6: { color: '#7ff0e6', count: 1, speed: 1, size: 1, period: 1, level: 3, tiers: mkTiers() },
        7: { color: '#86ffd0', count: 1, speed: 1, size: 1, period: 1, level: 3, tiers: mkTiers() },
        8: { color: '#e0a86a', count: 1, speed: 1, size: 1, period: 1, level: 3, tiers: mkTiers() },
        9: { color: '#ffcf6b', count: 1, speed: 1, size: 1, period: 1, level: 3, tiers: mkTiers() },
      },
    };
  }

  /* ------------------------------ 施法者 ------------------------------ */
  const P = (n) => Math.PI * n;
  class Mage {
    constructor(scene) {
      const root = new BABYLON.TransformNode('mage', scene);
      const visual = new BABYLON.TransformNode('mageVisual', scene);
      visual.parent = root;
      this.root = root; this.visual = visual;
      this.scene = scene;

      const matArmor = new BABYLON.StandardMaterial('matArmor', scene);
      matArmor.diffuseColor = new C3(0.13, 0.15, 0.21);
      matArmor.specularColor = new C3(0.35, 0.38, 0.46);
      matArmor.specularPower = 42;

      const matCloth = new BABYLON.StandardMaterial('matCloth', scene);
      matCloth.diffuseColor = new C3(0.16, 0.185, 0.26);
      matCloth.specularColor = new C3(0.05, 0.055, 0.08);

      const matGold = new BABYLON.StandardMaterial('matGold', scene);
      matGold.diffuseColor = new C3(0.45, 0.34, 0.16);
      matGold.specularColor = new C3(0.7, 0.6, 0.35);
      matGold.specularPower = 64;
      matGold.emissiveColor = new C3(0.09, 0.06, 0.02);

      const matTrim = new BABYLON.StandardMaterial('matTrim', scene);
      matTrim.diffuseColor = new C3(0, 0, 0);
      matTrim.emissiveColor = new C3(0.10, 0.55, 0.95);
      matTrim.specularColor = new C3(0, 0, 0);
      this.matTrim = matTrim;

      /* 躯干 + 长袍 + 纹章 */
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

      /* 头 + 兜帽 + 发光面罩 */
      const head = BABYLON.MeshBuilder.CreateSphere('head', { diameter: 0.46, segments: 14 }, scene);
      head.position.y = 2.20; head.material = matArmor; head.parent = visual;
      const hood = BABYLON.MeshBuilder.CreateSphere('hood', { diameter: 0.74, segments: 14, slice: 0.60 }, scene);
      hood.position.set(0, 2.28, -0.10); hood.rotation.x = -0.32; hood.material = matCloth; hood.parent = visual;
      const hoodTip = BABYLON.MeshBuilder.CreateCylinder('hoodTip', { height: 0.34, diameterTop: 0, diameterBottom: 0.22, tessellation: 10 }, scene);
      hoodTip.position.set(0, 2.62, -0.22); hoodTip.rotation.x = -0.5; hoodTip.material = matCloth; hoodTip.parent = visual;
      const visor = BABYLON.MeshBuilder.CreateBox('visor', { width: 0.26, height: 0.06, depth: 0.05 }, scene);
      visor.position.set(0, 2.20, 0.22); visor.material = matTrim; visor.parent = visual;

      /* 肩甲(双层) */
      const shoulderM = [], spikeM = [];
      for (const s of [-1, 1]) {
        const sh = BABYLON.MeshBuilder.CreateSphere('shoulder', { diameter: 0.46, segments: 12, slice: 0.5 }, scene);
        sh.position.set(s * 0.52, 1.88, 0); sh.rotation.z = s * 0.5; sh.material = matArmor; sh.parent = visual;
        shoulderM.push(sh);
        const spike = BABYLON.MeshBuilder.CreateCylinder('shSpike', { height: 0.26, diameterTop: 0, diameterBottom: 0.12, tessellation: 8 }, scene);
        spike.position.set(s * 0.56, 2.06, 0); spike.rotation.z = s * 0.62; spike.material = matGold; spike.parent = visual;
        spikeM.push(spike);
      }

      /* 静态躯干按材质合并(绘制调用 -10);动画部件(手臂/腿/披风/浮晶)保持独立 */
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

      /* 腿(走路摆动,藏于袍内若隐若现) */
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

      /* 手臂链:肩枢 → 肘枢 → 手 */
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

      /* 法杖(挂在右手,顶端悬浮晶体) */
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

      /* 披风:4 节链式摆动 */
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

      /* 悬浮水晶(高等级/施法时浮现) */
      this.crystals = [];
      for (let i = 0; i < 3; i++) {
        const c = BABYLON.MeshBuilder.CreatePolyhedron('crystal' + i, { type: 1, size: 0.09 }, scene);
        c.material = matTrim; c.parent = visual; c.setEnabled(false);
        this.crystals.push(c);
      }

      /* 施法者自身的微光 */
      const pl = new BABYLON.PointLight('mageLight', new V3(0, 2.6, 0.6), scene);
      pl.intensity = 0.95; pl.range = 24;
      pl.diffuse = new C3(0.42, 0.58, 1.0);
      pl.parent = root;
      this.light = pl;

      /* 运行时状态 */
      this.castAmount = 0;
      this.walkPhase = 0;
      this.facing = Math.PI - 0.55;
      this.targetFacing = this.facing;
      this.yOffset = 0;
      this.speedLean = 0;
      this.spell = { phase: 'idle', progress: 0, level: 3, color: '#79d2ff', skillId: 0, lastCall: -9 };
      this.poseCur = { armRx: 0.12, armRz: 0.14, elbowR: 0.35, armLx: 0.10, armLz: -0.14, elbowL: 0.3, torso: 0, hover: 0, spread: 0 };
      this.tintCur = new C3(0.10, 0.55, 0.95);
    }

    worldHand(out) {
      this.handR.computeWorldMatrix(true);
      const p = this.handR.getAbsolutePosition();
      if (out) return out.copyFrom(p);
      return p.clone();
    }

    setCast(k) { this.castAmount = k; }

    /* 技能驱动姿态:phase windup/release/travel/impact/aftermath/idle */
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

    /* 各阶段目标姿态(弧度) */
    _poseTarget() {
      const sp = this.spell;
      const k = Math.min(1, sp.progress);
      const cast = Math.max(this.castAmount, sp.phase === 'idle' ? 0 : k);
      const t = { armRx: 0.12, armRz: 0.14, elbowR: 0.35, armLx: 0.10, armLz: -0.14, elbowL: 0.30, torso: 0, hover: 0, spread: 0 };
      if (cast > 0.01 && sp.phase === 'idle') {
        /* 兼容旧 setCast 路径 */
        t.armRx = 0.12 + (-1.98 - 0.12) * cast; t.armRz = 0.14 + cast * 0.28; t.elbowR = 0.35 - cast * 0.2;
        t.armLx = 0.10 + (-0.75 - 0.10) * cast * 0.85; t.armLz = -0.14 - cast * 0.22;
        t.torso = cast * 0.06;
      }
      const ph = sp.phase;
      if (ph === 'windup') {
        const raise = -2.35 - k * 0.25;
        t.armRx = 0.12 + (raise - 0.12) * k; t.armRz = 0.14 + k * 0.34; t.elbowR = 0.35 - k * 0.28;
        t.armLx = 0.10 + (-1.15 - 0.10) * k * (sp.level >= 4 ? 1 : 0.8); t.armLz = -0.14 - k * 0.3;
        t.elbowL = 0.30 - k * 0.22; t.torso = -k * 0.10;
        if (sp.level >= 4) { t.hover = k * 0.55 * (sp.level >= 5 ? 1.4 : 1); t.spread = k * 0.5; }
      } else if (ph === 'release') {
        t.armRx = -1.15; t.armRz = 0.30; t.elbowR = 0.06; t.armLx = -0.55; t.armLz = -0.24; t.torso = 0.14;
        if (sp.level >= 4) t.hover = 0.35;
      } else if (ph === 'travel') {
        t.armRx = -1.45; t.armRz = 0.26; t.elbowR = 0.16; t.armLx = -0.6; t.armLz = -0.2; t.torso = 0.08;
        if (sp.level >= 4) t.hover = 0.3;
      } else if (ph === 'impact') {
        t.armRx = -0.55; t.armRz = 0.10; t.elbowR = 0.5; t.armLx = -0.2; t.armLz = -0.1; t.torso = 0.22;
      } else if (ph === 'aftermath') {
        t.armRx = -0.1; t.armRz = 0.14; t.elbowR = 0.4; t.torso = 0.05;
      }
      return t;
    }

    update(dt, time, moving) {
      const sp = this.spell;
      /* 超时未驱动则回待机 */
      if (sp.phase !== 'idle' && FX.time - sp.lastCall > 0.28) { sp.phase = 'idle'; sp.progress = 0; }

      /* 姿态平滑混合 */
      const t = this._poseTarget();
      const cur = this.poseCur;
      const blend = 1 - Math.exp(-dt * 9);
      for (const key in t) cur[key] += (t[key] - cur[key]) * blend;

      this.armR.rotation.x = cur.armRx; this.armR.rotation.z = cur.armRz;
      this.arms[0].elbow.rotation.x = cur.elbowR;
      this.armL.rotation.x = cur.armLx; this.armL.rotation.z = cur.armLz;
      this.arms[1].elbow.rotation.x = cur.elbowL;
      this.arms[0].shoulder.rotation.y = -cur.spread * 0.5;
      this.arms[1].shoulder.rotation.y = cur.spread * 0.5;
      this.visual.rotation.x = cur.torso;

      /* 走路:腿摆 + 前倾 + 手臂反摆(未施法时) */
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

      /* 披风摆动(移速越快越飘) */
      for (let i = 0; i < this.cape.length; i++) {
        const seg = this.cape[i];
        seg.rotation.x = 0.18 + Math.sin(time * 2.6 - i * 0.85) * 0.05
          + this.speedLean * (0.28 + i * 0.1) + Math.sin(this.walkPhase - i * 0.7) * 0.06 * this.speedLean;
        seg.rotation.z = Math.sin(time * 1.7 - i * 0.6) * 0.03;
      }

      /* 待机呼吸 / 走路起伏 + 位移腾空(yOffset) + 高等级悬浮 */
      const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.07 : Math.sin(time * 1.7) * 0.028;
      this.visual.position.y = bob + (this.yOffset || 0) + cur.hover + Math.sin(time * 2.1) * cur.hover * 0.18;
      this.root.rotation.z = moving ? Math.sin(this.walkPhase) * 0.02 : Math.sin(time * 1.1) * 0.012;

      /* 朝向平滑 */
      let diff = this.targetFacing - this.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.facing += diff * Math.min(1, dt * 11);
      this.root.rotation.y = this.facing;

      /* 技能色染色:纹路面罩/宝石/袍边 */
      const [r, g, b] = FX.hexToRgb(sp.color);
      const tc = this.tintCur;
      tc.r += (r - tc.r) * blend; tc.g += (g - tc.g) * blend; tc.b += (b - tc.b) * blend;
      this.matTrim.emissiveColor.copyFrom(tc);

      /* 法杖晶体脉冲 + 悬浮水晶 */
      const charge = Math.max(this.castAmount, sp.phase === 'windup' ? sp.progress : 0);
      const pulse = 0.9 + Math.sin(time * 2.3) * 0.1 + charge * 0.6;
      this.gem.scaling.setAll(pulse);
      this.brooch.rotation.y += dt * 1.2;
      const showCrystals = sp.level >= 4 && sp.phase !== 'idle';
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

      /* 随身微光随施法增亮 */
      this.light.diffuse.copyFrom(tc);
      this.light.intensity = 0.95 + charge * 1.1 + cur.hover * 0.5;
    }

    dispose() {
      this.root.getChildMeshes().forEach(m => m.dispose());
      this.visual.dispose();
      this.root.dispose();
    }
  }

  /* ------------------------------ 地面落点圈 ------------------------------ */
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
    update(dt, pos, inRange, radius, params) {
      if (!this.visible) return;
      this.spin += dt * params.spin * (inRange ? 1 : -1.6);
      this.ring.rotation.z = this.spin;
      this.disc.rotation.z = -this.spin * 0.35;
      this.ring.position.x = pos.x; this.ring.position.z = pos.z;
      this.disc.position.x = pos.x; this.disc.position.z = pos.z;
      /* 平面旋转平铺后可见轴是本地 X/Y(修复旧版误设 Z) */
      const s = radius * 2 * params.radius;
      this.ring.scaling.x = this.ring.scaling.y = s;
      this.disc.scaling.x = this.disc.scaling.y = s * 0.86;
      const col = inRange ? params.colorOk : params.colorBad;
      const [r, g, b] = FX.hexToRgb(col);
      const pulse = 0.82 + Math.sin(FX.time * 6) * 0.12;
      this.ring._spriteMat.setColor4('uColor', new C4(r * 1.6, g * 1.6, b * 1.6, params.opacity * pulse));
      this.disc._spriteMat.setColor4('uColor', new C4(r, g, b, params.opacity * 0.32));
    }
  }

  /* ------------------------------ 场景创建 ------------------------------ */
  function createGame(canvas) {
    const engine = new BABYLON.Engine(canvas, true, {
      /* preserveDrawingBuffer 会迫使合成器每帧拷贝后备缓冲,默认关闭;
         需要截图/像素探针时用 ?probe 打开 */
      preserveDrawingBuffer: /[?&]probe\b/.test(location.search),
      stencil: true,
      adaptToDeviceRatio: true,
    }, true);
    const hwBest = 1 / Math.min(window.devicePixelRatio || 1, 1.6);
    let hwLevel = hwBest;
    const hwMax = Math.max(hwBest, 1.15);
    engine.setHardwareScalingLevel(hwLevel);

    const scene = new BABYLON.Scene(engine);
    scene.clearColor = new C4(0.014, 0.022, 0.042, 1);
    scene.ambientColor = new C3(0.06, 0.08, 0.13);

    const params = defaultParams();
    FX.init(scene);

    scene.fogMode = BABYLON.Scene.FOGMODE_EXP2;
    scene.fogDensity = params.global.fogDensity;
    scene.fogColor = C3.FromHexString(params.global.fogColor);

    const hemi = new BABYLON.HemisphericLight('hemi', new V3(0.15, 1, -0.12), scene);
    hemi.intensity = params.global.ambient;
    hemi.diffuse = new C3(0.42, 0.52, 0.82);
    hemi.groundColor = new C3(0.03, 0.04, 0.07);

    const moon = new BABYLON.DirectionalLight('moon', new V3(-0.42, -1, 0.34), scene);
    moon.intensity = params.env.moon;
    moon.diffuse = C3.FromHexString(params.env.moonColor);

    /* 大地面(可拾取) */
    const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 240, height: 240, subdivisions: 2 }, scene);
    const gmat = new BABYLON.StandardMaterial('matGround', scene);
    const gnoise = FX.textures.groundNoise;
    gnoise.uScale = gnoise.vScale = params.env.noiseScale;
    gmat.diffuseTexture = gnoise;
    gmat.specularColor = new C3(params.env.groundSpec, params.env.groundSpec, params.env.groundSpec * 1.25);
    gmat.specularPower = 8;
    gmat.diffuseColor = C3.FromHexString(params.env.groundColor);
    gmat.emissiveColor = new C3(0.010, 0.015, 0.027);
    ground.material = gmat;
    ground.isPickable = true;

    /* —— 奥术试炼场:中央石台 + 符环 + 断柱 + 悬浮石 —— */
    const matStone = new BABYLON.StandardMaterial('matStone', scene);
    matStone.diffuseColor = new C3(0.10, 0.115, 0.16);
    matStone.specularColor = new C3(0.18, 0.2, 0.26);
    matStone.specularPower = 26;
    const matRune = new BABYLON.StandardMaterial('matRune', scene);
    matRune.diffuseColor = new C3(0, 0, 0);
    matRune.emissiveColor = new C3(0.10, 0.42, 0.72);
    matRune.specularColor = new C3(0, 0, 0);

    const platform = BABYLON.MeshBuilder.CreateCylinder('platform', { diameter: 13, height: 0.12, tessellation: 48 }, scene);
    platform.position.y = -0.075; platform.material = matStone;
    const rim = BABYLON.MeshBuilder.CreateTorus('rim', { diameter: 13, thickness: 0.09, tessellation: 64 }, scene);
    rim.position.y = 0.13; rim.material = matRune;
    const inner = BABYLON.MeshBuilder.CreateTorus('inner', { diameter: 8.4, thickness: 0.05, tessellation: 48 }, scene);
    inner.position.y = 0.13; inner.scaling.y = 1.6; inner.material = matRune;

    /* 符纹光盘(粒子库若提供 rune 贴图) */
    let runeDisc = null;
    if (FX.textures.rune) {
      runeDisc = FX.makeSprite(scene, 'arenaRune', FX.textures.rune, 'add', new C4(0.35, 0.75, 1, 0.34));
      runeDisc.rotation.x = Math.PI / 2;
      runeDisc.position.y = 0.135;
      runeDisc.scaling.set(11.6, 11.6, 1);
    }

    const pillars = [];
    const bandMeshes = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.22;
      const r = 17 + (i % 3) * 1.9;
      const h = 2.6 + ((i * 37) % 10) * 0.34;
      const col = BABYLON.MeshBuilder.CreateCylinder('pillar' + i, { diameterTop: 0.8, diameterBottom: 1.15, height: h, tessellation: 10 }, scene);
      col.position.set(Math.cos(a) * r, h / 2 - 0.1, Math.sin(a) * r);
      col.rotation.z = (((i * 53) % 10) / 10 - 0.5) * 0.16;
      col.rotation.x = (((i * 29) % 10) / 10 - 0.5) * 0.12;
      col.material = matStone;
      const band = BABYLON.MeshBuilder.CreateTorus('pillarBand' + i, { diameter: 1.02, thickness: 0.05, tessellation: 16 }, scene);
      band.position.set(col.position.x, h * 0.62, col.position.z);
      band.rotation.x = Math.PI / 2; band.material = matRune;
      pillars.push(col); bandMeshes.push(band);
    }
    /* 静态装饰按材质合并:石质 11→1、符文 12→1(绘制调用 -21) */
    {
      const mergeAt = (list) => {
        for (const m of list) m.bakeCurrentTransformIntoVertices();
        const merged = BABYLON.Mesh.MergeMeshes(list, true, true);
        merged.isPickable = false;
        return merged;
      };
      mergeAt([platform, ...pillars]);
      mergeAt([rim, inner, ...bandMeshes]);
    }

    const floaters = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.9;
      const r = 10.5 + (i % 3) * 2.2;
      const rock = BABYLON.MeshBuilder.CreatePolyhedron('floater' + i, { type: 3, size: 0.28 + (i % 3) * 0.14 }, scene);
      rock.position.set(Math.cos(a) * r, 2.4 + (i % 4) * 0.8, Math.sin(a) * r);
      rock.material = matStone;
      floaters.push({ mesh: rock, baseY: rock.position.y, phase: i * 1.7, spin: 0.2 + (i % 3) * 0.1 });
    }

    const mage = new Mage(scene);

    /* 相机:第三人称 45° 俯视跟随,略带侧角 */
    const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2 + 0.34, params.camera.beta, params.camera.distance, new V3(0, 1.4, 0), scene);
    camera.lowerRadiusLimit = 9;
    camera.upperRadiusLimit = 80;
    camera.lowerBetaLimit = 0.30;
    camera.upperBetaLimit = 1.28;
    camera.fov = params.camera.fov;
    camera.minZ = 0.4;
    camera.maxZ = 300;
    camera.panningSensibility = 0;
    camera.wheelDeltaPercentage = 0.021;
    camera.viewport = new BABYLON.Viewport(0, 0.19, 1, 0.81);
    camera.attachControl(canvas, true);
    if (camera.inputs && camera.inputs.attached && camera.inputs.attached.pointers) {
      camera.inputs.attached.pointers.buttons = [2];
    }

    /* ACES + UnrealBloom */
    const post = new BABYLON.DefaultRenderingPipeline('post', true, scene, [camera]);
    post.fxaaEnabled = params.post.fxaa;
    post.bloomEnabled = params.post.bloom;
    post.bloomThreshold = params.post.threshold;
    post.bloomWeight = params.post.weight;
    post.bloomKernel = params.post.kernel;
    post.bloomScale = 0.5;
    post.imageProcessingEnabled = true;
    post.imageProcessing.toneMappingEnabled = true;
    post.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
    post.imageProcessing.exposure = params.global.exposure;
    post.imageProcessing.contrast = params.global.contrast;
    post.vignetteEnabled = true;
    post.vignetteWeight = params.post.vignette;
    post.grainEnabled = params.post.grain > 0;
    post.grain.intensity = params.post.grain;

    const ring = new TargetRing(scene);

    /* 电影化镜头状态(技能系统写入,Core 只叠加不累积) */
    const cinematic = { focus: null, intensity: 0, shake: 0 };

    let cinematicRadius = 0;
    const game = {
      engine, scene, camera, post, mage, ground, ring, params, hemi, moon,
      cinematic,
      time: 0,
      frameDt: 0,
      moveInput: { x: 0, z: 0 },
      applyGlobal() {
        scene.fogDensity = params.global.fogDensity;
        scene.fogColor = C3.FromHexString(params.global.fogColor);
        post.imageProcessing.exposure = params.global.exposure;
        post.imageProcessing.contrast = params.global.contrast;
        hemi.intensity = params.global.ambient;
      },
      applyAim() { },
      applyEnv() {
        gmat.diffuseColor = C3.FromHexString(params.env.groundColor);
        gmat.specularColor = new C3(params.env.groundSpec, params.env.groundSpec, params.env.groundSpec * 1.25);
        gnoise.uScale = gnoise.vScale = params.env.noiseScale;
        moon.intensity = params.env.moon;
        moon.diffuse = C3.FromHexString(params.env.moonColor);
      },
      applyPost() {
        post.bloomEnabled = params.post.bloom;
        post.bloomThreshold = params.post.threshold;
        post.bloomWeight = params.post.weight;
        post.bloomKernel = params.post.kernel;
        post.fxaaEnabled = params.post.fxaa;
        post.vignetteWeight = params.post.vignette;
        post.grainEnabled = params.post.grain > 0;
        post.grain.intensity = params.post.grain;
      },
      applyCamera() {
        camera.fov = params.camera.fov;
        camera.radius = params.camera.distance;
        cinematicRadius = 0;
        camera.beta = params.camera.beta;
      },
    };

    /* 每帧:相机跟随 + 电影化叠加 + 悬浮石 + 粒子点尺寸 */
    let camPos = camera.target.clone();
    /* 逐帧复用的临时向量:相机/移动热路径零分配,避免每帧 GC 压力 */
    const sFwd = new V3(), sRight = new V3(), sDir = new V3(), sTmp = new V3(), sBase = new V3(), sTarget = new V3();
    let fpsEma = 60, resTimer = 0;
    scene.onBeforeRenderObservable.add(() => {
      const dt = Number.isFinite(game.frameDt) ? game.frameDt : Math.min(engine.getDeltaTime() / 1000, 0.05);
      game.time += dt;
      FX.time = game.time;

      /* 动态分辨率:仅在持续低于 45fps 时降低渲染比例兜底,恢复后逐步回升。
         本机不触发;UI 是 DOM 层不受影响,探针场景(dt 固定)也不会误触发。 */
      fpsEma = fpsEma * 0.96 + (dt > 1e-5 ? 1 / dt : 60) * 0.04;
      resTimer += dt;
      if (resTimer >= 1) {
        resTimer = 0;
        if (fpsEma < 45 && hwLevel < hwMax) {
          hwLevel = Math.min(hwMax, hwLevel + 0.18);
          engine.setHardwareScalingLevel(hwLevel);
        } else if (fpsEma > 57 && hwLevel > hwBest) {
          hwLevel = Math.max(hwBest, hwLevel - 0.12);
          engine.setHardwareScalingLevel(hwLevel);
        }
      }

      const mv = game.moveInput;
      const len = Math.hypot(mv.x, mv.z);
      let moving = false;
      if (len > 0.001) {
        camera.getDirectionToRef(V3.Forward(), sFwd); sFwd.y = 0;
        camera.getDirectionToRef(V3.Right(), sRight); sRight.y = 0;
        sFwd.normalize(); sRight.normalize();
        sFwd.scaleToRef(mv.z, sDir);
        sRight.scaleToRef(mv.x, sTmp);
        sDir.addInPlace(sTmp);
        sDir.y = 0;
        if (sDir.lengthSquared() > 0.00001) {
          sDir.normalize();
          const speed = 7.2;
          mage.root.position.x += sDir.x * speed * dt;
          mage.root.position.z += sDir.z * speed * dt;
          mage.faceTo(sDir.x, sDir.z);
          moving = true;
        }
      }

      /* 基础跟随:角色略偏后,让前方落点进入画面 */
      const fx = Math.sin(mage.facing), fz = Math.cos(mage.facing);
      sBase.set(mage.root.position.x + fx * 2.1, 1.5 + mage.visual.position.y * 0.4, mage.root.position.z + fz * 2.1);
      const t = 1 - Math.pow(1 - params.camera.smooth, dt * 60);
      V3.LerpToRef(camPos, sBase, Math.min(1, t), camPos);

      /* 电影化叠加(每帧从 base 重算,不累积漂移) */
      const cine = game.cinematic;
      sTarget.copyFrom(camPos);
      let fovOff = 0;
      if (cine.focus && cine.intensity > 0.001) {
        const k = Math.min(0.42, cine.intensity * 0.42);
        sTarget.x += (cine.focus.x - sTarget.x) * k;
        sTarget.z += (cine.focus.z - sTarget.z) * k;
        sTarget.y += (Math.max(1, cine.focus.y) - sTarget.y) * k * 0.5 + cine.intensity * 5.3;
        fovOff = cine.intensity * 0.12;
      }
      if (cine.shake > 0.001) {
        const s = cine.shake * 0.32;
        sTarget.x += (Math.random() * 2 - 1) * s;
        sTarget.z += (Math.random() * 2 - 1) * s;
        sTarget.y += (Math.random() * 2 - 1) * s * 0.6;
      }
      const userRadius = Math.max(9, Math.min(46, camera.radius - cinematicRadius));
      cinematicRadius += (cine.intensity * 12.5 - cinematicRadius) * Math.min(1, dt * 5);
      camera.radius = userRadius + cinematicRadius;
      camera.target.copyFrom(sTarget);
      camera.fov = params.camera.fov + fovOff;

      mage.update(dt, game.time, moving);

      for (const f of floaters) {
        f.mesh.position.y = f.baseY + Math.sin(game.time * 0.8 + f.phase) * 0.3;
        f.mesh.rotation.y += dt * f.spin;
      }
      if (runeDisc) runeDisc.rotation.z += dt * 0.06;

      const halfH = engine.getRenderHeight() * 0.5;
      FX.setPointScale(halfH / Math.max(0.2, Math.tan(camera.fov * 0.5)));
    });

    window.addEventListener('resize', () => engine.resize());

    return game;
  }

  global.Core = { createGame, Mage, TargetRing, defaultParams, V3, C3, C4 };
})(window);
