'use strict';
/* 五级区分度契约：每一级必须与相邻级存在"尺度无关"的结构差异。
   这是需求「不许简单放大」的自动化护栏——纯倍率放大不会改变下列签名，
   因此会让本测试失败。签名只取计数/模式/显隐标志，全部与 scale 无关。 */
const { test } = require('node:test');
const assert = require('node:assert');
const H = require('./helpers/harness');

/* 每技能每级期望的结构签名（见 dev/README.md「九技能五级跃迁链」） */
const EXPECT = {
  /* 1 寒霜之矛：弹道编排 —— 手中单矛 / 飞行中分裂 / 上空悬停 / 枪阵 */
  1: [
    { mode: 'solo',  lances: 1,  skySeal: false },
    { mode: 'split', lances: 3,  skySeal: false },
    { mode: 'hover', lances: 5,  skySeal: true },
    { mode: 'array', lances: 9,  skySeal: true },
    { mode: 'array', lances: 13, skySeal: true },
  ],
  /* 2 雷霆之矛：电弧走位 —— 直劈 / 链式弹跳 / 高空分支 / 环形雷网 / 审判巨剑 */
  2: [
    { mode: 'solo',   bounce: false, net: false, judgment: false },
    { mode: 'bounce', bounce: true,  net: false, judgment: false },
    { mode: 'sky',    bounce: false, net: false, judgment: false },
    { mode: 'net',    bounce: false, net: true,  judgment: false },
    { mode: 'sky',    bounce: false, net: false, judgment: true },
  ],
  /* 3 陨火天降：飞行编排 —— 单星 / 双星连坠 / 悬停蓄坠 / 空中裂变 / 三重连坠 */
  3: [
    { mode: 'dive',    meteors: 1, shards: 0 },
    { mode: 'twin',    meteors: 2, shards: 0 },
    { mode: 'hover',   meteors: 1, shards: 0 },
    { mode: 'fission', meteors: 1, shards: 6 },
    { mode: 'triple',  meteors: 3, shards: 0 },
  ],
  /* 4 星光束：光束走法 —— 水平单束 / 折射分束 / 聚能延迟 / 天穹 / 五束 */
  4: [
    { mode: 'solo',    beams: 1 },
    { mode: 'refract', beams: 3 },
    { mode: 'charge',  beams: 2 },
    { mode: 'sky',     beams: 2 },
    { mode: 'sky',     beams: 5 },
  ],
  /* 5 伏特禁城：柱阵拓扑 —— 链 / 环 / 穹顶 / 拔地高塔 / 内外双环 */
  5: [
    { pulse: 'chain',  rings: 1, pylons: 3 },
    { pulse: 'loop',   rings: 1, pylons: 4 },
    { pulse: 'loop',   rings: 1, pylons: 6 },
    { pulse: 'tower',  rings: 1, pylons: 8 },
    { pulse: 'double', rings: 2, pylons: 10 },
  ],
  /* 6 冰川王冠：冻结方式 —— 单圈 / 波环 / 山脊+冰罩 / 三重波 / 中央主冠 */
  6: [
    { waves: 0, dome: false, crown: false },
    { waves: 1, dome: false, crown: false },
    { waves: 1, dome: true,  crown: false },
    { waves: 3, dome: true,  crown: false },
    { waves: 3, dome: true,  crown: true  },
  ],
  /* 7 疾风裂空：位移与风壁耦合 —— 无风壁 / 风壁 / 残留 / 持续龙卷 / 过冲巨龙卷 */
  7: [
    { spirals: 0, rings: 0, debris: 0,  tail: false, dash: false },
    { spirals: 3, rings: 3, debris: 4,  tail: false, dash: false },
    { spirals: 3, rings: 4, debris: 6,  tail: true,  dash: false },
    { spirals: 5, rings: 5, debris: 9,  tail: true,  dash: false },
    { spirals: 5, rings: 7, debris: 15, tail: true,  dash: true  },
  ],
  /* 8 岩牙突刺：地脉抬升编排 —— 单排 / 犬牙双排 / 地裂缝 / 直线+环形 / 中央主峰 */
  8: [
    { peaks: 4,  fissure: false, crown: false },
    { peaks: 6,  fissure: false, crown: false },
    { peaks: 9,  fissure: true,  crown: false },
    { peaks: 15, fissure: true,  crown: false },
    { peaks: 23, fissure: true,  crown: true  },
  ],
  /* 9 王之财宝（标杆）：身旁单门 / 三门 / 落点六门 / 穹顶十四门 / 头顶十二门 × 五轮 */
  9: [
    { gates: 1,  shots: 1,  grandSeal: false },
    { gates: 3,  shots: 3,  grandSeal: false },
    { gates: 6,  shots: 6,  grandSeal: false },
    { gates: 14, shots: 14, grandSeal: false },
    { gates: 12, shots: 60, grandSeal: true  },
  ],
  /* 10 魔弹连射：弹幕编排 —— 掌前单弹 / 三连扇射 / 环轨俯冲 / 双环螺旋地毯 / 光环风暴+核心 */
  10: [
    { mode: 'direct', shots: 1,  halo: 0,  skySeal: false, grandSeal: false },
    { mode: 'volley', shots: 3,  halo: 0,  skySeal: false, grandSeal: false },
    { mode: 'orbit',  shots: 6,  halo: 0,  skySeal: true,  grandSeal: false },
    { mode: 'fan',    shots: 12, halo: 0,  skySeal: false, grandSeal: false },
    { mode: 'storm',  shots: 49, halo: 12, skySeal: false, grandSeal: true  },
  ],
  /* 11 怒涛裂岸：浪与涡的编排 —— 单浪 / 三浪潮线 / 浪卷涡潭 / 涡潭喷泉 / 巨浪+聚水球 */
  11: [
    { mode: 'wave',   waves: 1, vortex: false, fountains: 0, orb: false },
    { mode: 'tide',   waves: 3, vortex: false, fountains: 0, orb: false },
    { mode: 'coil',   waves: 1, vortex: true,  fountains: 0, orb: false },
    { mode: 'spout',  waves: 0, vortex: true,  fountains: 4, orb: false },
    { mode: 'deluge', waves: 3, vortex: true,  fountains: 1, orb: true  },
  ],
};

/* 从 Cast 实例抽取尺度无关的结构签名 */
function signature(cast) {
  switch (cast.def.id) {
    case 1: return { mode: cast.mode, lances: cast.lances.length, skySeal: !!cast.skySeal };
    case 2: return { mode: cast.mode, bounce: !!cast.bouncePts, net: !!cast.netArcs,
      judgment: cast.judgment.isEnabled() };
    case 3: return { mode: cast.plan.mode, meteors: cast.meteors.length, shards: cast.shards.length };
    case 4: return { mode: cast.mode, beams: cast.beams.length };
    case 5: return { pulse: cast.plan.pulse, rings: cast.plan.rings.length, pylons: cast.pylons.length };
    case 6: return { waves: cast.waves.length, dome: !!cast.dome, crown: !!cast.crownMonolith };
    case 7: return { spirals: cast.spirals.length, rings: cast.rings.length, debris: cast.debris.length,
      tail: cast.plan.tail > 0, dash: cast.plan.dash > 0 };
    case 8: return { peaks: cast.peaks.length, fissure: !!cast.fissureMesh,
      /* 主峰按节点名判定，不能用高度阈值：四级的常规峰同样能超过该阈值 */
      crown: cast.peaks.some(p => /^crownPeak_/.test(p.mesh.name || '')) };
    case 9: return { gates: cast.gates.length, shots: cast.shots.length, grandSeal: !!cast.grandSeal };
    case 10: return { mode: cast.mode, shots: cast.shots.length, halo: cast.halo.length,
      skySeal: !!cast.skySeal, grandSeal: !!cast.grandSeal };
    case 11: return { mode: cast.mode, waves: cast.waves.length, vortex: !!cast.vortex,
      fountains: cast.fountains.length, orb: !!cast.coreOrb };
    default: throw new Error('未登记的技能 id: ' + cast.def.id);
  }
}

test('五级结构签名：每级与相邻级存在尺度无关的结构差异', () => {
  const ctx = H.loadArcana();
  const engine = H.makeEngine();
  const scene = new H.BABYLON.Scene(engine);
  H.installPlaceholderFx(ctx, scene);
  const game = H.createTestGame(ctx, engine, scene);

  for (const def of ctx.SKILLS.defs) {
    const want = EXPECT[def.id];
    assert.ok(want, def.name + ' 缺少五级结构签名登记');
    assert.strictEqual(want.length, 5, def.name + ' 结构签名必须是 5 级');

    const seen = [];
    for (let level = 1; level <= 5; level++) {
      H.resetCastState(ctx, game);
      ctx.SKILLS.setLevel(game, def.id, level);
      assert.ok(ctx.SKILLS.start(game, def.id, new H.BABYLON.Vector3(0, 0, 8)),
        def.name + ' LV.' + level + ' 释放失败');
      const got = signature(ctx.SKILLS.casts[0]);
      assert.deepStrictEqual(got, want[level - 1], def.name + ' LV.' + level + ' 结构签名不符');
      seen.push(JSON.stringify(got));
    }
    /* 五级签名两两不同：任何一级退化成"更大一号的同一个东西"都会在此暴露 */
    assert.strictEqual(new Set(seen).size, 5, def.name + ' 存在结构相同的等级（退化为纯放大）');
  }

  ctx.SKILLS.abortAll();
  engine.dispose();
});
