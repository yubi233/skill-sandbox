/* ============================================================================
   stats.ts — 统一数值源（阶段3b：消灭「预览文案与实际数值不一致」）
   原则：每一项成长的阶跃常量只在这里定义一次（STEPS）；
   - 实际战斗数值 = spellTuning / allyStats / 各乘数函数；
   - 营地预览文案 = upgradePreview，内部同样调用上述函数（不再是第二份公式）；
   - tests/rules.test.ts 用「current(lv+1) === next(lv)」迁移一致性 + 抽样对照
     锁死两侧。
   ========================================================================== */

import { CONFIG, type SpellDef } from '../config';

/** 任意等级表（DIRECTOR.levels 的只读视图）。缺省键 = 0 阶。 */
export interface StatLevels {
  readonly [key: string]: number | undefined;
}

/** 全部成长阶跃常量——唯一的数值出处。改平衡只改这里。 */
export const STEPS = {
  spellPower: 0.18,          // 每阶法术伤害 +18%
  surge: 0.07,               // 每阶冷却 -7%
  surgeFloor: 0.55,          // 冷却乘数下限
  cooldownFloor: 0.6,        // 冷却秒数下限（profile 契约）
  fireDamage: 0.25,          // 烈焰精通每阶伤害 +25%
  fireRadius: 0.12,          // 烈焰精通每阶半径 +12%
  frostDamage: 0.15,         // 霜寒精通每阶伤害 +15%
  frostSlow: 0.10,           // 霜寒精通每阶减速加深
  frostSlowFloor: 0.15,      // 减速系数下限
  frostDuration: 0.8,        // 霜寒精通每阶持续 +0.8s
  thunderDamage: 0.20,       // 雷霆精通每阶伤害 +20%
  oath: 0.15,                // 誓约武备每阶全军攻击 +15%
  drillHp: 0.20,             // 誓卫操练每阶生命 +20%
  drillInterval: 0.10,       // 誓卫操练每阶攻速 +10%
  loreAtk: 0.20,             // 猎手战技每阶攻击 +20%
  intervalFloor: 0.5,        // 攻击间隔乘数下限
  musterPer: 2,              // 扩充军召每阶上限 +2
  fortitudeHp: 25,           // 旅者体魄每阶生命 +25
  greed: 0.12,               // 慧眼拾金每阶金币 +12%
} as const;

const lv = (levels: StatLevels, key: string): number => levels[key] ?? 0;
const pct = (n: number): string => Math.round(n * 100) + '%';

/* ------------------------------ 全局乘数 ------------------------------ */

export function spellPowerMul(levels: StatLevels): number {
  return 1 + STEPS.spellPower * lv(levels, 'spellPower');
}

export function cooldownMul(levels: StatLevels): number {
  return Math.max(STEPS.surgeFloor, 1 - STEPS.surge * lv(levels, 'surge'));
}

export function goldMul(levels: StatLevels): number {
  return 1 + STEPS.greed * lv(levels, 'greed');
}

/* ------------------------------ 军团 ------------------------------ */

export interface AllyStatMul {
  atk: number;
  hp: number;
  interval: number;
}

export function allyStats(levels: StatLevels, allyKey: string): AllyStatMul {
  let atk = 1 + STEPS.oath * lv(levels, 'oath');
  let hp = 1;
  let interval = 1;
  if (allyKey === 'guard') {
    hp = 1 + STEPS.drillHp * lv(levels, 'guardDrill');
    interval = 1 - STEPS.drillInterval * lv(levels, 'guardDrill');
  } else if (allyKey === 'hunter') {
    atk *= 1 + STEPS.loreAtk * lv(levels, 'hunterLore');
    interval = 1 - STEPS.drillInterval * lv(levels, 'hunterLore');
  }
  return { atk, hp, interval: Math.max(STEPS.intervalFloor, interval) };
}

export function allyCap(levels: StatLevels, allyKey: string): number {
  const def = CONFIG.allyOf(allyKey);
  return def ? def.cap + STEPS.musterPer * lv(levels, 'muster') : 0;
}

/* ------------------------------ 法术实际数值 ------------------------------ */

export interface SpellSlowTuning {
  factor: number;
  duration: number;
}
export interface SpellChainTuning {
  count: number;
  damage: number;
  range: number;
}
export interface SpellTuning {
  damage: number;
  radius: number;
  cooldown: number;
  slow: SpellSlowTuning | null;
  chain: SpellChainTuning | null;
}

/** 与 render/skills.ts 的 profile() 同源：基线 × 全局乘数 × 精通阶。 */
export function spellTuning(def: SpellDef, levels: StatLevels): SpellTuning {
  const dmgMul = spellPowerMul(levels);
  let damage = def.damage * dmgMul;
  const slow = def.slow ? { factor: def.slow.factor, duration: def.slow.duration } : null;
  const chain = def.chain ? { count: def.chain.count, damage: def.chain.damage * dmgMul, range: def.chain.range } : null;
  if (def.id === 1) {
    damage *= 1 + STEPS.fireDamage * lv(levels, 'fireMastery');
  } else if (def.id === 2) {
    damage *= 1 + STEPS.frostDamage * lv(levels, 'frostMastery');
    if (slow) {
      slow.factor = Math.max(STEPS.frostSlowFloor, slow.factor - STEPS.frostSlow * lv(levels, 'frostMastery'));
      slow.duration += STEPS.frostDuration * lv(levels, 'frostMastery');
    }
  } else if (def.id === 3) {
    damage *= 1 + STEPS.thunderDamage * lv(levels, 'thunderMastery');
    if (chain) chain.count += lv(levels, 'thunderMastery');
  }
  return {
    damage,
    radius: def.radius * (def.id === 1 ? 1 + STEPS.fireRadius * lv(levels, 'fireMastery') : 1),
    cooldown: Math.max(STEPS.cooldownFloor, def.cooldown * cooldownMul(levels)),
    slow,
    chain,
  };
}

/* ------------------------------ 营地预览文案 ------------------------------ */

/** 与历史文案逐字节一致；每个分支的数据都来自上方函数（单一出处）。 */
export function upgradePreview(levels: StatLevels, key: string): { current: string; next: string } {
  const def = CONFIG.upgradeOf(key);
  if (!def) return { current: '', next: '' };
  const base = lv(levels, key);
  const effect = (rank: number): string => {
    const at = (patch: StatLevels): StatLevels => ({ ...levels, [key]: rank, ...patch });
    switch (key) {
      case 'spellPower':
        return pct(spellPowerMul(at({}))) + ' 法术伤害';
      case 'surge':
        return spellTuning(CONFIG.spellOf(1)!, at({})).cooldown.toFixed(2) + 's 火球冷却';
      case 'fireMastery': {
        const t = spellTuning(CONFIG.spellOf(1)!, at({}));
        return Math.round(t.damage) + ' 伤害 · ' + t.radius.toFixed(1) + 'm';
      }
      case 'frostMastery': {
        const t = spellTuning(CONFIG.spellOf(2)!, at({}));
        return pct(1 - t.slow!.factor) + ' 减速 · ' + t.slow!.duration.toFixed(1) + 's';
      }
      case 'thunderMastery': {
        const t = spellTuning(CONFIG.spellOf(3)!, at({}));
        return t.chain!.count + ' 次连锁 · ' + pct(1 + STEPS.thunderDamage * rank) + ' 伤害';
      }
      case 'resounding':
        return rank + ' 次弹跳';
      case 'oath':
        return pct(1 + STEPS.oath * rank) + ' 全军攻击';
      case 'guardDrill': {
        const s = allyStats(at({}), 'guard');
        return Math.round(CONFIG.allyOf('guard')!.hp * s.hp) + ' 生命 · ' +
          (CONFIG.allyOf('guard')!.atkInterval * s.interval).toFixed(2) + 's';
      }
      case 'hunterLore': {
        const s = allyStats(at({ oath: 0 }), 'hunter');
        return pct(s.atk) + ' 攻击 · ' + (CONFIG.allyOf('hunter')!.atkInterval * s.interval).toFixed(2) + 's';
      }
      case 'muster':
        return allyCap(at({}), 'guard') + ' / 军种';
      case 'fortitude':
        return (CONFIG.HERO.hp + STEPS.fortitudeHp * rank) + ' 生命';
      case 'spiritDrain':
        return '+' + rank + ' 生命 / 击杀';
      case 'greed':
        return pct(goldMul(at({}))) + ' 击杀金币';
      case 'lastStand':
        return rank ? '每次出战 1 次' : '未获得保护';
      case 'autoFire':
      case 'autoFrost':
      case 'autoThunder':
        return rank ? '自动施放' : '手动施放';
      default:
        return rank ? '永久解锁' : '尚未学会';
    }
  };
  return { current: effect(base), next: effect(Math.min(def.max, base + 1)) };
}
