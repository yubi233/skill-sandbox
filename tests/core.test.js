'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers/harness');

test('Mage.dispose 完整回收网格/节点/灯光/材质', () => {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  const before = H.snapshot(scene);
  const mage = new ctx.Core.Mage(scene);
  const created = H.snapshot(scene);
  assert.ok(created.meshes > before.meshes && created.materials > before.materials, '角色资源未创建');

  mage.dispose();
  assert.deepStrictEqual(H.snapshot(scene), before,
    'dispose 后应回到创建前基线: ' + JSON.stringify({ before, created, after: H.snapshot(scene) }));
  mage.dispose(); /* 幂等 */
  assert.deepStrictEqual(H.snapshot(scene), before);
  engine.dispose();
});

test('FX 时钟单一写入点：FX.update 不得自增全局时间', () => {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  H.installPlaceholderFx(ctx, scene);
  ctx.FX.time = 5;
  ctx.FX.update(1);
  assert.strictEqual(ctx.FX.time, 5, 'FX.update 改写了全局时钟');
  engine.dispose();
});

test('技能系统在无 UI/DOM 的纯模拟环境中可用', () => {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  H.installPlaceholderFx(ctx, scene);
  const game = H.createTestGame(ctx, engine, scene);
  H.resetCastState(ctx, game);
  ctx.SKILLS.setLevel(game, 9, 5);
  assert.ok(ctx.SKILLS.start(game, 9, new H.BABYLON.Vector3(0, 0, 8)));
  H.busy(game, ctx);
  assert.strictEqual(ctx.SKILLS.casts.length, 0);
  assert.strictEqual(ctx.FX.aliveCount(), 0);
  engine.dispose();
});
