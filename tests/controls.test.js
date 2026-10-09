'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers/harness');

/* 回归：疾风位移途中施放其他法术，姿态换人但位移必须继续到目标。
   旧实现把位移挂在 poseOwner 上，会导致角色停在半路（约 40% 处）。 */
test('疾风位移不被后续法术截断', () => {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  H.installPlaceholderFx(ctx, scene);
  const game = H.createTestGame(ctx, engine, scene);
  const baseline = H.snapshot(scene);
  H.resetCastState(ctx, game);

  ctx.SKILLS.setLevel(game, 7, 5);
  assert.ok(ctx.SKILLS.start(game, 7, new H.BABYLON.Vector3(0, 0, 8)));
  const wind = ctx.SKILLS.casts[0];
  const targetZ = wind.target.z;

  let guard = 0;
  while ((!ctx.SKILLS.casts[0] || ctx.SKILLS.casts[0].phase !== 'travel') && guard++ < 3000) {
    H.step(game, ctx);
  }
  assert.ok(ctx.SKILLS.casts[0] && ctx.SKILLS.casts[0].phase === 'travel', '疾风未进入位移阶段');
  /* 位移起步是缓动的，先推几帧让它产生实际位移 */
  for (let i = 0; i < 5; i++) H.step(game, ctx);
  assert.ok(game.mage.root.position.z > 0.1, '位移尚未开始');

  /* 位移途中释放陨火：姿态所有者换人 */
  ctx.SKILLS.clearCooldowns();
  ctx.SKILLS.setLevel(game, 3, 1);
  assert.ok(ctx.SKILLS.start(game, 3, new H.BABYLON.Vector3(0, 0, 8)));
  assert.notStrictEqual(ctx.SKILLS.poseOwner(game), wind, '新法术应接管姿态');
  assert.strictEqual(ctx.SKILLS.moveOwner(game), wind, '位移所有者仍应是疾风');

  let frames = 0;
  while (ctx.SKILLS.casts.includes(wind) && frames++ < 6000) H.step(game, ctx);
  assert.ok(frames < 6000, '疾风未在限时内完成');

  const finalZ = game.mage.root.position.z;
  assert.ok(Math.abs(finalZ - targetZ) < 0.35,
    '位移被截断: finalZ=' + finalZ.toFixed(2) + ' targetZ=' + targetZ.toFixed(2));

  H.busy(game, ctx);
  assert.deepStrictEqual(H.snapshot(scene), baseline, '并发位移场景结束后资源未回基线');
  engine.dispose();
});
