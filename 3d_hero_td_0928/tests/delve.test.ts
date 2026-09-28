/* ============================================================================
   delve.test.ts — 全场下探模拟：导演状态机、经济、成长树与胜负流转。
   自 tests/waves.test.js + tests/progression.test.js（VM 装载 dev/director.js
   等）移植为直连 src；dev 时代的 DIRECTOR.on/emit 回调语义改由类型化
   gameEvents 排水等价承载（eventsDuring / world.events）。
   覆盖：
   - 无尽波次循环（神装下探→撤退→天赋保留→再下探）与波次事件契约；
   - 瘴蚀：战斗中扣血、营地不扣；裸装败北保留金币/史录并结算下探；
   - 自动施法/自动魔弹：首返前彻底禁用（即使注入天赋），首返+点亮后生效；
   - 首次营地购买矩阵、购买状态矩阵、成长依赖按营地购买解锁、
     未知/缺金/满级拒绝不变更资源；
   - 返营与败北每局仅计数一次；已购能力跨局保留；
   - 真实法术提前瞄准命中、自动火球瞄准选择；
   - 三个随机种子下：仅手动火球清首波并赚到首个升级。
   不移植（语义已废弃）：U 键面板、dev 管线内部；progression 的注册表
   自检语义移入 tests/config.test.ts。
   ========================================================================== */
import { test, type TestContext } from 'node:test';
import { strict as assert } from 'node:assert';
import { CONFIG } from '../src/core/config';
import { DIRECTOR } from '../src/core/director';
import { FX } from '../src/render/particles';
import { Units } from '../src/render/entities/units';
import { SPELLS } from '../src/render/skills';
import { createHeadlessWorld, drainSimErrors, eventsDuring, snapshot, type HeadlessWorld } from './helpers/headless';

/* ------------------------------ 公共脚手架 ------------------------------ */

function freshWorld(t: TestContext, seed = 928): HeadlessWorld {
  const world = createHeadlessWorld({ seed });
  t.after(() => world.dispose());
  drainSimErrors();   // 丢弃上一个测试遗留，保证零错误断言只看本测试
  return world;
}

const g = (world: HeadlessWorld) => world.game as never;

function firstReturn(world: HeadlessWorld): void {
  const d = DIRECTOR;
  d.begin();
  assert.ok(d.enterDelve());
  assert.ok(d.retreat());
  assert.strictEqual(d.completedDelves, 1);
  assert.strictEqual(d.state, 'camp');
}

function buyAll(d: typeof DIRECTOR, keys: string[]): void {
  for (const key of keys) {
    const gold = d.gold;
    const cost = d.upgradeCost(key);
    const level = d.level(key);
    assert.ok(d.buyUpgrade(key), '营地应能购买 ' + key);
    assert.strictEqual(d.level(key), level + 1);
    assert.strictEqual(d.gold, gold - cost, key + ' 应只扣一次费用');
  }
}

/* 收集一次同步操作触发的拒绝事件原因（dev 时代 d.on('reject') 的排水等价） */
function rejectReasons(run: () => unknown, type: 'reject-upgrade' | 'reject-summon'): string[] {
  return eventsDuring(run)
    .filter((e) => e.type === type)
    .map((e) => (e as { reason: string }).reason);
}

/* 与空格辅助瞄准相同：选择射程内最靠近防线的敌人，用正式预测器预判落点。
   不调用伤害/击杀接口，也不绕过射程、冷却或真实法术飞行。 */
function manualFireAim(world: HeadlessWorld): { x: number; z: number } | null {
  const p = SPELLS.profile(1)!;
  const hero = world.game.mage.root.position;
  const target = Units.aliveEnemies()
    .filter((e) => Math.hypot(e.x - hero.x, e.z - hero.z) <= p.range)
    .sort((a, b) => a.z - b.z)[0];
  return target ? SPELLS.targetPoint(target, 1) : null;
}

/* ------------------------------ 无尽下探主循环（原 waves.test.js） ------------------------------ */

test('无尽波次循环：下探推进 → 撤退/败北回营 → 天赋保留 → 再下探', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  d.begin();
  assert.strictEqual(d.state, 'camp');

  /* 首次出战归来后才在营地购买天赋，跨局保留。 */
  assert.strictEqual(d.completedDelves, 0);
  assert.ok(d.enterDelve());
  assert.ok(d.retreat());
  assert.strictEqual(d.completedDelves, 1);
  d.gold = 800;
  assert.ok(d.buyUpgrade('spellPower'));
  assert.ok(d.buyUpgrade('fortitude'));

  /* 神装脚本：满强化 + 每次波间整备自动召满两排 */
  d.gold = 2000;
  d.levels = {
    spellPower: 12, fireMastery: 4, autoFire: 1, unlockBolt: 1,
    oath: 12, unlockGuard: 1, unlockHunter: 1, greed: 6, muster: 4,
    surge: 4, fortitude: 6, spiritDrain: 3,
  };
  const talentSnapshot = { ...d.levels };
  const bossWaves: number[] = [];
  const pump = (until: () => boolean, guardTicks: number): void => {
    let guard = 0;
    while (!until() && guard++ < guardTicks) {
      world.tickOnce(1 / 30);
      for (const e of world.events) {
        if (e.type === 'wave' && e.hasBoss) bossWaves.push(e.wave);
        if (e.type === 'clear') {
          for (let i = 0; i < 12; i++) { d.summon('guard'); d.summon('hunter'); }
        }
      }
    }
  };

  /* 下探：无尽波次一路推进，穿过第 5 波头目，到第 7 波主动撤退 */
  assert.ok(d.enterDelve());
  assert.strictEqual(d.state, 'battle');
  assert.strictEqual(d.wave, 1);
  pump(() => d.wave >= 7 || d.state === 'defeat', 30 * 60 * 20);
  assert.ok(d.wave >= 7, '无尽波次应持续推进到第 7 波: ' + d.wave);
  assert.ok(bossWaves.includes(5), '实际波次事件应经过第 5 波头目');
  assert.ok(d.retreat(), '出战中应可主动撤退');
  assert.strictEqual(d.state, 'camp');
  assert.strictEqual(d.completedDelves, 2);
  assert.strictEqual(d.record, 7, '史录应记到 7');
  assert.strictEqual(d.wave, 0);
  assert.ok(d.gold > 2000, '撤退保留战利品: ' + d.gold);
  assert.deepStrictEqual(d.levels, talentSnapshot, '循环全程天赋必须保留');

  /* 再下探从头开始，推进到第 10 波头目波 */
  assert.ok(d.enterDelve());
  assert.strictEqual(d.wave, 1, '下探永远从第 1 波开始');
  pump(() => d.wave >= 10 || d.state === 'defeat', 30 * 60 * 24);
  assert.ok(d.wave >= 10 || d.state === 'defeat',
    '应推进到第 10 波或败北: wave=' + d.wave);
  if (d.state !== 'defeat') {
    assert.ok(bossWaves.includes(10), '第二次下探应触发第 10 波头目事件');
    assert.ok(d.retreat());
    assert.ok(d.record >= 10, 'record 应至少 10');
  }
  assert.strictEqual(d.completedDelves, 3, '每次撤退或败北仅结算一次下探');
  assert.deepStrictEqual(d.levels, talentSnapshot, '再次出战后仍保留全部天赋');
  assert.ok(d.kills > 40, '总击杀应可观: ' + d.kills);
  assert.deepStrictEqual(drainSimErrors(), [], '循环全程零 console.error');
});

test('瘴蚀：战斗中每秒扣血，随波次加深；营地里不扣', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  d.begin();
  d.enterDelve();
  /* 波 1 瘴蚀 0.5/s，泵 4 秒应掉约 2 血 */
  const hp0 = d.heroHp;
  for (let i = 0; i < 30 * 4; i++) world.tickOnce(1 / 30);
  const drained = hp0 - d.heroHp;
  assert.ok(drained > 0.5 && drained < 8, '瘴蚀应持续扣血（约 2 点）: ' + drained.toFixed(2));

  /* 波次加深曲线 */
  const b1 = CONFIG.blightPerSec(1);
  const b15 = CONFIG.blightPerSec(15);
  assert.ok(b15 > b1 * 2, '15 波瘴蚀应明显加深: ' + b1 + ' -> ' + b15);

  /* 撤退回营：state=camp 后不再扣血 */
  assert.ok(d.retreat());
  const hpCamp = d.heroHp;
  for (let i = 0; i < 60; i++) world.tickOnce(1 / 30);
  assert.strictEqual(d.heroHp, hpCamp, '营地里不应扣血');
});

test('自动施法：未点亮绝不施放；首次返营购买后冷却完毕自动投向敌群', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  d.begin();
  d.enterDelve();
  const spawnPack = () => {
    for (let k = 0; k < 4; k++) Units.spawnEnemy('grunt', (k - 1.5) * 1.4, CONFIG.FIELD.heroZ + 14);
  };
  spawnPack();
  /* 未点天赋：4 秒内不应自动施放 */
  for (let i = 0; i < 30 * 4; i++) {
    if (Units.aliveEnemies().length < 2) spawnPack();
    world.tickOnce(1 / 30);
  }
  assert.strictEqual(SPELLS.casts.length, 0, '未点亮术式不应自动施放');

  /* 首次返营后按依赖购买自动火球，再次出战才自动施法。 */
  assert.ok(d.retreat());
  d.gold = 1000;
  for (const key of ['spellPower', 'fireMastery', 'autoFire']) {
    assert.ok(d.buyUpgrade(key), '营地应能购买 ' + key);
  }
  assert.ok(d.enterDelve());
  spawnPack();
  let casted = false;
  for (let i = 0; i < 30 * 3 && !casted; i++) {
    if (Units.aliveEnemies().length < 2) spawnPack();
    world.tickOnce(1 / 30);
    casted = SPELLS.casts.some((c) => c.def.id === 1);
  }
  assert.ok(casted, '燎原术式应自动施放火球');
});

test('裸装下探：无强化时防线会在无尽波次中被击穿，败北保留金币史录并结算下探', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  d.begin();
  d.enterDelve();
  let steps = 0;
  while (d.state !== 'defeat' && steps < 30 * 60 * 12) {
    world.tickOnce(1 / 30);
    steps++;
  }
  assert.strictEqual(d.state, 'defeat');
  assert.strictEqual(d.heroHp, 0);
  assert.ok(d.gold > 0, '败北应保留金币');
  assert.ok(d.record >= 1, '败北保留史录波次');
  assert.strictEqual(d.completedDelves, 1, '败北立即结算一次下探');
});

test('经济闭环：击杀掉金、买升级扣费、锁定不扣费、缺金拒绝召唤、壁垒与魂息', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  d.begin();
  assert.ok(d.enterDelve());
  const g0 = d.gold;
  Units.spawnEnemy('grunt', 0, 12).takeDamage(9999);
  assert.ok(d.gold > g0, '击杀应掉金');
  for (let i = 0; i < 40; i++) world.tickOnce(1 / 30);
  assert.ok(d.retreat());
  assert.ok(d.canBuyUpgrades(), '首次返营后才可升级');

  d.gold = 500;
  const cost = d.upgradeCost('spellPower');
  assert.ok(d.buyUpgrade('spellPower'));
  assert.strictEqual(d.gold, 500 - cost);
  assert.strictEqual(d.spellPowerMul(), 1.18);

  /* 回响碎片走魔弹支线，不再是烈焰精通的前置。 */
  assert.ok(d.isUnlocked('fireMastery'), '魔焰强化后直接开放烈焰精通');
  assert.ok(!d.isUnlocked('resounding'), '未学魔弹时仍锁定回响碎片');
  const beforeLockedBuy = d.gold;
  assert.ok(!d.buyUpgrade('resounding'));
  assert.strictEqual(d.gold, beforeLockedBuy, '锁定节点不得扣费');
  d.gold = 2000;
  for (const key of ['fireMastery', 'autoFire', 'unlockBolt', 'resounding', 'oath', 'unlockGuard']) {
    assert.ok(d.isUnlocked(key), key + ' 前置已满足');
    assert.ok(d.buyUpgrade(key), '应能购买 ' + key);
  }
  assert.strictEqual(d.level('fireMastery'), 1);

  /* 坚甲购买立即抬高上限并治疗 */
  d.heroHp = 10;
  d.gold = 500;
  const max0 = d.heroMaxHp;
  assert.ok(d.buyUpgrade('fortitude'));
  assert.strictEqual(d.heroMaxHp, max0 + 25);
  assert.strictEqual(d.heroHp, 35);

  /* 已解锁且处于战斗中的召唤，才能真正覆盖金币不足分支。 */
  assert.ok(d.enterDelve());
  d.gold = 1;
  assert.ok(d.ownsAlly('guard'));
  const summonRejects = rejectReasons(() => assert.ok(!d.summon('guard'), '金币不足应拒绝'), 'reject-summon');
  assert.deepStrictEqual(summonRejects, ['gold']);
  assert.strictEqual(d.gold, 1);

  /* 魂息汲取：击杀回血 */
  d.levels.spiritDrain = 2;
  d.heroHp = 40;
  Units.spawnEnemy('grunt', 2, 12).takeDamage(9999);
  assert.strictEqual(d.heroHp, 42, '击杀应回 2 点血');
  d.levels.spiritDrain = 0;

  /* 最终壁垒：致死一击保留 1 HP，每局一次 */
  d.state = 'battle';
  d.levels.lastStand = 1;
  d.heroHp = 5;
  d.damageHero(50);
  assert.strictEqual(d.state, 'battle', '壁垒应挡下致死一击');
  assert.strictEqual(d.heroHp, 1);
  d.damageHero(50);
  assert.strictEqual(d.state, 'defeat', '壁垒每局一次，第二次应阵亡');

  /* 波间提前开战 */
  const w2 = freshWorld(t);
  const d2 = DIRECTOR;
  d2.state = 'intermission';
  d2._interT = 5;
  d2.startNextNow();
  assert.strictEqual(d2.state, 'battle');
  assert.strictEqual(d2.wave, 1);
});

test('波次编排：出生按节奏入列，波清空放奖金进整备、整备归零自动开打', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  d.begin();
  assert.ok(d.enterDelve());
  assert.strictEqual(d.wave, 1);
  const wave1Count = CONFIG.waveDef(1).groups.reduce((s, g2) => s + g2.count, 0);
  let steps = 0;
  while (Units.enemies.length < wave1Count && steps++ < 30 * 20) world.tickOnce(1 / 30);
  assert.strictEqual(Units.enemies.length, wave1Count);
  /* 秒清全场 → 进入波间整备 */
  for (const e of Units.enemies.slice()) e.takeDamage(99999);
  let steps2 = 0;
  while (d.state === 'battle' && steps2++ < 30 * 30) world.tickOnce(1 / 30);
  assert.strictEqual(d.state, 'intermission');
  assert.ok(d.intermissionLeft() > 0 && d.intermissionLeft() <= CONFIG.FIELD.intermission);
  /* 整备归零 → 第 2 波自动开打（无尽） */
  d._interT = 0.01;
  let steps3 = 0;
  while (d.state === 'intermission' && steps3++ < 30 * 5) world.tickOnce(1 / 30);
  assert.strictEqual(d.state, 'battle');
  assert.strictEqual(d.wave, 2);
});

/* ------------------------------ 成长门控矩阵（原 progression.test.js） ------------------------------ */

test('首次营地禁止任何购买，只有火球拥有权；首次归来仍需逐项研习能力', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  assert.strictEqual(d.state, 'title');
  assert.strictEqual(d.completedDelves, 0);
  assert.strictEqual(d.ownsSpell('1'), true);
  assert.strictEqual(d.ownsSpell('999'), false);
  assert.strictEqual(d.ownsAlly('unknown'), false);
  d.begin();
  assert.strictEqual(d.canBuyUpgrades(), false);
  const rejects: string[] = [];
  const gold = d.gold;
  for (const u of CONFIG.UPGRADES) {
    assert.strictEqual(d.upgradeVisible(u.key), false, '首次营地不开放成长树: ' + u.key);
    rejects.push(...rejectReasons(
      () => assert.strictEqual(d.buyUpgrade(u.key), false, '初始金币不能跳过首次体验: ' + u.key),
      'reject-upgrade'));
  }
  assert.ok(rejects.every((reason) => reason === 'first-delve'));
  assert.strictEqual(rejects.length, CONFIG.UPGRADES.length);
  assert.strictEqual(d.gold, gold);
  assert.deepStrictEqual({ ...d.levels }, {});
  assert.ok(d.enterDelve());
  assert.ok(d.retreat());
  assert.strictEqual(d.canBuyUpgrades(), true);
  assert.strictEqual(d.upgradeVisible('spellPower'), true);
  assert.strictEqual(d.ownsSpell('2'), false, '首返本身不赠送霜爆');
  assert.strictEqual(d.ownsSpell('3'), false, '首返本身不赠送雷霆');
  assert.strictEqual(d.ownsAlly('guard'), false);
  assert.strictEqual(d.ownsAlly('hunter'), false);
  assert.strictEqual(d.ownsBolt(), false);
  buyAll(d, ['spellPower']);
  assert.strictEqual(d.completedDelves, 1);
});

for (const injectedRanks of [false, true]) {
  test('首次出战无盟友、魔弹或自动施法（注入天赋=' + injectedRanks + '）', (t) => {
    const world = freshWorld(t);
    const d = DIRECTOR;
    d.begin();
    assert.ok(d.enterDelve());
    if (injectedRanks) {
      d.levels = {
        unlockFrost: 1, unlockThunder: 1, unlockGuard: 1, unlockHunter: 1, unlockBolt: 1,
        autoFire: 1, autoFrost: 1, autoThunder: 1,
      };
    }
    assert.strictEqual(d.completedDelves, 0);
    assert.strictEqual(d.ownsSpell('1'), true);
    for (const id of ['2', '3']) assert.strictEqual(d.ownsSpell(id), false);
    assert.strictEqual(d.ownsBolt(), false);
    const gold = d.gold;
    const rejects: string[] = [];
    for (const key of ['guard', 'hunter']) {
      assert.strictEqual(d.ownsAlly(key), false);
      rejects.push(...rejectReasons(
        () => assert.strictEqual(d.summon(key), false, key + ' 首次下探不得召唤'),
        'reject-summon'));
    }
    assert.deepStrictEqual(rejects, ['locked', 'locked']);
    assert.strictEqual(d.gold, gold);
    assert.strictEqual(Units.allies.length, 0);
    const casts = t.mock.method(SPELLS, 'start');
    const projectiles = t.mock.method(Units, 'spawnProjectile');
    const enemy = Units.spawnEnemy('shield', 0, CONFIG.FIELD.heroZ + 10);
    for (let i = 0; i < 30 * 3; i++) world.tickOnce(1 / 30);
    assert.strictEqual(d.state, 'battle');
    assert.strictEqual(enemy.hp, enemy.maxHp, '射程内敌人不应被任何自动攻击伤害');
    assert.strictEqual(casts.mock.callCount(), 0, '全程没有瞬时自动施法，不只检查最终 casts');
    assert.strictEqual(projectiles.mock.callCount(), 0, '全程没有发射自动魔弹');
    assert.strictEqual(Units.projectiles!.list.length, 0);
    assert.deepStrictEqual(drainSimErrors(), []);
  });
}

for (const returned of [false, true]) {
  test('被锁法术直接调用不分配资源或消耗冷却（已首返=' + returned + '）', (t) => {
    const world = freshWorld(t);
    const d = DIRECTOR;
    if (returned) firstReturn(world);
    else {
      d.begin();
      /* 即使误写入解锁等级，首次出战门槛也必须生效。 */
      d.levels = { unlockFrost: 1, unlockThunder: 1 };
    }
    assert.ok(d.enterDelve());
    const base = snapshot(world.scene);
    for (const id of [2, 3]) {
      for (const remaining of [0, 1.25]) {
        SPELLS.cooldowns[id] = remaining;
        SPELLS.cooldownTotals[id] = 7.5;
        const cooldowns = { ...SPELLS.cooldowns };
        const totals = { ...SPELLS.cooldownTotals };
        assert.strictEqual(SPELLS.start(g(world), id, { x: 0, z: -20 }), false);
        assert.strictEqual(SPELLS.lastRejectReason, 'locked', '锁定判定先于冷却');
        assert.deepStrictEqual({ ...SPELLS.cooldowns }, cooldowns);
        assert.deepStrictEqual({ ...SPELLS.cooldownTotals }, totals);
        assert.strictEqual(SPELLS.casts.length, 0);
        assert.deepStrictEqual(snapshot(world.scene), base);
      }
    }
    assert.strictEqual(SPELLS.start(g(world), 999, { x: 0, z: -20 }), false);
    assert.strictEqual(SPELLS.lastRejectReason, 'unknown');
    assert.deepStrictEqual(snapshot(world.scene), base);
    assert.deepStrictEqual(drainSimErrors(), []);
  });
}

for (const state of ['title', 'camp', 'defeat'] as const) {
  test('已拥有法术仍禁止在 ' + state + ' 状态直接施放', (t) => {
    const world = freshWorld(t);
    firstReturn(world);
    const d = DIRECTOR;
    d.levels = { unlockFrost: 1, unlockThunder: 1 };
    d.state = state; // 状态门控矩阵：排除能力锁与金币不足的干扰。
    const base = snapshot(world.scene);
    for (const id of [1, 2, 3]) {
      assert.ok(d.ownsSpell(String(id)));
      assert.strictEqual(SPELLS.start(g(world), id, { x: 0, z: -20 }), false);
      assert.strictEqual(SPELLS.lastRejectReason, 'battle');
      assert.strictEqual(SPELLS.cdRemaining(id), 0);
    }
    assert.strictEqual(SPELLS.casts.length, 0);
    assert.deepStrictEqual(snapshot(world.scene), base);
  });
}

for (const state of ['battle', 'intermission', 'title', 'defeat'] as const) {
  test('购买状态矩阵：首返后 ' + state + ' 仍拒绝升级且不扣费', (t) => {
    const world = freshWorld(t);
    firstReturn(world);
    const d = DIRECTOR;
    buyAll(d, ['spellPower']);
    d.gold = 1000;
    d.heroHp = 10;
    d.state = state;
    const before = { gold: d.gold, hp: d.heroHp, maxHp: d.heroMaxHp, levels: { ...d.levels } };
    const rejects: string[] = [];
    for (const key of ['spellPower', 'fortitude']) {
      assert.ok(d.isUnlocked(key));
      rejects.push(...rejectReasons(() => assert.strictEqual(d.buyUpgrade(key), false), 'reject-upgrade'));
    }
    assert.deepStrictEqual(rejects, ['camp', 'camp']);
    assert.deepStrictEqual({ gold: d.gold, hp: d.heroHp, maxHp: d.heroMaxHp, levels: { ...d.levels } }, before);
    assert.strictEqual(d.canBuyUpgrades(), false);
    assert.strictEqual(d.completedDelves, 1);
  });
}

test('成长依赖按营地实际购买解锁：法术主线、魔弹支线、誓约与体魄', (t) => {
  const world = freshWorld(t);
  firstReturn(world);
  const d = DIRECTOR;
  d.gold = 100000;
  const rejectLocked = (keys: string[]) => {
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
  assert.strictEqual(d.ownsSpell('2'), true);
  assert.strictEqual(d.ownsSpell('3'), false);
  rejectLocked(['autoFrost', 'unlockThunder']);
  buyAll(d, ['frostMastery']);
  rejectLocked(['unlockThunder']);
  buyAll(d, ['autoFrost', 'unlockThunder']);
  assert.strictEqual(d.ownsSpell('3'), true);
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
  const world = freshWorld(t);
  firstReturn(world);
  const d = DIRECTOR;
  const rejectWithoutMutation = (key: string, reason: string) => {
    const before = { gold: d.gold, levels: { ...d.levels } };
    const rs = rejectReasons(() => assert.strictEqual(d.buyUpgrade(key), false), 'reject-upgrade');
    assert.strictEqual(rs.at(-1), reason);
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
  const world = freshWorld(t);
  const d = DIRECTOR;
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
  d.damageHero(99999);   // 营地状态承伤无效，不结算下探
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
    for (const e of Units.aliveEnemies()) e.takeDamage(99999);
    world.tickOnce(1 / 30);
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
  assert.strictEqual(d.gold, CONFIG.FIELD.startGold);
  d.begin();
  assert.strictEqual(d.canBuyUpgrades(), false, '重置后重新遵守首次体验门槛');
  assert.deepStrictEqual(drainSimErrors(), []);
});

test('已购法术、盟友与魔弹跨撤退和败北保留，后续第 1 波立即可用', (t) => {
  const world = freshWorld(t);
  firstReturn(world);
  const d = DIRECTOR;
  d.gold = 10000;
  buyAll(d, ['spellPower', 'fireMastery', 'autoFire', 'unlockFrost', 'frostMastery',
    'autoFrost', 'unlockThunder', 'unlockBolt', 'oath', 'unlockGuard', 'unlockHunter']);
  const levels = { ...d.levels };
  const projectiles = t.mock.method(Units, 'spawnProjectile');
  for (const outcome of ['retreat', 'defeat', 'retreat']) {
    const count = d.completedDelves;
    assert.ok(d.enterDelve());
    assert.strictEqual(d.wave, 1);
    assert.strictEqual(d.completedDelves, count, '开始新局不算完成');
    assert.deepStrictEqual({ ...d.levels }, levels);
    for (const id of [1, 2, 3]) {
      assert.strictEqual(d.ownsSpell(String(id)), true);
      assert.ok(SPELLS.isReady(id), '新局冷却已重置');
      assert.ok(SPELLS.start(g(world), id, { x: 0, z: -20 }));
    }
    for (const key of ['guard', 'hunter']) {
      const gold = d.gold;
      assert.strictEqual(d.ownsAlly(key), true);
      assert.ok(d.summon(key), '后续第 1 波应可召唤 ' + key);
      assert.strictEqual(d.gold, gold - CONFIG.allyOf(key)!.cost);
    }
    assert.strictEqual(Units.allies.length, 2);
    assert.strictEqual(d.ownsBolt(), true);
    Units.spawnEnemy('shield', 0, CONFIG.FIELD.heroZ + 10);
    const before = projectiles.mock.callCount();
    SPELLS.updateAuto(g(world), 0.5);
    assert.strictEqual(projectiles.mock.callCount(), before + 1, '魔弹在后续第 1 波真实发射');
    assert.strictEqual((projectiles.mock.calls.at(-1)!.arguments[0] as { kind: string }).kind, 'bolt');
    assert.strictEqual((projectiles.mock.calls.at(-1)!.result as { active: boolean }).active, true);
    if (outcome === 'retreat') assert.ok(d.retreat());
    else { d.damageHero(d.heroHp + 1); d.goCamp(); }
    assert.strictEqual(d.state, 'camp');
    assert.strictEqual(d.completedDelves, count + 1);
    assert.deepStrictEqual({ ...d.levels }, levels);
  }
  assert.deepStrictEqual(drainSimErrors(), []);
});

test('首次败北已记首返，但必须离开败北界面回营后才能购买', (t) => {
  const world = freshWorld(t);
  const d = DIRECTOR;
  d.begin();
  assert.ok(d.enterDelve());
  const gold = d.gold;
  d.damageHero(d.heroHp + 1);
  assert.strictEqual(d.state, 'defeat');
  assert.strictEqual(d.completedDelves, 1);
  assert.strictEqual(d.canBuyUpgrades(), false);
  const rs = rejectReasons(() => assert.strictEqual(d.buyUpgrade('spellPower'), false), 'reject-upgrade');
  assert.deepStrictEqual(rs, ['camp']);
  assert.strictEqual(d.gold, gold);
  d.goCamp();
  assert.strictEqual(d.completedDelves, 1);
  assert.strictEqual(d.canBuyUpgrades(), true);
  buyAll(d, ['spellPower']);
});

test('波间允许已拥有的法术和盟友，但仍不开放营地升级', (t) => {
  const world = freshWorld(t);
  firstReturn(world);
  const d = DIRECTOR;
  d.gold = 10000;
  buyAll(d, ['spellPower', 'fireMastery', 'autoFire', 'unlockFrost', 'oath', 'unlockGuard']);
  assert.ok(d.enterDelve());
  d.state = 'intermission'; // 独立验证公开操作在波间状态的契约，不推进导演。
  assert.strictEqual(d.inRun(), true);
  for (const id of [1, 2]) assert.ok(SPELLS.start(g(world), id, { x: 0, z: -20 }));
  assert.ok(d.summon('guard'));
  assert.strictEqual(Units.allies.length, 1);
  assert.strictEqual(d.buyUpgrade('spellPower'), false);
  assert.strictEqual(d.completedDelves, 1);
});

/* ------------------------------ 真实瞄准与自动施法选择 ------------------------------ */

for (const id of [1, 2, 3]) {
  test('真实法术 ' + id + ' 的提前瞄准能击中射程边缘移动敌人', (t) => {
    const world = freshWorld(t);
    firstReturn(world);
    const d = DIRECTOR;
    d.levels = { unlockFrost: 1, unlockThunder: 1 };
    assert.ok(d.enterDelve());
    const p = SPELLS.profile(id)!;
    const enemy = Units.spawnEnemy('grunt', 0, CONFIG.FIELD.heroZ + p.range - 0.05);
    const z = enemy.z;
    const hp = enemy.hp;
    const aim = SPELLS.targetPoint(enemy, id)!;
    assert.ok(aim.z < z, '向行进前方预判而不是瞄准旧坐标');
    assert.ok(Math.hypot(aim.x, aim.z - CONFIG.FIELD.heroZ) <= p.range);
    assert.ok(SPELLS.start(g(world), id, aim));
    for (let i = 0; i < 30 * 4 && enemy.alive && enemy.hp === hp; i++) {
      world.tickOnce(1 / 30, { advanceDirector: false });
    }
    assert.strictEqual(enemy.hp, hp - p.damage, '真实 impact 应精确造成一次伤害');
    if (p.slow) {
      assert.strictEqual(enemy.slowFactor, p.slow.factor);
      assert.ok(enemy.slowUntil > FX.time);
    }
    assert.deepStrictEqual(drainSimErrors(), []);
  });
}

test('射程外密集敌群不能抢占自动火球对可攻击敌人的瞄准', (t) => {
  const world = freshWorld(t);
  firstReturn(world);
  const d = DIRECTOR;
  d.gold = 1000;
  buyAll(d, ['spellPower', 'fireMastery', 'autoFire']);
  assert.ok(d.enterDelve());
  const p = SPELLS.profile(1)!;
  for (let i = 0; i < 8; i++) {
    Units.spawnEnemy('grunt', (i - 3.5) * 0.4, CONFIG.FIELD.heroZ + p.range + 1);
  }
  assert.strictEqual(SPELLS.autoTargetPoint(p.radius, 1), null, '只有超射程敌人时不得消耗法术');
  const target = Units.spawnEnemy('shield', -8, CONFIG.FIELD.heroZ + 15);
  const aim = SPELLS.autoTargetPoint(p.radius, 1)!;
  const expected = SPELLS.targetPoint(target, 1)!;
  assert.deepStrictEqual({ ...aim }, { ...expected }, '应瞄准唯一射程内敌人，不受远处密集群影响');
  const hp = target.hp;
  const casts = t.mock.method(SPELLS, 'start');
  SPELLS.updateAutoCasts(g(world), 1 / 30);
  assert.strictEqual(casts.mock.callCount(), 1);
  assert.strictEqual(casts.mock.calls[0].arguments[1], 1);
  assert.strictEqual(casts.mock.calls[0].result, true);
  assert.deepStrictEqual({ ...(casts.mock.calls[0].arguments[2] as { x: number; z: number }) }, { ...expected });
  for (let i = 0; i < 30 * 3 && target.hp === hp; i++) {
    world.tickOnce(1 / 30, { advanceDirector: false });
  }
  assert.ok(target.hp < hp, '自动火球应通过真实飞行命中选定目标');
  assert.deepStrictEqual(drainSimErrors(), []);
});

/* ------------------------------ 首波平衡（三种子） ------------------------------ */

for (const seed of [1, 928, 20260928]) {
  test('首次出战仅手动火球可清首波并赚到升级费（随机种子 ' + seed + '）', (t) => {
    const world = freshWorld(t, seed);
    const d = DIRECTOR;
    const casts = t.mock.method(SPELLS, 'start');
    const projectiles = t.mock.method(Units, 'spawnProjectile');
    const spawns = t.mock.method(Units, 'spawnEnemy');
    const clears: Array<{ wave: number; bonus: number }> = [];
    d.begin();
    assert.ok(d.enterDelve());
    assert.strictEqual(d.completedDelves, 0);
    assert.strictEqual(SPELLS.profile(1)!.damage, 36);
    const startGold = d.gold;
    let manualCasts = 0, frames = 0;
    while (d.state === 'battle' && frames++ < 30 * 60) {
      if (SPELLS.isReady(1)) {
        const aim = manualFireAim(world);
        if (aim) {
          const hero = world.game.mage.root.position;
          assert.ok(Math.hypot(aim.x - hero.x, aim.z - hero.z) <= SPELLS.profile(1)!.range);
          assert.ok(SPELLS.start(g(world), 1, aim), '合法手动火球应成功');
          manualCasts++;
        }
      }
      world.tickOnce(1 / 30);
      for (const e of world.events) if (e.type === 'clear') clears.push({ wave: e.wave, bonus: e.bonus });
    }
    assert.strictEqual(d.state, 'intermission', '手动火球应在英雄存活时完成首波');
    assert.strictEqual(d.wave, 1);
    assert.strictEqual(d.runKills, 6);
    assert.strictEqual(d.kills, 6);
    assert.ok(d.heroHp > 0);
    assert.strictEqual(d.completedDelves, 0, '清一波不等于完成一次下探');
    assert.deepStrictEqual({ ...d.levels }, {}, '首次出战没有任何强化');
    assert.strictEqual(Units.allies.length, 0, '没有盟友代打');
    assert.strictEqual(projectiles.mock.callCount(), 0, '没有自动魔弹代打');
    assert.ok(manualCasts > 0 && manualCasts <= 6, '少量真实火球即可过关: ' + manualCasts);
    assert.strictEqual(casts.mock.callCount(), manualCasts, '所有施法都是手动请求，没有自动施法');
    assert.ok(casts.mock.calls.every((call) => call.arguments[1] === 1 && call.result === true));
    assert.strictEqual(spawns.mock.callCount(), 6);
    assert.ok(spawns.mock.calls.every((call) => call.arguments[0] === 'grunt' && Math.abs(call.arguments[1] as number) <= 1.6),
      '真实导演应在中路生成六个骸骨卒');
    assert.strictEqual(clears.length, 1, '通关奖励只发一次');
    const bonus = CONFIG.FIELD.waveBonusBase + CONFIG.FIELD.waveBonusPer;
    const earned = d.gold - startGold;
    assert.strictEqual(clears[0].bonus, bonus);
    assert.strictEqual(earned, 6 * CONFIG.enemyOf('grunt')!.gold + bonus, '击杀与通关奖金完整结算');
    const cost = d.upgradeCost('spellPower');
    assert.ok(earned >= cost, '仅首波所得（不靠初始金币）就应负担首个升级');
    assert.ok(d.retreat());
    assert.strictEqual(d.completedDelves, 1);
    assert.ok(d.canBuyUpgrades());
    assert.ok(d.buyUpgrade('spellPower'));
    assert.strictEqual(d.gold, startGold + earned - cost);
    assert.strictEqual(d.level('spellPower'), 1);
    assert.deepStrictEqual(drainSimErrors(), [], '真实战斗不得有被吞掉的异常');
  });
}
