'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame } = require('./harness.js');

const ctx = loadGame();
const { CONFIG } = ctx;

test('注册表校验干净（接线问题一次暴露）', () => {
  const problems = CONFIG.validate();
  assert.strictEqual(problems.length, 0, 'validate 应返回空表: ' + problems.join(' | '));
});

test('法术/敌人/盟友/升级查表闭合', () => {
  for (const s of CONFIG.SPELLS) assert.strictEqual(CONFIG.spellOf(s.id).name, s.name);
  for (const e of CONFIG.ENEMIES) assert.strictEqual(CONFIG.enemyOf(e.key).name, e.name);
  for (const a of CONFIG.ALLIES) assert.strictEqual(CONFIG.allyOf(a.key).name, a.name);
  for (const u of CONFIG.UPGRADES) assert.strictEqual(CONFIG.upgradeOf(u.key).name, u.name);
  assert.strictEqual(CONFIG.enemyOf('nope'), null);
});

test('升级费用随等级递增且有上限', () => {
  for (const u of CONFIG.UPGRADES) {
    let prev = -1;
    for (let lv = 0; lv < Math.min(u.max, 8); lv++) {
      const cost = CONFIG.upgradeCost(u, lv);
      assert.ok(cost > prev, u.name + ' 费用应递增');
      prev = cost;
    }
    assert.ok(u.max >= 1 && u.max <= 99);
  }
});

test('无尽波次生成：前 60 波逐波派生、头目每 5 波轮换、瘴蚀随波加深', () => {
  assert.ok(!CONFIG.waveDef(1).groups.some((g) => CONFIG.enemyOf(g.key).boss), '第 1 波无头目');
  for (let w = 1; w <= 60; w++) {
    const def = CONFIG.waveDef(w);
    let units = 0;
    for (const g of def.groups) units += g.count;
    assert.ok(units >= 3, '第 ' + w + ' 波应有足量敌人: ' + units);
    const isBossWave = w % CONFIG.BOSS_EVERY === 0;
    const hasBoss = def.groups.some((g) => CONFIG.enemyOf(g.key).boss);
    assert.strictEqual(hasBoss, isBossWave, '第 ' + w + ' 波头目契约');
    if (isBossWave) {
      const bossKey = def.groups.find((g) => CONFIG.enemyOf(g.key).boss).key;
      const want = CONFIG.BOSS_ROTATION[Math.floor(w / CONFIG.BOSS_EVERY - 1) % CONFIG.BOSS_ROTATION.length];
      assert.strictEqual(bossKey, want, '第 ' + w + ' 波 Boss 应按波次轮换');
    }
    assert.ok(CONFIG.blightPerSec(w) >= CONFIG.blightPerSec(1), '瘴蚀应随波次不降');
  }
  const m5 = CONFIG.depthMul(5), m6 = CONFIG.depthMul(6);
  assert.ok(m6.hp > m5.hp && m6.atk > m5.atk && m6.gold > m5.gold, '深度乘数三轴递增');
  assert.ok(CONFIG.depthMul(20).hp > 3, '20 波时生命应超过 3 倍');
  assert.ok(CONFIG.blightPerSec(20) > CONFIG.blightPerSec(1) * 1.5, '瘴蚀应有长线加深');
});

test('首次波次为中路六名骸骨卒，基础火球足以击杀一名满血骸骨卒', () => {
  const groups = Array.from(CONFIG.waveDef(1).groups, (g) => ({ key: g.key, count: g.count, lane: g.lane }));
  assert.deepStrictEqual(groups, [{ key: 'grunt', count: 6, lane: 0 }]);
  assert.ok(CONFIG.waveDef(1).groups.every((g) => g.interval > 0), '首波敌人应分批入场');
  assert.strictEqual(CONFIG.spellOf(1).damage, 36);
  assert.ok(CONFIG.spellOf(1).damage >= CONFIG.enemyOf('grunt').hp * CONFIG.depthMul(1).hp);
});

test('战场几何自洽：英雄在集结行之后，出生口在北端', () => {
  const F = CONFIG.FIELD;
  assert.ok(F.heroZ < F.rallyZ[1] && F.rallyZ[1] < F.rallyZ[0] && F.rallyZ[0] < F.spawnZ);
  assert.strictEqual(CONFIG.HERO.position[1], F.heroZ);
  assert.ok(F.halfWidth > 0 && F.startGold > 0 && F.intermission > 0);
});
