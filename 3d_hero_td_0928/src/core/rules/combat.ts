/* ============================================================================
   combat.ts — 战斗策略纯函数（阶段3c：从 render 层收编进 core）
   原则：全部函数无副作用、不依赖 Babylon/DOM；单位以最小结构视图传入
   （x/z/alive/def.reach/def.speed/speedNow），由调用方（skills/input）供血。
   覆盖：自动锁定目标评分、移动目标提前量、施法校验顺序、自动施法门控。
   tests/combat.test.ts 用表测试锁死这些策略。
   ========================================================================== */

import { CONFIG } from '../config';

/** 目标/盟友的最小结构视图（Units.Enemy/Ally 天然满足）。 */
export interface CombatUnitView {
  x: number;
  z: number;
  alive: boolean;
  def: { reach: number; speed: number };
  speedNow?: () => number;
}

/** 施法相关的最小参数视图（SpellProfile 的子集 + 常量延迟）。 */
export interface CastTuningView {
  windup: number;
  flightSpeed: number;
  range: number;
  radius: number;
}

const heroPos = (): { x: number; z: number } => ({ x: CONFIG.HERO.position[0], z: CONFIG.FIELD.heroZ });

/* ------------------------------ 目标评分 ------------------------------ */

/** 自动锁定：射程内「越靠近防线 + 周边越密」者胜（与历史策略一致）。 */
export function pickAutoTarget(
  enemies: readonly CombatUnitView[],
  range: number,
  radius: number,
): CombatUnitView | null {
  const hero = heroPos();
  let best: CombatUnitView | null = null;
  let bestScore = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (Math.hypot(e.x - hero.x, e.z - hero.z) > range) continue;
    let score = 1 + (CONFIG.FIELD.heroZ + 46 - e.z) * 0.04; /* 越靠近防线越优先 */
    for (const o of enemies) {
      if (o === e || !o.alive) continue;
      if (Math.hypot(o.x - e.x, o.z - e.z) <= radius) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** 空格手动锁定：射程内最靠前（z 最小）的威胁——与自动火球的密度评分是两种策略。 */
export function pickFrontTarget(enemies: readonly CombatUnitView[], range: number): CombatUnitView | null {
  const hero = heroPos();
  let target: CombatUnitView | null = null;
  let bestZ = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (Math.hypot(e.x - hero.x, e.z - hero.z) > range) continue;
    if (e.z < bestZ) {
      bestZ = e.z;
      target = e;
    }
  }
  return target;
}

/* ------------------------------ 移动目标提前量 ------------------------------ */

/** 施法前摇 + 释放 + 飞行的总延迟常数（与法术阶段机一致）。 */
export const RELEASE_DELAY = 0.16;
/** 近段合围的判定线：enemy.z 越过 hero.z + FAR_SEGMENT 后直奔英雄。 */
export const FAR_SEGMENT = 14;
/** 直奔英雄时的额外判定余量。 */
export const HERO_REACH_MARGIN = 0.3;

/**
 * 移动目标提前量：预测敌人施法结算时的位置（朝当前接近目标方向），
 * 距离钳制在「到接近目标的剩余路程」内。
 */
export function leadPoint(
  enemy: CombatUnitView,
  tuning: CastTuningView,
  allies: readonly CombatUnitView[],
): { x: number; z: number } | null {
  if (!enemy.alive) return null;
  const hero = heroPos();
  let toward: CombatUnitView | { x: number; z: number } = hero;
  let near = 4.2;
  for (const ally of allies) {
    if (!ally.alive) continue;
    const d = Math.hypot(ally.x - enemy.x, ally.z - enemy.z);
    if (d < near) {
      near = d;
      toward = ally;
    }
  }
  const dx = toward.x - enemy.x;
  const dz = toward.z - enemy.z;
  const remaining = Math.hypot(dx, dz);
  const reach = enemy.def.reach + (toward === hero ? HERO_REACH_MARGIN : 0);
  const speed = enemy.speedNow ? enemy.speedNow() : enemy.def.speed;
  const range = Math.hypot(enemy.x - hero.x, enemy.z - hero.z);
  const flight = tuning.flightSpeed > 0 ? range / (tuning.flightSpeed + speed) : 0;
  const travel = Math.min(Math.max(0, remaining - reach), speed * (tuning.windup + RELEASE_DELAY + flight));
  if (toward === hero && enemy.z > hero.z + FAR_SEGMENT) return { x: enemy.x, z: enemy.z - travel };
  const k = remaining > 0 ? travel / remaining : 0;
  return { x: enemy.x + dx * k, z: enemy.z + dz * k };
}

/* ------------------------------ 施法校验顺序 ------------------------------ */

export type CastCheck =
  | 'ok'
  | 'not-in-run'
  | 'no-selection'
  | 'unknown'
  | 'not-owned'
  | 'cooldown'
  | 'out-of-range';

export interface CastCheckInput {
  inRun: boolean;
  selectedId: number | null;
  known: boolean;
  owned: boolean;
  cooldownReady: boolean;
  distance: number;
  range: number;
}

/** 手动施法校验的完整顺序（input.tryCast 的决策核心，toast 由调用方映射）。 */
export function checkCast(input: CastCheckInput): CastCheck {
  if (!input.inRun) return 'not-in-run';
  if (!input.selectedId) return 'no-selection';
  if (!input.known) return 'unknown';
  if (!input.owned) return 'not-owned';
  if (!input.cooldownReady) return 'cooldown';
  if (input.distance > input.range) return 'out-of-range';
  return 'ok';
}

/* ------------------------------ 自动施法门控 ------------------------------ */

export interface AutoCastGateInput {
  stateIsBattle: boolean;
  completedDelves: number;
  owned: boolean;
  autoRank: number;
  cooldownReady: boolean;
  activeCasts: number;
  castBudget: number;
}

/** 自动施法每 0.25s 的门控判定（时序节流留在调用方）。 */
export function shouldAutoCast(input: AutoCastGateInput): boolean {
  if (!input.stateIsBattle) return false;
  if (input.completedDelves === 0) return false; // 首次出战：手动火球，无任何自动化
  if (!input.owned || input.autoRank <= 0) return false;
  if (!input.cooldownReady) return false;
  return input.activeCasts < input.castBudget;
}
