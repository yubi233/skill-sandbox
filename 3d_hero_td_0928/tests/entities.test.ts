/* ============================================================================
   entities.test.ts — 单位实体与法术生命周期测试（NullEngine，直连 src）。
   自 tests/lifecycle.test.js（VM 装载 dev/entities.js + dev/skills.js）移植：
   - 单位生命周期：预热 → 基线 → 生成/推进/战死/清理 → 场景五类资源精确回基线；
   - 敌人抵达防线殴打英雄，誓卫顶住并反击；
   - 追踪弹命中伤害；目标先死则弹体消散；
   - applyAoE 圈内命中/圈外排除/施加减速；
   - 回响碎片：魔弹命中后弹片跳向邻近亡灵（伤害逐跳衰减）；
   - 异常隔离：单位 update 抛错只回收自身，其余单位不受影响；
   - 法术全链路：三种法术构造→释放→结算→资源全部回收。
   不移植：法术精通节点 profile 改写（fireMastery 伤害/半径已由 tests/rules.test.ts
   经 spellTuning 同源断言覆盖，frost/thunder 精通走同一条 spellTuning 通路）。
   ========================================================================== */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { CONFIG } from '../src/core/config';
import { DIRECTOR } from '../src/core/director';
import { FX } from '../src/render/particles';
import { Units } from '../src/render/entities/units';
import { SPELLS } from '../src/render/skills';
import { createHeadlessWorld, drainSimErrors, peekSimErrors, snapshot, type HeadlessWorld } from './helpers/headless';

function freshWorld(t: { after(cb: () => void): void }, fxCapacity = 64): HeadlessWorld {
  const world = createHeadlessWorld({ seed: 928, fxCapacity });
  t.after(() => world.dispose());
  drainSimErrors();   // 丢弃上一个测试遗留，保证零错误断言只看本测试
  return world;
}

const g = (world: HeadlessWorld) => world.game as never;

/* 预热各机型（合并网格/共享材质缓存定型）、清场、再取基线 */
function warmBaseline(world: HeadlessWorld, ticks = 40): ReturnType<typeof snapshot> {
  for (let i = 0; i < ticks; i++) world.tickOnce(1 / 30);
  Units.clear();
  for (let i = 0; i < 6; i++) Units.update(1 / 30);   /* 清完 dying */
  return snapshot(world.scene);
}

test('单位生命周期：生成 → 推进 → 战死 → 场景回基线', (t) => {
  const world = freshWorld(t);
  /* 预热各机型（合并网格/共享材质缓存定型），再取基线 */
  Units.spawnEnemy('grunt', 0, 30);
  Units.spawnEnemy('lord', 2, 30);
  const allies = [Units.spawnAlly('guard', 1), Units.spawnAlly('hunter', 1)];
  assert.ok(allies.every((a) => a !== null), '两排军种都应能生成');
  const base = warmBaseline(world);
  assert.strictEqual(Units.enemies.length, 0);
  assert.strictEqual(Units.allies.length, 0);

  const e = Units.spawnEnemy('grunt', -3, 30);
  const z0 = e.z;
  for (let i = 0; i < 30; i++) world.tickOnce(1 / 30);
  assert.ok(e.z < z0 - 1, '骸骨卒应向南推进: ' + z0 + ' -> ' + e.z);
  assert.ok(e.x < -1, '应向出料路号回拢');

  e.takeDamage(9999);
  assert.strictEqual(e.alive, false);
  assert.ok(DIRECTOR.gold > CONFIG.FIELD.startGold, '击杀应掉金');
  for (let i = 0; i < 40; i++) world.tickOnce(1 / 30);   /* 尸骸倒伏完成 */

  Units.clear();
  for (let i = 0; i < 6; i++) Units.update(1 / 30);
  assert.deepStrictEqual(snapshot(world.scene), base, '清理后场景应精确回基线');
});

test('敌人抵达防线会殴打英雄；誓卫顶住并反击', (t) => {
  const world = freshWorld(t);
  DIRECTOR.state = 'battle';

  const guard = Units.spawnAlly('guard', 1);
  assert.ok(guard, '应能召唤誓卫');
  const hp0 = DIRECTOR.heroHp;

  const e1 = Units.spawnEnemy('grunt', guard!.x, guard!.z + 2);
  const e2 = Units.spawnEnemy('grunt', 4, CONFIG.FIELD.heroZ + 1.6); /* 直奔英雄 */
  let heroHurt = false, enemyHurt = false;
  for (let i = 0; i < 260 && !(heroHurt && enemyHurt); i++) {
    world.tickOnce(1 / 30);
    heroHurt = DIRECTOR.heroHp < hp0;
    enemyHurt = e1.hp < e1.maxHp;
  }
  assert.ok(heroHurt, '贴脸敌人应打中英雄');
  assert.ok(enemyHurt || !e1.alive, '誓卫应反击近身敌人');
});

test('追踪弹：命中目标并造成伤害；目标先死则消散不崩', (t) => {
  const world = freshWorld(t);
  const e = Units.spawnEnemy('grunt', 2, CONFIG.FIELD.heroZ + 10);
  const hp0 = e.hp;
  Units.spawnProjectile({
    fromX: 0, fromY: 1.5, fromZ: CONFIG.FIELD.heroZ,
    target: e, speed: 26, damage: 7, colorHex: '#9fd8ff', kind: 'bolt', faction: 'hero',
  });
  let hit = false;
  for (let i = 0; i < 90 && !hit; i++) {
    world.tickOnce(1 / 30);
    hit = e.hp < hp0;
  }
  assert.ok(hit, '魔弹应命中');

  const e2 = Units.spawnEnemy('runner', -2, CONFIG.FIELD.heroZ + 12);
  const p = Units.spawnProjectile({
    fromX: 0, fromY: 1.5, fromZ: CONFIG.FIELD.heroZ,
    target: e2, speed: 8, damage: 5, colorHex: '#9fd8ff', kind: 'bolt', faction: 'hero',
  });
  e2.kill();
  for (let i = 0; i < 120; i++) world.tickOnce(1 / 30);
  assert.strictEqual(p.active, false, '目标死亡后弹体应消散');
});

test('AOE 与减速：applyAoE 命中范围内单位并施加 slow', (t) => {
  const world = freshWorld(t);
  const inA = Units.spawnEnemy('grunt', 0, 10);
  const outA = Units.spawnEnemy('shield', 9, 10);
  const victims = Units.applyAoE(0, 10, 4.2, 30, { slow: { factor: 0.45, duration: 3.5 } });
  assert.ok(victims.includes(inA), '圈内应命中');
  assert.ok(!victims.includes(outA), '圈外不应命中');
  assert.strictEqual(inA.hp, inA.maxHp - 30);
  assert.ok(inA.slowFactor < 1 && inA.slowUntil > FX.time, '应被减速');
});

test('法术全链路：三种法术按快照构造、释放、结算与回收', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  d.begin();
  assert.ok(d.enterDelve());
  assert.ok(d.retreat());
  d.levels.unlockFrost = 1;
  d.levels.unlockThunder = 1;
  assert.ok(d.enterDelve());
  /* 合法战斗状态下只推进实体/法术，不让导演在清场后推进波次污染基线。 */
  const tick = () => world.tickOnce(1 / 30, { advanceDirector: false });
  const aim = { x: 0, z: CONFIG.FIELD.heroZ + 18 };
  /* 预热：让共享材质/血条材质缓存定型后再取基线 */
  Units.spawnEnemy('shield', aim.x, aim.z).takeDamage(1);
  for (let i = 0; i < 40; i++) tick();
  Units.clear();
  for (let i = 0; i < 6; i++) Units.update(1 / 30);
  const base = snapshot(world.scene);

  for (const id of [1, 2, 3]) {
    const e = Units.spawnEnemy('shield', aim.x, aim.z);
    assert.ok(d.ownsSpell(String(id)), '法术 ' + id + ' 已解锁');
    assert.ok(SPELLS.start(g(world), id, aim), '法术 ' + id + ' 应可释放');
    assert.ok(!SPELLS.isReady(id), '释放后进入冷却');
    assert.strictEqual(SPELLS.cdRemaining(id), SPELLS.profile(id)!.cooldown);
    let guard = 0;
    while (SPELLS.casts.length && guard++ < 400) tick();
    assert.strictEqual(SPELLS.casts.length, 0, '法术 ' + id + ' 应自然结束');
    assert.ok(e.hp < e.maxHp || !e.alive, '法术 ' + id + ' 应造成伤害');
    Units.clear();
    for (let i = 0; i < 6; i++) Units.update(1 / 30);
    assert.deepStrictEqual(snapshot(world.scene), base, '法术 ' + id + ' 资源应全部回收');
  }
  assert.strictEqual(d.wave, 1, '隔离生命周期测试不应自动开新波');
  assert.strictEqual(d.state, 'battle');
  assert.deepStrictEqual(drainSimErrors(), [], '法术全链路不得吞掉运行时异常');
});

test('异常隔离：单位 update 抛错只回收自身', (t) => {
  const world = freshWorld(t);
  const bad = Units.spawnEnemy('grunt', 0, 20);
  const good = Units.spawnEnemy('grunt', 3, 20);
  (bad as unknown as { update: () => void }).update = () => { throw new Error('boom'); };
  Units.update(1 / 30);
  assert.strictEqual(bad.alive, false, '故障单位应被回收标记');
  assert.strictEqual(good.alive, true, '健康单位不受影响');
  const errorsBefore = peekSimErrors().length;
  Units.update(1 / 30);
  assert.ok(peekSimErrors().length >= errorsBefore);
});

test('回响碎片：魔弹命中后弹片跳向邻近亡灵（逐跳衰减）', (t) => {
  const world = freshWorld(t);
  DIRECTOR.levels.resounding = 1;

  const a = Units.spawnEnemy('grunt', 0, 10);
  const b = Units.spawnEnemy('grunt', 3.5, 10);
  Units.spawnProjectile({
    fromX: 0, fromY: 1.5, fromZ: CONFIG.FIELD.heroZ,
    target: a, speed: 26, damage: 10, colorHex: '#9fd8ff', kind: 'bolt', faction: 'hero',
    bounces: DIRECTOR.level('resounding'),
  });
  let hopped = false;
  for (let i = 0; i < 120 && !hopped; i++) {
    world.tickOnce(1 / 30);
    hopped = b.hp < b.maxHp;
  }
  assert.ok(hopped, '弹片应跳到 3.5m 外的邻近敌人');
  assert.strictEqual(a.hp, a.maxHp - 10);
  assert.ok(b.hp >= b.maxHp - 6, '弹跳伤害应衰减为 5.5 → 取整机制内: ' + b.hp);
});
