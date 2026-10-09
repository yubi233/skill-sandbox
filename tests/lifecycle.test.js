'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers/harness');
const PHASE_CHAIN = 'windup,release,travel,impact,aftermath';

test('9 技能 × 5 等级：五阶段完整、结束后资源回基线', () => {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  H.installPlaceholderFx(ctx, scene);
  const game = H.createTestGame(ctx, engine, scene);
  const baseline = H.snapshot(scene);

  for (const def of ctx.SKILLS.defs) {
    for (let level = 1; level <= 5; level++) {
      H.resetCastState(ctx, game);
      ctx.SKILLS.setLevel(game, def.id, level);
      const label = def.name + ' LV.' + level;
      assert.ok(ctx.SKILLS.start(game, def.id, new H.BABYLON.Vector3(0, 0, 8)), label + ' 释放失败');

      const phases = [];
      let frames = 0;
      while (frames < 6000 && (ctx.SKILLS.casts.length || ctx.SKILLS.transients.length || ctx.FX.aliveCount())) {
        const phase = ctx.SKILLS.casts[0] && ctx.SKILLS.casts[0].phase;
        if (phase && phases[phases.length - 1] !== phase) phases.push(phase);
        H.step(game, ctx);
        frames++;
      }
      assert.strictEqual(phases.join(','), PHASE_CHAIN, label + ' 阶段序列不完整: ' + phases.join(','));
      assert.ok(frames < 6000, label + ' 未能在限时内收敛');
      assert.deepStrictEqual(H.snapshot(scene), baseline, label + ' 结束后场景资源未回基线');
      assert.strictEqual(ctx.FX.aliveCount(), 0, label + ' 结束后仍有粒子存活');
    }
  }
  engine.dispose();
});
