'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame, makeEngine, installPlaceholderFx, createTestGame, step } = require('./harness.js');

/* 全场模拟：导演状态机、经济、升级与胜负流转 */
function freshWorld(t) {
  const ctx = loadGame(undefined, { seed: 928 });
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);
  return { ctx, engine, scene, game };
}

test('无尽波次循环：下探推进 → 撤退/败北回营 → 天赋保留 → 再下探', (t) => {
  const w = freshWorld(t);
  const { ctx, game } = w;
  ctx.DIRECTOR.begin();
  assert.strictEqual(ctx.DIRECTOR.state, 'camp');

  /* 首次出战归来后才在营地购买天赋，跨局保留。 */
  assert.strictEqual(ctx.DIRECTOR.completedDelves, 0);
  assert.ok(ctx.DIRECTOR.enterDelve());
  assert.ok(ctx.DIRECTOR.retreat());
  assert.strictEqual(ctx.DIRECTOR.completedDelves, 1);
  ctx.DIRECTOR.gold = 800;
  assert.ok(ctx.DIRECTOR.buyUpgrade('spellPower'));
  assert.ok(ctx.DIRECTOR.buyUpgrade('fortitude'));

  /* 神装脚本：满强化 + 每次波间整备自动召满两排 */
  ctx.DIRECTOR.gold = 2000;
  ctx.DIRECTOR.levels = {
    spellPower: 12, fireMastery: 4, autoFire: 1, unlockBolt: 1,
    oath: 12, unlockGuard: 1, unlockHunter: 1, greed: 6, muster: 4,
    surge: 4, fortitude: 6, spiritDrain: 3,
  };
  const talentSnapshot = { ...ctx.DIRECTOR.levels };
  const bossWaves = [];
  ctx.DIRECTOR.on((kind, data) => {
    if (kind === 'wave' && data.hasBoss) bossWaves.push(data.wave);
    if (kind !== 'clear') return;
    for (let i = 0; i < 12; i++) {
      ctx.DIRECTOR.summon('guard');
      ctx.DIRECTOR.summon('hunter');
    }
  });

  /* 下探：无尽波次一路推进，穿过第 5 波头目，到第 7 波主动撤退 */
  assert.ok(ctx.DIRECTOR.enterDelve());
  assert.strictEqual(ctx.DIRECTOR.state, 'battle');
  assert.strictEqual(ctx.DIRECTOR.wave, 1);
  let guard = 0;
  while (ctx.DIRECTOR.wave < 7 && ctx.DIRECTOR.state !== 'defeat' && guard++ < 30 * 60 * 20) step(game, ctx, 1 / 30);
  assert.ok(ctx.DIRECTOR.wave >= 7, '无尽波次应持续推进到第 7 波: ' + ctx.DIRECTOR.wave);
  assert.ok(bossWaves.includes(5), '实际波次事件应经过第 5 波头目');
  assert.ok(ctx.DIRECTOR.retreat(), '出战中应可主动撤退');
  assert.strictEqual(ctx.DIRECTOR.state, 'camp');
  assert.strictEqual(ctx.DIRECTOR.completedDelves, 2);
  assert.strictEqual(ctx.DIRECTOR.record, 7, '史录应记到 7');
  assert.strictEqual(ctx.DIRECTOR.wave, 0);
  assert.ok(ctx.DIRECTOR.gold > 2000, '撤退保留战利品: ' + ctx.DIRECTOR.gold);
  assert.deepStrictEqual(ctx.DIRECTOR.levels, talentSnapshot, '循环全程天赋必须保留');

  /* 再下探从头开始，推进到第 10 波头目波 */
  assert.ok(ctx.DIRECTOR.enterDelve());
  assert.strictEqual(ctx.DIRECTOR.wave, 1, '下探永远从第 1 波开始');
  guard = 0;
  while (ctx.DIRECTOR.wave < 10 && ctx.DIRECTOR.state !== 'defeat' && guard++ < 30 * 60 * 24) step(game, ctx, 1 / 30);
  assert.ok(ctx.DIRECTOR.wave >= 10 || ctx.DIRECTOR.state === 'defeat',
    '应推进到第 10 波或败北: wave=' + ctx.DIRECTOR.wave);
  if (ctx.DIRECTOR.state !== 'defeat') {
    assert.ok(bossWaves.includes(10), '第二次下探应触发第 10 波头目事件');
    assert.ok(ctx.DIRECTOR.retreat());
    assert.ok(ctx.DIRECTOR.record >= 10, 'record 应至少 10');
  }
  assert.strictEqual(ctx.DIRECTOR.completedDelves, 3, '每次撤退或败北仅结算一次下探');
  assert.deepStrictEqual(ctx.DIRECTOR.levels, talentSnapshot, '再次出战后仍保留全部天赋');
  assert.ok(ctx.DIRECTOR.kills > 40, '总击杀应可观: ' + ctx.DIRECTOR.kills);
  assert.ok(ctx.__errors.length === 0, '循环全程零 console.error: ' + ctx.__errors.slice(0, 3).join(' | '));
});

test('瘴蚀：战斗中每秒扣血，随波次加深；营地里不扣', (t) => {
  const w = freshWorld(t);
  const { ctx, game } = w;
  ctx.DIRECTOR.begin();
  ctx.DIRECTOR.enterDelve();
  /* 波 1 瘴蚀 0.5/s，泵 4 秒应掉约 2 血 */
  const hp0 = ctx.DIRECTOR.heroHp;
  for (let i = 0; i < 30 * 4; i++) step(game, ctx, 1 / 30);
  const drained = hp0 - ctx.DIRECTOR.heroHp;
  assert.ok(drained > 0.5 && drained < 8, '瘴蚀应持续扣血（约 2 点）: ' + drained.toFixed(2));

  /* 波次加深曲线 */
  const b1 = ctx.CONFIG.blightPerSec(1);
  const b15 = ctx.CONFIG.blightPerSec(15);
  assert.ok(b15 > b1 * 2, '15 波瘴蚀应明显加深: ' + b1 + ' -> ' + b15);

  /* 撤退回营：state=camp 后不再扣血 */
  assert.ok(ctx.DIRECTOR.retreat());
  const hpCamp = ctx.DIRECTOR.heroHp;
  for (let i = 0; i < 60; i++) step(game, ctx, 1 / 30);
  assert.strictEqual(ctx.DIRECTOR.heroHp, hpCamp, '营地里不应扣血');
});

test('自动施法师式：点亮后冷却完毕自动投向敌群', (t) => {
  const w = freshWorld(t);
  const { ctx, game } = w;
  ctx.DIRECTOR.begin();
  ctx.DIRECTOR.enterDelve();
  const spawnPack = () => {
    for (let k = 0; k < 4; k++) ctx.Units.spawnEnemy('grunt', (k - 1.5) * 1.4, ctx.CONFIG.FIELD.heroZ + 14);
  };
  spawnPack();
  /* 未点天赋：4 秒内不应自动施放 */
  for (let i = 0; i < 30 * 4; i++) {
    if (ctx.Units.aliveEnemies().length < 2) spawnPack();
    step(game, ctx, 1 / 30);
  }
  assert.strictEqual(ctx.SPELLS.casts.length, 0, '未点亮术式不应自动施放');

  /* 首次返营后按依赖购买自动火球，再次出战才自动施法。 */
  assert.ok(ctx.DIRECTOR.retreat());
  ctx.DIRECTOR.gold = 1000;
  for (const key of ['spellPower', 'fireMastery', 'autoFire']) {
    assert.ok(ctx.DIRECTOR.buyUpgrade(key), '营地应能购买 ' + key);
  }
  assert.ok(ctx.DIRECTOR.enterDelve());
  spawnPack();
  let casted = false;
  for (let i = 0; i < 30 * 3 && !casted; i++) {
    if (ctx.Units.aliveEnemies().length < 2) spawnPack();
    step(game, ctx, 1 / 30);
    casted = ctx.SPELLS.casts.some((c) => c.def.id === 1);
  }
  assert.ok(casted, '燎原术式应自动施放火球');
});

test('裸装下探：无强化时防线会在无尽波次中被击穿，败北保留金币天赋', (t) => {
  const w = freshWorld(t);
  const { ctx, game } = w;
  ctx.DIRECTOR.begin();
  ctx.DIRECTOR.enterDelve();
  let steps = 0;
  while (ctx.DIRECTOR.state !== 'defeat' && steps < 30 * 60 * 12) {
    step(game, ctx, 1 / 30);
    steps++;
  }
  assert.strictEqual(ctx.DIRECTOR.state, 'defeat');
  assert.strictEqual(ctx.DIRECTOR.heroHp, 0);
  assert.ok(ctx.DIRECTOR.gold > 0, '败北应保留金币');
  assert.ok(ctx.DIRECTOR.record >= 1, '败北保留史录波次');
});

test('经济闭环：击杀掉金、买升级扣费、金币不足拒绝召唤', (t) => {
  const w = freshWorld(t);
  const { ctx, game } = w;
  ctx.DIRECTOR.begin();
  assert.ok(ctx.DIRECTOR.enterDelve());
  const g0 = ctx.DIRECTOR.gold;
  ctx.Units.spawnEnemy('grunt', 0, 12).takeDamage(9999);
  assert.ok(ctx.DIRECTOR.gold > g0, '击杀应掉金');
  for (let i = 0; i < 40; i++) step(game, ctx, 1 / 30);
  assert.ok(ctx.DIRECTOR.retreat());
  assert.ok(ctx.DIRECTOR.canBuyUpgrades(), '首次返营后才可升级');

  ctx.DIRECTOR.gold = 500;
  const cost = ctx.DIRECTOR.upgradeCost('spellPower');
  assert.ok(ctx.DIRECTOR.buyUpgrade('spellPower'));
  assert.strictEqual(ctx.DIRECTOR.gold, 500 - cost);
  assert.strictEqual(ctx.DIRECTOR.spellPowerMul(), 1.18);

  /* 回响碎片走魔弹支线，不再是烈焰精通的前置。 */
  assert.ok(ctx.DIRECTOR.isUnlocked('fireMastery'), '魔焰强化后直接开放烈焰精通');
  assert.ok(!ctx.DIRECTOR.isUnlocked('resounding'), '未学魔弹时仍锁定回响碎片');
  const beforeLockedBuy = ctx.DIRECTOR.gold;
  assert.ok(!ctx.DIRECTOR.buyUpgrade('resounding'));
  assert.strictEqual(ctx.DIRECTOR.gold, beforeLockedBuy, '锁定节点不得扣费');
  ctx.DIRECTOR.gold = 2000;
  for (const key of ['fireMastery', 'autoFire', 'unlockBolt', 'resounding', 'oath', 'unlockGuard']) {
    assert.ok(ctx.DIRECTOR.isUnlocked(key), key + ' 前置已满足');
    assert.ok(ctx.DIRECTOR.buyUpgrade(key), '应能购买 ' + key);
  }
  assert.strictEqual(ctx.DIRECTOR.level('fireMastery'), 1);

  /* 坚甲购买立即抬高上限并治疗 */
  ctx.DIRECTOR.heroHp = 10;
  ctx.DIRECTOR.gold = 500;
  const max0 = ctx.DIRECTOR.heroMaxHp;
  assert.ok(ctx.DIRECTOR.buyUpgrade('fortitude'));
  assert.strictEqual(ctx.DIRECTOR.heroMaxHp, max0 + 25);
  assert.strictEqual(ctx.DIRECTOR.heroHp, 35);

  /* 已解锁且处于战斗中的召唤，才能真正覆盖金币不足分支。 */
  assert.ok(ctx.DIRECTOR.enterDelve());
  ctx.DIRECTOR.gold = 1;
  const summonRejects = [];
  ctx.DIRECTOR.on((kind, data) => { if (kind === 'reject') summonRejects.push(data.reason); });
  assert.ok(ctx.DIRECTOR.ownsAlly('guard'));
  assert.ok(!ctx.DIRECTOR.summon('guard'), '金币不足应拒绝');
  assert.deepStrictEqual(summonRejects, ['gold']);
  assert.strictEqual(ctx.DIRECTOR.gold, 1);

  /* 魂息汲取：击杀回血 */
  ctx.DIRECTOR.levels.spiritDrain = 2;
  ctx.DIRECTOR.heroHp = 40;
  ctx.Units.spawnEnemy('grunt', 2, 12).takeDamage(9999);
  assert.strictEqual(ctx.DIRECTOR.heroHp, 42, '击杀应回 2 点血');
  ctx.DIRECTOR.levels.spiritDrain = 0;

  /* 最终壁垒：致死一击保留 1 HP，每局一次 */
  ctx.DIRECTOR.state = 'battle';
  ctx.DIRECTOR.levels.lastStand = 1;
  ctx.DIRECTOR.heroHp = 5;
  ctx.DIRECTOR.damageHero(50);
  assert.strictEqual(ctx.DIRECTOR.state, 'battle', '壁垒应挡下致死一击');
  assert.strictEqual(ctx.DIRECTOR.heroHp, 1);
  ctx.DIRECTOR.damageHero(50);
  assert.strictEqual(ctx.DIRECTOR.state, 'defeat', '壁垒每局一次，第二次应阵亡');

  /* 波间提前开战 */
  const w2 = freshWorld(t);
  w2.ctx.DIRECTOR.state = 'intermission';
  w2.ctx.DIRECTOR._interT = 5;
  w2.ctx.DIRECTOR.startNextNow();
  assert.strictEqual(w2.ctx.DIRECTOR.state, 'battle');
  assert.strictEqual(w2.ctx.DIRECTOR.wave, 1);
});

test('波次编排：出生按节奏入列，层内波间整备、波清空放奖金', (t) => {
  const w = freshWorld(t);
  const { ctx, game } = w;
  ctx.DIRECTOR.begin();
  assert.ok(ctx.DIRECTOR.enterDelve());
  assert.strictEqual(ctx.DIRECTOR.wave, 1);
  const wave1Count = ctx.CONFIG.waveDef(1).groups.reduce((s, g) => s + g.count, 0);
  let steps = 0;
  while (ctx.Units.enemies.length < wave1Count && steps++ < 30 * 20) step(game, ctx, 1 / 30);
  assert.strictEqual(ctx.Units.enemies.length, wave1Count);
  /* 秒清全场 → 进入波间整备 */
  for (const e of ctx.Units.enemies.slice()) e.takeDamage(99999);
  let steps2 = 0;
  while (ctx.DIRECTOR.state === 'battle' && steps2++ < 30 * 30) step(game, ctx, 1 / 30);
  assert.strictEqual(ctx.DIRECTOR.state, 'intermission');
  assert.ok(ctx.DIRECTOR.intermissionLeft() > 0 && ctx.DIRECTOR.intermissionLeft() <= ctx.CONFIG.FIELD.intermission);
  /* 整备归零 → 第 2 波自动开打（无尽） */
  ctx.DIRECTOR._interT = 0.01;
  let steps3 = 0;
  while (ctx.DIRECTOR.state === 'intermission' && steps3++ < 30 * 5) step(game, ctx, 1 / 30);
  assert.strictEqual(ctx.DIRECTOR.state, 'battle');
  assert.strictEqual(ctx.DIRECTOR.wave, 2);
});
