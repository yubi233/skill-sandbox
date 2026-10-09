'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers/harness');

test('施法并发与瞬态数量预算', () => {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  H.installPlaceholderFx(ctx, scene);
  const game = H.createTestGame(ctx, engine, scene);
  const baseline = H.snapshot(scene);
  const v = (z) => new H.BABYLON.Vector3(0, 0, z);
  const ids = ctx.SKILLS.defs.map(d => d.id);

  /* 普通施法上限 budget.casts */
  H.resetCastState(ctx, game);
  for (let i = 0; i < ctx.SKILLS.budget.casts; i++) {
    ctx.SKILLS.setLevel(game, ids[i], 1);
    assert.ok(ctx.SKILLS.start(game, ids[i], v(8)), '第 ' + (i + 1) + ' 个法术应被接受');
  }
  ctx.SKILLS.setLevel(game, ids[ctx.SKILLS.budget.casts], 1);
  assert.strictEqual(ctx.SKILLS.start(game, ids[ctx.SKILLS.budget.casts], v(8)), false, '超出并发上限应拒绝');
  assert.strictEqual(ctx.SKILLS.lastRejectReason, 'cast-limit');
  ctx.SKILLS.abortAll();

  /* 大招上限 budget.ultimates */
  ctx.SKILLS.clearCooldowns();
  for (const id of [1, 2]) {
    ctx.SKILLS.setLevel(game, id, 5);
    assert.ok(ctx.SKILLS.start(game, id, v(8)), '大招应被接受: ' + id);
  }
  ctx.SKILLS.setLevel(game, 3, 5);
  assert.strictEqual(ctx.SKILLS.start(game, 3, v(8)), false, '第三个大招应被拒绝');
  assert.strictEqual(ctx.SKILLS.lastRejectReason, 'ultimate-limit');
  ctx.SKILLS.abortAll();

  /* 瞬态台账上限：最旧的被挤出并释放 */
  let disposedCount = 0;
  const dummy = () => ({ update() {}, dispose() { disposedCount++; }, done: false, disposed: false });
  for (let i = 0; i < ctx.SKILLS.budget.transients + 12; i++) ctx.SKILLS.addTransient(dummy());
  assert.ok(ctx.SKILLS.transients.length <= ctx.SKILLS.budget.transients, '瞬态台账超限');
  assert.strictEqual(disposedCount, 12, '挤出的瞬态数量不对');
  ctx.SKILLS.transients.length = 0;

  /* 每帧粒子预算：重法术全程不透支，帧间重置 */
  H.resetCastState(ctx, game);
  ctx.SKILLS.setLevel(game, 3, 5);
  assert.ok(ctx.SKILLS.start(game, 3, v(8)));
  let minLeft = Infinity;
  let frames = 0;
  while (frames < 6000 && (ctx.SKILLS.casts.length || ctx.SKILLS.transients.length || ctx.FX.aliveCount())) {
    H.step(game, ctx);
    if (ctx.SKILLS._particlesLeft < minLeft) minLeft = ctx.SKILLS._particlesLeft;
    frames++;
  }
  assert.ok(minLeft >= 0, '粒子预算出现透支: ' + minLeft);
  assert.deepStrictEqual(H.snapshot(scene), baseline, '预算测试结束后资源未回基线');
  engine.dispose();
});
