/* ============================================================================
   rng.ts — 种子随机（阶段3：确定性契约的地基）
   mulberry32 参考实现；领域种子派生保证「表现层变化不影响战斗结果」。
   约定：核心逻辑的全部随机必须走 Rng，禁止 Math.random（ cosmetics 除外，
   由调用方显式选择领域）。?seed=<n> URL 参数在 render/main 注入基础种子。
   ========================================================================== */

export type Rng = () => number;

/** mulberry32：32 位状态的小型 PRNG，分布质量足够游戏用途且极快。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a 字符串散列：把领域名折叠进种子。 */
export function hashStr(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 领域种子派生：deriveSeed(base, 'combat') 与 deriveSeed(base, 'cosmetic') 互不相干。 */
export function deriveSeed(base: number, scope: string): number {
  return (hashStr(scope) ^ Math.imul(base >>> 0, 0x9e3779b1)) >>> 0;
}

/** 便捷包装：[min, max) 均匀浮点 / 整数。 */
export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}
export function rngInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}

/* ============================================================================
   领域 RNG 分流（阶段3d：种子确定性的接线点）
   - combat   ：一切影响玩法结果的随机（出怪散布、单位首攻节拍）。?seed= 注入
     后可逐位复现；分布与 Math.random 同为均匀，仅换成可复现源。
   - cosmetic ：预留的表现域（当前无人使用）。
   - 其余 Math.random 保持未播种：FX 粒子抖动、walkPhase/bob、镜头震屏等纯
     表现随机继续走 FX 的 Math.random；FX.time 是时钟，同样不播种。
     原则：表现层随机不得反过来影响战斗结果（领域派生保证两域互不相干）。
   ========================================================================== */
export const gameRng = {
  combat: mulberry32(1),
  cosmetic: mulberry32(1),
  /** 以基础种子重派生两域（render/main 启动时注入 ?seed=，测试可显式重置）。 */
  reseed(base: number): void {
    this.combat = mulberry32(deriveSeed(base, 'combat'));
    this.cosmetic = mulberry32(deriveSeed(base, 'cosmetic'));
  },
};

/** 战斗域散布扰动：(rng()*2-1)*spread，与 FX.randSpread 同式，但走 gameRng.combat。 */
export function combatSpread(spread: number): number {
  return (gameRng.combat() * 2 - 1) * spread;
}
