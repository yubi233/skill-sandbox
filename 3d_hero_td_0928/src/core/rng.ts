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
