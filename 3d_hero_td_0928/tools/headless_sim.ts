/* ============================================================================
   headless_sim.ts — 无头验收测试（阶段4，参考 3d_survivors_like_0922 的
   tools/headless_sim）：NullEngine + 占位贴图，零 DOM 跑完整下探。
   共用骨架（占位 FX / HeadlessGame / 绑定 + DirectorWorld 接线 / tickOnce /
   错误捕获）已抽到 tests/helpers/headless.ts，与 TS 表测试同一条流水线。
   验收门（--gates 默认）：
   - 参考 AI（买最便宜的可见升级 → 出战 → 火球打自动评分点 → 血量<30% 撤退）
     能推进到第 3 波且总击杀 ≥ 15、全场零 console.error；
   - 单步耗时 p95 < 2ms（模拟逻辑不藏性能悬崖）。
   --stress：场面上 200 敌人压满，p95 < 8ms。
   运行：npm run sim（verify 链最后一环）。
   ========================================================================== */
import { CONFIG } from '../src/core/config';
import { DIRECTOR } from '../src/core/director';
import { gameRng } from '../src/core/rng';
import { Units } from '../src/render/entities/units';
import { SPELLS } from '../src/render/skills';
import { createHeadlessWorld, drainSimErrors, type HeadlessGame } from '../tests/helpers/headless';

/* ------------------------------ 参考 AI 玩家 ------------------------------ */

const BUY_PRIORITY = ['spellPower', 'surge', 'fireMastery', 'fortitude', 'greed', 'spiritDrain'];

function aiCampStep(): void {
  for (const key of BUY_PRIORITY) {
    while (DIRECTOR.upgradeVisible(key) && DIRECTOR.isUnlocked(key)
      && DIRECTOR.level(key) < (CONFIG.upgradeOf(key)?.max ?? 0)
      && DIRECTOR.gold >= DIRECTOR.upgradeCost(key)) {
      if (!DIRECTOR.buyUpgrade(key)) break;
    }
  }
  DIRECTOR.enterDelve();
}

function aiBattleStep(): 'continue' | 'retreat' {
  const hpFrac = DIRECTOR.heroHp / DIRECTOR.heroMaxHp;
  if (hpFrac < 0.3) return DIRECTOR.retreat() ? 'retreat' : 'continue';
  if (DIRECTOR.state === 'intermission') {
    if (DIRECTOR.intermissionLeft() < 4) DIRECTOR.startNextNow();
    return 'continue';
  }
  aiDecide();   // 10Hz 节流：火球打自动评分点
  return 'continue';
}

/* ------------------------------ 主流程 ------------------------------ */

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

let aiClock = 0;
function aiDecide(): boolean {
  if ((aiClock = (aiClock + 1) % 6) !== 0) return false;   // 10Hz 决策节流
  if (SPELLS.isReady(1)) {
    const p = SPELLS.profile(1)!;
    const point = SPELLS.autoTargetPoint(p.radius, 1);
    if (point) {
      SPELLS.start(game_ref() as never, 1, point);
      return true;
    }
  }
  return false;
}
let GAME: HeadlessGame;
function game_ref(): HeadlessGame { return GAME; }

function run(): number {
  const stress = process.argv.includes('--stress');
  gameRng.reseed(20260929);
  const world = createHeadlessWorld();
  GAME = world.game;

  const TICK = 1 / 60;
  const tickMs: number[] = [];
  let steps = 0;
  const hardCapSteps = stress ? 60 * 120 : 60 * 60 * 8;   // 压力 2 分钟 / 正常至多 8 分钟模拟

  DIRECTOR.begin();
  aiCampStep();                                          // 首次回营才有购买；首探直接出战
  if (DIRECTOR.state !== 'battle') DIRECTOR.enterDelve();

  const tickOnce = (): void => {
    const t0 = performance.now();
    world.tickOnce(TICK);
    tickMs.push(performance.now() - t0);
    steps++;
  };

  if (stress) {
    // 压力：无导演节奏，直接铺 200 敌人
    DIRECTOR.enterDelve();
    for (let i = 0; i < 200; i++) {
      Units.spawnEnemy(i % 5 === 0 ? 'shield' : 'grunt',
        (Math.random() * 2 - 1) * 12, 10 + (i % 8) * 3);
    }
    while (steps < hardCapSteps) tickOnce();
  } else {
    while (steps < hardCapSteps && DIRECTOR.state !== 'defeat' && DIRECTOR.record < 6) {
      tickOnce();
      if (DIRECTOR.state === 'camp') { aiCampStep(); continue; }
      if (DIRECTOR.inRun() && aiBattleStep() === 'retreat') { aiCampStep(); }
    }
  }

  const p95 = percentile(tickMs, 0.95);
  const maxWave = DIRECTOR.record, kills = DIRECTOR.kills, goldEarned = DIRECTOR.gold;
  const totalRanks = Object.values(DIRECTOR.levels).reduce((a, b) => a + b, 0);
  const errors = drainSimErrors();
  const summary = { mode: stress ? 'stress' : 'gates', steps, maxWave, kills, goldEarned, totalRanks,
    p95: +p95.toFixed(3), errors };

  console.log(`[headless_sim] ${JSON.stringify(summary)}`);
  if (!stress) {
    assert_(maxWave >= 3, `参考 AI 应推进到第 3 波（实际 ${maxWave}）`);
    assert_(kills >= 15, `总击杀应 ≥ 15（实际 ${kills}）`);
    assert_(totalRanks >= 2, `应完成至少 2 阶营地购买（实际 ${totalRanks}）`);
  }
  assert_(p95 < (stress ? 8 : 2), `tick p95 应 < ${stress ? 8 : 2}ms（实际 ${p95.toFixed(3)}ms）`);
  assert_(errors.length === 0, `零 console.error（实际 ${errors.length}）: ${errors.slice(0, 2)}`);
  return 0;

  function assert_(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
}

process.exit(run());
