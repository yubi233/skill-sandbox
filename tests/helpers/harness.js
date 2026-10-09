'use strict';
/* 测试装载器：vendor Babylon(NullEngine 可用) + dev 源码按构建顺序装入 VM 沙盒。
   不涉及 DOM/渲染/GPU，只验证逻辑、生命周期与场景资源数量。 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const BABYLON = require(path.join(__dirname, '..', '..', 'dev', 'vendor', 'babylon.js'));

const ROOT = path.join(__dirname, '..', '..');
/* 与 dev/build.mjs 的 SOURCES 保持一致（测试不装载 ui/main，它们依赖 DOM） */
const SOURCE_ORDER = ['particles.js', 'skill-catalog.js', 'core.js', 'skills.js'];
const PLACEHOLDER_TEXTURES = ['glow', 'spark', 'smoke', 'debris', 'ring', 'softDisc', 'slash', 'beamGlow',
  'groundNoise', 'rune', 'fracture', 'star', 'vortex', 'crystal',
  'meteorScar', 'iceScar', 'voltScar', 'earthScar', 'goldScar', 'arcaneScar', 'waterScar',
  'gate', 'blade', 'spearBlade', 'grandCircle', 'magicBullet', 'waveSheet'];
const LAYER_BLENDS = [['glow', 'add'], ['spark', 'add'], ['smoke', 'normal'], ['debris', 'normal']];

function loadArcana(sourceOrder = SOURCE_ORDER) {
  const errors = [];
  const ctx = {
    BABYLON,
    Math,
    console: { log() {}, warn() {}, error(...parts) { errors.push(parts.map(String).join(' ')); } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const name of sourceOrder) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'dev', name), 'utf8'), ctx, { filename: name });
  }
  ctx.__errors = errors;
  return ctx;
}

function makeEngine() {
  return new BABYLON.NullEngine({ renderWidth: 640, renderHeight: 360 });
}

/* 用 1×1 占位纹理与小型粒子层替代 FX.init 的程序化贴图 */
function installPlaceholderFx(ctx, scene, capacity = 64) {
  for (const name of PLACEHOLDER_TEXTURES) {
    ctx.FX.textures[name] = BABYLON.RawTexture.CreateRGBATexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false);
  }
  for (const [name, blending] of LAYER_BLENDS) {
    ctx.FX.layers[name] = new ctx.FX.PointLayer(scene, name, capacity, ctx.FX.textures[name], blending);
  }
}

/* 手工组装与 Core.createGame 等价的测试用 game（跳过 DOM/相机控制/后期处理） */
function createTestGame(ctx, engine, scene) {
  return {
    engine, scene,
    params: ctx.Core.defaultParams(),
    mage: new ctx.Core.Mage(scene),
    camera: new BABYLON.FreeCamera('testCamera', new BABYLON.Vector3(0, 10, -15), scene),
    cinematic: { focus: null, intensity: 0, shake: 0 },
    moveInput: { x: 0, z: 0 },
    time: 0,
  };
}

function snapshot(scene) {
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    nodes: scene.transformNodes.length,
    lights: scene.lights.length,
    textures: scene.textures.length,
  };
}

/* 单步推进：时间唯一写入点 → 技能 → 粒子 → 角色姿态（与 game.tick 顺序一致） */
function step(game, ctx, dt = 1 / 60) {
  game.time += dt;
  ctx.FX.time = game.time;
  ctx.SKILLS.update(dt);
  ctx.FX.update(dt);
  game.mage.update(dt, game.time, false);
}

/* 推进到所有法术/瞬态/粒子收敛，返回帧数 */
function busy(game, ctx, limit = 6000) {
  let frames = 0;
  while (frames < limit && (ctx.SKILLS.casts.length || ctx.SKILLS.transients.length || ctx.FX.aliveCount())) {
    step(game, ctx);
    frames++;
  }
  return frames;
}

function resetCastState(ctx, game) {
  ctx.SKILLS.abortAll();
  ctx.SKILLS.clearCooldowns();
  game.mage.root.position.set(0, 0, 0);
  game.mage.yOffset = 0;
}

module.exports = {
  BABYLON, ROOT, SOURCE_ORDER,
  loadArcana, makeEngine, installPlaceholderFx, createTestGame,
  snapshot, step, busy, resetCastState,
};
