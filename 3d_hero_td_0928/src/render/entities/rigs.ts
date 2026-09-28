/* ============================================================================
   rigs.ts — 亡灵/圣光机体装配 + 按场景共享材质（自 dev/entities.js 拆出为 ESM）
   · 模块级 nid/uid 命名计数器（原 IIFE 顶部定义，全实体共享，由本模块持有）
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import type { EnemyDef, AllyDef } from '../../core/config';

const C3 = BABYLON.Color3;

let uid = 0;
export const nid = (name: string): string => name + '_' + (++uid);

/* 亡灵机体（静态合并体 + 独立动画持武手臂 + 眼睛网格） */
export interface EnemyRig {
  root: BABYLON.TransformNode;
  visual: BABYLON.TransformNode;
  arm: BABYLON.TransformNode;
  bodyMesh: BABYLON.Mesh;
  eyeMesh: BABYLON.Mesh;
  height: number;
}

/* 圣光机体（trimMesh 仅猎手的弓有） */
export interface AllyRig {
  root: BABYLON.TransformNode;
  visual: BABYLON.TransformNode;
  arm: BABYLON.TransformNode;
  bodyMesh: BABYLON.Mesh;
  trimMesh: BABYLON.Mesh | null;
  height: number;
}

export type UnitRig = EnemyRig | AllyRig;

/* ------------------------------ 共享材质缓存（按场景） ------------------------------ */
const matCache: { scene: BABYLON.Scene | null; map: Map<string, BABYLON.StandardMaterial> } = { scene: null, map: new Map() };
function sharedMat(scene: BABYLON.Scene, name: string, build: () => BABYLON.StandardMaterial): BABYLON.StandardMaterial {
  if (matCache.scene !== scene) { matCache.scene = scene; matCache.map.clear(); }
  if (!matCache.map.has(name)) matCache.map.set(name, build());
  return matCache.map.get(name)!;
}
export const boneMat = (scene: BABYLON.Scene, hex: string): BABYLON.StandardMaterial => sharedMat(scene, 'bone' + hex, () => {
  const m = new BABYLON.StandardMaterial(nid('boneMat'), scene);
  const c = C3.FromHexString(hex);
  m.diffuseColor = c.scale(0.85);
  m.specularColor = new C3(0.22, 0.24, 0.26);
  m.specularPower = 30;
  m.emissiveColor = c.scale(0.055);
  return m;
});
export const eyeMat = (scene: BABYLON.Scene, hex: string): BABYLON.StandardMaterial => sharedMat(scene, 'eye' + hex, () => {
  const m = new BABYLON.StandardMaterial(nid('eyeMat'), scene);
  m.diffuseColor = new C3(0, 0, 0);
  m.emissiveColor = C3.FromHexString(hex).scale(1.35);
  m.specularColor = new C3(0, 0, 0);
  m.disableLighting = true;
  return m;
});
export const steelMat = (scene: BABYLON.Scene, hex: string): BABYLON.StandardMaterial => sharedMat(scene, 'steel' + hex, () => {
  const m = new BABYLON.StandardMaterial(nid('steelMat'), scene);
  const c = C3.FromHexString(hex);
  m.diffuseColor = c.scale(0.8);
  m.specularColor = new C3(0.5, 0.55, 0.62);
  m.specularPower = 48;
  return m;
});
export const trimMat = (scene: BABYLON.Scene, hex: string): BABYLON.StandardMaterial => sharedMat(scene, 'trim' + hex, () => {
  const m = new BABYLON.StandardMaterial(nid('trimMat'), scene);
  m.diffuseColor = new C3(0, 0, 0);
  m.emissiveColor = C3.FromHexString(hex).scale(0.55);
  m.specularColor = new C3(0, 0, 0);
  return m;
});

export function mergeParts(list: BABYLON.Mesh[], mat: BABYLON.Material, _scene: BABYLON.Scene, parent: BABYLON.Node): BABYLON.Mesh {
  for (const m of list) m.bakeCurrentTransformIntoVertices();
  const merged = BABYLON.Mesh.MergeMeshes(list, true, true)!;
  merged.material = mat;
  merged.parent = parent;
  merged.isPickable = false;
  return merged;
}

/* ------------------------------ 亡灵机体 ------------------------------ */
/* 返回 {root, visual, arm, height}；静态部件按材质合并，仅持武手臂独立动画 */
export function buildEnemyRig(scene: BABYLON.Scene, def: EnemyDef): EnemyRig {
  const s = def.scale;
  const root = new BABYLON.TransformNode(nid('enemy'), scene);
  const visual = new BABYLON.TransformNode(nid('enemyVisual'), scene);
  visual.parent = root;
  visual.scaling.setAll(s);
  const bone = boneMat(scene, def.color);
  const eye = eyeMat(scene, def.eye);

  const parts: BABYLON.Mesh[] = [], eyes: BABYLON.Mesh[] = [];
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
export function buildAllyRig(scene: BABYLON.Scene, def: AllyDef): AllyRig {
  const root = new BABYLON.TransformNode(nid('ally'), scene);
  const visual = new BABYLON.TransformNode(nid('allyVisual'), scene);
  visual.parent = root;
  const steel = steelMat(scene, def.color);
  const trim = trimMat(scene, def.trim);
  const parts: BABYLON.Mesh[] = [], trims: BABYLON.Mesh[] = [];

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
    // TODO(阶段3)：按 def.rig 显式注册，消除 else=圣殿猎手 的静默回退
    const hood = BABYLON.MeshBuilder.CreateSphere(nid('hood'), { diameter: 0.34, segments: 8, slice: 0.62 }, scene);
    hood.position.y = 1.38; hood.rotation.x = -0.18; parts.push(hood);
    const cloak = BABYLON.MeshBuilder.CreateCylinder(nid('cloak'), { diameterTop: 0.40, diameterBottom: 0.62, height: 0.78, tessellation: 10 }, scene);
    cloak.position.y = 0.62; parts.push(cloak);
    const quiver = BABYLON.MeshBuilder.CreateCylinder(nid('quiver'), { height: 0.36, diameter: 0.10, tessellation: 6 }, scene);
    quiver.position.set(-0.16, 1.02, -0.14); quiver.rotation.z = 0.35; parts.push(quiver);
    const limb = BABYLON.MeshBuilder.CreateCapsule(nid('hArm'), { height: 0.46, radius: 0.045, tessellation: 6 }, scene);
    limb.position.y = -0.20; limb.material = steel; limb.parent = arm;
    /* 原文传 arc: 0.62 —— 本版本 CreateTorus 的 typings 与实现均不读取该键（无操作），照传保持原文数值 */
    const bow = BABYLON.MeshBuilder.CreateTorus(nid('bow'), { diameter: 0.66, thickness: 0.028, tessellation: 12, arc: 0.62 } as any, scene);
    bow.position.set(0, -0.34, 0.14); bow.rotation.y = Math.PI / 2; bow.rotation.z = Math.PI * 0.19;
    bow.material = trim; bow.parent = arm;
    const string = BABYLON.MeshBuilder.CreateCylinder(nid('string'), { height: 0.62, diameter: 0.008, tessellation: 3 }, scene);
    string.position.set(0, -0.34, 0.10); string.material = trim; string.parent = arm;
  }

  const bodyMesh = mergeParts(parts, steel, scene, visual);
  const trimMesh = trims.length ? mergeParts(trims, trim, scene, visual) : null;
  return { root, visual, arm, bodyMesh, trimMesh, height: 1.85 };
}
