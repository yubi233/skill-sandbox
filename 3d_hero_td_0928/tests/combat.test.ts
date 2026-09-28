/* 阶段3c 验收：战斗策略纯函数的表测试。
   pickAutoTarget / pickFrontTarget / leadPoint / checkCast / shouldAutoCast 的
   每条策略分支都有断言；单位用最小结构视图构造，无需 Babylon。 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  pickAutoTarget, pickFrontTarget, leadPoint, checkCast, shouldAutoCast,
  CombatUnitView, RELEASE_DELAY,
} from '../src/core/rules/combat';

const unit = (x: number, z: number, over: Partial<CombatUnitView> = {}): CombatUnitView => ({
  x, z, alive: true, def: { reach: 1.7, speed: 2.6 }, ...over,
});
const TUNING = { windup: 0.42, flightSpeed: 20, range: 34, radius: 4.2 };
const HERO = { x: 0, z: -30 };

test('pickAutoTarget：射程外不选，越靠近防线与越密者胜', () => {
  const far = unit(0, 30);                       // 距英雄 60m，射程外
  const back = unit(0, -4);                      // 靠近防线
  const front = unit(0, 2);                      // 靠近出料口
  assert.equal(pickAutoTarget([far], 34, 4.2), null, '射程外应排除');
  assert.equal(pickAutoTarget([back, front], 34, 4.2), back, '更靠近防线者优先');
  // 密度反超：front 带两个 4.2m 内邻居，防线劣势(6*0.24≈1.44)小于密度(+2)
  const near = (dx: number) => unit(dx, 2);
  assert.equal(pickAutoTarget([back, front, near(3), near(-3)], 34, 4.2), front, '密度可反超');
});

test('pickFrontTarget：射程内 z 最小者胜，射程外排除', () => {
  const a = unit(0, 0), b = unit(3, -10), out = unit(0, 20);
  assert.equal(pickFrontTarget([a, b, out], 34), b, '最靠前（z 最小）者');
  assert.equal(pickFrontTarget([out], 34), null, '射程外排除');
});

test('leadPoint：远段直奔防线时沿 z 轴提前，钳制在剩余路程内', () => {
  // z=24 的敌人 2.6m/s 直奔 hero(z=-30)：实际距离 54m → 飞行 54/(20+2.6)，
  // 延迟 = 0.42 + 0.16 + 2.3894 = 2.9694s → 提前 7.7204m（远小于剩余 52m，不钳制）
  const e = unit(0, 24);
  const p = leadPoint(e, TUNING, []);
  assert.ok(p);
  assert.equal(p!.x, 0, '直奔防线时 x 不变');
  const expected = 24 - 2.6 * (0.42 + RELEASE_DELAY + 54 / (TUNING.flightSpeed + 2.6));
  assert.ok(Math.abs(p!.z - expected) < 1e-9, `沿 z 提前: ${p!.z} ≠ ${expected}`);
  // 距防线仅 1m 时：提前量钳制在 remaining-reach = 1-(1.7+0.3) = 负 → 0（原地）
  const close = unit(0, -29);
  const pc = leadPoint(close, TUNING, []);
  assert.equal(pc!.z, -29, '贴脸敌人提前量为 0');
});

test('leadPoint：盟友 4.2m 内成为拦截目标，走向盟友而非防线', () => {
  const guard = unit(5, -20, { alive: true });
  const e = unit(5, -14, { alive: true });
  const p = leadPoint(e, TUNING, [guard]);
  // 指向盟友方向（dz<0, dx=0），提前量比例 k = travel/6
  assert.equal(p!.x, 5, '盟友在正上方时 x 不变');
  assert.ok(p!.z < -14, '朝盟友方向提前');
});

test('checkCast：完整校验顺序矩阵', () => {
  const base = { inRun: true, selectedId: 1, known: true, owned: true, cooldownReady: true, distance: 10, range: 34 };
  assert.equal(checkCast(base), 'ok');
  assert.equal(checkCast({ ...base, inRun: false }), 'not-in-run');
  assert.equal(checkCast({ ...base, selectedId: null }), 'no-selection');
  assert.equal(checkCast({ ...base, known: false }), 'unknown');
  assert.equal(checkCast({ ...base, owned: false }), 'not-owned');
  assert.equal(checkCast({ ...base, cooldownReady: false }), 'cooldown');
  assert.equal(checkCast({ ...base, distance: 35 }), 'out-of-range');
});

test('shouldAutoCast：首次下探彻底禁用自动化（即使注入了天赋）', () => {
  const base = { stateIsBattle: true, completedDelves: 1, owned: true, autoRank: 1, cooldownReady: true, activeCasts: 0, castBudget: 3 };
  assert.equal(shouldAutoCast(base), true);
  assert.equal(shouldAutoCast({ ...base, completedDelves: 0 }), false, '首返前无自动化');
  assert.equal(shouldAutoCast({ ...base, stateIsBattle: false }), false);
  assert.equal(shouldAutoCast({ ...base, owned: false }), false);
  assert.equal(shouldAutoCast({ ...base, autoRank: 0 }), false);
  assert.equal(shouldAutoCast({ ...base, cooldownReady: false }), false);
  assert.equal(shouldAutoCast({ ...base, activeCasts: 3 }), false, '并发预算');
});
