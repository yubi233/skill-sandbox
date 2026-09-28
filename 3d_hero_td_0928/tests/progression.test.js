'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame, makeEngine, installPlaceholderFx, createTestGame, snapshot, step } = require('./harness.js');

function freshWorld(t, seed = 928) {
  const ctx = loadGame(undefined, { seed });
  const engine = makeEngine();
  const scene = new ctx.BABYLON.Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);
  return { ctx, engine, scene, game };
}

function firstReturn(ctx) {
  const d = ctx.DIRECTOR;
  d.begin();
  assert.ok(d.enterDelve());
  assert.ok(d.retreat());
  assert.strictEqual(d.completedDelves, 1);
  assert.strictEqual(d.state, 'camp');
}

function buyAll(d, keys) {
  for (const key of keys) {
    const gold = d.gold;
    const cost = d.upgradeCost(key);
    const level = d.level(key);
    assert.ok(d.buyUpgrade(key), '营地应能购买 ' + key);
    assert.strictEqual(d.level(key), level + 1);
    assert.strictEqual(d.gold, gold - cost, key + ' 应只扣一次费用');
  }
}

/* 与空格辅助瞄准相同：选择射程内最靠近防线的敌人，用正式预测器预判落点。
   不调用伤害/击杀接口，也不绕过射程、冷却或真实法术飞行。 */
function manualFireAim(ctx, game) {
  const p = ctx.SPELLS.profile(1);
  const hero = game.mage.root.position;
  const target = ctx.Units.aliveEnemies()
    .filter((e) => Math.hypot(e.x - hero.x, e.z - hero.z) <= p.range)
    .sort((a, b) => a.z - b.z)[0];
  return target ? ctx.SPELLS.targetPoint(target, 1) : null;
}

test('首次营地禁止任何购买，只有火球拥有权；首次归来仍需逐项研习能力', (t) => {
  const { ctx } = freshWorld(t);
  const d = ctx.DIRECTOR;
  assert.strictEqual(d.state, 'title');
  assert.strictEqual(d.completedDelves, 0);
  assert.strictEqual(d.ownsSpell(1), true);
  assert.strictEqual(d.ownsSpell('1'), true);
  assert.strictEqual(d.ownsSpell(999), false);
  assert.strictEqual(d.ownsAlly('unknown'), false);
  d.begin();
  assert.strictEqual(d.canBuyUpgrades(), false);
  const rejects = [];
  d.on((kind, data) => { if (kind === 'reject-upgrade') rejects.push(data.reason); });
  const gold = d.gold;
  for (const u of ctx.CONFIG.UPGRADES) {
    assert.strictEqual(d.upgradeVisible(u.key), false, '首次营地不开放成长树: ' + u.key);
    assert.strictEqual(d.buyUpgrade(u.key), false, '初始金币不能跳过首次体验: ' + u.key);
  }
  assert.ok(rejects.every((reason) => reason === 'first-delve'));
  assert.strictEqual(rejects.length, ctx.CONFIG.UPGRADES.length);
  assert.strictEqual(d.gold, gold);
  assert.deepStrictEqual({ ...d.levels }, {});
  assert.ok(d.enterDelve());
  assert.ok(d.retreat());
  assert.strictEqual(d.canBuyUpgrades(), true);
  assert.strictEqual(d.upgradeVisible('spellPower'), true);
  assert.strictEqual(d.ownsSpell(2), false, '首返本身不赠送霜爆');
  assert.strictEqual(d.ownsSpell(3), false, '首返本身不赠送雷霆');
  assert.strictEqual(d.ownsAlly('guard'), false);
  assert.strictEqual(d.ownsAlly('hunter'), false);
  assert.strictEqual(d.ownsBolt(), false);
  buyAll(d, ['spellPower']);
  assert.strictEqual(d.completedDelves, 1);
});

for (const injectedRanks of [false, true]) {
  test('首次出战无盟友、魔弹或自动施法（注入天赋=' + injectedRanks + '）', (t) => {
    const { ctx, game } = freshWorld(t);
    const d = ctx.DIRECTOR;
    d.begin();
    assert.ok(d.enterDelve());
    if (injectedRanks) {
      d.levels = {
        unlockFrost: 1, unlockThunder: 1, unlockGuard: 1, unlockHunter: 1, unlockBolt: 1,
        autoFire: 1, autoFrost: 1, autoThunder: 1,
      };
    }
    assert.strictEqual(d.completedDelves, 0);
    assert.strictEqual(d.ownsSpell(1), true);
    for (const id of [2, 3]) assert.strictEqual(d.ownsSpell(id), false);
    assert.strictEqual(d.ownsBolt(), false);
    const gold = d.gold;
    const rejects = [];
    d.on((kind, data) => { if (kind === 'reject') rejects.push(data.reason); });
    for (const key of ['guard', 'hunter']) {
      assert.strictEqual(d.ownsAlly(key), false);
      assert.strictEqual(d.summon(key), false, key + ' 首次下探不得召唤');
    }
    assert.deepStrictEqual(rejects, ['locked', 'locked']);
    assert.strictEqual(d.gold, gold);
    assert.strictEqual(ctx.Units.allies.length, 0);
    const casts = t.mock.method(ctx.SPELLS, 'start');
    const projectiles = t.mock.method(ctx.Units, 'spawnProjectile');
    const enemy = ctx.Units.spawnEnemy('shield', 0, ctx.CONFIG.FIELD.heroZ + 10);
    for (let i = 0; i < 30 * 3; i++) step(game, ctx, 1 / 30);
    assert.strictEqual(d.state, 'battle');
    assert.strictEqual(enemy.hp, enemy.maxHp, '射程内敌人不应被任何自动攻击伤害');
    assert.strictEqual(casts.mock.callCount(), 0, '全程没有瞬时自动施法，不只检查最终 casts');
    assert.strictEqual(projectiles.mock.callCount(), 0, '全程没有发射自动魔弹');
    assert.strictEqual(ctx.Units.projectiles.list.length, 0);
    assert.deepStrictEqual(ctx.__errors, []);
  });
}

for (const returned of [false, true]) {
  test('被锁法术直接调用不分配资源或消耗冷却（已首返=' + returned + '）', (t) => {
    const { ctx, game, scene } = freshWorld(t);
    const d = ctx.DIRECTOR;
    if (returned) firstReturn(ctx);
    else {
      d.begin();
      /* 即使误写入解锁等级，首次出战门槛也必须生效。 */
      d.levels = { unlockFrost: 1, unlockThunder: 1 };
    }
    assert.ok(d.enterDelve());
    const base = snapshot(scene);
    for (const id of [2, 3]) {
      for (const remaining of [0, 1.25]) {
        ctx.SPELLS.cooldowns[id] = remaining;
        ctx.SPELLS.cooldownTotals[id] = 7.5;
        const cooldowns = { ...ctx.SPELLS.cooldowns };
        const totals = { ...ctx.SPELLS.cooldownTotals };
        assert.strictEqual(ctx.SPELLS.start(game, id, { x: 0, z: -20 }), false);
        assert.strictEqual(ctx.SPELLS.lastRejectReason, 'locked', '锁定判定先于冷却');
        assert.deepStrictEqual({ ...ctx.SPELLS.cooldowns }, cooldowns);
        assert.deepStrictEqual({ ...ctx.SPELLS.cooldownTotals }, totals);
        assert.strictEqual(ctx.SPELLS.casts.length, 0);
        assert.deepStrictEqual(snapshot(scene), base);
      }
    }
    assert.strictEqual(ctx.SPELLS.start(game, 999, { x: 0, z: -20 }), false);
    assert.strictEqual(ctx.SPELLS.lastRejectReason, 'unknown');
    assert.deepStrictEqual(snapshot(scene), base);
    assert.deepStrictEqual(ctx.__errors, []);
  });
}

for (const state of ['title', 'camp', 'defeat']) {
  test('已拥有法术仍禁止在 ' + state + ' 状态直接施放', (t) => {
    const { ctx, game, scene } = freshWorld(t);
    firstReturn(ctx);
    const d = ctx.DIRECTOR;
    d.levels = { unlockFrost: 1, unlockThunder: 1 };
    d.state = state; // 状态门控矩阵：排除能力锁与金币不足的干扰。
    const base = snapshot(scene);
    for (const id of [1, 2, 3]) {
      assert.ok(d.ownsSpell(id));
      assert.strictEqual(ctx.SPELLS.start(game, id, { x: 0, z: -20 }), false);
      assert.strictEqual(ctx.SPELLS.lastRejectReason, 'battle');
      assert.strictEqual(ctx.SPELLS.cdRemaining(id), 0);
    }
    assert.strictEqual(ctx.SPELLS.casts.length, 0);
    assert.deepStrictEqual(snapshot(scene), base);
  });
}

for (const state of ['battle', 'intermission', 'title', 'defeat']) {
  test('购买状态矩阵：首返后 ' + state + ' 仍拒绝升级且不扣费', (t) => {
    const { ctx } = freshWorld(t);
    firstReturn(ctx);
    const d = ctx.DIRECTOR;
    buyAll(d, ['spellPower']);
    d.gold = 1000;
    d.heroHp = 10;
    d.state = state;
    const before = { gold: d.gold, hp: d.heroHp, maxHp: d.heroMaxHp, levels: { ...d.levels } };
    const rejects = [];
    d.on((kind, data) => { if (kind === 'reject-upgrade') rejects.push(data.reason); });
    assert.strictEqual(d.canBuyUpgrades(), false);
    for (const key of ['spellPower', 'fortitude']) {
      assert.ok(d.isUnlocked(key));
      assert.strictEqual(d.buyUpgrade(key), false);
    }
    assert.deepStrictEqual(rejects, ['camp', 'camp']);
    assert.deepStrictEqual({ gold: d.gold, hp: d.heroHp, maxHp: d.heroMaxHp, levels: { ...d.levels } }, before);
    assert.strictEqual(d.completedDelves, 1);
  });
}

test('成长依赖按营地实际购买解锁：法术主线、魔弹支线、誓约与体魄', (t) => {
  const { ctx } = freshWorld(t);
  firstReturn(ctx);
  const d = ctx.DIRECTOR;
  d.gold = 100000;
  const rejectLocked = (keys) => {
    for (const key of keys) {
      const gold = d.gold;
      assert.strictEqual(d.isUnlocked(key), false, key + ' 前置尚未满足');
      assert.strictEqual(d.buyUpgrade(key), false, key + ' 不得越级购买');
      assert.strictEqual(d.gold, gold);
      assert.strictEqual(d.level(key), 0);
    }
  };
  rejectLocked(['fireMastery', 'autoFire', 'unlockFrost', 'unlockBolt', 'resounding', 'oath', 'fortitude']);
  buyAll(d, ['spellPower']);
  assert.strictEqual(d.isUnlocked('fortitude'), true, '体魄依赖魔焰强化');
  rejectLocked(['autoFire', 'oath', 'resounding']);
  buyAll(d, ['fireMastery']);
  rejectLocked(['unlockFrost', 'unlockBolt', 'oath', 'resounding']);
  buyAll(d, ['autoFire']);
  assert.strictEqual(d.isUnlocked('unlockFrost'), true);
  assert.strictEqual(d.isUnlocked('unlockBolt'), true);
  assert.strictEqual(d.isUnlocked('oath'), true);
  rejectLocked(['resounding', 'frostMastery', 'autoFrost', 'unlockThunder']);
  buyAll(d, ['unlockFrost']);
  assert.strictEqual(d.ownsSpell(2), true);
  assert.strictEqual(d.ownsSpell(3), false);
  rejectLocked(['autoFrost', 'unlockThunder']);
  buyAll(d, ['frostMastery']);
  rejectLocked(['unlockThunder']);
  buyAll(d, ['autoFrost', 'unlockThunder']);
  assert.strictEqual(d.ownsSpell(3), true);
  rejectLocked(['autoThunder']);
  buyAll(d, ['thunderMastery', 'autoThunder']);
  assert.strictEqual(d.ownsBolt(), false, '法术主线不会隐式赠送魔弹');
  buyAll(d, ['unlockBolt']);
  assert.strictEqual(d.ownsBolt(), true);
  buyAll(d, ['resounding']);
  rejectLocked(['unlockGuard', 'unlockHunter']);
  buyAll(d, ['oath', 'unlockGuard']);
  assert.strictEqual(d.ownsAlly('guard'), true);
  assert.strictEqual(d.ownsAlly('hunter'), false);
  buyAll(d, ['unlockHunter', 'fortitude']);
  assert.strictEqual(d.ownsAlly('hunter'), true);
  assert.strictEqual(d.state, 'camp', '整条成长路线只在营地购买');
});

test('营地购买仍校验未知节点、金币不足与最高等级，拒绝不能改变资源', (t) => {
  const { ctx } = freshWorld(t);
  firstReturn(ctx);
  const d = ctx.DIRECTOR;
  const rejects = [];
  d.on((kind, data) => { if (kind === 'reject-upgrade') rejects.push(data.reason); });
  const rejectWithoutMutation = (key, reason) => {
    const before = { gold: d.gold, levels: { ...d.levels } };
    assert.strictEqual(d.buyUpgrade(key), false);
    assert.strictEqual(rejects.at(-1), reason);
    assert.deepStrictEqual({ gold: d.gold, levels: { ...d.levels } }, before);
  };
  rejectWithoutMutation('missing-upgrade', 'unknown');
  d.gold = d.upgradeCost('spellPower') - 1;
  rejectWithoutMutation('spellPower', 'gold');
  d.gold++;
  buyAll(d, ['spellPower']);
  assert.strictEqual(d.gold, 0, '刚好足额时应允许购买');
  d.gold = 10000;
  buyAll(d, ['fireMastery', 'autoFire']);
  rejectWithoutMutation('autoFire', 'max');
});

test('返营与败北每局仅计数一次，波间不计完成，重置清除成长', (t) => {
  const { ctx, game } = freshWorld(t);
  const d = ctx.DIRECTOR;
  assert.strictEqual(d.retreat(), false);
  d.goCamp();
  d.goCamp();
  assert.strictEqual(d.completedDelves, 0, '没有实际出战不能伪造首返');
  assert.ok(d.enterDelve());
  assert.strictEqual(d.enterDelve(), false, '战斗中重复出战无效');
  assert.ok(d.retreat());
  assert.strictEqual(d.completedDelves, 1);
  assert.strictEqual(d.retreat(), false);
  d.goCamp();
  d.damageHero(99999);
  assert.strictEqual(d.completedDelves, 1);
  buyAll(d, ['spellPower']);
  const gold = d.gold;
  assert.ok(d.enterDelve());
  d.damageHero(d.heroHp + 1);
  assert.strictEqual(d.state, 'defeat');
  assert.strictEqual(d.heroHp, 0);
  assert.strictEqual(d.completedDelves, 2, '败北立即完成计数，不等待回营按钮');
  for (let i = 0; i < 3; i++) d.damageHero(99999);
  assert.strictEqual(d.retreat(), false);
  assert.strictEqual(d.enterDelve(), false);
  d.goCamp();
  d.goCamp();
  assert.strictEqual(d.completedDelves, 2, '败北后重复返营不会重复结算');
  assert.strictEqual(d.gold, gold);
  assert.strictEqual(d.level('spellPower'), 1);
  assert.ok(d.enterDelve());
  /* 状态机用例可清怪缩短等待；下方首波平衡用例则仅使用真实手动法术。 */
  for (let i = 0; i < 30 * 12 && d.state === 'battle'; i++) {
    for (const e of ctx.Units.aliveEnemies()) e.takeDamage(99999);
    step(game, ctx, 1 / 30);
  }
  assert.strictEqual(d.state, 'intermission');
  assert.strictEqual(d.completedDelves, 2, '一波通关不会误记为下探完成');
  assert.ok(d.retreat());
  assert.strictEqual(d.completedDelves, 3);
  d.goCamp();
  assert.strictEqual(d.completedDelves, 3);
  d.reset();
  assert.strictEqual(d.state, 'title');
  assert.strictEqual(d.completedDelves, 0);
  assert.deepStrictEqual({ ...d.levels }, {});
  assert.strictEqual(d.gold, ctx.CONFIG.FIELD.startGold);
  d.begin();
  assert.strictEqual(d.canBuyUpgrades(), false, '重置后重新遵守首次体验门槛');
  assert.deepStrictEqual(ctx.__errors, []);
});

test('已购法术、盟友与魔弹跨撤退和败北保留，后续第 1 波立即可用', (t) => {
  const { ctx, game } = freshWorld(t);
  firstReturn(ctx);
  const d = ctx.DIRECTOR;
  d.gold = 10000;
  buyAll(d, ['spellPower', 'fireMastery', 'autoFire', 'unlockFrost', 'frostMastery',
    'autoFrost', 'unlockThunder', 'unlockBolt', 'oath', 'unlockGuard', 'unlockHunter']);
  const levels = { ...d.levels };
  const projectiles = t.mock.method(ctx.Units, 'spawnProjectile');
  for (const outcome of ['retreat', 'defeat', 'retreat']) {
    const count = d.completedDelves;
    assert.ok(d.enterDelve());
    assert.strictEqual(d.wave, 1);
    assert.strictEqual(d.completedDelves, count, '开始新局不算完成');
    assert.deepStrictEqual({ ...d.levels }, levels);
    for (const id of [1, 2, 3]) {
      assert.strictEqual(d.ownsSpell(id), true);
      assert.ok(ctx.SPELLS.isReady(id), '新局冷却已重置');
      assert.ok(ctx.SPELLS.start(game, id, { x: 0, z: -20 }));
    }
    for (const key of ['guard', 'hunter']) {
      const gold = d.gold;
      assert.strictEqual(d.ownsAlly(key), true);
      assert.ok(d.summon(key), '后续第 1 波应可召唤 ' + key);
      assert.strictEqual(d.gold, gold - ctx.CONFIG.allyOf(key).cost);
    }
    assert.strictEqual(ctx.Units.allies.length, 2);
    assert.strictEqual(d.ownsBolt(), true);
    ctx.Units.spawnEnemy('shield', 0, ctx.CONFIG.FIELD.heroZ + 10);
    const before = projectiles.mock.callCount();
    ctx.SPELLS.updateAuto(game, 0.5);
    assert.strictEqual(projectiles.mock.callCount(), before + 1, '魔弹在后续第 1 波真实发射');
    assert.strictEqual(projectiles.mock.calls.at(-1).arguments[0].kind, 'bolt');
    assert.strictEqual(projectiles.mock.calls.at(-1).result.active, true);
    if (outcome === 'retreat') assert.ok(d.retreat());
    else { d.damageHero(d.heroHp + 1); d.goCamp(); }
    assert.strictEqual(d.state, 'camp');
    assert.strictEqual(d.completedDelves, count + 1);
    assert.deepStrictEqual({ ...d.levels }, levels);
  }
  assert.deepStrictEqual(ctx.__errors, []);
});

test('首次败北已记首返，但必须离开败北界面回营后才能购买', (t) => {
  const { ctx } = freshWorld(t);
  const d = ctx.DIRECTOR;
  d.begin();
  assert.ok(d.enterDelve());
  const gold = d.gold;
  d.damageHero(d.heroHp + 1);
  assert.strictEqual(d.state, 'defeat');
  assert.strictEqual(d.completedDelves, 1);
  assert.strictEqual(d.canBuyUpgrades(), false);
  assert.strictEqual(d.buyUpgrade('spellPower'), false);
  assert.strictEqual(d.gold, gold);
  d.goCamp();
  assert.strictEqual(d.completedDelves, 1);
  assert.strictEqual(d.canBuyUpgrades(), true);
  buyAll(d, ['spellPower']);
});

test('波间允许已拥有的法术和盟友，但仍不开放营地升级', (t) => {
  const { ctx, game } = freshWorld(t);
  firstReturn(ctx);
  const d = ctx.DIRECTOR;
  d.gold = 10000;
  buyAll(d, ['spellPower', 'fireMastery', 'autoFire', 'unlockFrost', 'oath', 'unlockGuard']);
  assert.ok(d.enterDelve());
  d.state = 'intermission'; // 独立验证公开操作在波间状态的契约，不推进导演。
  assert.strictEqual(d.inRun(), true);
  for (const id of [1, 2]) assert.ok(ctx.SPELLS.start(game, id, { x: 0, z: -20 }));
  assert.ok(d.summon('guard'));
  assert.strictEqual(ctx.Units.allies.length, 1);
  assert.strictEqual(d.buyUpgrade('spellPower'), false);
  assert.strictEqual(d.completedDelves, 1);
});

for (const id of [1, 2, 3]) {
  test('真实法术 ' + id + ' 的提前瞄准能击中射程边缘移动敌人', (t) => {
    const { ctx, game } = freshWorld(t);
    firstReturn(ctx);
    const d = ctx.DIRECTOR;
    d.levels = { unlockFrost: 1, unlockThunder: 1 };
    assert.ok(d.enterDelve());
    const p = ctx.SPELLS.profile(id);
    const enemy = ctx.Units.spawnEnemy('grunt', 0, ctx.CONFIG.FIELD.heroZ + p.range - 0.05);
    const z = enemy.z;
    const hp = enemy.hp;
    const aim = ctx.SPELLS.targetPoint(enemy, id);
    assert.ok(aim.z < z, '向行进前方预判而不是瞄准旧坐标');
    assert.ok(Math.hypot(aim.x, aim.z - ctx.CONFIG.FIELD.heroZ) <= p.range);
    assert.ok(ctx.SPELLS.start(game, id, aim));
    for (let i = 0; i < 30 * 4 && enemy.alive && enemy.hp === hp; i++) {
      step(game, ctx, 1 / 30, { advanceDirector: false });
    }
    assert.strictEqual(enemy.hp, hp - p.damage, '真实 impact 应精确造成一次伤害');
    if (p.slow) {
      assert.strictEqual(enemy.slowFactor, p.slow.factor);
      assert.ok(enemy.slowUntil > ctx.FX.time);
    }
    assert.deepStrictEqual(ctx.__errors, []);
  });
}

test('射程外密集敌群不能抢占自动火球对可攻击敌人的瞄准', (t) => {
  const { ctx, game } = freshWorld(t);
  firstReturn(ctx);
  const d = ctx.DIRECTOR;
  d.gold = 1000;
  buyAll(d, ['spellPower', 'fireMastery', 'autoFire']);
  assert.ok(d.enterDelve());
  const p = ctx.SPELLS.profile(1);
  for (let i = 0; i < 8; i++) {
    ctx.Units.spawnEnemy('grunt', (i - 3.5) * 0.4, ctx.CONFIG.FIELD.heroZ + p.range + 1);
  }
  assert.strictEqual(ctx.SPELLS.autoTargetPoint(p.radius, 1), null, '只有超射程敌人时不得消耗法术');
  const target = ctx.Units.spawnEnemy('shield', -8, ctx.CONFIG.FIELD.heroZ + 15);
  const aim = ctx.SPELLS.autoTargetPoint(p.radius, 1);
  const expected = ctx.SPELLS.targetPoint(target, 1);
  assert.deepStrictEqual({ ...aim }, { ...expected }, '应瞄准唯一射程内敌人，不受远处密集群影响');
  const hp = target.hp;
  const casts = t.mock.method(ctx.SPELLS, 'start');
  ctx.SPELLS.updateAutoCasts(game, 1 / 30);
  assert.strictEqual(casts.mock.callCount(), 1);
  assert.strictEqual(casts.mock.calls[0].arguments[1], 1);
  assert.strictEqual(casts.mock.calls[0].result, true);
  assert.deepStrictEqual({ ...casts.mock.calls[0].arguments[2] }, { ...expected });
  for (let i = 0; i < 30 * 3 && target.hp === hp; i++) {
    step(game, ctx, 1 / 30, { advanceDirector: false });
  }
  assert.ok(target.hp < hp, '自动火球应通过真实飞行命中选定目标');
  assert.deepStrictEqual(ctx.__errors, []);
});

const missingReferences = [
  ['霜爆解锁', (c) => c.spellOf(2), 'unlock'],
  ['雷霆解锁', (c) => c.spellOf(3), 'unlock'],
  ['誓卫解锁', (c) => c.allyOf('guard'), 'unlock'],
  ['猎手解锁', (c) => c.allyOf('hunter'), 'unlock'],
  ['魔弹解锁', (c) => c.HERO.autoBolt, 'unlock'],
  ['升级父节点', (c) => c.upgradeOf('fireMastery'), 'parent'],
  ['跨分支前置', (c) => c.upgradeOf('oath'), 'requires'],
];
for (const [name, select, field] of missingReferences) {
  test('注册表校验拒绝未知引用：' + name, () => {
    const { CONFIG } = loadGame(['config.js']);
    assert.strictEqual(CONFIG.validate().length, 0);
    const def = select(CONFIG), original = def[field];
    try {
      def[field] = 'missingRegressionNode';
      const problems = CONFIG.validate();
      assert.ok(problems.some((message) => message.includes('missingRegressionNode')),
        name + ' 应报告实际不存在的引用: ' + problems.join(' | '));
    } finally {
      def[field] = original;
    }
    assert.strictEqual(CONFIG.validate().length, 0, '修复引用后校验应恢复');
  });
}

const cycles = [
  ['父链环', (c) => { c.upgradeOf('fireMastery').parent = 'autoFire'; }],
  ['跨分支 requires 环', (c) => {
    c.upgradeOf('oath').requires = 'fortitude';
    c.upgradeOf('fortitude').requires = 'oath';
  }],
  ['parent 与 requires 混合环', (c) => { c.upgradeOf('spellPower').requires = 'autoFire'; }],
  ['自身 requires 环', (c) => { c.upgradeOf('fortitude').requires = 'fortitude'; }],
];
for (const [name, mutate] of cycles) {
  test('注册表校验终止并拒绝成长依赖环：' + name, { timeout: 2000 }, () => {
    const { CONFIG } = loadGame(['config.js']);
    assert.strictEqual(CONFIG.validate().length, 0);
    const original = CONFIG.UPGRADES.map((u) => ({ def: u, parent: u.parent, requires: u.requires }));
    try {
      mutate(CONFIG);
      assert.ok(CONFIG.validate().some((message) => message.includes('成环')), '实际循环依赖必须被识别');
    } finally {
      for (const { def, parent, requires } of original) {
        def.parent = parent;
        if (requires === undefined) delete def.requires;
        else def.requires = requires;
      }
    }
    assert.strictEqual(CONFIG.validate().length, 0, '修复环后校验应恢复');
  });
}

for (const seed of [1, 928, 20260928]) {
  test('首次出战仅手动火球可清首波并赚到升级费（随机种子 ' + seed + '）', (t) => {
    const { ctx, game } = freshWorld(t, seed);
    const d = ctx.DIRECTOR;
    const casts = t.mock.method(ctx.SPELLS, 'start');
    const projectiles = t.mock.method(ctx.Units, 'spawnProjectile');
    const spawns = t.mock.method(ctx.Units, 'spawnEnemy');
    const clears = [];
    d.on((kind, data) => { if (kind === 'clear') clears.push(data); });
    d.begin();
    assert.ok(d.enterDelve());
    assert.strictEqual(d.completedDelves, 0);
    assert.strictEqual(ctx.SPELLS.profile(1).damage, 36);
    const startGold = d.gold;
    let manualCasts = 0, frames = 0;
    while (d.state === 'battle' && frames++ < 30 * 60) {
      if (ctx.SPELLS.isReady(1)) {
        const aim = manualFireAim(ctx, game);
        if (aim) {
          const hero = game.mage.root.position;
          assert.ok(Math.hypot(aim.x - hero.x, aim.z - hero.z) <= ctx.SPELLS.profile(1).range);
          assert.ok(ctx.SPELLS.start(game, 1, aim), '合法手动火球应成功');
          manualCasts++;
        }
      }
      step(game, ctx, 1 / 30);
    }
    assert.strictEqual(d.state, 'intermission', '手动火球应在英雄存活时完成首波');
    assert.strictEqual(d.wave, 1);
    assert.strictEqual(d.runKills, 6);
    assert.strictEqual(d.kills, 6);
    assert.ok(d.heroHp > 0);
    assert.strictEqual(d.completedDelves, 0, '清一波不等于完成一次下探');
    assert.deepStrictEqual({ ...d.levels }, {}, '首次出战没有任何强化');
    assert.strictEqual(ctx.Units.allies.length, 0, '没有盟友代打');
    assert.strictEqual(projectiles.mock.callCount(), 0, '没有自动魔弹代打');
    assert.ok(manualCasts > 0 && manualCasts <= 6, '少量真实火球即可过关: ' + manualCasts);
    assert.strictEqual(casts.mock.callCount(), manualCasts, '所有施法都是手动请求，没有自动施法');
    assert.ok(casts.mock.calls.every((call) => call.arguments[1] === 1 && call.result === true));
    assert.strictEqual(spawns.mock.callCount(), 6);
    assert.ok(spawns.mock.calls.every((call) => call.arguments[0] === 'grunt' && Math.abs(call.arguments[1]) <= 1.6),
      '真实导演应在中路生成六个骸骨卒');
    assert.strictEqual(clears.length, 1, '通关奖励只发一次');
    const bonus = ctx.CONFIG.FIELD.waveBonusBase + ctx.CONFIG.FIELD.waveBonusPer;
    const earned = d.gold - startGold;
    assert.strictEqual(clears[0].bonus, bonus);
    assert.strictEqual(earned, 6 * ctx.CONFIG.enemyOf('grunt').gold + bonus, '击杀与通关奖金完整结算');
    const cost = d.upgradeCost('spellPower');
    assert.ok(earned >= cost, '仅首波所得（不靠初始金币）就应负担首个升级');
    t.diagnostic('clear=' + (frames / 30).toFixed(2) + 's, casts=' + manualCasts +
      ', hp=' + d.heroHp.toFixed(2) + ', earned=' + earned);
    assert.ok(d.retreat());
    assert.strictEqual(d.completedDelves, 1);
    assert.ok(d.canBuyUpgrades());
    assert.ok(d.buyUpgrade('spellPower'));
    assert.strictEqual(d.gold, startGold + earned - cost);
    assert.strictEqual(d.level('spellPower'), 1);
    assert.deepStrictEqual(ctx.__errors, [], '真实战斗不得有被吞掉的异常');
  });
}
