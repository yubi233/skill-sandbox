/* ============================================================================
   mage.ts — 可动战斗法师（程序化模型 + 施法姿态机）
   自 dev/core.js 拆出为 ESM（阶段2 第3步）；数值与行为保持与原文一致。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { FX } from './particles';

const V3 = BABYLON.Vector3;
const C3 = BABYLON.Color3;
const C4 = BABYLON.Color4;
const P = (n: number): number => Math.PI * n;

/* 施法姿态机相位 */
type SpellPhase = 'idle' | 'windup' | 'release' | 'travel' | 'impact' | 'aftermath';

/* 姿态通道（update 按键逐帧指数混合） */
interface MagePose {
  armRx: number; armRz: number; elbowR: number;
  armLx: number; armLz: number; elbowL: number;
  torso: number; hover: number; spread: number;
}

/* 技能系统经 setSpellPose 写入的姿态状态 */
interface MageSpellState {
  phase: SpellPhase;
  progress: number;
  level: number;
  color: string;
  skillId: number;
  lastCall: number;
}

/* 腿 / 臂装配节点 */
interface MageLeg { node: BABYLON.TransformNode; side: number; }
interface MageArm { shoulder: BABYLON.TransformNode; elbow: BABYLON.TransformNode; hand: BABYLON.Mesh; side: number; }

/* ------------------------------ 施法者（复用） ------------------------------ */
export class Mage {
  root: BABYLON.TransformNode;
  visual: BABYLON.TransformNode;
  scene: BABYLON.Scene;
  matTrim: BABYLON.StandardMaterial;
  _ownMaterials: BABYLON.StandardMaterial[];
  bodyMeshes: BABYLON.Mesh[];
  legs: MageLeg[];
  arms: MageArm[];
  armR: BABYLON.TransformNode;
  armL: BABYLON.TransformNode;
  handR: BABYLON.Mesh;
  gem: BABYLON.Mesh;
  brooch: BABYLON.Mesh;
  cape: BABYLON.TransformNode[];
  crystals: BABYLON.Mesh[];
  light: BABYLON.PointLight;
  castAmount: number;
  walkPhase: number;
  facing: number;
  targetFacing: number;
  yOffset: number;
  speedLean: number;
  spell: MageSpellState;
  poseCur: MagePose;
  tintCur: BABYLON.Color3;

  constructor(scene: BABYLON.Scene) {
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

    const shoulderM: BABYLON.Mesh[] = [], spikeM: BABYLON.Mesh[] = [];
    for (const s of [-1, 1]) {
      const sh = BABYLON.MeshBuilder.CreateSphere('shoulder', { diameter: 0.46, segments: 12, slice: 0.5 }, scene);
      sh.position.set(s * 0.52, 1.88, 0); sh.rotation.z = s * 0.5; sh.material = matArmor; sh.parent = visual;
      shoulderM.push(sh);
      const spike = BABYLON.MeshBuilder.CreateCylinder('shSpike', { height: 0.26, diameterTop: 0, diameterBottom: 0.12, tessellation: 8 }, scene);
      spike.position.set(s * 0.56, 2.06, 0); spike.rotation.z = s * 0.62; spike.material = matGold; spike.parent = visual;
      spikeM.push(spike);
    }

    const mergeStatic = (list: BABYLON.Mesh[], mat: BABYLON.StandardMaterial): BABYLON.Mesh => {
      for (const m of list) m.bakeCurrentTransformIntoVertices();
      const merged = BABYLON.Mesh.MergeMeshes(list, true, true)!;
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
    let capeParent: BABYLON.TransformNode = visual;
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

  worldHand(out?: BABYLON.Vector3): BABYLON.Vector3 {
    this.handR.computeWorldMatrix(true);
    const p = this.handR.getAbsolutePosition();
    if (out) return out.copyFrom(p);
    return p.clone();
  }

  setCast(k: number): void { this.castAmount = k; }

  setSpellPose(phase: SpellPhase, progress: number, level?: number, colorHex?: string, skillId?: number): void {
    this.spell.phase = phase;
    this.spell.progress = progress;
    this.spell.level = level || 3;
    if (colorHex) this.spell.color = colorHex;
    this.spell.skillId = skillId || 0;
    this.spell.lastCall = FX.time;
  }

  faceTo(x: number, z: number): void {
    const d = new V3(x, 0, z);
    if (d.lengthSquared() > 0.0001) this.targetFacing = Math.atan2(d.x, d.z);
  }

  _poseTarget(): MagePose {
    const sp = this.spell;
    const k = Math.min(1, sp.progress);
    const cast = Math.max(this.castAmount, sp.phase === 'idle' ? 0 : k);
    const t: MagePose = { armRx: 0.12, armRz: 0.14, elbowR: 0.35, armLx: 0.10, armLz: -0.14, elbowL: 0.30, torso: 0, hover: 0, spread: 0 };
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

  update(dt: number, time: number, moving: boolean): void {
    const sp = this.spell;
    if (sp.phase !== 'idle' && FX.time - sp.lastCall > 0.28) { sp.phase = 'idle'; sp.progress = 0; }

    const t = this._poseTarget();
    const cur = this.poseCur;
    const blend = 1 - Math.exp(-dt * 9);
    /* 原 JS for...in；MagePose 为自有可枚举键的普通对象，Object.keys 与之等价 */
    for (const key of Object.keys(t) as Array<keyof MagePose>) cur[key] += (t[key] - cur[key]) * blend;

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

  dispose(): void {
    if (this.gem) this.gem.disableEdgesRendering();
    this.root.getChildMeshes().forEach(m => m.dispose());
    this.visual.dispose();
    this.root.dispose();
    /* Babylon 7 typings 已无 Material.isDisposed；保留原守卫结构（本版本运行时恒走 dispose 分支） */
    const alive = (mat: BABYLON.Material): boolean => {
      const probe = mat as BABYLON.Material & { isDisposed?: () => boolean };
      return typeof probe.isDisposed === 'function' ? !probe.isDisposed() : true;
    };
    for (const mat of this._ownMaterials) if (alive(mat)) mat.dispose();
    for (const mat of this.scene.materials.slice()) {
      if (mat.name === 'lineShader' && alive(mat)) mat.dispose();
    }
  }
}
