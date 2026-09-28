/* ==========================================================================
   main.ts — 启动、错误遥测与统一时间步
   （自 dev/main.js 移植为 ESM，阶段2 第8步；数值与行为保持与原文一致）
   显式流水线：update(时间) → DIRECTOR(波次) → Units(实体) → SPELLS(法术)
   → FX(粒子) → lateUpdate(姿态/镜头) → updateAim(瞄准圈) → UI → render。
   输入/瞄准状态与快捷键见 ./input（attachInput）。
   ========================================================================== */
import { CONFIG } from '../core/config';
import { DIRECTOR } from '../core/director';
import { createGame, type Game } from './scene';
import { Units } from './entities/units';
import { SPELLS } from './skills';
import { FX } from './particles';
import { UI } from './ui';
import { attachInput, type GameWithAim } from './input';

/* ------------------------------ 错误遥测（模块求值即挂接） ------------------------------ */
const w = window as unknown as { __errors: string[]; __game?: Game };
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

  const canvas = document.getElementById('scene') as HTMLCanvasElement;
  const game = createGame(canvas);
  w.__game = game;
  Units.bind(game);
  DIRECTOR.bind(game);
  UI.init(game);
  attachInput(game, canvas);

  /* —— 统一时间步（与 dev/main.js 逐行对齐）：
     钳制 dt → update → !paused: DIRECTOR/Units/SPELLS/FX → lateUpdate
     → updateAim(瞄准圈) → UI → render —— */
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
    game.render();
  };

  let lastNativeFrame = performance.now();
  let lastRenderedFrame = lastNativeFrame;
  game.renderPaused = false;
  const draw = (now: number) => {
    const dt = Math.min((now - lastRenderedFrame) / 1000, 0.05);
    lastRenderedFrame = now;
    try {
      game.tick(dt);
    } catch (e) {
      const err = e as { stack?: string } | null;
      const message = 'tick: ' + (err && err.stack ? err.stack : String(e));
      if (!w.__errors.includes(message)) w.__errors.push(message);
    }
  };
  game.engine.runRenderLoop(() => {
    const now = performance.now(); lastNativeFrame = now;
    if (!game.renderPaused) draw(now);
  });
  /* 部分嵌入式 WebView 在页面可见时仍暂停 RAF；仅在原生帧停滞时补帧 */
  const watchdog = setInterval(() => {
    const now = performance.now();
    if (document.hidden || game.renderPaused || now - lastNativeFrame < 250) return;
    game.engine.beginFrame();
    try { draw(now); } finally { game.engine.endFrame(); }
  }, 33);
  game.__watchdog = watchdog;
  window.addEventListener('pagehide', () => clearInterval(watchdog), { once: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
