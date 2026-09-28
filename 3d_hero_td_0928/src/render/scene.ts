/* ============================================================================
   scene.ts — 死灵防线 3D · 战场基座
   日照草甸 + 圣光防线 + 可动战斗法师（保留法术试验场的程序化模型）。
   ACES tone mapping + 克制的高光 bloom；显式主循环契约与试验场一致：
   game.update(时间/移动) → 法术/实体 → 粒子 → game.lateUpdate(姿态/镜头/装饰)
   → UI → game.render(动态分辨率)。game.dispose 统一回收，幂等。
   自 dev/core.js 拆出为 ESM（阶段2 第3步）；数值与行为保持与原文一致。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { CONFIG, type ThemeColors } from '../core/config';
import { FX, type FxSpriteMesh } from './particles';
import { Mage } from './mage';
import { TargetRing } from './target_ring';

/* ------------------------------ 模块内别名（原 IIFE 顶部） ------------------------------ */
const V3 = BABYLON.Vector3;
const C3 = BABYLON.Color3;
const C4 = BABYLON.Color4;
const FIELD = CONFIG.FIELD;
const HERO = CONFIG.HERO;

/* ------------------------------ 类型 ------------------------------ */
/* 电影化镜头状态（技能系统写入，Core 只叠加不累积） */
export interface GameCinematic {
  focus: BABYLON.Vector3 | null;
  intensity: number;
  shake: number;
  shakeEnabled: boolean;
}

/* 亡灵之门装饰组合 */
export interface GameGate {
  node: BABYLON.TransformNode;
  glow: FxSpriteMesh;
  light: BABYLON.PointLight;
}

/* createGame 返回对象的完整契约（main.js / ui.js / skills.js 消费方）。
   update/lateUpdate/render/dispose 在 createGame 内后置赋值（保持原 JS 流程）；
   tick/renderPaused/__watchdog 由 main.js 在 createGame 返回后追加，tick 为可变属性。 */
export interface Game {
  engine: BABYLON.Engine;
  scene: BABYLON.Scene;
  camera: BABYLON.ArcRotateCamera;
  post: BABYLON.DefaultRenderingPipeline;
  mage: Mage;
  ground: BABYLON.GroundMesh;
  ring: TargetRing;
  hemi: BABYLON.HemisphericLight;
  moon: BABYLON.DirectionalLight;
  cinematic: GameCinematic;
  gate: GameGate;
  time: number;
  frameDt: number;
  paused: boolean;
  /* —— 创建后追加（main.js 主循环契约） —— */
  tick: (dt: number) => void;
  renderPaused?: boolean;
  fpsEma?: number;
  __watchdog?: ReturnType<typeof setInterval> | null;
  lateUpdate: (dt: number) => void;
  update: (dt: number) => void;
  render: () => void;
  dispose: () => void;
  applyTheme: (theme: ThemeColors | null | undefined) => void;
  /* —— 内部状态（原匿名对象上的下划线字段） —— */
  _gateBase: [number, number, number];
  _resTimer?: number;
}

/* ------------------------------ 场景创建 ------------------------------ */
export function createGame(canvas: HTMLCanvasElement): Game {
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
  const rallyMarks: BABYLON.Mesh[] = [];
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
  for (const laneX of CONFIG.TUNING.laneX) {
    for (let i = 0; i < 6; i++) {
      const dash = BABYLON.MeshBuilder.CreateBox('laneDash', { width: 0.10, height: 0.02, depth: 2.2 }, scene);
      dash.position.set(laneX, 0.03, FIELD.rallyZ[1] + 6 + i * 6.2); dash.material = matRune;
      rallyMarks.push(dash);
    }
  }

  /* 侧柱阵：两列断柱夹出战场走廊 */
  const pillars: BABYLON.Mesh[] = [], bandMeshes: BABYLON.Mesh[] = [];
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
    const mergeAt = (list: BABYLON.Mesh[]): BABYLON.Mesh => {
      for (const m of list) m.bakeCurrentTransformIntoVertices();
      const merged = BABYLON.Mesh.MergeMeshes(list, true, true)!;
      merged.isPickable = false;
      return merged;
    };
    mergeAt([platform, ...pillars]);
    mergeAt([rim, inner, ...bandMeshes, ...rallyMarks]);
  }

  /* —— 亡灵之门：日光雾中的象牙石门与淡彩魔力 —— */
  const gate = new BABYLON.TransformNode('necroGate', scene);
  const obelisks: BABYLON.Mesh[] = [];
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
  /* 注：本版本 CreateTorus 无 arc 选项，运行时忽略该字段；保留原字面量维持行为一致 */
  const arch = BABYLON.MeshBuilder.CreateTorus('gateArch', { diameter: 13.6, thickness: 0.85, tessellation: 24, arc: 0.5 } as { diameter?: number; thickness?: number; tessellation?: number }, scene);
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
  const floaters: Array<{ mesh: BABYLON.Mesh; baseY: number; phase: number; spin: number }> = [];
  for (let i = 0; i < 7; i++) {
    const rock = BABYLON.MeshBuilder.CreatePolyhedron('floater' + i, { type: 3, size: 0.26 + (i % 3) * 0.12 }, scene);
    const a = i * 2.1;
    rock.position.set(Math.cos(a) * (11 + (i % 3) * 1.6), 3.0 + (i % 4) * 0.9, FIELD.spawnZ - 2 + Math.sin(i * 1.3) * 5);
    rock.material = matBoneStone; rock.parent = gate;
    floaters.push({ mesh: rock, baseY: rock.position.y, phase: i * 1.7, spin: 0.2 + (i % 3) * 0.1 });
  }

  const mage = new Mage(scene);
  mage.root.position.set(HERO.position[0], 0, HERO.position[1]);

  /* 相机：自英雄身后俯瞰北面战场（参数出处 CONFIG.TUNING.camera，阶段3e） */
  const CAM = CONFIG.TUNING.camera;
  const camera = new BABYLON.ArcRotateCamera('cam', -Math.PI / 2, CAM.beta, CAM.radius, new V3(0, 1.5, CAM.targetZ), scene);
  camera.lowerRadiusLimit = CAM.minRadius;
  camera.upperRadiusLimit = CAM.maxRadius;
  camera.lowerBetaLimit = 0.44;
  camera.upperBetaLimit = 0.78;
  camera.fov = CAM.fov;
  camera.minZ = 0.4;
  camera.maxZ = 320;
  camera.panningSensibility = 0;
  camera.wheelDeltaPercentage = 0.021;
  camera.attachControl(canvas, true);
  if (camera.inputs && camera.inputs.attached && camera.inputs.attached.pointers) {
    (camera.inputs.attached.pointers as unknown as { buttons: number[] }).buttons = [2];
  }

  /* 清晰日光 + 只让白热核心泛光：阈值压低、权重适中，亮背景下光效靠
     分层光晕与暗衬底保对比（skills.js），曝光略收避免全场过曝。 */
  const POST = CONFIG.TUNING.post;
  const post = new BABYLON.DefaultRenderingPipeline('post', true, scene, [camera]);
  post.fxaaEnabled = true;
  post.bloomEnabled = true;
  post.bloomThreshold = POST.bloomThreshold;
  post.bloomWeight = POST.bloomWeight;
  post.bloomKernel = 32;
  post.bloomScale = 0.5;
  post.imageProcessingEnabled = true;
  post.imageProcessing.toneMappingEnabled = true;
  post.imageProcessing.toneMappingType = BABYLON.ImageProcessingConfiguration.TONEMAPPING_ACES;
  post.imageProcessing.exposure = POST.exposure;
  post.imageProcessing.contrast = POST.contrast;
  /* 本版本 DefaultRenderingPipeline 无 vignetteEnabled 存取器；原 JS 此行运行时为无害赋值，原样保留 */
  (post as unknown as { vignetteEnabled: boolean }).vignetteEnabled = false;
  post.grainEnabled = false;

  const ring = new TargetRing(scene);

  /* 电影化镜头状态（技能系统写入，Core 只叠加不累积） */
  const cinematic: GameCinematic = { focus: null, intensity: 0, shake: 0, shakeEnabled: false };
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
    applyTheme(theme: ThemeColors | null | undefined): void {
      if (!theme) return;
      const fogC = C3.FromHexString(theme.fog);
      scene.fogColor.copyFrom(fogC);
      scene.clearColor!.set(fogC.r, fogC.g, fogC.b, 1);
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
      gateGlow._spriteMat!.setColor4('uColor', new C4(gateC.r, gateC.g, gateC.b, 0.12));
      moon.diffuse.copyFrom(C3.FromHexString(theme.moon));
      wispEmitter.cfg.color = [gateC.r * 0.9, gateC.g * 0.9, gateC.b * 0.9];
    },
  } as Game;
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
    gateGlow._spriteMat!.setColor4('uColor', new C4(gb[0], gb[1], gb[2], 0.12 + (pulse - 0.9) * 0.12));
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
    /* SPELLS/Units 尚未转为模块（仍是 dev/*.js 的 window 全局），阶段2后段改为直接 import */
    const w = window as unknown as { SPELLS?: { abortAll(): void }; Units?: { clear(): void } };
    w.SPELLS?.abortAll();
    w.Units?.clear();
    window.removeEventListener('resize', onWindowResize);
    scene.dispose();
    engine.dispose();
  };

  return game;
}

/* ------------------------------ 全局兼容桥 ------------------------------ */
export const Core = { createGame, Mage, TargetRing };
// TODO(阶段2末)：全部模块转换后移除此全局桥
if (typeof window !== 'undefined') {
  (window as unknown as { Core: typeof Core }).Core = Core;
}

/* 单一入口重导出：后续模块统一从本文件取战场对象 */
export { Mage } from './mage';
export { TargetRing } from './target_ring';
