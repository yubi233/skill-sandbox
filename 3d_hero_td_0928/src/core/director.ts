/* ============================================================================
   director.ts — 死灵防线 3D · 无尽波次导演 + 经济 + 状态机
   （自 dev/director.js 移植为 ESM；原文已删，git 历史保留）
   核心循环：营地(camp) → 进入地下城(enterDelve) → 无尽波次(battle↔intermission)
   → 败北 或 主动撤退(retreat) → 回营地 → 天赋树消费 → 再下探。
   编成由 CONFIG.waveDef 逐波派生；敌人强度乘 CONFIG.depthMul；
   战斗中瘴蚀(blight)每秒扣血逼出 DPS 检定。金币与天赋跨局保留。
   UI 与输入层只读状态、调方法，不直接改写内部字典。
   核心模块：零 import 引擎/DOM/渲染层。对 Units/SPELLS/game 的依赖全部
   倒置为可注入的 DirectorWorld 世界钩子，由浏览器桥 bindWorld() 注入；
   测试/驱动不注入时所有钩子调用走可选链静默跳过。
   ========================================================================== */
import { CONFIG } from './config';
import type { ThemeColors } from './config';
import { allyCap, allyStats, cooldownMul, goldMul, spellPowerMul, upgradePreview } from './rules/stats';

/* ------------------------------ 类型 ------------------------------ */

/* 状态机的五个状态 */
type DirectorState = 'title' | 'camp' | 'battle' | 'intermission' | 'defeat';

/* 盟友最小视图：导演只读 alive/def（key + 基础 hp），并直接改写 hp/maxHp（保留已损血量比例） */
export interface AllyLike {
  alive: boolean;
  def: { key: string; hp: number };
  hp: number;
  maxHp: number;
}

/* 世界钩子（依赖倒置）：原对 Units/SPELLS/game 的直接引用改为注入实现。
   null 约定：spawnAlly 返回 null = 满员无空位 → 上层退款。 */
export interface DirectorWorld {
  clearWorld(): void;                                     // Units.clear()
  spawnEnemy(defKey: string, x: number, z: number): void; // Units.spawnEnemy(defKey, x, z)
  spawnAlly(key: string, stats: { atk: number; hp: number; interval: number }): unknown; // Units.spawnAlly(key, stats)
  allies(): AllyLike[];                                   // Units.allies（含阵亡，alive 字段区分）
  aliveEnemies(): Array<{ alive: boolean }>;              // Units.enemies
  dyingCount(): number;                                   // Units.dying.length
  resetSpells(): void;                                    // SPELLS.reset()
  shake(amount: number): void;                            // game.cinematic.shake = max(shake, amount)
  applyTheme(theme: ThemeColors): void;                   // game.applyTheme(theme)
}

/* 事件监听器：阶段3将替换为带类型的事件队列；暂保留字符串 kind 的 on/emit 机制 */
export type DirectorListener = (kind: string, data: any) => void;

const FIELD = CONFIG.FIELD;
const HERO = CONFIG.HERO;
const LANE_X = [-7, 0, 7];

/* 出怪散布扰动：与 FX.randSpread 同式。该式为纯数学（无引擎/无状态），
   核心层禁止 import 渲染模块，故本地自带一份，行为逐位一致。 */
const randSpread = (a: number): number => (Math.random() * 2 - 1) * a;

export const DIRECTOR = {
  state: 'title' as DirectorState, // title | camp | battle | intermission | defeat
  _world: null as DirectorWorld | null,
  gold: FIELD.startGold,
  wave: 0,                 // 本次下探的当前波次（1 基；0 = 在营地）
  record: 0,               // 史录最深波次（跨下探保留，成绩线）
  heroHp: HERO.hp,
  heroMaxHp: HERO.hp,
  kills: 0,
  runKills: 0,             // 本次下探的击杀
  levels: {} as Record<string, number>,              // 天赋树：跨局保留（营地消费，深入更稳）
  _queue: [] as Array<{ defKey: string; at: number; lane: number }>, // 待生成 {defKey, at, lane}
  _waveT: 0,
  _interT: 0,
  _listeners: [] as DirectorListener[],
  completedDelves: 0,
  _runActive: false,
  _lastStandUsed: false,

  on(fn: DirectorListener) { this._listeners.push(fn); },
  /* data 可省略（原 JS 即有 emit('reset') 单参调用，监听器收到 undefined） */
  emit(kind: string, data?: any) {
    for (const fn of this._listeners) {
      try { fn(kind, data); } catch (e) { console.error('[director] 监听器异常: ' + (e as Error)); }
    }
  },

  /* 兼容旧签名（dev/main.js 与测试仍传 game）：核心不再持有游戏壳，仅复位。
     世界钩子请改用 bindWorld() 注入。 */
  bind(_game: unknown) {
    this.reset();
  },

  bindWorld(world: DirectorWorld) {
    this._world = world;
  },

  reset() {
    this.state = 'title';
    this.gold = FIELD.startGold;
    this.wave = 0;
    this.record = 0;
    this.heroMaxHp = HERO.hp;
    this.heroHp = HERO.hp;
    this.kills = 0;
    this.runKills = 0;
    this.levels = {};
    this.completedDelves = 0;
    this._runActive = false;
    this._lastStandUsed = false;
    this._queue.length = 0;
    this._waveT = 0;
    this._interT = 0;
    this._world?.clearWorld();
    this._world?.resetSpells();
    this.emit('reset');
  },

  /* ------------------------------ 地下城循环 ------------------------------ */
  /* 进地下城 → 无尽波次 → 败北或主动撤退回营 → 天赋消费 → 再下探 */
  depthMul() { return CONFIG.depthMul(Math.max(1, this.wave)); },
  blightPerSec() { return CONFIG.blightPerSec(Math.max(1, this.wave)); },
  begin() {
    if (this.state !== 'title') return;
    this.state = 'camp';
    this.emit('camp', {});
  },
  enterDelve() {
    if (this.state !== 'camp') return false;
    this._runActive = true;
    this.wave = 0;
    this.runKills = 0;
    this.heroHp = this.heroMaxHp;
    this._lastStandUsed = false;
    this._world?.clearWorld();
    this._world?.resetSpells();
    this._world?.applyTheme(CONFIG.THEMES[0].theme);
    this.nextWave();
    this.emit('delve', { record: this.record });
    return true;
  },
  /* 主动撤退：带着战利品回营（与败北同结果，但体面） */
  retreat() {
    if (this.state !== 'battle' && this.state !== 'intermission') return false;
    const wave = this.wave;
    this.goCamp();
    this.emit('retreat', { wave, gold: this.gold });
    return true;
  },
  _finishDelve() {
    if (!this._runActive) return;
    this.completedDelves++;
    this._runActive = false;
  },
  goCamp() {
    this._finishDelve();
    this.state = 'camp';
    this.wave = 0;
    this._queue.length = 0;
    this._world?.clearWorld();
    this._world?.resetSpells();
    this.emit('camp', {});
  },

  /* ------------------------------ 升级乘数 ------------------------------ */
  inRun() { return this.state === 'battle' || this.state === 'intermission'; },
  canBuyUpgrades() { return this.state === 'camp' && this.completedDelves > 0; },
  ownsSpell(id: string) {
    const def = CONFIG.spellOf(id);
    if (!def) return false;
    return def.id === 1 || (this.completedDelves > 0 && !!def.unlock && this.level(def.unlock) > 0);
  },
  ownsAlly(key: string) {
    const def = CONFIG.allyOf(key);
    return !!(def && this.completedDelves > 0 && def.unlock && this.level(def.unlock) > 0);
  },
  ownsBolt() {
    return this.completedDelves > 0 && this.level(HERO.autoBolt.unlock) > 0;
  },
  level(key: string) { return this.levels[key] || 0; },
  isUnlocked(key: string) {
    const def = CONFIG.upgradeOf(key);
    if (!def) return false;
    return (def.parent === null || this.level(def.parent) >= 1) &&
      (!def.requires || this.level(def.requires) >= 1);
  },
  upgradeVisible(key: string) {
    const def = CONFIG.upgradeOf(key);
    if (!def || this.completedDelves === 0) return false;
    if (this.level(key) > 0) return true;
    if (def.requires && this.level(def.requires) === 0) return false;
    if (this.isUnlocked(key)) return true;
    const parent = def.parent === null ? null : CONFIG.upgradeOf(def.parent);
    return !!(parent && this.isUnlocked(parent.key));
  },
  upgradePreview(key: string) {
    return upgradePreview(this.levels, key);
  },
    spellPowerMul() { return spellPowerMul(this.levels); },
  cooldownMul() { return cooldownMul(this.levels); },
  goldMul() { return goldMul(this.levels); },
  /* 按军种聚合天赋：誓约武备(全军攻) + 军种节点(生命/攻速) */
  allyStats(allyKey: string) {
    return allyStats(this.levels, allyKey);
  },
    capOf(allyKey: string) {
    return allyCap(this.levels, allyKey);
  },
  upgradeCost(key: string) {
    const def = CONFIG.upgradeOf(key);
    return def ? CONFIG.upgradeCost(def, this.level(key)) : Infinity;
  },

  /* ------------------------------ 经济 ------------------------------ */
  onKill(gold: number, isBoss: boolean) {
    this.kills++;
    if (this.state === 'battle' || this.state === 'intermission') this.runKills++;
    const mul = this.depthMul();
    const gained = Math.round(gold * this.goldMul() * mul.gold);
    this.gold += gained;
    /* 魂息汲取：击杀回血（对位原作 Spirit Drain） */
    const drain = this.level('spiritDrain');
    if (drain > 0 && this.heroHp < this.heroMaxHp) {
      this.heroHp = Math.min(this.heroMaxHp, this.heroHp + drain);
    }
    this.emit('gold', { gained, total: this.gold, isBoss });
  },
  buyUpgrade(key: string) {
    if (this.state !== 'camp') return this._rejectBuy(key, 'camp');
    if (!this.canBuyUpgrades()) return this._rejectBuy(key, 'first-delve');
    const def = CONFIG.upgradeOf(key);
    if (!def) return this._rejectBuy(key, 'unknown');
    const lv = this.level(key);
    if (lv >= def.max) return this._rejectBuy(key, 'max');
    if (!this.isUnlocked(key)) return this._rejectBuy(key, 'locked');
    const cost = CONFIG.upgradeCost(def, lv);
    if (this.gold < cost) return this._rejectBuy(key, 'gold');
    this.gold -= cost;
    this.levels[key] = lv + 1;
    if (key === 'fortitude') {
      this.heroMaxHp += 25;
      this.heroHp = Math.min(this.heroMaxHp, this.heroHp + 25);
    }
    /* 军团分支：购买即重算在场单位（保留已损血量比例） */
    if (['oath', 'guardDrill', 'hunterLore'].includes(key)) this.refreshAllies();
    this.emit('upgrade', { key, level: lv + 1 });
    return true;
  },
  _rejectBuy(key: string, reason: string) {
    const def = CONFIG.upgradeOf(key);
    this.emit('reject-upgrade', { key, name: def ? def.name : key, reason });
    return false;
  },
  refreshAllies() {
    for (const a of this._world?.allies() ?? []) {
      if (!a.alive) continue;
      const stats = this.allyStats(a.def.key);
      const ratio = a.maxHp > 0 ? a.hp / a.maxHp : 1;
      a.maxHp = Math.max(1, Math.round(a.def.hp * stats.hp));
      a.hp = Math.max(1, Math.round(a.maxHp * ratio));
    }
  },
  summon(allyKey: string) {
    const def = CONFIG.allyOf(allyKey);
    if (!def) return false;
    if (!this.inRun() || !this.ownsAlly(allyKey)) {
      this.emit('reject', { reason: this.inRun() ? 'locked' : 'battle', name: def.name });
      return false;
    }
    const alive = (this._world?.allies() ?? []).filter((a) => a.alive && a.def.key === allyKey).length;
    if (alive >= this.capOf(allyKey)) { this.emit('reject', { reason: 'cap', name: def.name }); return false; }
    if (this.gold < def.cost) { this.emit('reject', { reason: 'gold', name: def.name }); return false; }
    this.gold -= def.cost;
    const stats = this.allyStats(allyKey);
    const a = this._world?.spawnAlly(allyKey, stats);
    if (!a) { this.gold += def.cost; this.emit('reject', { reason: 'slot', name: def.name }); return false; }
    this.emit('summon', { name: def.name });
    return true;
  },

  /* ------------------------------ 英雄承伤 ------------------------------ */
  damageHero(n: number) {
    if (this.state !== 'battle') return;
    this.heroHp = Math.max(0, this.heroHp - n);
    /* 最终壁垒：致死一击保留 1 点生命，每局一次 */
    if (this.heroHp <= 0 && this.level('lastStand') > 0 && !this._lastStandUsed) {
      this.heroHp = 1;
      this._lastStandUsed = true;
      this.emit('laststand', {});
      this._world?.shake(0.6);
    }
    this.emit('hurt', { hp: this.heroHp });
    if (this.heroHp <= 0) {
      this._finishDelve();
      this.state = 'defeat';
      this._world?.clearWorld();
      this._world?.resetSpells();
      /* 败北返营：金币与天赋全保留，可强化后再下探 */
      this.emit('defeat', { wave: this.wave });
    }
  },

  /* ------------------------------ 波次流转（无尽） ------------------------------ */
  nextWave() {
    this.wave++;
    this.record = Math.max(this.record, this.wave);
    const def = CONFIG.waveDef(this.wave);
    this._queue.length = 0;
    this._waveT = 0;
    let t = 0.4;
    for (const g of def.groups) {
      for (let i = 0; i < g.count; i++) {
        this._queue.push({ defKey: g.key, at: t, lane: g.lane });
        t += g.interval;
      }
      t += 1.1;
    }
    this.state = 'battle';
    const hasBoss = def.groups.some((g) => { const e = CONFIG.enemyOf(g.key); return e && e.boss; });
    if (hasBoss) {
      /* 头目波换肤：战场随深度轮换 */
      const theme = CONFIG.THEMES[Math.floor(this.wave / CONFIG.BOSS_EVERY - 1) % CONFIG.THEMES.length];
      this._world?.applyTheme(theme.theme);
      this._world?.shake(0.5);
    }
    this.emit('wave', {
      wave: this.wave, hasBoss,
      banner: def.banner || (hasBoss ? '首领波' : ''),
    });
  },
  startNextNow() {
    if (this.state !== 'intermission') return;
    this.nextWave();
  },

  update(dt: number) {
    if (this.state === 'battle') {
      /* 瘴蚀：战斗中的持续生命流失（对位原作 Blight） */
      if (this.heroHp > 0) this.damageHero(this.blightPerSec() * dt);
      if (this.state !== 'battle') return;
      this._waveT += dt;
      while (this._queue.length && this._queue[0].at <= this._waveT) {
        const item = this._queue.shift()!;
        const x = LANE_X[(item.lane + 1)] + randSpread(1.6);
        const z = FIELD.spawnZ + randSpread(2.4);
        this._world?.spawnEnemy(item.defKey, x, z);
      }
      if (this.state === 'battle' &&
        !this._queue.length && this._world?.aliveEnemies().every((e) => !e.alive) === true && this._world?.dyingCount() === 0) {
        /* 本波清空 → 奖金 → 整备 → 下一波（无尽） */
        const mul = this.depthMul();
        const bonus = Math.round((FIELD.waveBonusBase + this.wave * FIELD.waveBonusPer) * mul.gold);
        this.gold += bonus;
        this.state = 'intermission';
        this._interT = FIELD.intermission;
        this.emit('clear', { wave: this.wave, bonus });
      }
    } else if (this.state === 'intermission') {
      this._interT -= dt;
      if (this._interT <= 0) this.nextWave();
    }
  },
  intermissionLeft() { return Math.max(0, this._interT); },
};

// TODO(阶段2末)：全部模块转换后移除此全局桥
if (typeof window !== 'undefined') {
  (window as unknown as { DIRECTOR: typeof DIRECTOR }).DIRECTOR = DIRECTOR;
}
