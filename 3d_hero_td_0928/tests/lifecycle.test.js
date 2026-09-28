'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { loadGame, makeEngine, installPlaceholderFx, createTestGame, snapshot, step } = require('./harness.js');

/* 单位实体：生命周期、推进、交战、投射物、AOE、回收回基线 */
test('单位生命周期：生成 → 推进 → 战死 → 场景回基线', () => {
  const ctx = loadGame();
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);

  /* 预热各机型（合并网格/共享材质缓存定型），再取基线 */
  const warm = [ctx.Units.spawnEnemy('grunt', 0, 30), ctx.Units.spawnEnemy('lord', 2, 30),
    ctx.Units.spawnAlly('guard', 1), ctx.Units.spawnAlly('hunter', 1)];
  for (let i = 0; i < 40; i++) step(game, ctx, 1 / 30);
  ctx.Units.clear();
  for (let i = 0; i < 6; i++) ctx.Units.update(1 / 30);   /* 清完 dying */
  const base = snapshot(scene);
  assert.strictEqual(ctx.Units.enemies.length, 0);
  assert.strictEqual(ctx.Units.allies.length, 0);

  const e = ctx.Units.spawnEnemy('grunt', -3, 30);
  const z0 = e.z;
  for (let i = 0; i < 30; i++) step(game, ctx, 1 / 30);
  assert.ok(e.z < z0 - 1, '骸骨卒应向南推进: ' + z0 + ' -> ' + e.z);
  assert.ok(e.x < -1, '应向出料路号回拢');

  e.takeDamage(9999);
  assert.strictEqual(e.alive, false);
  assert.ok(ctx.DIRECTOR.gold > ctx.CONFIG.FIELD.startGold, '击杀应掉金');
  for (let i = 0; i < 40; i++) step(game, ctx, 1 / 30);   /* 尸骸倒伏完成 */

  ctx.Units.clear();
  for (let i = 0; i < 6; i++) ctx.Units.update(1 / 30);
  assert.deepStrictEqual(snapshot(scene), base, '清理后场景应精确回基线');
});

test('敌人抵达防线会殴打英雄；誓卫顶住并反击', () => {
  const ctx = loadGame();
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);
  ctx.DIRECTOR.state = 'battle';

  const guard = ctx.Units.spawnAlly('guard', 1);
  assert.ok(guard, '应能召唤誓卫');
  const hp0 = ctx.DIRECTOR.heroHp;

  const e1 = ctx.Units.spawnEnemy('grunt', guard.x, guard.z + 2);
  const e2 = ctx.Units.spawnEnemy('grunt', 4, ctx.CONFIG.FIELD.heroZ + 1.6); /* 直奔英雄 */
  let heroHurt = false, enemyHurt = false;
  for (let i = 0; i < 260 && !(heroHurt && enemyHurt); i++) {
    step(game, ctx, 1 / 30);
    heroHurt = ctx.DIRECTOR.heroHp < hp0;
    enemyHurt = e1.hp < e1.maxHp;
  }
  assert.ok(heroHurt, '贴脸敌人应打中英雄');
  assert.ok(enemyHurt || !e1.alive, '誓卫应反击近身敌人');
});

test('追踪弹：命中目标并造成伤害；目标先死则消散不崩', () => {
  const ctx = loadGame();
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);

  const e = ctx.Units.spawnEnemy('grunt', 2, ctx.CONFIG.FIELD.heroZ + 10);
  const hp0 = e.hp;
  ctx.Units.spawnProjectile({
    fromX: 0, fromY: 1.5, fromZ: ctx.CONFIG.FIELD.heroZ,
    target: e, speed: 26, damage: 7, colorHex: '#9fd8ff', kind: 'bolt', faction: 'hero',
  });
  let hit = false;
  for (let i = 0; i < 90 && !hit; i++) {
    step(game, ctx, 1 / 30);
    hit = e.hp < hp0;
  }
  assert.ok(hit, '魔弹应命中');

  const e2 = ctx.Units.spawnEnemy('runner', -2, ctx.CONFIG.FIELD.heroZ + 12);
  const p = ctx.Units.spawnProjectile({
    fromX: 0, fromY: 1.5, fromZ: ctx.CONFIG.FIELD.heroZ,
    target: e2, speed: 8, damage: 5, colorHex: '#9fd8ff', kind: 'bolt', faction: 'hero',
  });
  e2.kill();
  for (let i = 0; i < 120; i++) step(game, ctx, 1 / 30);
  assert.strictEqual(p.active, false, '目标死亡后弹体应消散');
});

test('AOE 与减速：applyAoE 命中范围内单位并施加 slow', () => {
  const ctx = loadGame();
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);

  const inA = ctx.Units.spawnEnemy('grunt', 0, 10);
  const outA = ctx.Units.spawnEnemy('shield', 9, 10);
  const victims = ctx.Units.applyAoE(0, 10, 4.2, 30, { slow: { factor: 0.45, duration: 3.5 } });
  assert.ok(victims.includes(inA), '圈内应命中');
  assert.ok(!victims.includes(outA), '圈外不应命中');
  assert.strictEqual(inA.hp, inA.maxHp - 30);
  assert.ok(inA.slowFactor < 1 && inA.slowUntil > ctx.FX.time, '应被减速');
});

test('法术全链路：三种法术按快照构造、释放、结算与回收', (t) => {
  const ctx = loadGame();
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  t.after(() => { scene.dispose(); engine.dispose(); });
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);
  ctx.DIRECTOR.begin();
  assert.ok(ctx.DIRECTOR.enterDelve());
  assert.ok(ctx.DIRECTOR.retreat());
  ctx.DIRECTOR.levels.unlockFrost = 1;
  ctx.DIRECTOR.levels.unlockThunder = 1;
  assert.ok(ctx.DIRECTOR.enterDelve());
  /* 合法战斗状态下只推进实体/法术，不让导演在清场后推进波次污染基线。 */
  const tick = () => step(game, ctx, 1 / 30, { advanceDirector: false });
  const aim = { x: 0, z: ctx.CONFIG.FIELD.heroZ + 18 };
  /* 预热：让共享材质/血条材质缓存定型后再取基线 */
  ctx.Units.spawnEnemy('shield', aim.x, aim.z).takeDamage(1);
  for (let i = 0; i < 40; i++) tick();
  ctx.Units.clear();
  for (let i = 0; i < 6; i++) ctx.Units.update(1 / 30);
  const base = snapshot(scene);

  for (const id of [1, 2, 3]) {
    const e = ctx.Units.spawnEnemy('shield', aim.x, aim.z);
    assert.ok(ctx.DIRECTOR.ownsSpell(id), '法术 ' + id + ' 已解锁');
    assert.ok(ctx.SPELLS.start(game, id, aim), '法术 ' + id + ' 应可释放');
    assert.ok(!ctx.SPELLS.isReady(id), '释放后进入冷却');
    assert.strictEqual(ctx.SPELLS.cdRemaining(id), ctx.SPELLS.profile(id).cooldown);
    let guard = 0;
    while (ctx.SPELLS.casts.length && guard++ < 400) tick();
    assert.strictEqual(ctx.SPELLS.casts.length, 0, '法术 ' + id + ' 应自然结束');
    assert.ok(e.hp < e.maxHp || !e.alive, '法术 ' + id + ' 应造成伤害');
    ctx.Units.clear();
    for (let i = 0; i < 6; i++) ctx.Units.update(1 / 30);
    assert.deepStrictEqual(snapshot(scene), base, '法术 ' + id + ' 资源应全部回收');
  }
  assert.strictEqual(ctx.DIRECTOR.wave, 1, '隔离生命周期测试不应自动开新波');
  assert.strictEqual(ctx.DIRECTOR.state, 'battle');
  assert.deepStrictEqual(ctx.__errors, [], '法术全链路不得吞掉运行时异常');
});

test('异常隔离：单位 update 抛错只回收自身', () => {
  const ctx = loadGame();
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);

  const bad = ctx.Units.spawnEnemy('grunt', 0, 20);
  const good = ctx.Units.spawnEnemy('grunt', 3, 20);
  bad.update = () => { throw new Error('boom'); };
  ctx.Units.update(1 / 30);
  assert.strictEqual(bad.alive, false, '故障单位应被回收标记');
  assert.strictEqual(good.alive, true, '健康单位不受影响');
  const errorsBefore = ctx.__errors.length;
  ctx.Units.update(1 / 30);
  assert.ok(ctx.__errors.length >= errorsBefore);
});

test('回响碎片：魔弹命中后弹片跳向邻近亡灵（逐跳衰减）', () => {
  const ctx = loadGame();
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);
  ctx.DIRECTOR.levels.resounding = 1;

  const a = ctx.Units.spawnEnemy('grunt', 0, 10);
  const b = ctx.Units.spawnEnemy('grunt', 3.5, 10);
  ctx.Units.spawnProjectile({
    fromX: 0, fromY: 1.5, fromZ: ctx.CONFIG.FIELD.heroZ,
    target: a, speed: 26, damage: 10, colorHex: '#9fd8ff', kind: 'bolt', faction: 'hero',
    bounces: ctx.DIRECTOR.level('resounding'),
  });
  let hopped = false;
  for (let i = 0; i < 120 && !hopped; i++) {
    step(game, ctx, 1 / 30);
    hopped = b.hp < b.maxHp;
  }
  assert.ok(hopped, '弹片应跳到 3.5m 外的邻近敌人');
  assert.strictEqual(a.hp, a.maxHp - 10);
  assert.ok(b.hp >= b.maxHp - 6, '弹跳伤害应衰减为 5.5 → 取整机制内: ' + b.hp);
});

test('法术精通节点：profile 按天赋改写伤害/半径/减速/链数', () => {
  const ctx = loadGame();
  const engine = makeEngine();
  const scene = new BABYLON.Scene(engine);
  installPlaceholderFx(ctx, scene);
  const game = createTestGame(ctx, engine, scene);
  ctx.Units.bind(game);
  ctx.DIRECTOR.bind(game);

  const base = ctx.SPELLS.profile(1);
  ctx.DIRECTOR.levels.fireMastery = 2;
  const fire = ctx.SPELLS.profile(1);
  assert.ok(fire.damage > base.damage, '烈焰精通应抬高火球伤害');
  assert.ok(fire.radius > base.radius, '烈焰精通应扩大火球半径');

  const frost0 = ctx.SPELLS.profile(2);
  ctx.DIRECTOR.levels.frostMastery = 3;
  const frost = ctx.SPELLS.profile(2);
  assert.ok(frost.slow.factor < frost0.slow.factor, '霜寒精通应加深减速');
  assert.ok(frost.slow.duration > frost0.slow.duration, '霜寒精通应延长减速');

  const bolt0 = ctx.SPELLS.profile(3);
  ctx.DIRECTOR.levels.thunderMastery = 2;
  const bolt = ctx.SPELLS.profile(3);
  assert.strictEqual(bolt.chain.count, bolt0.chain.count + 2, '雷霆精通应 +2 链');
});
