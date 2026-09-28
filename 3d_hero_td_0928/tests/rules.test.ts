/* 阶段3b 验收：统一数值源的一致性契约。
   1) 迁移一致性：upgradePreview 在相邻两阶上 current(lv+1) === next(lv)；
   2) 文案抽检：与历史营地文案逐字节一致；
   3) render↔core 同源：SPELLS.profile() 与 spellTuning() 逐字段相等；
   4) 军团乘数/上限与 director 委托实现一致。 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CONFIG, SpellDef } from '../src/core/config';
import { DIRECTOR } from '../src/core/director';
import { spellTuning, upgradePreview, allyStats, allyCap, STEPS } from '../src/core/rules/stats';
import { SPELLS } from '../src/render/skills';

const zeros = (): Record<string, number> => {
  const lv: Record<string, number> = {};
  for (const u of CONFIG.UPGRADES) lv[u.key] = 0;
  return lv;
};

test('预览迁移一致性：current(lv+1) === next(lv) 对全部节点全部阶成立', () => {
  for (const def of CONFIG.UPGRADES) {
    for (let lv = 0; lv < def.max; lv++) {
      const low = zeros(); low[def.key] = lv;
      const high = zeros(); high[def.key] = lv + 1;
      const a = upgradePreview(low, def.key);
      const b = upgradePreview(high, def.key);
      assert.strictEqual(a.next, b.current,
        `${def.key} 第 ${lv}→${lv + 1} 阶：next("${a.next}") ≠ 下一阶 current("${b.current}")`);
    }
  }
});

test('文案抽检：与历史营地文案逐字节一致', () => {
  const lv0 = zeros();
  assert.equal(upgradePreview(lv0, 'spellPower').current, '100% 法术伤害');
  assert.equal(upgradePreview(lv0, 'spellPower').next, '118% 法术伤害');
  assert.equal(upgradePreview(lv0, 'surge').current, '2.60s 火球冷却');
  assert.equal(upgradePreview(lv0, 'surge').next, '2.42s 火球冷却');
  assert.equal(upgradePreview(lv0, 'fireMastery').current, '36 伤害 · 4.2m');
  assert.equal(upgradePreview(lv0, 'fireMastery').next, '45 伤害 · 4.7m');
  assert.equal(upgradePreview(lv0, 'muster').next, '8 / 军种');
  assert.equal(upgradePreview(lv0, 'fortitude').next, '125 生命');
  assert.equal(upgradePreview(lv0, 'greed').next, '112% 击杀金币');
  assert.equal(upgradePreview(lv0, 'autoFire').current, '手动施放');
  assert.equal(upgradePreview(lv0, 'autoFire').next, '自动施放');
});

test('render↔core 同源：SPELLS.profile 与 spellTuning 逐字段相等', () => {
  const fire = CONFIG.spellOf(1) as SpellDef;
  for (const levels of [
    {},
    { spellPower: 2 },
    { fireMastery: 3 },
    { spellPower: 8, surge: 6, fireMastery: 4 },
  ]) {
    DIRECTOR.levels = levels as Record<string, number>;
    const p = SPELLS.profile(1)!;
    const t = spellTuning(fire, levels);
    assert.equal(p.damage, t.damage, `damage @${JSON.stringify(levels)}`);
    assert.equal(p.radius, t.radius, `radius @${JSON.stringify(levels)}`);
    assert.equal(p.cooldown, t.cooldown, `cooldown @${JSON.stringify(levels)}`);
  }
  // 烈焰精通满阶的具体数值锚点（36 × 1.18³ 系 spellPower 8 阶 × 精通 4 阶）
  const maxed = spellTuning(fire, { spellPower: 8, fireMastery: 4 });
  assert.equal(maxed.damage, 36 * (1 + STEPS.spellPower * 8) * (1 + STEPS.fireDamage * 4));
});

test('军团乘数/上限与 director 委托一致，预览数字同源', () => {
  const levels = { oath: 2, guardDrill: 3, hunterLore: 1, muster: 2 };
  DIRECTOR.levels = levels as Record<string, number>;
  assert.deepEqual(DIRECTOR.allyStats('guard'), allyStats(levels, 'guard'));
  assert.deepEqual(DIRECTOR.allyStats('hunter'), allyStats(levels, 'hunter'));
  assert.equal(DIRECTOR.capOf('guard'), allyCap(levels, 'guard'));
  assert.equal(DIRECTOR.capOf('guard'), 6 + STEPS.musterPer * 2);
  assert.equal(DIRECTOR.goldMul(), goldMulLocal(levels));
  function goldMulLocal(l: Record<string, number>): number { return 1 + STEPS.greed * (l.greed ?? 0); }
  // guardDrill 预览的数字直接来自 allyStats
  const preview = upgradePreview({ ...levels }, 'guardDrill');
  assert.ok(preview.current.includes(String(Math.round(90 * (1 + STEPS.drillHp * 3)))) );
});
