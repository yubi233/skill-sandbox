/* ============================================================================
   config.ts — 死灵防线 3D · 唯一数值注册表（自 dev/config.js 移植为 ESM；原文已删，git 历史保留）
   玩法蓝本：Baffled Engineer《Legion Breaker》（itch.io / Steam demo）——
   玩家扮演战法师，向逼近的不死军团施法、召唤圣光军团、用击杀金币买升级，
   顶住一波波进攻并在波末迎战 Boss。本文件把法术/敌人/盟友/升级/波次全部
   收敛为纯数据 + validate() 校验；所有消费方（core/entities/skills/ui/main）
   一律由本表派生，不手抄第二份数值。新增内容 = 在此加一项 + 对应实现类。
   本文件只含纯数据与校验，不依赖引擎（核心模块：零 import，引擎与 DOM 一概不碰）。
   ========================================================================== */

/* ------------------------------ 类型 ------------------------------ */

/* 法术减速参数：factor 为移速乘数（<1），duration 持续秒数 */
export interface SpellSlow {
  factor: number;
  duration: number;
}

/* 法术链式跳弧参数 */
export interface SpellChain {
  count: number;
  damage: number;
  range: number;
}

export interface SpellDef {
  id: number;
  name: string;
  hotkey: string;
  form: string;
  groundTarget: boolean;
  color: string;
  range: number;
  radius: number;
  damage: number;
  windup: number;
  cooldown: number;
  flightSpeed: number;
  description: string;
  slow?: SpellSlow;
  chain?: SpellChain;
  unlock?: string;
}

/* 亡灵召唤参数（亡灵主教） */
export interface EnemySummon {
  unit: string;
  count: number;
  interval: number;
  cap: number;
}

export interface EnemyDef {
  key: string;
  name: string;
  hp: number;
  speed: number;
  atk: number;
  atkInterval: number;
  reach: number;
  gold: number;
  scale: number;
  color: string;
  eye: string;
  boss?: boolean;
  slam?: boolean;
  summon?: EnemySummon;
}

export interface AllyDef {
  key: string;
  name: string;
  hotkey: string;
  cost: number;
  cap: number;
  row: number;
  hp: number;
  atk: number;
  atkInterval: number;
  reach: number;
  speed: number;
  ranged: boolean;
  projectileSpeed?: number;
  color: string;
  trim: string;
  description: string;
  unlock?: string;
}

export interface UpgradeDef {
  key: string;
  branch: string;
  parent: string | null;
  requires?: string;
  name: string;
  base: number;
  growth: number;
  max: number;
  per: string;
  applies: string;
  description: string;
}

export interface BranchDef {
  key: string;
  name: string;
  color: string;
}

/* theme 内层配色：雾色/雾密度/地表/圣门/月亮 */
export interface ThemeColors {
  fog: string;
  fogDensity: number;
  ground: string;
  gate: string;
  moon: string;
}

export interface ThemeDef {
  key: string;
  name: string;
  theme: ThemeColors;
}

/* 单个出兵组：key 对应 ENEMIES 表，lane ∈ {-1, 0, 1} */
export interface WaveGroup {
  key: string;
  count: number;
  lane: number;
  interval: number;
}

/* waveDef(w) 的返回：编成组 + 可选头目横幅文案 */
export interface WaveDefResult {
  groups: WaveGroup[];
  banner?: string;
}

/* 英雄自动魔弹（HERO.autoBolt） */
export interface HeroAutoBolt {
  damage: number;
  interval: number;
  range: number;
  speed: number;
  unlock: string;
  name: string;
  color: string;
}

export interface HeroDef {
  hp: number;
  position: [number, number];
  autoBolt: HeroAutoBolt;
}

export interface FieldDef {
  halfWidth: number;
  spawnZ: number;
  heroZ: number;
  rallyZ: [number, number];
  rallySpreadX: number;
  intermission: number;
  waveBonusBase: number;
  waveBonusPer: number;
  startGold: number;
}

/* depthMul(w) 的返回：敌人 hp/atk/gold 的波次深度乘数 */
export interface DepthMulResult {
  hp: number;
  atk: number;
  gold: number;
}

/* ------------------------------ 派生视图函数签名 ------------------------------ */
export type WaveDefFn = (w: number) => WaveDefResult;
export type DepthMulFn = (w: number) => DepthMulResult;
export type BlightPerSecFn = (w: number) => number;
export type EnemyOfFn = (key: string) => EnemyDef | null;
export type AllyOfFn = (key: string) => AllyDef | null;
export type SpellOfFn = (id: number | string) => SpellDef | null;
export type UpgradeOfFn = (key: string) => UpgradeDef | null;
export type BranchOfFn = (key: string) => BranchDef | null;
export type UpgradeCostFn = (def: UpgradeDef, level: number) => number;
export type ValidateFn = () => string[];

/* ------------------------------ 英雄基线 ------------------------------ */
const HERO: HeroDef = {
  hp: 100,
  position: [0, -30],            // 战场坐标（x, z），面朝 +z 的亡灵来向
  autoBolt: {
    damage: 8, interval: 0.72, range: 17, speed: 26, unlock: 'unlockBolt',
    name: '魔弹', color: '#4f9fd9',
  },
};

/* ------------------------------ 英雄法术 ------------------------------ */
/* groundTarget: 鼠标选地面落点释放；否则自动锁定最优目标（空格/按钮） */
const SPELLS: SpellDef[] = [
  {
    id: 1, name: '火球术', hotkey: '1', form: '落点 AOE', groundTarget: true,
    color: '#ff9440', range: 34, radius: 4.2, damage: 36,
    windup: 0.42, cooldown: 2.6, flightSpeed: 20,
    description: '魔焰火球划出弧线砸进敌阵，冲击波掀翻成片骸骨。',
  },
  {
    id: 2, name: '霜爆术', hotkey: '2', form: '落点 AOE · 减速', groundTarget: true, unlock: 'unlockFrost',
    color: '#2fa3d6', range: 30, radius: 5.2, damage: 14,
    windup: 0.5, cooldown: 6.0, flightSpeed: 24, slow: { factor: 0.45, duration: 3.5 },
    description: '寒潮在落点炸开，冻缓亡灵的脚步，为防线争取喘息。',
  },
  {
    id: 3, name: '雷霆之矛', hotkey: '3', form: '落点打击 · 链式', groundTarget: true, unlock: 'unlockThunder',
    color: '#9a6fe8', range: 34, radius: 2.6, damage: 46,
    windup: 0.55, cooldown: 4.2, flightSpeed: 0, chain: { count: 2, damage: 16, range: 6 },
    description: '天穹掷下审判雷矛，电弧跳向邻近亡灵逐一劈碎。',
  },
];

/* ------------------------------ 亡灵军团 ------------------------------ */
/* speed m/s；gold 为击杀奖励；reach 为与防线目标的交战半径 */
const ENEMIES: EnemyDef[] = [
  {
    key: 'grunt', name: '骸骨卒', hp: 34, speed: 2.6, atk: 6, atkInterval: 1.0,
    reach: 1.7, gold: 6, scale: 1, color: '#e7ddbd', eye: '#65cbbb',
  },
  {
    key: 'runner', name: '疾骨', hp: 20, speed: 4.6, atk: 5, atkInterval: 0.8,
    reach: 1.6, gold: 8, scale: 0.86, color: '#efe4c9', eye: '#7cb989',
  },
  {
    key: 'shield', name: '持盾骸骨', hp: 112, speed: 1.7, atk: 10, atkInterval: 1.4,
    reach: 1.8, gold: 14, scale: 1.14, color: '#b9c2c6', eye: '#ffb257',
  },
  {
    key: 'lord', name: '骸骨领主', hp: 850, speed: 1.5, atk: 26, atkInterval: 1.8,
    reach: 2.6, gold: 160, scale: 2.1, color: '#e8dcc2', eye: '#ff4b4b',
    boss: true,
  },
  {
    key: 'colossus', name: '碎骨巨像', hp: 2400, speed: 1.15, atk: 42, atkInterval: 2.0,
    reach: 3.2, gold: 280, scale: 2.7, color: '#b8a98c', eye: '#ffb257',
    boss: true, slam: true,
  },
  {
    key: 'bishop', name: '亡灵主教', hp: 3200, speed: 1.8, atk: 34, atkInterval: 1.5,
    reach: 2.4, gold: 420, scale: 2.2, color: '#d8c9e8', eye: '#c96bff',
    boss: true, summon: { unit: 'grunt', count: 2, interval: 6, cap: 26 },
  },
];

/* ------------------------------ 圣光军团 ------------------------------ */
/* cost 金币召唤；slot 行次：0 = 前排近战（誓卫），1 = 后排远程（猎手） */
const ALLIES: AllyDef[] = [
  {
    key: 'guard', name: '誓卫', hotkey: 'F', cost: 50, cap: 6, row: 0, unlock: 'unlockGuard',
    hp: 90, atk: 9, atkInterval: 1.0, reach: 2.1, speed: 0, ranged: false,
    color: '#608ebc', trim: '#e1bb65', description: '持矛列阵的圣殿卫兵，死死顶住亡灵的冲击。',
  },
  {
    key: 'hunter', name: '圣殿猎手', hotkey: 'G', cost: 80, cap: 6, row: 1, unlock: 'unlockHunter',
    hp: 55, atk: 11, atkInterval: 1.25, reach: 14, speed: 0, ranged: true,
    projectileSpeed: 22, color: '#5eaa9c', trim: '#f1d590', description: '后排连珠放箭，优先点杀越线的疾骨。',
  },
];

/* ------------------------------ 天赋树 ------------------------------ */
/* 对位原作 skill tree：三分支（法术/军团/体魄），节点带等级与父依赖
   （parent 需 ≥ LV1 才可投资本节点）。cost(level) = base * growth^level。
   招牌节点对位：魂息汲取=原作 Spirit Drain（击杀回血），回响碎片=
   Resounding Fragments（魔弹弹片弹跳），圣辉坚甲=Fortitude。 */
const BRANCHES: BranchDef[] = [
  { key: 'spell', name: '法术研习', color: '#c26a31' },
  { key: 'legion', name: '军团契约', color: '#387e9b' },
  { key: 'vital', name: '旅途补给', color: '#6a8950' },
];
const UPGRADES: UpgradeDef[] = [
  {
    key: 'spellPower', branch: 'spell', parent: null, name: '魔焰强化', base: 35, growth: 1.55, max: 8,
    per: '+18%/级', applies: '法术伤害',
    description: '让每一颗火球更有分量。所有已学会的法术与魔弹伤害提升 18%。',
  },
  {
    key: 'surge', branch: 'spell', parent: 'spellPower', name: '施法熟练', base: 40, growth: 1.55, max: 6,
    per: '-7%/级', applies: '法术冷却',
    description: '更快准备下一次施法。所有已学会法术的冷却缩短 7%。',
  },
  {
    key: 'fireMastery', branch: 'spell', parent: 'spellPower', name: '烈焰精通', base: 65, growth: 1.55, max: 4,
    per: '+25% 伤 · +12% 范围', applies: '火球术',
    description: '火球伤害 +25%，爆炸半径 +12%。让一颗火球覆盖更多敌人。',
  },
  {
    key: 'autoFire', branch: 'spell', parent: 'fireMastery', name: '自动火球', base: 140, growth: 1, max: 1,
    per: '自动施放', applies: '火球术',
    description: '第一次自动化：火球冷却完毕即自动瞄准敌群，你仍可手动施法。',
  },
  {
    key: 'unlockFrost', branch: 'spell', parent: 'autoFire', name: '研习霜爆', base: 180, growth: 1, max: 1,
    per: '新法术', applies: '霜爆术',
    description: '永久解锁霜爆术与快捷键 2。范围寒潮减缓敌人，给火球争取时间。',
  },
  {
    key: 'frostMastery', branch: 'spell', parent: 'unlockFrost', name: '霜寒精通', base: 110, growth: 1.55, max: 4,
    per: '更强减速', applies: '霜爆术',
    description: '霜爆伤害 +15%，减速加深、持续 +0.8s。',
  },
  {
    key: 'autoFrost', branch: 'spell', parent: 'frostMastery', name: '自动霜爆', base: 260, growth: 1, max: 1,
    per: '自动施放', applies: '霜爆术',
    description: '霜爆术冷却完毕即自动覆盖敌群，持续压制推进。',
  },
  {
    key: 'unlockThunder', branch: 'spell', parent: 'autoFrost', name: '研习雷霆', base: 320, growth: 1, max: 1,
    per: '新法术', applies: '雷霆之矛',
    description: '永久解锁雷霆之矛与快捷键 3。强力打击与链式电弧击穿敌群。',
  },
  {
    key: 'thunderMastery', branch: 'spell', parent: 'unlockThunder', name: '雷霆精通', base: 120, growth: 1.6, max: 3,
    per: '+1 链', applies: '雷霆之矛',
    description: '雷矛伤害 +20%，链式跳弧 +1 道。',
  },
  {
    key: 'autoThunder', branch: 'spell', parent: 'thunderMastery', name: '自动雷霆', base: 300, growth: 1, max: 1,
    per: '自动施放', applies: '雷霆之矛',
    description: '雷霆之矛冷却完毕即自动劈落，链弧自动寻敌。',
  },
  {
    key: 'unlockBolt', branch: 'spell', parent: 'autoFire', name: '奥术魔弹', base: 160, growth: 1, max: 1,
    per: '辅助攻击', applies: '自动魔弹',
    description: '永久学会自动魔弹，近处有敌人时持续射击，填补法术冷却。',
  },
  {
    key: 'resounding', branch: 'spell', parent: 'unlockBolt', name: '回响碎片', base: 85, growth: 1.6, max: 3,
    per: '+1 弹跳', applies: '自动魔弹',
    description: '魔弹弹向邻近亡灵，每级多跳 1 次，每次保留 55% 伤害。',
  },
  {
    key: 'oath', branch: 'legion', parent: null, requires: 'autoFire', name: '誓约武备', base: 70, growth: 1.55, max: 8,
    per: '+15%/级', applies: '全军攻击',
    description: '为未来的军团准备武备。全体盟军攻击提升 15%，开启招募研习。',
  },
  {
    key: 'unlockGuard', branch: 'legion', parent: 'oath', name: '誓卫契约', base: 100, growth: 1, max: 1,
    per: '新军种', applies: '誓卫',
    description: '永久解锁誓卫招募。出战后花费金币召唤近战卫兵，抵住来敌。',
  },
  {
    key: 'guardDrill', branch: 'legion', parent: 'unlockGuard', name: '誓卫操练', base: 95, growth: 1.55, max: 4,
    per: '+20% 生命', applies: '誓卫',
    description: '誓卫生命 +20%、攻击间隔缩短 10%。',
  },
  {
    key: 'unlockHunter', branch: 'legion', parent: 'unlockGuard', name: '猎手契约', base: 180, growth: 1, max: 1,
    per: '新军种', applies: '圣殿猎手',
    description: '永久解锁圣殿猎手招募。从后排远程点杀越线的敌人。',
  },
  {
    key: 'hunterLore', branch: 'legion', parent: 'unlockHunter', name: '猎手战技', base: 95, growth: 1.55, max: 4,
    per: '+20% 攻', applies: '圣殿猎手',
    description: '猎手攻击 +20%、射击间隔缩短 10%。',
  },
  {
    key: 'muster', branch: 'legion', parent: 'guardDrill', name: '扩充军召', base: 90, growth: 1.6, max: 6,
    per: '+2/级', applies: '召唤上限',
    description: '誓卫与圣殿猎手的在场上限各 +2。',
  },
  {
    key: 'fortitude', branch: 'vital', parent: null, requires: 'spellPower', name: '旅者体魄', base: 50, growth: 1.5, max: 8,
    per: '+25 HP', applies: '生命上限',
    description: '生命上限增加 25，让下一次旅程坚持得更久。',
  },
  {
    key: 'spiritDrain', branch: 'vital', parent: 'fortitude', name: '魂息汲取', base: 80, growth: 1.55, max: 5,
    per: '+1 HP/杀', applies: '击杀回复',
    description: '每一次击杀回复生命，抵消战斗中的瘴蚀。',
  },
  {
    key: 'greed', branch: 'vital', parent: 'fortitude', name: '慧眼拾金', base: 55, growth: 1.5, max: 6,
    per: '+12%/级', applies: '击杀金币',
    description: '亡灵掉落的金币增加 12%，更快积累下一次成长。',
  },
  {
    key: 'lastStand', branch: 'vital', parent: 'spiritDrain', name: '最终壁垒', base: 150, growth: 1, max: 1,
    per: '1 次/局', applies: '致死保护',
    description: '承受致命一击时保留 1 点生命，每次出战可触发一次。',
  },
];

/* ------------------------------ 无尽波次生成器 ------------------------------ */
/* 单次下探 = 无尽波次：waveDef(w) 逐波派生编成，只有败北或主动撤退才回营。
   每 BOSS_EVERY 波为头目波（三 Boss 轮换，数值仍乘 depthMul）。
   瘴蚀 Blight：战斗中每秒扣血，随波次加深——逼出 DPS 检定，
   由体魄系的圣辉坚甲（上限）与魂息汲取（击杀回血）对冲。 */
const BOSS_EVERY = 5;
const BOSS_ROTATION: string[] = ['lord', 'colossus', 'bishop'];
const THEMES: ThemeDef[] = [
  { key: 'plains', name: '晨风草原', theme: { fog: '#c3deea', fogDensity: 0.006, ground: '#a5be78', gate: '#50b8ad', moon: '#fff0d4' } },
  { key: 'mire', name: '翡翠湿地', theme: { fog: '#c6e5db', fogDensity: 0.008, ground: '#84b58a', gate: '#e6b75c', moon: '#fff3db' } },
  { key: 'citadel', name: '曙光圣殿', theme: { fog: '#e1dced', fogDensity: 0.007, ground: '#b3af87', gate: '#b57aac', moon: '#fff0e1' } },
];
function waveDef(w: number): WaveDefResult {
  const d = Math.max(0, w - 1);
  const ramp = (base: number, per: number, cap: number): number => Math.max(2, Math.min(cap, Math.round(base + per * d)));
  const groups: WaveGroup[] = [];
  if (w === 1) {
    return { groups: [{ key: 'grunt', count: 6, lane: 0, interval: 1.1 }] };
  }
  if (w % BOSS_EVERY === 0) {
    const boss = BOSS_ROTATION[Math.floor(w / BOSS_EVERY - 1) % BOSS_ROTATION.length];
    groups.push({ key: boss, count: 1, lane: 0, interval: 1 });
    groups.push({ key: 'grunt', count: Math.max(3, Math.round(ramp(5, 1.2, 16) * 0.7)), lane: -1, interval: 0.7 });
    groups.push({ key: 'runner', count: Math.max(2, Math.round(ramp(3, 0.9, 12) * 0.7)), lane: 1, interval: 0.5 });
    groups.push({ key: 'shield', count: Math.max(2, Math.round(ramp(2, 0.7, 8) * 0.7)), lane: 0, interval: 0.9 });
    /* 原 JS `(enemyOf(boss) || {}).name`：查表失败时回落为 "undefined现身"（validate 保证查表命中） */
    return { groups, banner: (enemyOf(boss)?.name ?? 'undefined') + '现身' };
  }
  groups.push({ key: 'grunt', count: ramp(6, 1.6, 22), lane: w % 3 - 1, interval: 0.75 });
  groups.push({ key: 'runner', count: ramp(3, 1.1, 15), lane: (w + 1) % 3 - 1, interval: 0.5 });
  groups.push({ key: 'shield', count: ramp(2, 0.9, 12), lane: (w + 2) % 3 - 1, interval: 0.9 });
  return { groups };
}
/* 波次深度乘数（w → 敌人 hp/atk/gold）：二次项保证长线变硬 */
function depthMul(w: number): DepthMulResult {
  const d = Math.max(0, w - 1);
  return {
    hp: 1 + 0.16 * d + 0.012 * d * d,
    atk: 1 + 0.10 * d + 0.004 * d * d,
    gold: 1 + 0.10 * d,
  };
}
/* 瘴蚀：战斗中每秒生命流失，随波次缓升 */
function blightPerSec(w: number): number {
  return 0.5 + 0.06 * Math.max(0, w - 1);
}

/* ------------------------------ 战场几何 ------------------------------ */
const FIELD: FieldDef = {
  halfWidth: 14,                 // 可用地面半宽（x ∈ [-14, 14]）
  spawnZ: 36,                    // 亡灵出料口（雾中）
  heroZ: -30,                    // 英雄防线（与 HERO.position 对齐）
  rallyZ: [-21, -26],            // 盟友集结行：row0 前排 / row1 后排
  rallySpreadX: 10,              // 集结行横向排布半宽
  intermission: 18,              // 波间整备秒数
  waveBonusBase: 20,             // 波次通关奖金 = base + wave * per（再乘深度赏金轴）
  waveBonusPer: 6,
  startGold: 90,
};

/* ------------------------------ 派生视图 ------------------------------ */
function indexBy<T>(list: readonly T[], key: keyof T): Record<string, T> {
  const map: Record<string, T> = {};
  for (const item of list) map[String(item[key])] = item;
  return map;
}
const enemyOf: EnemyOfFn = (key) => ENEMIES.find((e) => e.key === key) || null;
const allyOf: AllyOfFn = (key) => ALLIES.find((a) => a.key === key) || null;
const spellOf: SpellOfFn = (id) => SPELLS.find((s) => s.id === Number(id)) || null;
const upgradeOf: UpgradeOfFn = (key) => UPGRADES.find((u) => u.key === key) || null;
const branchOf: BranchOfFn = (key) => BRANCHES.find((b) => b.key === key) || null;
const upgradeCost: UpgradeCostFn = (def, level) => Math.round(def.base * Math.pow(def.growth, level));
/* 整数钳制工具（原 JS 中为 IIFE 私有助手，本模块内暂无调用方；导出以保留实现并通过 noUnusedLocals） */
export function clampInt(v: number, a: number, b: number): number {
  v = Math.round(Number(v) || 0);
  return v < a ? a : v > b ? b : v;
}

/* 启动与测试都会运行；返回问题列表而不是抛错，便于一次收集全部问题 */
function validate(): string[] {
  const problems: string[] = [];
  const spellIds = new Set<number>(), hotkeys = new Set<string>();
  for (const s of SPELLS) {
    if (!Number.isInteger(s.id) || s.id < 1 || spellIds.has(s.id)) problems.push('法术 id 非法或重复: ' + s.id);
    spellIds.add(s.id);
    if (!/^#[0-9a-f]{6}$/i.test(s.color)) problems.push(s.name + ' 颜色非法');
    for (const k of ['range', 'radius', 'damage', 'windup', 'cooldown'] as const) {
      if (!(s[k] > 0)) problems.push(s.name + ' 缺少有效 ' + k);
    }
    if (typeof s.groundTarget !== 'boolean') problems.push(s.name + ' groundTarget 必须是布尔');
    if (hotkeys.has(s.hotkey)) problems.push(s.name + ' 快捷键重复: ' + s.hotkey);
    hotkeys.add(s.hotkey);
    if (typeof s.description !== 'string' || s.description.length < 4) problems.push(s.name + ' 缺少描述');
    if (s.slow && !(s.slow.factor > 0 && s.slow.factor < 1 && s.slow.duration > 0)) problems.push(s.name + ' slow 配置非法');
    if (s.chain && !(s.chain.count >= 0 && s.chain.damage > 0 && s.chain.range > 0)) problems.push(s.name + ' chain 配置非法');
  }
  for (const e of ENEMIES) {
    for (const k of ['hp', 'speed', 'atk', 'atkInterval', 'reach', 'gold'] as const) {
      if (!(e[k] > 0)) problems.push(e.name + ' 缺少有效 ' + k);
    }
    if (!/^#[0-9a-f]{6}$/i.test(e.color) || !/^#[0-9a-f]{6}$/i.test(e.eye)) problems.push(e.name + ' 颜色非法');
  }
  const allyKeys = new Set<string>();
  for (const a of ALLIES) {
    if (allyKeys.has(a.key)) problems.push('盟友 key 重复: ' + a.key);
    allyKeys.add(a.key);
    for (const k of ['cost', 'cap', 'hp', 'atk', 'atkInterval', 'reach'] as const) {
      if (!(a[k] > 0)) problems.push(a.name + ' 缺少有效 ' + k);
    }
    if (a.row !== 0 && a.row !== 1) problems.push(a.name + ' row 必须是 0/1');
    if (a.ranged && !(a.projectileSpeed !== undefined && a.projectileSpeed > 0)) problems.push(a.name + ' 远程单位缺 projectileSpeed');
    if (hotkeys.has(a.hotkey)) problems.push(a.name + ' 快捷键与法术冲突: ' + a.hotkey);
    hotkeys.add(a.hotkey);
  }
  for (const u of UPGRADES) {
    if (!/^[a-zA-Z]/.test(u.key)) problems.push('升级 key 必须以字母开头: ' + u.key);
    for (const k of ['base', 'growth'] as const) if (!(u[k] > 0)) problems.push(u.name + ' 缺少有效 ' + k);
    if (!(u.max >= 1)) problems.push(u.name + ' max 非法');
    if (u.max >= 2 && upgradeCost(u, 1) <= upgradeCost(u, 0)) problems.push(u.name + ' 升级费用未递增');
    if (!branchOf(u.branch)) problems.push(u.name + ' 未知分支: ' + u.branch);
  }
  if (new Set(UPGRADES.map((u) => u.key)).size !== UPGRADES.length) problems.push('升级 key 重复');
  if (new Set(BRANCHES.map((b) => b.key)).size !== BRANCHES.length) problems.push('分支 key 重复');
  /* 树结构自检：父引用存在、无环、无跨分支父子、每分支恰有根 */
  const byKey = indexBy(UPGRADES, 'key');
  for (const def of [...SPELLS, ...ALLIES, HERO.autoBolt]) {
    if (def.unlock && !byKey[def.unlock]) problems.push('能力解锁节点不存在: ' + def.unlock);
  }
  for (const u of UPGRADES) {
    if (u.requires && !byKey[u.requires]) problems.push(u.name + ' 成长条件不存在: ' + u.requires);
    const seen = new Set<string>(), active = new Set<string>();
    const visit = (key: string): void => {
      if (active.has(key)) { problems.push(u.name + ' 成长条件成环'); return; }
      if (seen.has(key) || !byKey[key]) return;
      active.add(key);
      const def = byKey[key];
      if (def.parent) visit(def.parent);
      if (def.requires) visit(def.requires);
      active.delete(key); seen.add(key);
    };
    visit(u.key);
  }
  for (const u of UPGRADES) {
    if (u.parent === null) continue;
    const parent = byKey[u.parent];
    if (!parent) { problems.push(u.name + ' 父节点不存在: ' + u.parent); continue; }
    if (parent.branch !== u.branch) problems.push(u.name + ' 与父节点跨分支');
    if (parent.key === u.key) problems.push(u.name + ' 不能以自己为父');
  }
  for (const b of BRANCHES) {
    const roots = UPGRADES.filter((u) => u.branch === b.key && u.parent === null);
    if (roots.length !== 1) problems.push('分支 ' + b.name + ' 必须恰有一个根节点，现有 ' + roots.length);
  }
  for (const u of UPGRADES) {
    /* parent 为必填 string|null，原 JS 的 !== undefined 分支在此类型下恒真，已并入 null 判断 */
    let node: UpgradeDef | undefined = u;
    let hops = 0;
    while (node && node.parent !== null) {
      node = byKey[node.parent];
      if (++hops > UPGRADES.length) { problems.push(u.name + ' 依赖成环'); break; }
    }
  }
  /* 无尽波次生成器自检：前 40 波逐波派生，头目波契约与数值合法 */
  if (THEMES.length < 1) problems.push('主题表为空');
  for (const t of THEMES) {
    for (const k of ['fog', 'ground', 'gate', 'moon'] as const) {
      if (!/^#[0-9a-f]{6}$/i.test(t.theme[k] || '')) problems.push('主题 ' + t.key + ' 颜色非法: ' + k);
    }
    if (!(t.theme.fogDensity > 0)) problems.push('主题 ' + t.key + ' 雾密度非法');
  }
  for (let w = 1; w <= 40; w++) {
    const def = waveDef(w);
    for (const g of def.groups) {
      if (!enemyOf(g.key)) problems.push('第 ' + w + ' 波引用未知敌人: ' + g.key);
      if (!(g.count >= 1)) problems.push('第 ' + w + ' 波 ' + g.key + ' 数量非法');
      if (![-1, 0, 1].includes(g.lane)) problems.push('第 ' + w + ' 波路号非法');
    }
    const hasBoss = def.groups.some((g) => { const e = enemyOf(g.key); return e && e.boss; });
    if (w % BOSS_EVERY === 0 !== hasBoss) problems.push('第 ' + w + ' 波头目波契约不符');
    const mul = depthMul(w);
    for (const k of ['hp', 'atk', 'gold'] as const) {
      if (!(mul[k] > 0)) problems.push('第 ' + w + ' 波深度乘数非法: ' + k);
    }
    if (!(blightPerSec(w) > 0)) problems.push('第 ' + w + ' 波瘴蚀非法');
  }
  if (depthMul(20).hp <= depthMul(19).hp) problems.push('深度乘数应随波次递增');
  if (waveDef(1).groups.some((g) => enemyOf(g.key)?.boss)) problems.push('第 1 波不应有头目');
  for (const b of BOSS_ROTATION) {
    if (!enemyOf(b) || !enemyOf(b)?.boss) problems.push('BOSS_ROTATION 引用非 Boss 敌人: ' + b);
  }
  for (const k of ['halfWidth', 'spawnZ', 'intermission', 'startGold'] as const) {
    if (!(FIELD[k] > 0)) problems.push('FIELD.' + k + ' 非法');
  }
  if (!Number.isFinite(FIELD.heroZ) || FIELD.heroZ === 0) problems.push('FIELD.heroZ 非法');
  if (FIELD.rallyZ.length !== 2 || !(FIELD.rallyZ[0] > FIELD.rallyZ[1])) problems.push('FIELD.rallyZ 必须是前高后低两行');
  if (FIELD.heroZ >= FIELD.rallyZ[1]) problems.push('英雄必须站在集结行之后');
  if (HERO.position[1] !== FIELD.heroZ) problems.push('HERO.position 与 FIELD.heroZ 不一致');
  return problems;
}

/* ------------------------------ 全局注册表 ------------------------------ */
export interface Config {
  HERO: HeroDef;
  SPELLS: SpellDef[];
  ENEMIES: EnemyDef[];
  ALLIES: AllyDef[];
  UPGRADES: UpgradeDef[];
  BRANCHES: BranchDef[];
  BOSS_EVERY: number;
  BOSS_ROTATION: string[];
  THEMES: ThemeDef[];
  FIELD: FieldDef;
  waveDef: WaveDefFn;
  depthMul: DepthMulFn;
  blightPerSec: BlightPerSecFn;
  enemyOf: EnemyOfFn;
  allyOf: AllyOfFn;
  spellOf: SpellOfFn;
  upgradeOf: UpgradeOfFn;
  branchOf: BranchOfFn;
  upgradeCost: UpgradeCostFn;
  validate: ValidateFn;
}

export const CONFIG: Config = {
  HERO, SPELLS, ENEMIES, ALLIES, UPGRADES, BRANCHES, BOSS_EVERY, BOSS_ROTATION,
  THEMES, FIELD,
  waveDef, depthMul, blightPerSec,
  enemyOf, allyOf, spellOf, upgradeOf, branchOf, upgradeCost, validate,
};

// TODO(阶段2末)：全部模块转换后移除此全局桥
(window as unknown as { CONFIG: typeof CONFIG }).CONFIG = CONFIG;
