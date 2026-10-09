'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers/harness');

function setup() {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  H.installPlaceholderFx(ctx, scene);
  const game = H.createTestGame(ctx, engine, scene);
  return { ctx, engine, scene, game, baseline: H.snapshot(scene) };
}

test('init 失败：整体回收、上报原因、后续施法正常', () => {
  const { ctx, engine, scene, game, baseline } = setup();
  const original = ctx.FX.makeSprite;
  let calls = 0;
  ctx.FX.makeSprite = (...args) => {
    if (++calls === 2) throw new Error('injected sprite failure');
    return original(...args);
  };
  ctx.SKILLS.setLevel(game, 1, 3);
  assert.strictEqual(ctx.SKILLS.start(game, 1, new H.BABYLON.Vector3(0, 0, 8)), false, 'init 失败必须返回 false');
  assert.strictEqual(ctx.SKILLS.lastRejectReason, 'error');
  assert.deepStrictEqual(H.snapshot(scene), baseline, 'init 失败后场景资源未回基线');
  assert.strictEqual(ctx.SKILLS.casts.length, 0, '失败法术不得留在活动列表');
  assert.ok(ctx.__errors.some(e => e.includes('创建失败')), '失败未上报');

  ctx.FX.makeSprite = original;
  ctx.SKILLS.clearCooldowns();
  assert.ok(ctx.SKILLS.start(game, 1, new H.BABYLON.Vector3(0, 0, 8)), '回收后应可正常施法');
  H.busy(game, ctx);
  assert.deepStrictEqual(H.snapshot(scene), baseline);
  engine.dispose();
});

test('update 失败：单法术隔离，其余法术继续推进', () => {
  const { ctx, engine, scene, game, baseline } = setup();
  ctx.SKILLS.setLevel(game, 1, 1);
  assert.ok(ctx.SKILLS.start(game, 1, new H.BABYLON.Vector3(0, 0, 8)));
  const real = ctx.SKILLS.casts[0];

  const fake = {
    game, def: { name: 'FakeBlast' }, level: 3, phase: 'travel', finished: false, disposed: false,
    p: { color: '#ffffff' }, kick: 0, focus: null, lift: 0,
    update() { throw new Error('injected update failure'); },
    dispose() { this.disposed = true; },
  };
  ctx.SKILLS.casts.push(fake);

  H.step(game, ctx); /* 不得向外抛错 */
  assert.ok(fake.disposed, '故障法术未被回收');
  assert.ok(!ctx.SKILLS.casts.includes(fake), '故障法术未被移出列表');
  assert.ok(ctx.SKILLS.casts.includes(real), '正常法术被误伤');
  assert.ok(ctx.__errors.some(e => e.includes('更新失败')), '故障未上报');

  H.busy(game, ctx);
  assert.deepStrictEqual(H.snapshot(scene), baseline, '故障后剩余法术应正常收敛并回基线');
  engine.dispose();
});

test('瞬态更新失败被隔离回收', () => {
  const { ctx, engine, scene, game } = setup();
  const bad = { update() { throw new Error('boom'); }, dispose() { this.disposed = true; }, done: false, disposed: false };
  ctx.SKILLS.transients.push(bad);
  H.step(game, ctx);
  assert.ok(bad.disposed, '故障瞬态未被回收');
  assert.ok(!ctx.SKILLS.transients.includes(bad), '故障瞬态未被移出台账');
  engine.dispose();
});
