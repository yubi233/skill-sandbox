/* ============================================================================
   effects.ts — 命中火花 / 弓光 / 全局 FX 发射器池（自 dev/entities.js 拆出为 ESM）
   fxEmitters 按原文常驻、从不回收（审计已记录，阶段3 卫生项，行为保持不变）。
   与 units 的环：Units.fxPool 只在函数体内运行期读取（ESM 活绑定，初始化期零访问）。
   ========================================================================== */
import { FX, type EmitterCfg } from '../particles';
import { Units, type Ally } from './units';
import type { Game } from '../scene';

const { rand, randSpread } = FX;

type FxEmitter = InstanceType<typeof FX.Emitter>;

/* ------------------------------ 通用 FX 发射器池 ------------------------------ */
export const fxEmitters: Record<string, FxEmitter> = {};
export function ensureFx(name: string, cfg: EmitterCfg): FxEmitter {
  if (!fxEmitters[name]) {
    fxEmitters[name] = new FX.Emitter(FX.layers[name] || FX.layers.glow, cfg);
  }
  return fxEmitters[name];
}

/* ------------------------------ 命中火花 ------------------------------ */
export function hitSpark(game: Game, x: number, y: number, z: number, hex: string): void {
  const [r, g, b] = FX.hexToRgb(hex);
  Units.fxPool.burst(game, 'spark', 5, x, y, z, () => ({
    x: randSpread(2.4), y: rand(0.5, 2.2), z: randSpread(2.4),
  }), { color: [r, g, b], life: [0.18, 0.4], size0: [0.05, 0.12], size1: [0.01, 0.03], alpha: [0.5, 0.9], turb: 0.4 });
}
export function bowFlash(game: Game, ally: Ally): void {
  const [r, g, b] = FX.hexToRgb('#ffe6a3');
  Units.fxPool.burst(game, 'spark', 3, ally.x, 1.25, ally.z + 0.3, () => ({
    x: randSpread(1.2), y: rand(0.2, 0.8), z: rand(1.5, 3),
  }), { color: [r, g, b], life: [0.12, 0.26], size0: [0.04, 0.09], size1: [0.008, 0.02], alpha: [0.5, 0.8], turb: 0.2 });
}
