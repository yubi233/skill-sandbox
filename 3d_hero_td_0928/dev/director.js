/* ============================================================================
   director.js — 死灵防线 3D · 无尽波次导演 + 经济 + 状态机
   核心循环：营地(camp) → 进入地下城(enterDelve) → 无尽波次(battle↔intermission)
   → 败北 或 主动撤退(retreat) → 回营地 → 天赋树消费 → 再下探。
   编成由 CONFIG.waveDef 逐波派生；敌人强度乘 CONFIG.depthMul；
   战斗中瘴蚀(blight)每秒扣血逼出 DPS 检定。金币与天赋跨局保留。
   UI 与输入层只读状态、调方法，不直接改写内部字典。
   ========================================================================== */
(function (global) {
  'use strict';
  const FIELD = CONFIG.FIELD;
  const HERO = CONFIG.HERO;
  const LANE_X = [-7, 0, 7];

  const DIRECTOR = {
    state: 'title',          // title | camp | battle | intermission | defeat
    game: null,
    gold: FIELD.startGold,
    wave: 0,                 // 本次下探的当前波次（1 基；0 = 在营地）
    record: 0,               // 史录最深波次（跨下探保留，成绩线）
    heroHp: HERO.hp,
    heroMaxHp: HERO.hp,
    kills: 0,
    runKills: 0,             // 本次下探的击杀
    levels: {},              // 天赋树：跨局保留（营地消费，深入更稳）
    _queue: [],              // 待生成 {defKey, at, lane}
    _waveT: 0,
    _interT: 0,
    _listeners: [],
    completedDelves: 0,
    _runActive: false,
    _lastStandUsed: false,

    on(fn) { this._listeners.push(fn); },
    emit(kind, data) {
      for (const fn of this._listeners) {
        try { fn(kind, data); } catch (e) { console.error('[director] 监听器异常: ' + e); }
      }
    },

    bind(game) {
      this.game = game;
      this.reset();
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
      Units.clear();
      SPELLS.reset();
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
      Units.clear();
      SPELLS.reset();
      if (this.game && this.game.applyTheme) this.game.applyTheme(CONFIG.THEMES[0].theme);
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
      Units.clear();
      SPELLS.reset();
      this.emit('camp', {});
    },

    /* ------------------------------ 升级乘数 ------------------------------ */
    inRun() { return this.state === 'battle' || this.state === 'intermission'; },
    canBuyUpgrades() { return this.state === 'camp' && this.completedDelves > 0; },
    ownsSpell(id) {
      const def = CONFIG.spellOf(id);
      if (!def) return false;
      return def.id === 1 || (this.completedDelves > 0 && !!def.unlock && this.level(def.unlock) > 0);
    },
    ownsAlly(key) {
      const def = CONFIG.allyOf(key);
      return !!(def && this.completedDelves > 0 && def.unlock && this.level(def.unlock) > 0);
    },
    ownsBolt() {
      return this.completedDelves > 0 && this.level(HERO.autoBolt.unlock) > 0;
    },
    level(key) { return this.levels[key] || 0; },
    isUnlocked(key) {
      const def = CONFIG.upgradeOf(key);
      if (!def) return false;
      return (def.parent === null || this.level(def.parent) >= 1) &&
        (!def.requires || this.level(def.requires) >= 1);
    },
    upgradeVisible(key) {
      const def = CONFIG.upgradeOf(key);
      if (!def || this.completedDelves === 0) return false;
      if (this.level(key) > 0) return true;
      if (def.requires && this.level(def.requires) === 0) return false;
      if (this.isUnlocked(key)) return true;
      const parent = CONFIG.upgradeOf(def.parent);
      return !!(parent && this.isUnlocked(parent.key));
    },
    upgradePreview(key) {
      const def = CONFIG.upgradeOf(key);
      if (!def) return { current: '', next: '' };
      const lv = this.level(key);
      const effect = (rank) => {
        const level = (k) => k === key ? rank : this.level(k);
        const pct = (n) => Math.round(n * 100) + '%';
        switch (key) {
          case 'spellPower': return pct(1 + 0.18 * rank) + ' 法术伤害';
          case 'surge': return (CONFIG.spellOf(1).cooldown * Math.max(0.55, 1 - 0.07 * rank)).toFixed(2) + 's 火球冷却';
          case 'fireMastery': return Math.round(CONFIG.spellOf(1).damage * (1 + 0.18 * level('spellPower')) * (1 + 0.25 * rank)) + ' 伤害 · ' + (CONFIG.spellOf(1).radius * (1 + 0.12 * rank)).toFixed(1) + 'm';
          case 'frostMastery': return pct(1 - Math.max(0.15, CONFIG.spellOf(2).slow.factor - 0.10 * rank)) + ' 减速 · ' + (CONFIG.spellOf(2).slow.duration + 0.8 * rank).toFixed(1) + 's';
          case 'thunderMastery': return (CONFIG.spellOf(3).chain.count + rank) + ' 次连锁 · ' + pct(1 + 0.20 * rank) + ' 伤害';
          case 'resounding': return rank + ' 次弹跳';
          case 'oath': return pct(1 + 0.15 * rank) + ' 全军攻击';
          case 'guardDrill': return Math.round(CONFIG.allyOf('guard').hp * (1 + 0.20 * rank)) + ' 生命 · ' + (CONFIG.allyOf('guard').atkInterval * Math.max(0.5, 1 - 0.10 * rank)).toFixed(2) + 's';
          case 'hunterLore': return pct(1 + 0.20 * rank) + ' 攻击 · ' + (CONFIG.allyOf('hunter').atkInterval * Math.max(0.5, 1 - 0.10 * rank)).toFixed(2) + 's';
          case 'muster': return (CONFIG.allyOf('guard').cap + 2 * rank) + ' / 军种';
          case 'fortitude': return (HERO.hp + 25 * rank) + ' 生命';
          case 'spiritDrain': return '+' + rank + ' 生命 / 击杀';
          case 'greed': return pct(1 + 0.12 * rank) + ' 击杀金币';
          case 'lastStand': return rank ? '每次出战 1 次' : '未获得保护';
          case 'autoFire': case 'autoFrost': case 'autoThunder': return rank ? '自动施放' : '手动施放';
          default: return rank ? '永久解锁' : '尚未学会';
        }
      };
      return { current: effect(lv), next: effect(Math.min(def.max, lv + 1)) };
    },
    spellPowerMul() { return 1 + 0.18 * this.level('spellPower'); },
    cooldownMul() { return Math.max(0.55, 1 - 0.07 * this.level('surge')); },
    goldMul() { return 1 + 0.12 * this.level('greed'); },
    /* 按军种聚合天赋：誓约武备(全军攻) + 军种节点(生命/攻速) */
    allyStats(allyKey) {
      let atk = 1 + 0.15 * this.level('oath');
      let hp = 1;
      let interval = 1;
      if (allyKey === 'guard') {
        hp = 1 + 0.20 * this.level('guardDrill');
        interval = 1 - 0.10 * this.level('guardDrill');
      } else if (allyKey === 'hunter') {
        atk *= 1 + 0.20 * this.level('hunterLore');
        interval = 1 - 0.10 * this.level('hunterLore');
      }
      return { atk, hp, interval: Math.max(0.5, interval) };
    },
    capOf(allyKey) {
      const def = CONFIG.allyOf(allyKey);
      return def ? def.cap + 2 * this.level('muster') : 0;
    },
    upgradeCost(key) {
      const def = CONFIG.upgradeOf(key);
      return def ? CONFIG.upgradeCost(def, this.level(key)) : Infinity;
    },

    /* ------------------------------ 经济 ------------------------------ */
    onKill(gold, isBoss) {
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
    buyUpgrade(key) {
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
    _rejectBuy(key, reason) {
      const def = CONFIG.upgradeOf(key);
      this.emit('reject-upgrade', { key, name: def ? def.name : key, reason });
      return false;
    },
    refreshAllies() {
      for (const a of Units.allies) {
        if (!a.alive) continue;
        const stats = this.allyStats(a.def.key);
        const ratio = a.maxHp > 0 ? a.hp / a.maxHp : 1;
        a.maxHp = Math.max(1, Math.round(a.def.hp * stats.hp));
        a.hp = Math.max(1, Math.round(a.maxHp * ratio));
      }
    },
    summon(allyKey) {
      const def = CONFIG.allyOf(allyKey);
      if (!def) return false;
      if (!this.inRun() || !this.ownsAlly(allyKey)) {
        this.emit('reject', { reason: this.inRun() ? 'locked' : 'battle', name: def.name });
        return false;
      }
      const alive = Units.aliveAllies().filter((a) => a.def.key === allyKey).length;
      if (alive >= this.capOf(allyKey)) { this.emit('reject', { reason: 'cap', name: def.name }); return false; }
      if (this.gold < def.cost) { this.emit('reject', { reason: 'gold', name: def.name }); return false; }
      this.gold -= def.cost;
      const stats = this.allyStats(allyKey);
      const a = Units.spawnAlly(allyKey, stats);
      if (!a) { this.gold += def.cost; this.emit('reject', { reason: 'slot', name: def.name }); return false; }
      this.emit('summon', { name: def.name });
      return true;
    },

    /* ------------------------------ 英雄承伤 ------------------------------ */
    damageHero(n) {
      if (this.state !== 'battle') return;
      this.heroHp = Math.max(0, this.heroHp - n);
      /* 最终壁垒：致死一击保留 1 点生命，每局一次 */
      if (this.heroHp <= 0 && this.level('lastStand') > 0 && !this._lastStandUsed) {
        this.heroHp = 1;
        this._lastStandUsed = true;
        this.emit('laststand', {});
        if (this.game) this.game.cinematic.shake = Math.max(this.game.cinematic.shake, 0.6);
      }
      this.emit('hurt', { hp: this.heroHp });
      if (this.heroHp <= 0) {
        this._finishDelve();
        this.state = 'defeat';
        Units.clear();
        SPELLS.reset();
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
        if (this.game && this.game.applyTheme) this.game.applyTheme(theme.theme);
        if (this.game) this.game.cinematic.shake = Math.max(this.game.cinematic.shake, 0.5);
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

    update(dt) {
      if (this.state === 'battle') {
        /* 瘴蚀：战斗中的持续生命流失（对位原作 Blight） */
        if (this.heroHp > 0) this.damageHero(this.blightPerSec() * dt);
        if (this.state !== 'battle') return;
        this._waveT += dt;
        while (this._queue.length && this._queue[0].at <= this._waveT) {
          const item = this._queue.shift();
          const x = LANE_X[(item.lane + 1)] + FX.randSpread(1.6);
          const z = FIELD.spawnZ + FX.randSpread(2.4);
          Units.spawnEnemy(item.defKey, x, z);
        }
        if (this.state === 'battle' &&
          !this._queue.length && Units.enemies.every((e) => !e.alive) && Units.dying.length === 0) {
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

  global.DIRECTOR = DIRECTOR;
})(window);
