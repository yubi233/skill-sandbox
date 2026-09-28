/* ============================================================================
   tests/helpers/headless.ts — 无头测试共用骨架（自 tools/headless_sim.ts 抽出，
   与 tests/harness.js 的 VM 装载思路一脉相承，但直接 import src ESM 模块）。
   NullEngine + 1×1 占位贴图：零 DOM/GPU 驱动完整游戏循环。
   - installPlaceholderFx(scene)：FX 纹理/粒子层占位（无 canvas/Image 的 node 里
     也能驱动完整粒子池）。
   - createHeadlessWorld(opts)：组装 HeadlessGame + Units.bind/DIRECTOR.bind +
     DIRECTOR.bindWorld 接线（Units/SPELLS），并提供 tickOnce 单步推进
     （时间→导演→实体→法术→粒子→姿态，与 game.tick 顺序一致）、gameEvents
     逐帧排水与 console.error 捕获。
   tools/headless_sim.ts 与 tests/*.test.ts 共用本骨架，保证验收仿真与
   表测试走同一条流水线。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { CONFIG } from '../../src/core/config';
import { DIRECTOR } from '../../src/core/director';
import { gameEvents, type GameEvent } from '../../src/core/events';
import { gameRng } from '../../src/core/rng';
import { FX } from '../../src/render/particles';
import { Units } from '../../src/render/entities/units';
import { SPELLS } from '../../src/render/skills';
import { Mage } from '../../src/render/mage';

/* ------------------------------ 占位渲染环境 ------------------------------ */
const PLACEHOLDER_TEXTURES = ['glow', 'spark', 'smoke', 'debris', 'ring', 'softDisc', 'slash',
  'beamGlow', 'groundNoise', 'rune', 'fracture', 'star', 'vortex', 'crystal', 'blade',
  'spearBlade', 'grandCircle', 'daylightGrass'] as const;
const LAYER_BLENDS: Array<[string, 'add' | 'normal']> =
  [['glow', 'add'], ['spark', 'add'], ['smoke', 'normal'], ['debris', 'normal']];

export function installPlaceholderFx(scene: BABYLON.Scene, capacity = 512): void {
  for (const name of PLACEHOLDER_TEXTURES) {
    FX.textures[name] = BABYLON.RawTexture.CreateRGBATexture(
      new Uint8Array([255, 255, 255, 255]), 1, 1, scene, false, false) as unknown as BABYLON.DynamicTexture;
  }
  for (const [name, blending] of LAYER_BLENDS) {
    FX.layers[name] = new FX.PointLayer(scene, name, capacity, FX.textures[name], blending);
  }
}

/* ------------------------------ 类型 ------------------------------ */
export interface HeadlessGame {
  engine: BABYLON.NullEngine;
  scene: BABYLON.Scene;
  mage: Mage;
  camera: BABYLON.FreeCamera;
  cinematic: { focus: unknown; intensity: number; shake: number; shakeEnabled: boolean };
  time: number;
  frameDt: number;
  paused: boolean;
}

export interface TickOpts {
  /* 生命周期隔离测试可跳过导演，避免清场后自动生成下一波污染资源基线 */
  advanceDirector?: boolean;
}

export interface HeadlessWorld {
  game: HeadlessGame;
  engine: BABYLON.NullEngine;
  scene: BABYLON.Scene;
  /** 最近一次 tickOnce 排出的 GameEvent（每帧覆盖）。 */
  events: GameEvent[];
  tickOnce(dt?: number, opts?: TickOpts): void;
  /** 经 world 钩子清场 + 法术回收后销毁场景（必须在 scene.dispose 前清空 singleton）。 */
  dispose(): void;
}

/* ------------------------------ console.error 捕获 ------------------------------ */
/* 异常隔离路径（units/skills 的逐实例 try/catch）会走 console.error：
   捕获进数组供测试/门禁断言，同时转发到原始 stderr 不吞日志。 */
const simErrors: string[] = [];
let errorHookInstalled = false;
function ensureErrorHook(): void {
  if (errorHookInstalled) return;
  errorHookInstalled = true;
  const origError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    simErrors.push(args.map(String).join(' '));
    origError(...args);
  };
}
/** 取走全部已捕获错误（清空）。 */
export function drainSimErrors(): string[] {
  return simErrors.splice(0, simErrors.length);
}
/** 只读查看已捕获错误（不清空，供增量断言）。 */
export function peekSimErrors(): readonly string[] {
  return simErrors;
}

/** 同步执行 run() 并返回期间 push 的 GameEvent（先清空遗留事件）。 */
export function eventsDuring(run: () => unknown): GameEvent[] {
  const scratch: GameEvent[] = [];
  gameEvents.drain(scratch);
  run();
  const out: GameEvent[] = [];
  gameEvents.drain(out);
  return out;
}

/* ------------------------------ 场景快照 ------------------------------ */
/* 生命周期/法术回收测试用：清理后五类资源数应精确回基线。 */
export function snapshot(scene: BABYLON.Scene) {
  return {
    meshes: scene.meshes.length,
    materials: scene.materials.length,
    nodes: scene.transformNodes.length,
    lights: scene.lights.length,
    textures: scene.textures.length,
  };
}

/* ------------------------------ 组装 ------------------------------ */
export function createHeadlessWorld(opts: { seed?: number; fxCapacity?: number } = {}): HeadlessWorld {
  ensureErrorHook();
  if (opts.seed !== undefined) gameRng.reseed(opts.seed);
  const engine = new BABYLON.NullEngine();
  const scene = new BABYLON.Scene(engine);
  installPlaceholderFx(scene, opts.fxCapacity ?? 512);
  const game: HeadlessGame = {
    engine, scene,
    mage: new Mage(scene),
    camera: new BABYLON.FreeCamera('headlessCam', new BABYLON.Vector3(0, 10, -48), scene),
    cinematic: { focus: null, intensity: 0, shake: 0, shakeEnabled: false },
    time: 0, frameDt: 0, paused: false,
  };
  game.mage.root.position.set(0, 0, CONFIG.FIELD.heroZ);
  Units.bind(game as unknown as never);
  DIRECTOR.bind(game as unknown as never);   // 语义 = DIRECTOR.reset()
  DIRECTOR.bindWorld({
    clearWorld: () => Units.clear(),
    spawnEnemy: (defKey, x, z) => { Units.spawnEnemy(defKey, x, z); },
    spawnAlly: (key, stats) => Units.spawnAlly(key, stats),
    allies: () => Units.allies,
    aliveEnemies: () => Units.aliveEnemies(),
    dyingCount: () => Units.dying.length,
    resetSpells: () => SPELLS.reset(),
    shake: () => {},
    applyTheme: () => {},
  });

  const world: HeadlessWorld = {
    game, engine, scene,
    events: [],
    tickOnce(dt = 1 / 60, tickOpts: TickOpts = {}) {
      game.time += dt;
      FX.time = game.time;
      if (tickOpts.advanceDirector !== false) DIRECTOR.update(dt);
      Units.update(dt);
      SPELLS.update(game as unknown as never, dt);
      FX.update(dt);
      game.mage.update(dt, game.time, false);
      gameEvents.drain(world.events);   // 排水保持架构行为
    },
    dispose() {
      DIRECTOR.reset();                 // 经 world 钩子 Units.clear + SPELLS.abortAll（场景仍存活，安全 dispose）
      scene.dispose();
      engine.dispose();
    },
  };
  return world;
}
