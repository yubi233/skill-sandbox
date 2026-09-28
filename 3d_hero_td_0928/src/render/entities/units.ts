/* ============================================================================
   units.ts — 死灵防线 3D · 单位实体系统（自 dev/entities.js 拆出为 ESM，本模块为主入口）
   · ResourceOwner：显式资源归属（见 ./resource_owner，此处转出供 window 桥继承）
   · Unit 基类：血量/减速/攻击节拍/程序化行走与挥击动画/头顶血条
   · Enemy：向防线推进，遇盟友或英雄进入交战；死亡掉金
   · Ally：占驻集结槽位，近战拦截 / 远程放箭
   · Projectile：共享池化的追踪弹（见 ./projectiles，英雄魔弹 / 猎手箭矢）
   · 逐实例异常隔离：单个单位故障只回收自身，不拖垮整帧
   与 effects/projectiles 的环：Units 只在其方法体内被运行期读取（ESM 活绑定，
   初始化期零访问），循环 import 安全。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { CONFIG, type EnemyDef, type AllyDef } from '../../core/config';
import { DIRECTOR } from '../../core/director';
import { gameRng, rngRange } from '../../core/rng';
import { FX, type EmitterCfg, type FxSpriteMesh } from '../particles';
import type { Game } from '../scene';
import { ResourceOwner } from './resource_owner';
import { nid, buildEnemyRig, buildAllyRig, eyeMat, type EnemyRig, type UnitRig } from './rigs';
import { HpBar } from './hp_bar';
import { hitSpark, bowFlash, ensureFx } from './effects';
import { ProjectilePool, type Projectile, type ProjectileSpawnOpts } from './projectiles';

const V3 = BABYLON.Vector3;
const C4 = BABYLON.Color4;
const { clamp, lerp, rand, randSpread } = FX;
const FIELD = CONFIG.FIELD;

export { ResourceOwner };

type Faction = 'enemy' | 'ally';

/* 集结槽位（takeSlot 派生，Ally 占驻） */
export interface RallySlot { i: number; x: number; z: number; }

/* 亡灵倒伏 / 召唤法环 的渐隐队列项（判别联合） */
export type DyingEntry =
  | { kind: 'unit'; unit: Unit; t: number; dur: number }
  | { kind: 'ring'; mesh: FxSpriteMesh; t: number; dur: number };

let nextUnitId = 1;

/* ------------------------------ 单位基类 ------------------------------ */
export class Unit {
  game: Game;
  scene: BABYLON.Scene;
  def: EnemyDef | AllyDef;
  faction: Faction;
  id: number;
  maxHp: number;
  hp: number;
  alive: boolean;
  dead: boolean;
  atk: number;
  attackTimer: number;
  swingT: number;
  walkPhase: number;
  slowUntil: number;
  slowFactor: number;
  flashT: number;
  target: Unit | null;
  rig: UnitRig;
  bar: HpBar | null;
  muzzle: BABYLON.Vector3;
  pendingHit: Unit | null;

  constructor(game: Game, def: EnemyDef | AllyDef, faction: Faction) {
    this.game = game;
    this.scene = game.scene;
    this.def = def;
    this.faction = faction;
    this.id = nextUnitId++;
    /* 亡灵随波次深度强化（hp/atk 轴；gold 轴在 DIRECTOR.onKill 结算）
       （原 JS 的 typeof/存在性守卫是 window 桥接期遗留，ESM 下 DIRECTOR 恒在，等价改写） */
    const depth = (DIRECTOR && typeof DIRECTOR.depthMul === 'function' && DIRECTOR.wave > 0)
      ? DIRECTOR.depthMul() : { hp: 1, atk: 1 };
    this.maxHp = Math.round(def.hp * depth.hp);
    this.hp = this.maxHp;
    this.alive = true;
    this.dead = false;
    this.atk = def.atk * depth.atk;
    /* 首攻节拍属战斗因果 → gameRng.combat（?seed= 可复现）；
       分布与原 rand 同为 [0.1, 0.5) 均匀。walkPhase 等表现随机仍走 FX。 */
    this.attackTimer = rngRange(gameRng.combat, 0.1, 0.5);
    this.swingT = -1;               // -1 = 未在挥击；0..1 挥击进度
    this.walkPhase = rand(0, Math.PI * 2);
    this.slowUntil = 0;
    this.slowFactor = 1;
    this.flashT = 0;
    this.target = null;
    this.rig = faction === 'enemy' ? buildEnemyRig(this.scene, def as EnemyDef) : buildAllyRig(this.scene, def as AllyDef);
    this.bar = null;
    this.muzzle = new V3();
    this.pendingHit = null;
  }
  get x(): number { return this.rig.root.position.x; }
  get z(): number { return this.rig.root.position.z; }
  setPos(x: number, z: number): void { this.rig.root.position.set(x, 0, z); }
  slow(factor: number, duration: number): void {
    if (factor < this.slowFactor || FX.time > this.slowUntil) this.slowFactor = factor;
    this.slowUntil = Math.max(this.slowUntil, FX.time + duration);
  }
  takeDamage(amount: number): void {
    if (!this.alive) return;
    this.hp -= amount;
    this.flashT = CONFIG.TUNING.flashDuration;
    if (!this.bar && (this.def as EnemyDef).boss !== true) this.bar = new HpBar(this.scene, this);
    if (this.bar) this.bar.setVisible(true);
    if (this.hp <= 0) this.kill();
  }
  kill(): void {
    if (!this.alive) return;
    this.alive = false;
    this.dead = true;
    Units.onDeath(this);
  }
  /* 挥击动画推进；返回 true 的那一帧判定命中 */
  updateSwing(dt: number): boolean {
    if (this.swingT >= 0) {
      this.swingT += dt / CONFIG.TUNING.swingDuration;
      if (this.swingT >= 1) { this.swingT = -1; return true; }
    }
    return false;
  }
  swingArm(): void {
    /* 败北清场可能发生在本单位 update 执行中途，返回后续一律空守卫 */
    if (!this.rig) return;
    const k = this.swingT < 0 ? 0 : Math.sin(Math.PI * clamp(this.swingT, 0, 1));
    this.rig.arm.rotation.x = -1.7 * k;
  }
  updateLocomotion(dt: number, moving: boolean): void {
    if (!this.rig) return;
    if (moving) this.walkPhase += dt * (this.def.speed || 3) * 3.4;
    const bob = moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : Math.sin(this.walkPhase * 0.32) * 0.012;
    this.rig.visual.position.y = bob;
    this.rig.visual.rotation.x = moving ? 0.10 : 0.02;
    this.flashT = Math.max(0, this.flashT - dt);
  }
  beginAttack(target: Unit | null): void {
    this.attackTimer = this.def.atkInterval;
    this.swingT = 0;
    this.pendingHit = target;
  }
  /* 命中结算：由子类实现对英雄/单位的伤害 */
  landHit(): void { }
  update(_dt: number): void { }
  dispose(): void {
    if (this.bar) { this.bar.dispose(); this.bar = null; }
    if (this.rig) {
      this.rig.root.dispose(false, false);
      this.rig = null as unknown as UnitRig;
    }
  }
}

/* ------------------------------ 亡灵单位 ------------------------------ */
const AGGRO = CONFIG.TUNING.aggro;   // 阶段3e：出处 CONFIG.TUNING
export class Enemy extends Unit {
  declare def: EnemyDef;
  declare rig: EnemyRig;
  laneX: number;
  deathT: number;
  _summonT: number | undefined;
  _flashing: boolean;

  constructor(game: Game, defKey: string) {
    const def = CONFIG.enemyOf(defKey)!;
    super(game, def, 'enemy');
    this.laneX = 0;
    this.deathT = -1;
    this._flashing = false;
  }
  speedNow(): number {
    const slowed = FX.time < this.slowUntil ? this.slowFactor : 1;
    return this.def.speed * slowed;
  }
  update(dt: number): void {
    if (!this.alive) return;
    const game = this.game;
    const speed = this.speedNow();

    /* 亡灵主教：周期性从身后唤出骸骨卒 */
    if (this.def.summon) {
      const s = this.def.summon;
      this._summonT = (this._summonT === undefined ? s.interval * 0.7 : this._summonT) - dt;
      if (this._summonT <= 0) {
        this._summonT = s.interval;
        if (Units.enemies.filter((e) => e.alive).length < s.cap) {
          for (let i = 0; i < s.count; i++) {
            Units.spawnEnemy(s.unit, this.x + FX.randSpread(2.6), this.z + 1.6 + FX.rand(0, 1.2));
          }
          const [r, g, b] = FX.hexToRgb(this.def.eye);
          Units.fxPool.burst(game, 'glow', 10, this.x, 1.6, this.z + 1.2, () => ({
            x: FX.randSpread(2.2), y: FX.rand(0.6, 2.2), z: FX.rand(0.2, 1.6),
          }), { color: [r, g, b], life: [0.4, 0.8], size0: [0.2, 0.5], size1: [0.04, 0.1], alpha: [0.4, 0.8], turb: 0.6 });
        }
      }
    }

    /* 选目标：身前 4.2m 内最近的盟友，否则推进向英雄 */
    let target: Ally | null = null, bestD = AGGRO;
    for (const a of Units.allies) {
      if (!a.alive) continue;
      const d = Math.hypot(a.x - this.x, a.z - this.z);
      if (d < bestD) { bestD = d; target = a; }
    }
    const hero = game.mage.root.position;
    const dHero = Math.hypot(hero.x - this.x, hero.z - this.z);
    const heroReach = this.def.reach + 0.3;

    let moving = false;
    if (target && bestD <= this.def.reach) {
      this.attackTick(dt, target);
    } else if (dHero <= heroReach) {
      this.attackTick(dt, null);
    } else {
      if (target && bestD < AGGRO) {
        /* 绕向盟友拦截 */
        const dx = target.x - this.x, dz = target.z - this.z;
        const len = Math.max(0.001, Math.hypot(dx, dz));
        this.rig.root.position.x += (dx / len) * speed * dt;
        this.rig.root.position.z += (dz / len) * speed * dt;
        this.rig.root.rotation.y = Math.atan2(dx, dz);
      } else if (this.z > FIELD.heroZ + CONFIG.TUNING.farSegment) {
        /* 远段：按路号队形推进 */
        this.rig.root.position.z -= speed * dt;
        this.rig.root.position.x += clamp(this.laneX - this.x, -1, 1) * speed * 0.22 * dt;
        this.rig.root.rotation.y = Math.PI;
      } else {
        /* 近段：向英雄合围，侧路敌人不会走过防线 */
        const dx = hero.x - this.x, dz = hero.z - this.z;
        const len = Math.max(0.001, Math.hypot(dx, dz));
        this.rig.root.position.x += (dx / len) * speed * dt;
        this.rig.root.position.z += (dz / len) * speed * dt;
        this.rig.root.rotation.y = Math.atan2(dx, dz);
      }
      moving = true;
      this.attackTimer = Math.max(this.attackTimer - dt, 0.12);
    }
    const hit = this.updateSwing(dt);
    if (hit) this.landHit();
    if (!this.alive || !this.rig) return;   /* 本帧挥击结算可能触发败北清场 */
    this.swingArm();
    this.updateLocomotion(dt, moving);
    if (this.bar) this.bar.update();

    /* 受击闪红 */
    const flash = this.flashT > 0 ? this.flashT / 0.14 : 0;
    if (flash > 0 && this.rig.eyeMesh) {
      this.rig.eyeMesh.material = eyeMat(this.scene, '#ff5f5f');
      this._flashing = true;
    } else if (this._flashing && this.rig.eyeMesh) {
      this.rig.eyeMesh.material = eyeMat(this.scene, this.def.eye);
      this._flashing = false;
    }
  }
  attackTick(dt: number, ally: Ally | null): void {
    this.rig.root.rotation.y = Math.atan2(
      (ally ? ally.x : this.game.mage.root.position.x) - this.x,
      (ally ? ally.z : this.game.mage.root.position.z) - this.z);
    if (this.swingT < 0) {
      this.attackTimer -= dt;
      if (this.attackTimer <= 0) this.beginAttack(ally);
    }
  }
  landHit(): void {
    const target = this.pendingHit;
    this.pendingHit = null;
    if (!target) {
      DIRECTOR.damageHero(this.atk);
      /* 碎骨巨像：重击落地震屏 */
      if (this.def.slam && this.game) {
        this.game.cinematic.shake = Math.max(this.game.cinematic.shake, 0.5);
      }
    } else if (target.alive) {
      target.takeDamage(this.atk);
      hitSpark(this.game, target.x, 1.0, target.z, '#ff8a6a');
    }
  }
}

/* ------------------------------ 圣光军团单位 ------------------------------ */
export class Ally extends Unit {
  declare def: AllyDef;
  slot: RallySlot;
  atkMul: number;

  constructor(game: Game, defKey: string, slot: RallySlot, stats?: { atk: number; hp: number; interval: number } | null) {
    const def = CONFIG.allyOf(defKey)!;
    super(game, def, 'ally');
    this.slot = slot;
    const s = stats || { atk: 1, hp: 1, interval: 1 };
    this.maxHp = Math.round(def.hp * s.hp);
    this.hp = this.maxHp;
    this.atkMul = s.atk;
    this.atk = Math.round(def.atk * s.atk);
    this.setPos(slot.x, slot.z);
    this.rig.root.rotation.y = 0; // 面朝 +z：亡灵来向
  }
  /* 攻速/攻击随天赋实时取值（誓约武备/军种节点购买即时生效） */
  intervalNow(): number {
    const s = DIRECTOR ? DIRECTOR.allyStats(this.def.key) : { interval: 1 };
    return this.def.atkInterval * s.interval;
  }
  atkNow(): number {
    const s = DIRECTOR ? DIRECTOR.allyStats(this.def.key) : { atk: 1 };
    return Math.round(this.def.atk * s.atk);
  }
  update(dt: number): void {
    if (!this.alive) return;
    /* 索敌：射程内最近的亡灵 */
    let target: Enemy | null = null, bestD = this.def.reach + 0.4;
    for (const e of Units.enemies) {
      if (!e.alive) continue;
      const d = Math.hypot(e.x - this.x, e.z - this.z);
      if (d < bestD) { bestD = d; target = e; }
    }
    let moving = false;
    if (target) {
      this.rig.root.rotation.y = Math.atan2(target.x - this.x, target.z - this.z);
      if (this.swingT < 0) {
        this.attackTimer -= dt;
        if (this.attackTimer <= 0) {
          if (this.def.ranged) {
            this.attackTimer = this.intervalNow();
            Units.spawnProjectile({
              fromX: this.x, fromY: 1.15, fromZ: this.z,
              target, speed: this.def.projectileSpeed!, damage: this.atkNow(),
              colorHex: '#ffe6a3', kind: 'arrow', faction: 'ally',
            });
            bowFlash(this.game, this);
          } else {
            this.beginAttack(target);
          }
        }
      }
    } else {
      this.rig.root.rotation.y = 0;
      this.attackTimer = Math.max(this.attackTimer - dt, 0.12);
    }
    const hit = this.updateSwing(dt);
    if (hit) this.landHit();
    if (!this.alive || !this.rig) return;   /* 本帧挥击结算可能触发败北清场 */
    this.swingArm();
    this.updateLocomotion(dt, moving);
    if (this.bar) this.bar.update();
  }
  landHit(): void {
    const target = this.pendingHit;
    this.pendingHit = null;
    if (target && target.alive) {
      target.takeDamage(this.atkNow());
      hitSpark(this.game, target.x, 1.0, target.z, '#cfe8ff');
    }
  }
}

/* fxPool：技能/实体共用的 burst 门面（原 IIFE 内 fxPoolShim；game 参数仅为签名兼容） */
const fxPoolShim = {
  burst(_game: Game, layer: string, n: number, x: number, y: number, z: number,
    velFn: Parameters<InstanceType<typeof FX.Emitter>['burst']>[4], cfg: EmitterCfg): void {
    const e = ensureFx(layer, cfg);   // key 由调用方给定（阶段3e：消灭热路径 JSON.stringify）
    e.burst(n, x, y, z, velFn);
  },
};

/* ------------------------------ 单位注册表 ------------------------------ */
export const Units = {
  enemies: [] as Enemy[], allies: [] as Ally[], dying: [] as DyingEntry[],
  game: null as Game | null, fxPool: fxPoolShim, ProjectilePool,
  projectiles: null as ProjectilePool | null,
  get classes() { return { Unit, Enemy, Ally }; },

  bind(game: Game): void {
    if (this.game === game) return;
    this.clear();
    this.game = game;
    this.projectiles = new ProjectilePool(game);
  },
  aliveEnemies(): Enemy[] { return this.enemies.filter((e) => e.alive); },
  aliveAllies(): Ally[] { return this.allies.filter((a) => a.alive); },
  boss(): Enemy | null { return this.enemies.find((e) => e.alive && e.def.boss) || null; },

  spawnEnemy(defKey: string, x: number, z: number): Enemy {
    const e = new Enemy(this.game!, defKey);
    e.setPos(x, z);
    e.laneX = x;
    e.rig.root.rotation.y = Math.PI;
    if (e.def.boss) { e.bar = new HpBar(this.game!.scene, e); e.bar.setVisible(true); e.bar.update(); }
    this.enemies.push(e);
    return e;
  },
  spawnAlly(defKey: string, buff?: { atk: number; hp: number; interval: number } | null): Ally | null {
    const def = CONFIG.allyOf(defKey)!;
    const slot = this.takeSlot(def.row);
    if (!slot) return null;
    const a = new Ally(this.game!, defKey, slot, buff);
    this.allies.push(a);
    const [r, g, b] = FX.hexToRgb(def.trim);
    const ring = FX.makeSprite(this.game!.scene, nid('summonRing'), FX.textures.ring, 'add', new C4(r, g, b, 0.8));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(slot.x, 0.08, slot.z);
    ring.scaling.set(0.1, 0.1, 1);
    this.dying.push({ kind: 'ring', mesh: ring, t: 0, dur: 0.6 });
    return a;
  },
  takeSlot(row: number): RallySlot | null {
    const used = new Set(this.allies.filter((a) => a.alive && a.def.row === row).map((a) => a.slot.i));
    for (let i = 0; i < 10; i++) {
      if (used.has(i)) continue;
      const count = CONFIG.ALLIES.filter((d) => d.row === row).reduce((s, d) => s + DIRECTOR.capOf(d.key), 0);
      if (i >= Math.max(4, count)) continue;
      const spread = FIELD.rallySpreadX;
      const x = -spread + (i / Math.max(1, Math.max(4, count) - 1)) * spread * 2;
      return { i, x, z: FIELD.rallyZ[row] + (i % 2 === 0 ? 0 : 1.4) };
    }
    return null;
  },

  spawnProjectile(opts: ProjectileSpawnOpts): Projectile { return this.projectiles!.spawn(opts); },

  /* AOE：返回被命中的单位（雷击链等需要二次利用） */
  applyAoE(x: number, z: number, radius: number, damage: number,
    opts?: { slow?: { factor: number; duration: number } }): Enemy[] {
    const victims: Enemy[] = [];
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const bodyR = 0.35 + (e.def.scale || 1) * 0.35;
      const d = Math.hypot(e.x - x, e.z - z);
      if (d <= radius + bodyR) {
        e.takeDamage(damage);
        if (opts && opts.slow && e.alive) e.slow(opts.slow.factor, opts.slow.duration);
        victims.push(e);
      }
    }
    return victims;
  },
  nearestEnemy(x: number, z: number, maxRange?: number): Enemy | null {
    let best: Enemy | null = null, bestD = (maxRange || 1e9) * (maxRange || 1e9);
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = (e.x - x) * (e.x - x) + (e.z - z) * (e.z - z);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  },

  onDeath(unit: Unit): void {
    const game = this.game!;
    if (unit.faction === 'enemy') {
      const ed = unit.def as EnemyDef;
      DIRECTOR.onKill(ed.gold, ed.boss === true);
      const [r, g, b] = FX.hexToRgb(ed.eye);
      ensureFx(`deathGlow:${ed.eye}`, {
        life: [0.3, 0.7], size0: [0.3, 0.7], size1: [0.05, 0.15], alpha: [0.5, 0.9],
        color: [r, g, b], drag: 2.2, turb: 0.8,
      }).burst(14, unit.x, 0.9 * (ed.scale || 1), unit.z, () => ({
        x: randSpread(2.6), y: rand(0.5, 3.0), z: randSpread(2.6),
      }));
      const [br, bg, bb] = FX.hexToRgb(ed.color);
      ensureFx(`deathBone:${ed.color}`, {
        life: [0.5, 1.1], size0: [0.10, 0.26], size1: [0.03, 0.08], alpha: [0.6, 1.0],
        color: [br, bg, bb], color2: [br * 0.3, bg * 0.3, bb * 0.3], drag: 1.6, turb: 0.6, gravity: 7,
      }).burst(12, unit.x, 0.8, unit.z, () => ({
        x: randSpread(3.4), y: rand(1.2, 4.2), z: randSpread(3.4),
      }));
      if (ed.boss) {
        game.cinematic.shake = Math.max(game.cinematic.shake, 0.9);
        ensureFx('bossSmoke', {
          life: [1.2, 2.2], size0: [0.8, 1.6], size1: [2.4, 4.2], alpha: [0.10, 0.2],
          color: [0.16, 0.14, 0.18], drag: 1.0, turb: 0.7,
        }).burst(20, unit.x, 1.2, unit.z, () => ({
          x: randSpread(2.4), y: rand(0.6, 2.2), z: randSpread(2.4),
        }));
      }
      /* 尸骸倒伏 */
      this.dying.push({ kind: 'unit', unit, t: 0, dur: 0.9 });
    } else {
      const ad = unit.def as AllyDef;
      const [r, g, b] = FX.hexToRgb(ad.trim);
      ensureFx(`allyDeath:${ad.trim}`, {
        life: [0.4, 0.9], size0: [0.2, 0.5], size1: [0.04, 0.1], alpha: [0.5, 0.9],
        color: [r, g, b], drag: 2.0, turb: 0.7,
      }).burst(12, unit.x, 1.0, unit.z, () => ({
        x: randSpread(2.2), y: rand(0.4, 2.4), z: randSpread(2.2),
      }));
      this.dying.push({ kind: 'unit', unit, t: 0, dur: 0.7 });
    }
  },

  update(dt: number): void {
    /* 逐实例异常隔离：单个单位故障只回收自身。
       交战伤害可能触发败北 → Units.clear() 在本循环内清空数组，必须做空守卫。 */
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (!e) continue;
      try {
        if (e.alive) e.update(dt);
      } catch (err) {
        console.error('[units] 敌人更新失败，回收: ' + (err instanceof Error && err.stack ? err.stack : String(err)));
        e.alive = false; e.dead = true;
      }
      if (!e.alive && !this.dying.some((d) => d.kind === 'unit' && d.unit === e)) {
        this.enemies.splice(i, 1);
        e.dispose();
      }
    }
    for (let i = this.allies.length - 1; i >= 0; i--) {
      const a = this.allies[i];
      if (!a) continue;
      try {
        if (a.alive) a.update(dt);
      } catch (err) {
        console.error('[units] 盟友更新失败，回收: ' + (err instanceof Error && err.stack ? err.stack : String(err)));
        a.alive = false; a.dead = true;
      }
      if (!a.alive && !this.dying.some((d) => d.kind === 'unit' && d.unit === a)) {
        this.allies.splice(i, 1);
        a.dispose();
      }
    }
    /* 敌群简单分离，避免叠成一条线 */
    const list = this.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const minD = 0.55 * ((a.def.scale || 1) + (b.def.scale || 1)) * 0.8;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD * minD && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (minD - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.rig.root.position.x -= nx * push * 0.5; a.rig.root.position.z -= nz * push * 0.5;
          b.rig.root.position.x += nx * push * 0.5; b.rig.root.position.z += nz * push * 0.5;
        }
      }
    }
    if (this.projectiles) this.projectiles.update(dt);

    /* 尸骸倒伏 / 召唤法环渐隐 */
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i];
      if (!d) continue;
      d.t += dt;
      const k = clamp(d.t / d.dur, 0, 1);
      if (d.kind === 'unit' && d.unit.rig) {
        d.unit.rig.root.rotation.x = lerp(0, Math.PI * 0.42, k);
        d.unit.rig.visual.position.y = -k * 0.4;
        d.unit.rig.root.position.y = -k * 1.2;
        if ('eyeMesh' in d.unit.rig) d.unit.rig.eyeMesh.visibility = 1 - k;
        if (d.unit.rig.bodyMesh) d.unit.rig.bodyMesh.visibility = 1 - k * 0.9;
      } else if (d.kind === 'ring') {
        const s = lerp(0.1, 2.2, 1 - Math.pow(1 - k, 3));
        d.mesh.scaling.set(s, s, 1);
        d.mesh._spriteMat!.setColor4('uColor', new C4(1, 1, 1, 0.8 * (1 - k)));
      }
      if (k >= 1) {
        if (d.kind === 'unit') d.unit.dispose();
        else { d.mesh.material!.dispose(); d.mesh.dispose(); }
        this.dying.splice(i, 1);
      }
    }
  },

  clear() {
    /* 置 alive=false 再 dispose：战斗中清场（败北/换层）时，外层迭代循环
       仍持有旧引用，空守卫依赖 alive 标记，不置位会在下一轮崩在已 dispose 的 rig 上 */
    for (const e of this.enemies) { e.alive = false; e.dispose(); }
    for (const a of this.allies) { a.alive = false; a.dispose(); }
    for (const d of this.dying) {
      if (d.kind === 'unit' && d.unit.rig) d.unit.dispose();
      else if (d.kind === 'ring' && d.mesh) { d.mesh.material!.dispose(); d.mesh.dispose(); }
    }
    this.enemies.length = 0;
    this.allies.length = 0;
    this.dying.length = 0;
    if (this.projectiles) this.projectiles.clear();
  },
};

// TODO(阶段2末)：全部模块转换后移除此全局桥（dev/main.js / ui.js / skills.js 读取 window）
if (typeof window !== 'undefined') {
  (window as unknown as { Units: typeof Units }).Units = Units;
}
// TODO(阶段2末)：全部模块转换后移除此全局桥（dev/skills.js 的 SpellCast 继承此类）
if (typeof window !== 'undefined') {
  (window as unknown as { ResourceOwner: typeof ResourceOwner }).ResourceOwner = ResourceOwner;
}
