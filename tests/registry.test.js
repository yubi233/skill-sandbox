'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers/harness');

test('技能注册表完整且自洽', () => {
  const ctx = H.loadArcana();
  /* VM 沙盒数组与宿主原型不同，先拷回宿主再比较 */
  assert.deepStrictEqual([...ctx.SkillCatalog.validate()], [], '目录元数据有问题');
  assert.deepStrictEqual([...ctx.SKILLS.validateRegistry()], [], '注册表与 Cast 实现不闭合');

  const catalog = ctx.SKILL_CATALOG;
  assert.strictEqual(catalog.length, ctx.SKILLS.defs.length, '运行时 DEFS 数量与目录不一致');
  const params = ctx.Core.defaultParams();
  for (const def of ctx.SKILLS.defs) {
    assert.ok(def.description && def.description.length > 4, def.name + ' 缺少描述');
    assert.ok(def.level >= 1 && def.level <= 5, def.name + ' 默认等级非法');
    assert.ok(params.skills[def.id], '默认参数表缺技能 ' + def.id);
    for (let level = 1; level <= 5; level++) {
      const p = ctx.SKILLS.profile({ params }, def.id, level);
      assert.ok(p && p.range > 0 && p.radius > 0 && p.windup > 0 && p.cooldown > 0,
        def.name + ' LV.' + level + ' profile 非法');
      assert.strictEqual(p.level, level);
      assert.ok(p.levelName && p.name && p.ultimateName, def.name + ' LV.' + level + ' 展示字段缺失');
    }
  }
  const orders = Array.from(catalog.map(s => s.demoOrder)).sort((a, b) => a - b);
  assert.deepStrictEqual(orders, Array.from(catalog, (_, i) => i + 1), 'demoOrder 必须是 1..N 的完整排列');

  /* 洛克世界 18 系：元表完整、order 全排列、技能归属正确（同系多技能合法） */
  const elements = ctx.SkillCatalog.elements;
  assert.strictEqual(elements.length, 18, '洛克世界应为 18 系（老页游的土+石合并为地，删神系，新增幻）');
  assert.deepStrictEqual(Array.from(elements, e => e.order), Array.from({ length: 18 }, (_, i) => i + 1),
    '元素 order 必须是 1..18 的完整排列');
  assert.ok(ctx.SkillCatalog.elementOf('light') && ctx.SkillCatalog.elementOf('illusion'), '系别查询缺失');
  for (const gone of ['stone', 'godFire', 'godWater', 'godGrass']) {
    assert.strictEqual(ctx.SkillCatalog.elementOf(gone), null, gone + ' 不应在洛克世界 18 系中');
  }
  const expectElement = { 1: 'ice', 2: 'electric', 3: 'fire', 4: 'light', 5: 'electric', 6: 'ice', 7: 'fly', 8: 'earth', 9: 'light', 10: 'normal', 11: 'water' };
  for (const [id, element] of Object.entries(expectElement)) {
    const def = ctx.SKILLS.defs.find(d => d.id === Number(id));
    assert.strictEqual(def.element, element, def.name + ' 系别归属不符');
    assert.strictEqual(def.elementOrder, ctx.SkillCatalog.elementOf(element).order, def.name + ' elementOrder 不一致');
  }
});
