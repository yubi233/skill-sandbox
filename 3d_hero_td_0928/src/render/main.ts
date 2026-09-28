/* ==========================================================================
   main.ts — 启动、错误遥测与统一时间步
   （自 dev/main.js 移植为 ESM，阶段2 第8步；阶段3d 改固定 60Hz 逻辑步）
   显式流水线：每渲染帧 = 累积真实帧时长 → 按 TICK 步进若干逻辑步
   （update(时间) → DIRECTOR(波次) → Units(实体) → SPELLS(法术) → FX(粒子)
   → lateUpdate(姿态/镜头) → updateAim(瞄准圈) → UI）→ 排水 gameEvents 一次
   （UI.handleEvents 分发）→ game.render。
   输入/瞄准状态与快捷键见 ./input（attachInput）。
   ========================================================================== */
import { CONFIG } from '../core/config';
import { DIRECTOR } from '../core/director';
import { gameEvents, type GameEvent } from '../core/events';
import { gameRng } from '../core/rng';
import { createGame, type Game } from './scene';
import { Units } from './entities/units';
import { SPELLS } from './skills';
import { FX } from './particles';
import { UI } from './ui';
import { attachInput, type GameWithAim } from './input';
import './debug_globals';

/* ------------------------------ 错误遥测（模块求值即挂接） ------------------------------ */
const w = window as unknown as { __errors: string[]; __game?: Game; __seed?: number };
w.__errors = [];
const originalError = console.error.bind(console);
console.error = function (...args: unknown[]) {
  w.__errors.push(args.map(String).join(' '));
  originalError(...args);
};
window.addEventListener('error', (e) => {
  w.__errors.push('onerror: ' + e.message + ' @ ' + (e.filename || '') + ':' + e.lineno);
});
window.addEventListener('unhandledrejection', (e) => {
  w.__errors.push('unhandledrejection: ' + String(e.reason));
});

function boot(): void {
  /* 启动即校验注册表：数值接线问题一次全部暴露 */
  const problems = CONFIG.validate();
  if (problems.length) console.error('[config] 注册表校验失败: ' + problems.join(' | '));

  /* —— 种子注入（阶段3d）：?seed=<n> 复现战斗随机；缺省用时钟。
     必须在一切 bind 之前，首波出怪散布即走 gameRng.combat。 —— */
  const rawSeed = new URLSearchParams(location.search).get('seed');
  const base = rawSeed !== null && Number.isFinite(Number(rawSeed))
    ? Number(rawSeed) >>> 0
    : Date.now() & 0xffffffff;
  gameRng.reseed(base);
  w.__seed = base;   // 探针可读：window.__seed === 本次对局的基础种子

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const game = createGame(canvas);
  w.__game = game;
  Units.bind(game);
  DIRECTOR.bind(game);
  UI.init(game);
  attachInput(game, canvas);

  /* —— 阶段2 依赖倒置的收口：core 导演经 DirectorWorld 钩子驱动世界，
     render 是唯一实现方（旧桥删除时由本处接管接线）。 —— */
  DIRECTOR.bindWorld({
    clearWorld: () => Units.clear(),
    spawnEnemy: (defKey, x, z) => Units.spawnEnemy(defKey, x, z),
    spawnAlly: (key, stats) => Units.spawnAlly(key, stats),
    allies: () => Units.allies,
    aliveEnemies: () => Units.aliveEnemies(),
    dyingCount: () => Units.dying.length,
    resetSpells: () => SPELLS.reset(),
    shake: (amount) => {
      game.cinematic.shake = Math.max(game.cinematic.shake, amount);
    },
    applyTheme: (theme) => game.applyTheme(theme),
  });

  /* —— 逻辑步（各段与旧 tick 一一对应，仅 dt 恒为 TICK）：
     钳制 dt → update → !paused: DIRECTOR/Units/SPELLS/FX → lateUpdate
     → updateAim(瞄准圈) → UI。渲染移到帧尾统一执行（见下方 step）。 —— */
  const updateAim = (game as GameWithAim).__updateAim;
  game.tick = function (dt) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
    game.frameDt = dt;
    game.update(dt);
    if (!game.paused) {
      DIRECTOR.update(dt);
      Units.update(dt);
      SPELLS.update(game, dt);
      FX.update(dt);
    }
    game.lateUpdate(dt);
    updateAim(dt);
    UI.update(dt);
  };

  /* —— 统一时间步（阶段3d：固定 60Hz 累加器）：
     真实帧时长（钳 ≤0.25s 防螺旋追帧）累积进 acc，按 TICK 逐逻辑步推进；
     每渲染帧至多 6 步，步满仍有积压则丢弃（慢机表现为慢动作而非死亡螺旋）。
     帧尾排水 gameEvents 一次（多逻辑步也只排一次，UI.handleEvents 分发），
     最后 game.render 恰好一帧。 —— */
  const TICK = 1 / 60;
  const MAX_STEPS = 6;
  const MAX_CATCHUP_STEPS = 180;   // 看门狗补帧单次追步上限（嵌入式 WebView 停摆）
  let acc = 0;
  const drained: GameEvent[] = []; // drain 复用缓冲，稳态零分配
  const step = (now: number, catchUp = false) => {
    const realDt = Math.min((now - lastRenderedFrame) / 1000, 0.25);
    lastRenderedFrame = now;
    try {
      acc += realDt;
      const maxSteps = catchUp ? MAX_CATCHUP_STEPS : MAX_STEPS;
      let steps = 0;
      while (acc >= TICK && steps < maxSteps) { game.tick(TICK); acc -= TICK; steps++; }
      if (!catchUp && steps === MAX_STEPS) acc = 0;   // 积压丢弃，避免螺旋死亡
      gameEvents.drain(drained);
      if (drained.length) UI.handleEvents(drained);
      game.render();
    } catch (e) {
      const err = e as { stack?: string } | null;
      const message = 'tick: ' + (err && err.stack ? err.stack : String(e));
      if (!w.__errors.includes(message)) w.__errors.push(message);
    }
  };

  let lastNativeFrame = performance.now();
  let lastRenderedFrame = lastNativeFrame;
  game.renderPaused = false;
  game.engine.runRenderLoop(() => {
    const now = performance.now(); lastNativeFrame = now;
    if (!game.renderPaused) step(now);
  });
  /* 部分嵌入式 WebView 在页面可见时仍暂停 RAF；仅在原生帧停滞时补帧
     （catchUp=true：单次最多追 MAX_CATCHUP_STEPS 步且不丢积压）。 */
  const watchdog = setInterval(() => {
    const now = performance.now();
    if (document.hidden || game.renderPaused || now - lastNativeFrame < 250) return;
    game.engine.beginFrame();
    try { step(now, true); } finally { game.engine.endFrame(); }
  }, 33);
  game.__watchdog = watchdog;
  window.addEventListener('pagehide', () => clearInterval(watchdog), { once: true });

  /* 调试手柄（参考 survivors 的 __dbg）：确定性推进 N 秒模拟并排水事件，
     供探针/自动化在 WebView 节流或看门狗被 pagehide 清除时使用。 */
  (w as unknown as { __pump: (seconds: number) => void }).__pump = (seconds: number) => {
    const steps = Math.max(0, Math.round(seconds * 60));
    for (let i = 0; i < steps; i++) game.tick(TICK);
    gameEvents.drain(drained);
    if (drained.length) UI.handleEvents(drained);
    game.render();
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
