'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers/harness');
const PHASES = ['windup', 'release', 'travel', 'impact', 'aftermath'];

test('各阶段中止 abortAll：资源回基线、幂等、可再次施法', () => {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  H.installPlaceholderFx(ctx, scene);
  const game = H.createTestGame(ctx, engine, scene);
  const baseline = H.snapshot(scene);

  for (const def of ctx.SKILLS.defs) {
    for (const phase of PHASES) {
      H.resetCastState(ctx, game);
      ctx.SKILLS.setLevel(game, def.id, 5);
      assert.ok(ctx.SKILLS.start(game, def.id, new H.BABYLON.Vector3(0, 0, 8)), def.name + ' 释放失败');
      let guard = 0;
      while ((!ctx.SKILLS.casts[0] || ctx.SKILLS.casts[0].phase !== phase) && guard++ < 3000) {
        H.step(game, ctx);
      }
      assert.ok(ctx.SKILLS.casts[0] && ctx.SKILLS.casts[0].phase === phase,
        def.name + ' 未到达阶段 ' + phase);

      ctx.SKILLS.abortAll();
      ctx.SKILLS.abortAll(); /* 二次调用必须无副作用 */
      assert.deepStrictEqual(H.snapshot(scene), baseline, def.name + '@' + phase + ' 中止后资源未回基线');
      assert.strictEqual(ctx.FX.aliveCount(), 0, def.name + '@' + phase + ' 中止后仍有粒子');
    }
  }

  /* 中止后清冷却即可立即再次施法 */
  ctx.SKILLS.clearCooldowns();
  assert.ok(ctx.SKILLS.start(game, 3, new H.BABYLON.Vector3(0, 0, 8)), '中止后无法再次施法');
  ctx.SKILLS.abortAll();
  engine.dispose();
});
