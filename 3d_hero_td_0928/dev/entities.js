/* ============================================================================
   entities.js — 死灵防线 3D · 单位实体系统
   · ResourceOwner：显式资源归属（节点/材质/发射器登记后统一回收，共享材质绝不误删）
   · Unit 基类：血量/减速/攻击节拍/程序化行走与挥击动画/头顶血条
   · Enemy：向防线推进，遇盟友或英雄进入交战；死亡掉金
   · Ally：占驻集结槽位，近战拦截 / 远程放箭
   · Projectile：共享池化的追踪弹（英雄魔弹 / 猎手箭矢）
   · 逐实例异常隔离：单个单位故障只回收自身，不拖垮整帧
   ========================================================================== */
(function (global) {
  'use strict';
  const V3 = BABYLON.Vector3;
  const C3 = BABYLON.Color3;
  const C4 = BABYLON.Color4;
  const { clamp, lerp, rand, randSpread } = FX;
  const FIELD = CONFIG.FIELD;
  let uid = 0;
  const nid = (name) => name + '_' + (++uid);

  /* ------------------------------ 资源归属 ------------------------------ */
  class ResourceOwner {
    constructor(scene) {
      this.scene = scene;
      this.nodes = [];
      this.materials = new Set();
      this.emitters = [];
      this.disposed = false;
    }
    own(node, parent) {
      this.nodes.push(node);
      if ('isPickable' in node) node.isPickable = false;
      if (parent) node.parent = parent;
      if (node.material) this.materials.add(node.material);
      return node;
    }
    group(name, parent) {
      const node = new BABYLON.TransformNode(nid(name), this.scene);
      return this.own(node, parent);
    }
    mesh(type, opts, mat, parent, name) {
      const mesh = BABYLON.MeshBuilder['Create' + type](nid(name || type), opts, this.scene);
      mesh.material = mat;
      return this.own(mesh, parent);
    }
    emitter(layer, cfg) {
      const e = new FX.Emitter(FX.layers[layer] || FX.layers.glow, cfg);
      this.emitters.push(e);
      return e;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (const e of this.emitters) { e.alive = false; e._acc = 0; }
      this.emitters.length = 0;
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (!node.isDisposed || !node.isDisposed()) node.dispose(true, false);
      }
      for (const mat of this.materials) mat.dispose(false, false);
      this.nodes.length = 0; this.materials.clear();
    }
  }

  /* ------------------------------ 共享材质缓存（按场景） ------------------------------ */
  const matCache = { scene: null, map: new Map() };
  function sharedMat(scene, name, build) {
    if (matCache.scene !== scene) { matCache.scene = scene; matCache.map.clear(); }
    if (!matCache.map.has(name)) matCache.map.set(name, build());
    return matCache.map.get(name);
  }
  const boneMat = (scene, hex) => sharedMat(scene, 'bone' + hex, () => {
    const m = new BABYLON.StandardMaterial(nid('boneMat'), scene);
    const c = C3.FromHexString(hex);
    m.diffuseColor = c.scale(0.85);
    m.specularColor = new C3(0.22, 0.24, 0.26);
    m.specularPower = 30;
    m.emissiveColor = c.scale(0.055);
    return m;
  });
  const eyeMat = (scene, hex) => sharedMat(scene, 'eye' + hex, () => {
    const m = new BABYLON.StandardMaterial(nid('eyeMat'), scene);
    m.diffuseColor = new C3(0, 0, 0);
    m.emissiveColor = C3.FromHexString(hex).scale(1.35);
    m.specularColor = new C3(0, 0, 0);
    m.disableLighting = true;
    return m;
  });
  const steelMat = (scene, hex) => sharedMat(scene, 'steel' + hex, () => {
    const m = new BABYLON.StandardMaterial(nid('steelMat'), scene);
    const c = C3.FromHexString(hex);
    m.diffuseColor = c.scale(0.8);
    m.specularColor = new C3(0.5, 0.55, 0.62);
    m.specularPower = 48;
    return m;
  });
  const trimMat = (scene, hex) => sharedMat(scene, 'trim' + hex, () => {
    const m = new BABYLON.StandardMaterial(nid('trimMat'), scene);
    m.diffuseColor = new C3(0, 0, 0);
    m.emissiveColor = C3.FromHexString(hex).scale(0.55);
    m.specularColor = new C3(0, 0, 0);
    return m;
  });

  function mergeParts(list, mat, scene, parent) {
    for (const m of list) m.bakeCurrentTransformIntoVertices();
    const merged = BABYLON.Mesh.MergeMeshes(list, true, true);
    merged.material = mat;
    merged.parent = parent;
    merged.isPickable = false;
    return merged;
  }

  /* ------------------------------ 亡灵机体 ------------------------------ */
  /* 返回 {root, visual, arm, height}；静态部件按材质合并，仅持武手臂独立动画 */
  function buildEnemyRig(scene, def) {
    const s = def.scale;
    const root = new BABYLON.TransformNode(nid('enemy'), scene);
    const visual = new BABYLON.TransformNode(nid('enemyVisual'), scene);
    visual.parent = root;
    visual.scaling.setAll(s);
    const bone = boneMat(scene, def.color);
    const eye = eyeMat(scene, def.eye);

    const parts = [], eyes = [];
    const spine = BABYLON.MeshBuilder.CreateCapsule(nid('spine'), { height: 0.92, radius: 0.21, tessellation: 10 }, scene);
    spine.position.y = 0.86; parts.push(spine);
    /* 肋骨阴影：三道细环 */
    for (let i = 0; i < 3; i++) {
      const rib = BABYLON.MeshBuilder.CreateTorus(nid('rib'), { diameter: 0.42 - i * 0.04, thickness: 0.035, tessellation: 12 }, scene);
      rib.position.y = 1.02 - i * 0.17; rib.scaling.z = 0.7; parts.push(rib);
    }
    const pelvis = BABYLON.MeshBuilder.CreateBox(nid('pelvis'), { width: 0.30, height: 0.16, depth: 0.20 }, scene);
    pelvis.position.y = 0.48; parts.push(pelvis);
    /* 腿并进静态体：行进靠整体颠步，省两个动态网格 */
    for (const lx of [-0.11, 0.11]) {
      const leg = BABYLON.MeshBuilder.CreateCapsule(nid('leg'), { height: 0.52, radius: 0.065, tessellation: 6 }, scene);
      leg.position.set(lx, 0.24, 0); parts.push(leg);
    }
    const skull = BABYLON.MeshBuilder.CreateSphere(nid('skull'), { diameter: 0.30, segments: 8 }, scene);
    skull.position.y = 1.46; skull.scaling.set(1, 1.12, 1.06); parts.push(skull);
    const jaw = BABYLON.MeshBuilder.CreateBox(nid('jaw'), { width: 0.18, height: 0.07, depth: 0.14 }, scene);
    jaw.position.set(0, 1.36, 0.05); parts.push(jaw);
    for (const ex of [-0.075, 0.075]) {
      const e = BABYLON.MeshBuilder.CreateBox(nid('eye'), { width: 0.05, height: 0.035, depth: 0.02 }, scene);
      e.position.set(ex, 1.49, 0.145); eyes.push(e);
    }
    /* 左臂弯举（静态） */
    const armL = BABYLON.MeshBuilder.CreateCapsule(nid('armL'), { height: 0.5, radius: 0.05, tessellation: 6 }, scene);
    armL.position.set(-0.26, 1.02, 0.08); armL.rotation.z = 0.7; parts.push(armL);

    if (def.key === 'shield') {
      const shield = BABYLON.MeshBuilder.CreateBox(nid('shield'), { width: 0.09, height: 0.72, depth: 0.55 }, scene);
      shield.position.set(-0.30, 0.92, 0.16); shield.rotation.x = 0.12; parts.push(shield);
      const boss = BABYLON.MeshBuilder.CreateSphere(nid('shieldBoss'), { diameter: 0.16, segments: 6 }, scene);
      boss.position.set(-0.34, 0.92, 0.16); parts.push(boss);
    }
    if (def.boss) {
      /* 领主：骨冠 + 双肩尖刺 + 战旗 */
      for (let i = 0; i < 5; i++) {
        const spike = BABYLON.MeshBuilder.CreateCylinder(nid('crown'), { height: 0.24, diameterTop: 0, diameterBottom: 0.05, tessellation: 5 }, scene);
        const a = (i / 5) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.11, 1.68, Math.sin(a) * 0.11);
        spike.rotation.z = -Math.cos(a) * 0.3; spike.rotation.x = Math.sin(a) * 0.3;
        parts.push(spike);
      }
      for (const sx of [-1, 1]) {
        const sp = BABYLON.MeshBuilder.CreateCylinder(nid('pauldron'), { height: 0.36, diameterBottom: 0.20, diameterTop: 0, tessellation: 6 }, scene);
        sp.position.set(sx * 0.36, 1.28, 0); sp.rotation.z = sx * 0.5; parts.push(sp);
      }
      const banner = BABYLON.MeshBuilder.CreateBox(nid('banner'), { width: 0.46, height: 0.6, depth: 0.02 }, scene);
      banner.position.set(-0.4, 1.9, -0.12); banner.rotation.y = 0.35; parts.push(banner);
    }

    const bodyMesh = mergeParts(parts, bone, scene, visual);
    const eyeMesh = mergeParts(eyes, eye, scene, visual);

    /* 持武手臂（动态） */
    const arm = new BABYLON.TransformNode(nid('armR'), scene);
    arm.position.set(0.24, 1.16, 0); arm.parent = visual;
    const limb = BABYLON.MeshBuilder.CreateCapsule(nid('armRMesh'), { height: 0.52, radius: 0.05, tessellation: 6 }, scene);
    limb.position.y = -0.24; limb.material = bone; limb.parent = arm;
    if (def.key === 'grunt' || def.key === 'shield') {
      const club = BABYLON.MeshBuilder.CreateBox(nid('club'), { width: 0.09, height: 0.52, depth: 0.09 }, scene);
      club.position.set(0, -0.55, 0.1); club.rotation.x = 0.3; club.material = bone; club.parent = arm;
    } else if (def.key === 'runner') {
      const dagger = BABYLON.MeshBuilder.CreateBox(nid('dagger'), { width: 0.045, height: 0.34, depth: 0.045 }, scene);
      dagger.position.set(0, -0.52, 0.06); dagger.rotation.x = 0.2; dagger.material = bone; dagger.parent = arm;
    } else if (def.boss) {
      const cleaver = BABYLON.MeshBuilder.CreateBox(nid('cleaver'), { width: 0.10, height: 1.05, depth: 0.30 }, scene);
      cleaver.position.set(0, -0.78, 0.16); cleaver.rotation.x = 0.24; cleaver.material = bone; cleaver.parent = arm;
      const guard = BABYLON.MeshBuilder.CreateBox(nid('guardBar'), { width: 0.34, height: 0.06, depth: 0.06 }, scene);
      guard.position.set(0, -0.5, 0.1); guard.material = bone; guard.parent = arm;
    }

    return { root, visual, arm, bodyMesh, eyeMesh, height: 1.9 * s };
  }

  /* ------------------------------ 圣光军团机体 ------------------------------ */
  function buildAllyRig(scene, def) {
    const root = new BABYLON.TransformNode(nid('ally'), scene);
    const visual = new BABYLON.TransformNode(nid('allyVisual'), scene);
    visual.parent = root;
    const steel = steelMat(scene, def.color);
    const trim = trimMat(scene, def.trim);
    const parts = [], trims = [];

    const torso = BABYLON.MeshBuilder.CreateCapsule(nid('torso'), { height: 0.86, radius: 0.20, tessellation: 10 }, scene);
    torso.position.y = 0.82; parts.push(torso);
    const kilt = BABYLON.MeshBuilder.CreateCylinder(nid('kilt'), { diameterTop: 0.36, diameterBottom: 0.52, height: 0.4, tessellation: 10 }, scene);
    kilt.position.y = 0.36; parts.push(kilt);
    for (const lx of [-0.09, 0.09]) {
      const leg = BABYLON.MeshBuilder.CreateCapsule(nid('leg'), { height: 0.44, radius: 0.06, tessellation: 6 }, scene);
      leg.position.set(lx, 0.22, 0); parts.push(leg);
    }

    const arm = new BABYLON.TransformNode(nid('armR'), scene);
    arm.position.set(0.22, 1.06, 0); arm.parent = visual;

    if (def.key === 'guard') {
      const helm = BABYLON.MeshBuilder.CreateCylinder(nid('helm'), { height: 0.26, diameterTop: 0.10, diameterBottom: 0.26, tessellation: 8 }, scene);
      helm.position.y = 1.42; parts.push(helm);
      const shield = BABYLON.MeshBuilder.CreateBox(nid('aShield'), { width: 0.08, height: 0.62, depth: 0.46 }, scene);
      shield.position.set(-0.26, 0.86, 0.10); parts.push(shield);
      const rim = BABYLON.MeshBuilder.CreateTorus(nid('aRim'), { diameter: 0.34, thickness: 0.03, tessellation: 12 }, scene);
      rim.position.set(-0.30, 0.98, 0.10); rim.rotation.y = Math.PI / 2; rim.scaling.x = 1.8; trims.push(rim);
      const limb = BABYLON.MeshBuilder.CreateCapsule(nid('gArm'), { height: 0.48, radius: 0.05, tessellation: 6 }, scene);
      limb.position.y = -0.22; limb.material = steel; limb.parent = arm;
      const spear = BABYLON.MeshBuilder.CreateCylinder(nid('spear'), { height: 1.7, diameter: 0.035, tessellation: 5 }, scene);
      spear.position.set(0, -0.30, 0.12); spear.material = steel; spear.parent = arm;
      const tip = BABYLON.MeshBuilder.CreateCylinder(nid('tip'), { height: 0.18, diameterTop: 0, diameterBottom: 0.07, tessellation: 5 }, scene);
      tip.position.set(0, 0.68, 0.12); tip.material = steel; tip.parent = arm;
    } else {
      const hood = BABYLON.MeshBuilder.CreateSphere(nid('hood'), { diameter: 0.34, segments: 8, slice: 0.62 }, scene);
      hood.position.y = 1.38; hood.rotation.x = -0.18; parts.push(hood);
      const cloak = BABYLON.MeshBuilder.CreateCylinder(nid('cloak'), { diameterTop: 0.40, diameterBottom: 0.62, height: 0.78, tessellation: 10 }, scene);
      cloak.position.y = 0.62; parts.push(cloak);
      const quiver = BABYLON.MeshBuilder.CreateCylinder(nid('quiver'), { height: 0.36, diameter: 0.10, tessellation: 6 }, scene);
      quiver.position.set(-0.16, 1.02, -0.14); quiver.rotation.z = 0.35; parts.push(quiver);
      const limb = BABYLON.MeshBuilder.CreateCapsule(nid('hArm'), { height: 0.46, radius: 0.045, tessellation: 6 }, scene);
      limb.position.y = -0.20; limb.material = steel; limb.parent = arm;
      const bow = BABYLON.MeshBuilder.CreateTorus(nid('bow'), { diameter: 0.66, thickness: 0.028, tessellation: 12, arc: 0.62 }, scene);
      bow.position.set(0, -0.34, 0.14); bow.rotation.y = Math.PI / 2; bow.rotation.z = Math.PI * 0.19;
      bow.material = trim; bow.parent = arm;
      const string = BABYLON.MeshBuilder.CreateCylinder(nid('string'), { height: 0.62, diameter: 0.008, tessellation: 3 }, scene);
      string.position.set(0, -0.34, 0.10); string.material = trim; string.parent = arm;
    }

    const bodyMesh = mergeParts(parts, steel, scene, visual);
    const trimMesh = trims.length ? mergeParts(trims, trim, scene, visual) : null;
    return { root, visual, arm, bodyMesh, trimMesh, height: 1.85 };
  }

  /* ------------------------------ 头顶血条 ------------------------------ */
  class HpBar {
    constructor(scene, unit) {
      this.unit = unit;
      const w = clamp(1.15 * (unit.def.scale || 1), 1.0, 3.2);
      this.width = w;
      /* 父公告板承载旋转，子条在父本地空间里缩放/平移 → 任何镜头角度下血条都正确 */
      this.bg = FX.makeSprite(scene, nid('hpBg'), FX.textures.softDisc, 'normal', new C4(0.02, 0.03, 0.04, 0.92));
      this.bg.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      this.bg.scaling.set(w, 0.17, 1);
      this.fg = FX.makeSprite(scene, nid('hpFg'), FX.textures.softDisc, 'add', new C4(0.35, 1, 0.5, 0.95));
      this.fg.parent = this.bg;
      this.fg.position.y = 0;
      this.setColor(1);
      this.setVisible(false);
    }
    setColor(k) {
      /* 血量低时由绿转红 */
      const r = clamp(0.35 + (1 - k) * 0.75, 0, 1);
      const g = clamp(1.0 - (1 - k) * 0.45, 0, 1);
      this.fg._spriteMat.setColor4('uColor', new C4(r, g, 0.42, 0.95));
    }
    setVisible(v) {
      this.bg.setEnabled(v);
    }
    update() {
      const u = this.unit;
      const k = clamp(u.hp / u.maxHp, 0, 1);
      this.bg.position.set(u.rig.root.position.x, u.rig.height + 0.58, u.rig.root.position.z);
      /* 父平面缩放为 w×0.17，子条在 [-0.5, 0.5] 本地区间内左锚收缩 */
      this.fg.position.x = -0.5 * (1 - k);
      this.fg.scaling.set(Math.max(0.001, k), 0.74, 1);
      this.setColor(k);
    }
    dispose() {
      this.bg.material.dispose();
      this.fg.material.dispose();
      this.bg.dispose();
    }
  }

  /* ------------------------------ 单位基类 ------------------------------ */
  let nextUnitId = 1;
  class Unit {
    constructor(game, def, faction) {
      this.game = game;
      this.scene = game.scene;
      this.def = def;
      this.faction = faction;
      this.id = nextUnitId++;
      /* 亡灵随波次深度强化（hp/atk 轴；gold 轴在 DIRECTOR.onKill 结算） */
      const depth = (typeof DIRECTOR !== 'undefined' && DIRECTOR && DIRECTOR.depthMul && DIRECTOR.wave > 0)
        ? DIRECTOR.depthMul() : { hp: 1, atk: 1 };
      this.maxHp = Math.round(def.hp * depth.hp);
      this.hp = this.maxHp;
      this.alive = true;
      this.dead = false;
      this.atk = def.atk * depth.atk;
      this.attackTimer = rand(0.1, 0.5);
      this.swingT = -1;               // -1 = 未在挥击；0..1 挥击进度
      this.walkPhase = rand(0, Math.PI * 2);
      this.slowUntil = 0;
      this.slowFactor = 1;
      this.flashT = 0;
      this.target = null;
      this.rig = faction === 'enemy' ? buildEnemyRig(this.scene, def) : buildAllyRig(this.scene, def);
      this.bar = null;
      this.muzzle = new V3();
    }
    get x() { return this.rig.root.position.x; }
    get z() { return this.rig.root.position.z; }
    setPos(x, z) { this.rig.root.position.set(x, 0, z); }
    slow(factor, duration) {
      if (factor < this.slowFactor || FX.time > this.slowUntil) this.slowFactor = factor;
      this.slowUntil = Math.max(this.slowUntil, FX.time + duration);
    }
    takeDamage(amount) {
      if (!this.alive) return;
      this.hp -= amount;
      this.flashT = 0.14;
      if (!this.bar && this.def.boss !== true) this.bar = new HpBar(this.scene, this);
      if (this.bar) this.bar.setVisible(true);
      if (this.hp <= 0) this.kill();
    }
    kill() {
      if (!this.alive) return;
      this.alive = false;
      this.dead = true;
      Units.onDeath(this);
    }
    /* 挥击动画推进；返回 true 的那一帧判定命中 */
    updateSwing(dt) {
      if (this.swingT >= 0) {
        this.swingT += dt / 0.34;
        if (this.swingT >= 1) { this.swingT = -1; return true; }
      }
      return false;
    }
    swingArm() {
      /* 败北清场可能发生在本单位 update 执行中途，返回后续一律空守卫 */
      if (!this.rig) return;
      const k = this.swingT < 0 ? 0 : Math.sin(Math.PI * clamp(this.swingT, 0, 1));
      this.rig.arm.rotation.x = -1.7 * k;
    }
    updateLocomotion(dt, moving) {
      if (!this.rig) return;
      if (moving) this.walkPhase += dt * (this.def.speed || 3) * 3.4;
      const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : Math.sin(this.walkPhase * 0.32) * 0.012;
      this.rig.visual.position.y = bob;
      this.rig.visual.rotation.x = moving ? 0.10 : 0.02;
      this.flashT = Math.max(0, this.flashT - dt);
    }
    beginAttack(target) {
      this.attackTimer = this.def.atkInterval;
      this.swingT = 0;
      this.pendingHit = target;
    }
    /* 命中结算：由子类实现对英雄/单位的伤害 */
    landHit() { }
    update(dt) { }
    dispose() {
      if (this.bar) { this.bar.dispose(); this.bar = null; }
      if (this.rig) {
        this.rig.root.dispose(false, false);
        this.rig = null;
      }
    }
  }

  /* ------------------------------ 亡灵单位 ------------------------------ */
  const AGGRO = 4.2;
  class Enemy extends Unit {
    constructor(game, defKey) {
      const def = CONFIG.enemyOf(defKey);
      super(game, def, 'enemy');
      this.laneX = 0;
      this.deathT = -1;
    }
    speedNow() {
      const slowed = FX.time < this.slowUntil ? this.slowFactor : 1;
      return this.def.speed * slowed;
    }
    update(dt) {
      if (!this.alive) return;
      const game = this.game;
      const speed = this.speedNow();

      /* 亡灵主教：周期性从身后唤出骸骨卒 */
      if (this.def.summon) {
        const s = this.def.summon;
        this._summonT = (this._summonT === undefined ? s.interval * 0.7 : this._summonT) - dt;
        if (this._summonT <= 0) {
          this._summonT = s.interval;
          if (Units.enemies.filter((e) => e.alive).length < s.cap) {
            for (let i = 0; i < s.count; i++) {
              Units.spawnEnemy(s.unit, this.x + FX.randSpread(2.6), this.z + 1.6 + FX.rand(0, 1.2));
            }
            const [r, g, b] = FX.hexToRgb(this.def.eye);
            Units.fxPool.burst(game, 'glow', 10, this.x, 1.6, this.z + 1.2, () => ({
              x: FX.randSpread(2.2), y: FX.rand(0.6, 2.2), z: FX.rand(0.2, 1.6),
            }), { color: [r, g, b], life: [0.4, 0.8], size0: [0.2, 0.5], size1: [0.04, 0.1], alpha: [0.4, 0.8], turb: 0.6 });
          }
        }
      }

      /* 选目标：身前 4.2m 内最近的盟友，否则推进向英雄 */
      let target = null, bestD = AGGRO;
      for (const a of Units.allies) {
        if (!a.alive) continue;
        const d = Math.hypot(a.x - this.x, a.z - this.z);
        if (d < bestD) { bestD = d; target = a; }
      }
      const hero = game.mage.root.position;
      const dHero = Math.hypot(hero.x - this.x, hero.z - this.z);
      const heroReach = this.def.reach + 0.3;

      let moving = false;
      if (target && bestD <= this.def.reach) {
        this.attackTick(dt, target);
      } else if (dHero <= heroReach) {
        this.attackTick(dt, null);
      } else {
        if (target && bestD < AGGRO) {
          /* 绕向盟友拦截 */
          const dx = target.x - this.x, dz = target.z - this.z;
          const len = Math.max(0.001, Math.hypot(dx, dz));
          this.rig.root.position.x += (dx / len) * speed * dt;
          this.rig.root.position.z += (dz / len) * speed * dt;
          this.rig.root.rotation.y = Math.atan2(dx, dz);
        } else if (this.z > FIELD.heroZ + 14) {
          /* 远段：按路号队形推进 */
          this.rig.root.position.z -= speed * dt;
          this.rig.root.position.x += clamp(this.laneX - this.x, -1, 1) * speed * 0.22 * dt;
          this.rig.root.rotation.y = Math.PI;
        } else {
          /* 近段：向英雄合围，侧路敌人不会走过防线 */
          const dx = hero.x - this.x, dz = hero.z - this.z;
          const len = Math.max(0.001, Math.hypot(dx, dz));
          this.rig.root.position.x += (dx / len) * speed * dt;
          this.rig.root.position.z += (dz / len) * speed * dt;
          this.rig.root.rotation.y = Math.atan2(dx, dz);
        }
        moving = true;
        this.attackTimer = Math.max(this.attackTimer - dt, 0.12);
      }
      const hit = this.updateSwing(dt);
      if (hit) this.landHit();
      if (!this.alive || !this.rig) return;   /* 本帧挥击结算可能触发败北清场 */
      this.swingArm();
      this.updateLocomotion(dt, moving);
      if (this.bar) this.bar.update();

      /* 受击闪红 */
      const flash = this.flashT > 0 ? this.flashT / 0.14 : 0;
      if (flash > 0 && this.rig.eyeMesh) {
        this.rig.eyeMesh.material = eyeMat(this.scene, '#ff5f5f');
        this._flashing = true;
      } else if (this._flashing && this.rig.eyeMesh) {
        this.rig.eyeMesh.material = eyeMat(this.scene, this.def.eye);
        this._flashing = false;
      }
    }
    attackTick(dt, ally) {
      this.rig.root.rotation.y = Math.atan2(
        (ally ? ally.x : this.game.mage.root.position.x) - this.x,
        (ally ? ally.z : this.game.mage.root.position.z) - this.z);
      if (this.swingT < 0) {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) this.beginAttack(ally);
      }
    }
    landHit() {
      const target = this.pendingHit;
      this.pendingHit = null;
      if (!target) {
        DIRECTOR.damageHero(this.atk);
        /* 碎骨巨像：重击落地震屏 */
        if (this.def.slam && this.game) {
          this.game.cinematic.shake = Math.max(this.game.cinematic.shake, 0.5);
        }
      } else if (target.alive) {
        target.takeDamage(this.atk);
        hitSpark(this.game, target.x, 1.0, target.z, '#ff8a6a');
      }
    }
  }

  /* ------------------------------ 圣光军团单位 ------------------------------ */
  class Ally extends Unit {
    constructor(game, defKey, slot, stats) {
      const def = CONFIG.allyOf(defKey);
      super(game, def, 'ally');
      this.slot = slot;
      const s = stats || { atk: 1, hp: 1, interval: 1 };
      this.maxHp = Math.round(def.hp * s.hp);
      this.hp = this.maxHp;
      this.atkMul = s.atk;
      this.atk = Math.round(def.atk * s.atk);
      this.setPos(slot.x, slot.z);
      this.rig.root.rotation.y = 0; // 面朝 +z：亡灵来向
    }
    /* 攻速/攻击随天赋实时取值（誓约武备/军种节点购买即时生效） */
    intervalNow() {
      const s = DIRECTOR ? DIRECTOR.allyStats(this.def.key) : { interval: 1 };
      return this.def.atkInterval * s.interval;
    }
    atkNow() {
      const s = DIRECTOR ? DIRECTOR.allyStats(this.def.key) : { atk: 1 };
      return Math.round(this.def.atk * s.atk);
    }
    update(dt) {
      if (!this.alive) return;
      /* 索敌：射程内最近的亡灵 */
      let target = null, bestD = this.def.reach + 0.4;
      for (const e of Units.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - this.x, e.z - this.z);
        if (d < bestD) { bestD = d; target = e; }
      }
      let moving = false;
      if (target) {
        this.rig.root.rotation.y = Math.atan2(target.x - this.x, target.z - this.z);
        if (this.swingT < 0) {
          this.attackTimer -= dt;
          if (this.attackTimer <= 0) {
            if (this.def.ranged) {
              this.attackTimer = this.intervalNow();
              Units.spawnProjectile({
                fromX: this.x, fromY: 1.15, fromZ: this.z,
                target, speed: this.def.projectileSpeed, damage: this.atkNow(),
                colorHex: '#ffe6a3', kind: 'arrow', faction: 'ally',
              });
              bowFlash(this.game, this);
            } else {
              this.beginAttack(target);
            }
          }
        }
      } else {
        this.rig.root.rotation.y = 0;
        this.attackTimer = Math.max(this.attackTimer - dt, 0.12);
      }
      const hit = this.updateSwing(dt);
      if (hit) this.landHit();
      if (!this.alive || !this.rig) return;   /* 本帧挥击结算可能触发败北清场 */
      this.swingArm();
      this.updateLocomotion(dt, moving);
      if (this.bar) this.bar.update();
    }
    landHit() {
      const target = this.pendingHit;
      this.pendingHit = null;
      if (target && target.alive) {
        target.takeDamage(this.atkNow());
        hitSpark(this.game, target.x, 1.0, target.z, '#cfe8ff');
      }
    }
  }

  /* ------------------------------ 命中火花 ------------------------------ */
  function hitSpark(game, x, y, z, hex) {
    const [r, g, b] = FX.hexToRgb(hex);
    Units.fxPool.burst(game, 'spark', 5, x, y, z, () => ({
      x: randSpread(2.4), y: rand(0.5, 2.2), z: randSpread(2.4),
    }), { color: [r, g, b], life: [0.18, 0.4], size0: [0.05, 0.12], size1: [0.01, 0.03], alpha: [0.5, 0.9], turb: 0.4 });
  }
  function bowFlash(game, ally) {
    const [r, g, b] = FX.hexToRgb('#ffe6a3');
    Units.fxPool.burst(game, 'spark', 3, ally.x, 1.25, ally.z + 0.3, () => ({
      x: randSpread(1.2), y: rand(0.2, 0.8), z: rand(1.5, 3),
    }), { color: [r, g, b], life: [0.12, 0.26], size0: [0.04, 0.09], size1: [0.008, 0.02], alpha: [0.5, 0.8], turb: 0.2 });
  }

  /* ------------------------------ 追踪弹池 ------------------------------ */
  const PROJECTILE_CAP = 96;
  class ProjectilePool {
    constructor(game) {
      this.game = game;
      this.scene = game.scene;
      this.list = [];
      this.trailGlow = new FX.Emitter(FX.layers.glow, {
        life: [0.16, 0.3], size0: [0.10, 0.2], size1: [0.02, 0.05], alpha: [0.35, 0.6],
        drag: 2.4, turb: 0.3,
      });
      this._tmp = new V3();
    }
    _make(kind, hex) {
      if (kind === 'arrow') {
        const mesh = BABYLON.MeshBuilder.CreateCapsule(nid('arrow'), { height: 0.5, radius: 0.022, tessellation: 5 }, this.scene);
        const mat = new BABYLON.StandardMaterial(nid('arrowMat'), this.scene);
        mat.diffuseColor = new C3(0.1, 0.1, 0.1);
        mat.emissiveColor = C3.FromHexString(hex).scale(0.7);
        mat.specularColor = new C3(0, 0, 0);
        mesh.material = mat;
        mesh.isPickable = false;
        return { mesh, ownMaterial: true };
      }
      const mesh = FX.makeSprite(this.scene, nid('bolt'), FX.textures.glow, 'add', new C4(1, 1, 1, 0.95));
      mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      mesh.scaling.set(0.55, 0.55, 1);
      return { mesh, ownMaterial: true };
    }
    spawn(opts) {
      let p = null;
      for (const q of this.list) if (!q.active) { p = q; break; }
      if (!p) {
        if (this.list.length >= PROJECTILE_CAP) { p = this.list[0]; }
        else {
          p = { active: false, kind: null, mesh: null, ownMaterial: true, target: null, speed: 0, damage: 0, colorHex: '#fff', faction: '', lastPos: new V3(), size: 1, bounces: 0 };
          this.list.push(p);
        }
      }
      if (p.kind !== opts.kind || p.colorHex !== opts.colorHex) {
        if (p.mesh) { p.mesh.material.dispose(); p.mesh.dispose(); }
        const made = this._make(opts.kind, opts.colorHex);
        p.mesh = made.mesh; p.ownMaterial = made.ownMaterial;
        p.kind = opts.kind; p.colorHex = opts.colorHex;
      }
      p.active = true;
      p.mesh.setEnabled(true);
      p.mesh.position.set(opts.fromX, opts.fromY, opts.fromZ);
      p.lastPos.set(opts.fromX, opts.fromY, opts.fromZ);
      p.target = opts.target;
      p.speed = opts.speed;
      p.damage = opts.damage;
      p.faction = opts.faction || 'hero';
      p.size = opts.size || 1;
      p.bounces = opts.bounces || 0;
      const [r, g, b] = FX.hexToRgb(opts.colorHex);
      if (p.kind !== 'arrow') {
        p.mesh._spriteMat.setColor4('uColor', new C4(r * 1.4, g * 1.4, b * 1.4, 0.95));
        p.mesh.scaling.set(0.5 * p.size, 0.5 * p.size, 1);
      } else {
        p.mesh.material.emissiveColor = C3.FromHexString(opts.colorHex).scale(0.7);
      }
      return p;
    }
    update(dt) {
      for (const p of this.list) {
        if (!p.active) continue;
        const t = p.target;
        const alive = t && t.alive && t.rig;
        const tx = alive ? t.x : p.lastPos.x;
        const ty = alive ? (t.rig.height * 0.55) : p.lastPos.y;
        const tz = alive ? t.z : p.lastPos.z;
        const pos = p.mesh.position;
        const dx = tx - pos.x, dy = ty - pos.y, dz = tz - pos.z;
        const dist = Math.max(0.001, Math.hypot(dx, dy, dz));
        const step = p.speed * dt;
        if (dist <= step + 0.35) {
          /* 命中（或目标已亡的能量消散） */
          p.active = false;
          p.mesh.setEnabled(false);
          if (alive) {
            t.takeDamage(p.damage);
            hitSpark(this.game, tx, ty, tz, p.colorHex);
          } else {
            hitSpark(this.game, pos.x, pos.y, pos.z, p.colorHex);
          }
          /* 回响碎片：英雄魔弹命中后弹片跳向邻近亡灵（伤害逐跳 55% 衰减） */
          if (p.faction === 'hero' && p.kind === 'bolt' && p.bounces > 0) {
            let hop = null, hopD = 9;
            for (const e of Units.enemies) {
              if (!e.alive || e === t) continue;
              const d = Math.hypot(e.x - tx, e.z - tz);
              if (d < hopD) { hopD = d; hop = e; }
            }
            if (hop) {
              this.spawn({
                fromX: tx, fromY: ty, fromZ: tz,
                target: hop, speed: p.speed, damage: p.damage * 0.55,
                colorHex: p.colorHex, kind: 'bolt', faction: 'hero',
                size: p.size * 0.85, bounces: p.bounces - 1,
              });
            }
          }
          continue;
        }
        pos.x += (dx / dist) * step;
        pos.y += (dy / dist) * step;
        pos.z += (dz / dist) * step;
        p.lastPos.copyFrom(pos);
        if (p.kind === 'arrow') {
          p.mesh.rotation.x = Math.PI / 2 - Math.atan2(dy, Math.hypot(dx, dz));
          p.mesh.rotation.y = Math.atan2(dx, dz);
        }
        const [r, g, b] = FX.hexToRgb(p.colorHex);
        this.trailGlow.cfg.color = [r, g, b];
        this.trailGlow.stream(1.6, pos.x, pos.y, pos.z, () => ({ x: 0, y: 0, z: 0 }));
      }
    }
    clear() {
      for (const p of this.list) { p.active = false; if (p.mesh) p.mesh.setEnabled(false); }
    }
    dispose() {
      for (const p of this.list) {
        if (p.mesh) { if (p.ownMaterial && p.mesh.material) p.mesh.material.dispose(); p.mesh.dispose(); }
      }
      this.list.length = 0;
    }
  }

  /* ------------------------------ 通用 FX 发射器池 ------------------------------ */
  const fxEmitters = {};
  function ensureFx(name, cfg) {
    if (!fxEmitters[name]) {
      fxEmitters[name] = new FX.Emitter(FX.layers[name] || FX.layers.glow, cfg);
    }
    return fxEmitters[name];
  }
  const fxPoolShim = {
    burst(game, layer, n, x, y, z, velFn, cfg) {
      const e = ensureFx(layer + ':' + JSON.stringify(cfg), cfg);
      e.burst(n, x, y, z, velFn);
    },
  };

  /* ------------------------------ 单位注册表 ------------------------------ */
  const Units = {
    enemies: [], allies: [], dying: [],
    game: null, fxPool: fxPoolShim, ProjectilePool,
    get classes() { return { Unit, Enemy, Ally }; },

    bind(game) {
      if (this.game === game) return;
      this.clear();
      this.game = game;
      this.projectiles = new ProjectilePool(game);
    },
    aliveEnemies() { return this.enemies.filter((e) => e.alive); },
    aliveAllies() { return this.allies.filter((a) => a.alive); },
    boss() { return this.enemies.find((e) => e.alive && e.def.boss) || null; },

    spawnEnemy(defKey, x, z) {
      const e = new Enemy(this.game, defKey);
      e.setPos(x, z);
      e.laneX = x;
      e.rig.root.rotation.y = Math.PI;
      if (e.def.boss) { e.bar = new HpBar(this.game.scene, e); e.bar.setVisible(true); e.bar.update(); }
      this.enemies.push(e);
      return e;
    },
    spawnAlly(defKey, buff) {
      const def = CONFIG.allyOf(defKey);
      const slot = this.takeSlot(def.row);
      if (!slot) return null;
      const a = new Ally(this.game, defKey, slot, buff);
      this.allies.push(a);
      const [r, g, b] = FX.hexToRgb(def.trim);
      const ring = FX.makeSprite(this.game.scene, nid('summonRing'), FX.textures.ring, 'add', new C4(r, g, b, 0.8));
      ring.rotation.x = Math.PI / 2;
      ring.position.set(slot.x, 0.08, slot.z);
      ring.scaling.set(0.1, 0.1, 1);
      this.dying.push({ kind: 'ring', mesh: ring, t: 0, dur: 0.6 });
      return a;
    },
    takeSlot(row) {
      const used = new Set(this.allies.filter((a) => a.alive && a.def.row === row).map((a) => a.slot.i));
      for (let i = 0; i < 10; i++) {
        if (used.has(i)) continue;
        const count = CONFIG.ALLIES.filter((d) => d.row === row).reduce((s, d) => s + DIRECTOR.capOf(d.key), 0);
        if (i >= Math.max(4, count)) continue;
        const spread = FIELD.rallySpreadX;
        const x = -spread + (i / Math.max(1, Math.max(4, count) - 1)) * spread * 2;
        return { i, x, z: FIELD.rallyZ[row] + (i % 2 === 0 ? 0 : 1.4) };
      }
      return null;
    },

    spawnProjectile(opts) { return this.projectiles.spawn(opts); },

    /* AOE：返回被命中的单位（雷击链等需要二次利用） */
    applyAoE(x, z, radius, damage, opts) {
      const victims = [];
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const bodyR = 0.35 + (e.def.scale || 1) * 0.35;
        const d = Math.hypot(e.x - x, e.z - z);
        if (d <= radius + bodyR) {
          e.takeDamage(damage);
          if (opts && opts.slow && e.alive) e.slow(opts.slow.factor, opts.slow.duration);
          victims.push(e);
        }
      }
      return victims;
    },
    nearestEnemy(x, z, maxRange) {
      let best = null, bestD = (maxRange || 1e9) * (maxRange || 1e9);
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const d = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
        if (d < bestD) { bestD = d; best = e; }
      }
      return best;
    },

    onDeath(unit) {
      const game = this.game;
      if (unit.faction === 'enemy') {
        DIRECTOR.onKill(unit.def.gold, unit.def.boss === true);
        const [r, g, b] = FX.hexToRgb(unit.def.eye);
        ensureFx('deathGlow', {
          life: [0.3, 0.7], size0: [0.3, 0.7], size1: [0.05, 0.15], alpha: [0.5, 0.9],
          color: [r, g, b], drag: 2.2, turb: 0.8,
        }).burst(14, unit.x, 0.9 * (unit.def.scale || 1), unit.z, () => ({
          x: randSpread(2.6), y: rand(0.5, 3.0), z: randSpread(2.6),
        }));
        const [br, bg, bb] = FX.hexToRgb(unit.def.color);
        ensureFx('deathBone', {
          life: [0.5, 1.1], size0: [0.10, 0.26], size1: [0.03, 0.08], alpha: [0.6, 1.0],
          color: [br, bg, bb], color2: [br * 0.3, bg * 0.3, bb * 0.3], drag: 1.6, turb: 0.6, gravity: 7,
        }).burst(12, unit.x, 0.8, unit.z, () => ({
          x: randSpread(3.4), y: rand(1.2, 4.2), z: randSpread(3.4),
        }));
        if (unit.def.boss) {
          game.cinematic.shake = Math.max(game.cinematic.shake, 0.9);
          ensureFx('bossSmoke', {
            life: [1.2, 2.2], size0: [0.8, 1.6], size1: [2.4, 4.2], alpha: [0.10, 0.2],
            color: [0.16, 0.14, 0.18], drag: 1.0, turb: 0.7,
          }).burst(20, unit.x, 1.2, unit.z, () => ({
            x: randSpread(2.4), y: rand(0.6, 2.2), z: randSpread(2.4),
          }));
        }
        /* 尸骸倒伏 */
        this.dying.push({ kind: 'unit', unit, t: 0, dur: 0.9 });
      } else {
        const [r, g, b] = FX.hexToRgb(unit.def.trim);
        ensureFx('allyDeath', {
          life: [0.4, 0.9], size0: [0.2, 0.5], size1: [0.04, 0.1], alpha: [0.5, 0.9],
          color: [r, g, b], drag: 2.0, turb: 0.7,
        }).burst(12, unit.x, 1.0, unit.z, () => ({
          x: randSpread(2.2), y: rand(0.4, 2.4), z: randSpread(2.2),
        }));
        this.dying.push({ kind: 'unit', unit, t: 0, dur: 0.7 });
      }
    },

    update(dt) {
      /* 逐实例异常隔离：单个单位故障只回收自身。
         交战伤害可能触发败北 → Units.clear() 在本循环内清空数组，必须做空守卫。 */
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        const e = this.enemies[i];
        if (!e) continue;
        try {
          if (e.alive) e.update(dt);
        } catch (err) {
          console.error('[units] 敌人更新失败，回收: ' + (err && err.stack ? err.stack : err));
          e.alive = false; e.dead = true;
        }
        if (!e.alive && !this.dying.some((d) => d.unit === e)) {
          this.enemies.splice(i, 1);
          e.dispose();
        }
      }
      for (let i = this.allies.length - 1; i >= 0; i--) {
        const a = this.allies[i];
        if (!a) continue;
        try {
          if (a.alive) a.update(dt);
        } catch (err) {
          console.error('[units] 盟友更新失败，回收: ' + (err && err.stack ? err.stack : err));
          a.alive = false; a.dead = true;
        }
        if (!a.alive && !this.dying.some((d) => d.unit === a)) {
          this.allies.splice(i, 1);
          a.dispose();
        }
      }
      /* 敌群简单分离，避免叠成一条线 */
      const list = this.enemies;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (!a.alive) continue;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (!b.alive) continue;
          const dx = b.x - a.x, dz = b.z - a.z;
          const minD = 0.55 * ((a.def.scale || 1) + (b.def.scale || 1)) * 0.8;
          const d2 = dx * dx + dz * dz;
          if (d2 < minD * minD && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (minD - d) * 0.5;
            const nx = dx / d, nz = dz / d;
            a.rig.root.position.x -= nx * push * 0.5; a.rig.root.position.z -= nz * push * 0.5;
            b.rig.root.position.x += nx * push * 0.5; b.rig.root.position.z += nz * push * 0.5;
          }
        }
      }
      if (this.projectiles) this.projectiles.update(dt);

      /* 尸骸倒伏 / 召唤法环渐隐 */
      for (let i = this.dying.length - 1; i >= 0; i--) {
        const d = this.dying[i];
        if (!d) continue;
        d.t += dt;
        const k = clamp(d.t / d.dur, 0, 1);
        if (d.kind === 'unit' && d.unit.rig) {
          d.unit.rig.root.rotation.x = lerp(0, Math.PI * 0.42, k);
          d.unit.rig.visual.position.y = -k * 0.4;
          d.unit.rig.root.position.y = -k * 1.2;
          if (d.unit.rig.eyeMesh) d.unit.rig.eyeMesh.visibility = 1 - k;
          if (d.unit.rig.bodyMesh) d.unit.rig.bodyMesh.visibility = 1 - k * 0.9;
        } else if (d.kind === 'ring') {
          const s = lerp(0.1, 2.2, 1 - Math.pow(1 - k, 3));
          d.mesh.scaling.set(s, s, 1);
          d.mesh._spriteMat.setColor4('uColor', new C4(1, 1, 1, 0.8 * (1 - k)));
        }
        if (k >= 1) {
          if (d.kind === 'unit') d.unit.dispose();
          else { d.mesh.material.dispose(); d.mesh.dispose(); }
          this.dying.splice(i, 1);
        }
      }
    },

    clear() {
      /* 置 alive=false 再 dispose：战斗中清场（败北/换层）时，外层迭代循环
         仍持有旧引用，空守卫依赖 alive 标记，不置位会在下一轮崩在已 dispose 的 rig 上 */
      for (const e of this.enemies) { e.alive = false; e.dispose(); }
      for (const a of this.allies) { a.alive = false; a.dispose(); }
      for (const d of this.dying) {
        if (d.kind === 'unit' && d.unit.rig) d.unit.dispose();
        else if (d.mesh) { d.mesh.material.dispose(); d.mesh.dispose(); }
      }
      this.enemies.length = 0;
      this.allies.length = 0;
      this.dying.length = 0;
      if (this.projectiles) this.projectiles.clear();
    },
  };

  global.Units = Units;
  global.ResourceOwner = ResourceOwner;
})(window);
