/* ============================================================================
   skills.ts — 死灵防线 3D · 英雄法术系统 + 自动魔弹
   （自 dev/skills.js 移植为 ESM；原文已删，git 历史保留）
   契约与法术试验场一致：Cast 构造只做无副作用快照，init() 才分配场景资源；
   start() 对「构造+init」整体 try/catch，失败即 dispose 回滚；update 逐实例
   异常隔离。法术阶段 windup→release→travel→impact→aftermath 驱动 Mage 姿态
   与镜头（game.cinematic 只叠加不累积）。
   伤害数值 = CONFIG.SPELLS 基线 × DIRECTOR 升级乘数（奥术强化/奥能回涌）。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { FX, type FxSpriteMesh, type FxBlending } from './particles';
import { CONFIG, type SpellDef } from '../core/config';
import { DIRECTOR } from '../core/director';
import { Units, ResourceOwner, type Enemy } from './entities/units';
import type { Game } from './scene';

const V3 = BABYLON.Vector3;
const C3 = BABYLON.Color3;
const C4 = BABYLON.Color4;
const { clamp, lerp, rand, randSpread, easeOutCubic } = FX;

/* ------------------------------ 类型 ------------------------------ */
type FxEmitter = InstanceType<typeof FX.Emitter>;
/* emit 的初速度函数（FX.Emitter.burst/stream 的 velFn 允许省略形参） */
type VelFn = () => { x: number; y: number; z: number };

/* 法术阶段机（与 Mage.setSpellPose 的 SpellPhase 子集对齐） */
type CastPhase = 'windup' | 'release' | 'travel' | 'impact' | 'aftermath';

/* profile() 的返回：注册表基线 × 通用乘数 × 法术精通节点 */
export interface SpellProfile {
  id: number;
  name: string;
  color: string;
  range: number;
  radius: number;
  damage: number;
  windup: number;
  cooldown: number;
  flightSpeed: number;
  slow: { factor: number; duration: number } | null;
  chain: { count: number; damage: number; range: number } | null;
}

/* 落点预估的敌人最小视图（Units.Enemy 结构满足） */
interface SpellTargetEnemy {
  x: number;
  z: number;
  alive: boolean;
  def: { reach: number; speed: number };
  speedNow?(): number;
}

let uid = 0;
const nid = (name: string): string => name + '_' + (++uid);
const sat = (n: number): number => clamp(n, 0, 1);
const smooth = (n: number): number => { n = sat(n); return n * n * (3 - 2 * n); };
const PHASES: CastPhase[] = ['windup', 'release', 'travel', 'impact', 'aftermath'];
/* 阶段中文标签（本模块内暂无调用方；导出以保留实现并通过 noUnusedLocals） */
export const PHASE_LABEL = {
  windup: '聚能', release: '释放', travel: '飞行', impact: '爆发', aftermath: '余波',
};

const DEFS: SpellDef[] = CONFIG.SPELLS.map((s) => ({ ...s }));

/* 有效参数：注册表基线 × 通用乘数 × 法术精通节点 */
function profile(id: number): SpellProfile | null {
  const def = DEFS.find((d) => d.id === Number(id));
  if (!def) return null;
  const lv = (key: string): number => (DIRECTOR ? DIRECTOR.level(key) : 0);
  const dmgMul = DIRECTOR ? DIRECTOR.spellPowerMul() : 1;
  const cdMul = DIRECTOR ? DIRECTOR.cooldownMul() : 1;
  let damage = def.damage * dmgMul;
  let radius = def.radius;
  let slow = def.slow ? { factor: def.slow.factor, duration: def.slow.duration } : null;
  let chain = def.chain ? { count: def.chain.count, damage: def.chain.damage * dmgMul, range: def.chain.range } : null;
  if (def.id === 1) {
    damage *= 1 + 0.25 * lv('fireMastery');
    radius *= 1 + 0.12 * lv('fireMastery');
  } else if (def.id === 2) {
    damage *= 1 + 0.15 * lv('frostMastery');
    if (slow) {
      slow.factor = Math.max(0.15, slow.factor - 0.10 * lv('frostMastery'));
      slow.duration += 0.8 * lv('frostMastery');
    }
  } else if (def.id === 3) {
    damage *= 1 + 0.20 * lv('thunderMastery');
    if (chain) chain.count += lv('thunderMastery');
  }
  return {
    id: def.id, name: def.name, color: def.color,
    range: def.range, radius,
    damage,
    windup: def.windup,
    cooldown: Math.max(0.6, def.cooldown * cdMul),
    flightSpeed: def.flightSpeed, slow, chain,
  };
}
function texture(name: string, fallback?: string): BABYLON.DynamicTexture {
  return FX.textures[name] || FX.textures[fallback || 'ring'] || FX.textures.softDisc || FX.textures.glow;
}
function radialVel(speed: number, up?: number): VelFn {
  return () => {
    const a = rand(0, Math.PI * 2), v = rand(0.45, 1) * speed;
    return { x: Math.cos(a) * v, y: rand(-0.2, 0.7) * speed + (up || 0), z: Math.sin(a) * v };
  };
}

/* ------------------------------ 落点法阵 ------------------------------ */
class GroundRune {
  owner: SpellCast;
  root: BABYLON.TransformNode;
  rings: Array<{ mesh: FxSpriteMesh; spin: number; alpha: number }>;

  constructor(cast: SpellCast, center: BABYLON.Vector3) {
    this.owner = cast;
    this.root = cast.group('rune');
    this.root.position.copyFrom(center);
    this.rings = [];
    for (let i = 0; i < 2; i++) {
      const mesh = cast.sprite('runeLayer', i === 0 ? 'ring' : 'rune', this.root, true, 'normal');
      const r = 1 - i * 0.22;
      mesh.scaling.set(r * 2, r * 2, 1);
      mesh.position.y = 0.045 + i * 0.05;
      this.rings.push({ mesh, spin: (i % 2 ? -1 : 1) * (0.3 + i * 0.2), alpha: i ? 0.5 : 0.7 });
    }
  }
  update(time: number, radius: number, alpha: number): void {
    this.root.setEnabled(alpha > 0.002);
    this.root.scaling.set(radius, 1, radius);
    for (const r of this.rings) {
      r.mesh.rotation.z = time * r.spin;
      this.owner.spriteColor(r.mesh, alpha * r.alpha, 0.95);
    }
  }
}

/* ------------------------------ 冲击波环 ------------------------------ */
class Shockwave {
  mesh: FxSpriteMesh;
  radius: number;
  duration: number;
  t = 0;
  done = false;
  rgb: number[];
  y: number;

  constructor(cast: SpellCast, pos: { x: number; z: number }, radius: number, duration: number, y?: number) {
    this.mesh = cast.sprite('shock', 'ring', null, true, 'normal');
    this.radius = radius;
    this.duration = Math.max(0.1, duration);
    this.t = 0;
    this.done = false;
    this.rgb = cast.rgb.slice();
    this.y = y === undefined ? 0.09 : y;
    this.mesh.position.set(pos.x, this.y, pos.z);
    this.mesh.scaling.set(0.01, 0.01, 1);
  }
  update(dt: number): void {
    this.t += dt;
    const u = sat(this.t / this.duration);
    const diameter = 2 * this.radius * (0.12 + 0.88 * easeOutCubic(u));
    this.mesh.scaling.set(diameter, diameter, 1);
    this.mesh._spriteMat!.setColor4('uColor', new C4(
      this.rgb[0] * 1.15, this.rgb[1] * 1.15, this.rgb[2] * 1.15, 0.85 * Math.pow(1 - u, 1.4)));
    this.done = u >= 1;
  }
}

/* ------------------------------ 法术基类 ------------------------------ */
export class SpellCast extends ResourceOwner {
  game: Game;
  def: SpellDef;
  p: SpellProfile;
  phase: CastPhase;
  phaseT = 0;
  total = 0;
  finished = false;
  kick = 0;
  startGround: BABYLON.Vector3;
  dir: BABYLON.Vector3;
  target: BABYLON.Vector3;
  rgb: [number, number, number];
  /* —— 以下由 init()/buildSpell() 分配（构造保持无副作用快照） —— */
  core!: BABYLON.StandardMaterial;
  edge!: BABYLON.StandardMaterial;
  rune!: GroundRune;
  orb!: FxSpriteMesh;
  halo!: FxSpriteMesh;
  main!: FxEmitter;
  detail!: FxEmitter;
  smoke!: FxEmitter;
  shocks: Shockwave[] = [];
  haloBack: FxSpriteMesh | null = null;
  haloCore: FxSpriteMesh | null = null;
  origin!: BABYLON.Vector3;
  flightTime!: number;
  impactDur!: number;
  aftermathDur!: number;
  /* 子类阶段钩子（原型方法覆写，基类空实现 = 原 JS 的 if (this.onX) 守卫） */
  onRelease(): void { }
  onImpact(): void { }
  onAftermath(): void { }

  constructor(game: Game, def: SpellDef, aim: { x: number; z: number }, p: SpellProfile) {
    super(game.scene);
    this.game = game;
    this.def = def; this.p = p;
    this.phase = 'windup'; this.phaseT = 0; this.total = 0;
    this.finished = false;
    this.kick = 0;
    const mp = game.mage.root.position;
    this.startGround = new V3(mp.x, 0, mp.z);
    this.dir = new V3(aim.x - mp.x, 0, aim.z - mp.z);
    if (this.dir.length() < 0.05) this.dir.set(0, 0, 1);
    const dist = Math.min(p.range, Math.max(1, this.dir.length()));
    this.dir.normalize();
    this.target = this.startGround.add(this.dir.scale(dist));
    this.rgb = FX.hexToRgb(p.color);
    game.mage.faceTo(this.dir.x, this.dir.z);
  }
  init(): void {
    this.core = this.mat('luminousCore', 1.5, 1);
    this.edge = this.mat('haloEdge', 1.0, 0.8);
    this.rune = new GroundRune(this, this.target);
    this.orb = this.sprite('handCharge', 'star');
    this.orb.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.orb.scaling.set(0.01, 0.01, 1);
    this.main = this.emitter('glow', {
      life: [0.35, 0.85], size0: [0.18, 0.46], size1: [0.04, 0.13], alpha: [0.35, 0.70],
      drag: 1.7, turb: 1.0, jitter: 0.24, color: this.rgb.map((c) => c * 1.05),
    });
    this.detail = this.emitter('spark', {
      life: [0.24, 0.68], size0: [0.07, 0.15], size1: [0.012, 0.04], alpha: [0.55, 0.90],
      drag: 1.8, turb: 0.6, gravity: 2.0, color: this.rgb.map((c) => c * 1.3),
    });
    this.smoke = this.emitter('smoke', {
      life: [0.8, 1.65], size0: [0.5, 0.9], size1: [1.8, 3.2], alpha: [0.13, 0.24],
      color: [0.10, 0.11, 0.15], color2: [0.04, 0.05, 0.08], drag: 1.0, turb: 0.65,
    });
    this.shocks = [];
    this.buildSpell();
  }
  buildSpell(): void { }
  sprite(name: string, tex: string, parent?: BABYLON.Node | null, ground?: boolean, blending?: FxBlending): FxSpriteMesh {
    const mesh = FX.makeSprite(this.scene, nid(name), texture(tex), blending || 'add', new C4(1, 1, 1, 0)) as FxSpriteMesh & { _cast?: SpellCast };
    if (ground) mesh.rotation.x = Math.PI / 2;
    this.own(mesh, parent ?? undefined);
    mesh._cast = this;
    return mesh;
  }
  spriteColor(mesh: FxSpriteMesh, alpha: number, k?: number): void {
    const kk = k === undefined ? 1 : k;
    mesh._spriteMat!.setColor4('uColor', new C4(this.rgb[0] * kk, this.rgb[1] * kk, this.rgb[2] * kk, sat(alpha)));
  }
  /* 亮背景光晕结构：饱和色衬底(normal 混合，"盖"在背景上) + 白热核心(add)。
     纯加色光晕在明亮草地上会被背景吃掉，分层后对比度回来了。 */
  haloSprite(name: string, tex: string, coreScale?: number | [number, number]): FxSpriteMesh {
    const back = this.sprite(name + 'Back', tex, null, false, 'normal');
    const core = this.sprite(name + 'Core', tex, back, false, 'add');
    const s = Array.isArray(coreScale) ? coreScale : [coreScale || 0.52, coreScale || 0.52];
    core.scaling.set(s[0], s[1], 1);
    core.position.z = 0.02;
    core._spriteMat!.setColor4('uColor', new C4(
      0.55 + this.rgb[0] * 0.85, 0.55 + this.rgb[1] * 0.85, 0.5 + this.rgb[2] * 0.85, 0.95));
    this.haloBack = back;
    this.haloCore = core;
    return back;
  }
  setHaloVisible(v: boolean): void {
    if (this.haloBack) this.haloBack.isVisible = v;
    if (this.haloCore) this.haloCore.isVisible = v;
  }
  mat(name: string, glow: number, alpha?: number): BABYLON.StandardMaterial {
    const mat = new BABYLON.StandardMaterial(nid(name), this.scene);
    mat.diffuseColor = new C3(0, 0, 0);
    mat.emissiveColor = new C3(this.rgb[0] * glow, this.rgb[1] * glow, this.rgb[2] * glow);
    mat.specularColor = new C3(0, 0, 0);
    mat.disableLighting = true;
    mat.backFaceCulling = false;
    mat.alpha = alpha === undefined ? 1 : alpha;
    if (mat.alpha < 1) { mat.alphaMode = BABYLON.Constants.ALPHA_COMBINE; mat.disableDepthWrite = true; }
    this.materials.add(mat);
    return mat;
  }
  emit(e: FxEmitter | null, amount: number, pos: { x: number; y: number; z: number }, vel: VelFn, burst?: boolean): void {
    if (!e || this.disposed) return;
    const n = Math.min(burst ? 64 : 28, Math.max(0, amount));
    if (n <= 0) return;
    if (burst) e.burst(Math.floor(n), pos.x, pos.y, pos.z, vel);
    else e.stream(n, pos.x, pos.y, pos.z, vel);
  }
  addShock(radius: number, duration: number, y?: number): void {
    this.shocks.push(new Shockwave(this, this.target, radius, duration, y));
  }
  phaseProgress(): number {
    const dur = this.phase === 'windup' ? this.p.windup : this.phase === 'release' ? 0.16 :
      this.phase === 'travel' ? this.flightTime : this.phase === 'impact' ? this.impactDur : this.aftermathDur;
    return sat(this.phaseT / Math.max(0.01, dur));
  }
  update(dt: number): void {
    if (this.finished || this.disposed) return;
    this.total += dt; this.phaseT += dt;
    this.kick *= Math.exp(-dt * 6.5);
    const done = this[this.phase](dt);
    this.updateCommon(dt);
    for (let i = this.shocks.length - 1; i >= 0; i--) {
      const s = this.shocks[i];
      s.update(dt);
      if (s.done) { s.mesh.dispose(); this.shocks.splice(i, 1); }
    }
    if (done) this.advance();
  }
  updateCommon(dt: number): void {
    const windup = this.phase === 'windup';
    const k = windup ? smooth(this.phaseT / this.p.windup) : 1;
    const tail = this.phase === 'aftermath' ? 1 - this.phaseProgress() : 1;
    this.rune.update(this.total, this.p.radius, (windup ? 0.15 + k * 0.5 : 0.42) * tail);
    if (windup) {
      const hand = this.game.mage.worldHand ? this.game.mage.worldHand() : this.origin;
      this.orb.position.copyFrom(hand);
      const s = (0.28 + 0.7 * k);
      this.orb.scaling.set(s, s, 1);
      this.orb.rotation.z = this.total * 2.8;
      this.spriteColor(this.orb, 0.30 + 0.35 * k, 1.1);
      this.emit(this.main, dt * (9 + 11 * k), hand, () => ({ x: randSpread(0.4), y: rand(0.15, 0.8), z: randSpread(0.4) }));
    } else {
      this.spriteColor(this.orb, this.phase === 'release' ? 0.5 * (1 - this.phaseProgress()) : 0, 1.2);
    }
  }
  windup(_dt: number): boolean {
    return this.phaseT >= this.p.windup;
  }
  release(_dt: number): boolean { return this.phaseT >= 0.16; }
  travel(_dt: number): boolean { return this.phaseT >= this.flightTime; }
  impact(_dt: number): boolean { return this.phaseT >= this.impactDur; }
  aftermath(_dt: number): boolean { return this.phaseT >= this.aftermathDur; }
  advance(): void {
    const next = PHASES.indexOf(this.phase) + 1;
    if (next >= PHASES.length) { this.finished = true; return; }
    this.phase = PHASES[next];
    this.phaseT = 0;
    if (this.phase === 'release') {
      const hand = this.game.mage.worldHand ? this.game.mage.worldHand() : this.target;
      this.origin = hand.clone();
      this.emit(this.detail, 10, hand, radialVel(2.4, 0.8), true);
      this.onRelease();
    }
    if (this.phase === 'impact') {
      this.kick = 0.12;
      this.game.cinematic.shake = Math.max(this.game.cinematic.shake, this.def.id === 3 ? 0.55 : 0.32);
      this.game.cinematic.focus = this.target;
      this.addShock(this.p.radius, 0.5);
      this.emit(this.main, 14, this.target, radialVel(3.4, 2), true);
      this.emit(this.detail, 20, this.target, radialVel(5, 3), true);
      this.onImpact();
    }
    if (this.phase === 'aftermath') this.onAftermath();
  }
  /* 姿态由管理器统一写入（poseOwner），Cast 不直接操作 Mage */
}

/* ------------------------------ 火球术 ------------------------------ */
export class FireballCast extends SpellCast {
  ball!: BABYLON.Mesh;
  arcH!: number;
  _from!: BABYLON.Vector3;
  scar: FxSpriteMesh | null = null;
  scarDark: FxSpriteMesh | null = null;

  buildSpell(): void {
    this.impactDur = 0.3;
    this.aftermathDur = 1.1;
    const mp = this.game.mage.root.position;
    const dist = Math.hypot(this.target.x - mp.x, this.target.z - mp.z);
    this.flightTime = Math.max(0.22, dist / Math.max(6, this.p.flightSpeed));
    this.arcH = 0.22 * dist + 1.2;
    this.ball = this.mesh('Sphere', { diameter: 0.55, segments: 10 }, this.core);
    this.ball.isVisible = false;
    this.halo = this.haloSprite('fireHalo', 'softDisc');
    this.halo.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.halo.scaling.set(1.6, 1.6, 1);
    this.setHaloVisible(false);
    this._from = new V3();
  }
  onRelease(): void {
    this.ball.isVisible = true;
    this.setHaloVisible(true);
    if (this.game.mage.worldHand) this.game.mage.worldHand(this._from);
    else this._from.copyFrom(this.origin);
    this._from.y = Math.max(1.2, this._from.y);
  }
  travel(dt: number): boolean {
    const u = sat(this.phaseT / this.flightTime);
    const x = lerp(this._from.x, this.target.x, u);
    const z = lerp(this._from.z, this.target.z, u);
    const y = lerp(this._from.y, 0.35, u) + this.arcH * 4 * u * (1 - u);
    this.ball.position.set(x, y, z);
    this.halo.position.copyFrom(this.ball.position);
    const s = 0.85 + Math.sin(this.total * 31) * 0.12;
    this.ball.scaling.setAll(s);
    this.spriteColor(this.halo, 0.8, 1.2);
    this.emit(this.main, dt * 42, this.ball.position, () => ({ x: randSpread(0.8), y: rand(0.1, 0.6), z: randSpread(0.8) }));
    this.emit(this.detail, dt * 16, this.ball.position, radialVel(1.2, 0.4));
    return u >= 1;
  }
  onImpact(): void {
    this.ball.isVisible = false;
    this.setHaloVisible(false);
    this.emit(this.main, 26, this.target, radialVel(4.5, 2.6), true);
    this.emit(this.detail, 34, this.target, radialVel(7, 4), true);
    this.emit(this.smoke, 26, this.target, radialVel(2.2, 1.2), true);
    Units.applyAoE(this.target.x, this.target.z, this.p.radius, this.p.damage);
    /* 焦痕余波：暗衬底让亮粒子在亮草地上也读得清 */
    this.scarDark = this.sprite('scarDark', 'softDisc', null, true, 'normal');
    this.scarDark.position.set(this.target.x, 0.04, this.target.z);
    this.scarDark.scaling.set(this.p.radius * 2.3, this.p.radius * 2.3, 1);
    this.scarDark._spriteMat!.setColor4('uColor', new C4(0.012, 0.014, 0.016, 0.72));
    this.scar = this.sprite('scarFire', 'fracture', null, true, 'normal');
    this.scar.position.set(this.target.x, 0.06, this.target.z);
    this.scar.scaling.set(this.p.radius * 1.5, this.p.radius * 1.5, 1);
  }
  aftermath(dt: number): boolean {
    const k = this.phaseProgress();
    if (this.scar) this.spriteColor(this.scar, (1 - k) * 0.5, 0.9);
    this.emit(this.smoke, dt * 14 * (1 - k), this.target, () => ({ x: randSpread(0.5), y: rand(0.5, 1.4), z: randSpread(0.5) }));
    return k >= 1;
  }
}

/* ------------------------------ 霜爆术 ------------------------------ */
export class FrostCast extends SpellCast {
  shard!: BABYLON.Mesh;
  spikes!: Array<{ mesh: BABYLON.Mesh; baseY: number; topY: number }>;
  _from!: BABYLON.Vector3;
  iceDisc!: FxSpriteMesh;

  buildSpell(): void {
    this.impactDur = 0.34;
    this.aftermathDur = 1.3;
    const mp = this.game.mage.root.position;
    const dist = Math.hypot(this.target.x - mp.x, this.target.z - mp.z);
    this.flightTime = Math.max(0.16, dist / Math.max(6, this.p.flightSpeed));
    this.shard = this.mesh('Cylinder', { height: 1.1, diameterTop: 0, diameterBottom: 0.34, tessellation: 5 }, this.core);
    this.shard.isVisible = false;
    this.halo = this.haloSprite('frostHalo', 'softDisc');
    this.halo.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.halo.scaling.set(1.2, 1.2, 1);
    this.setHaloVisible(false);
    /* 落点冰锥环：爆发时升起 */
    this.spikes = [];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = this.p.radius * (0.5 + (i % 2) * 0.28);
      const h = this.p.radius * (0.42 + (i % 3) * 0.14);
      const cone = this.mesh('Cylinder', { height: h, diameterTop: 0, diameterBottom: 0.26, tessellation: 5 }, this.edge);
      cone.position.set(this.target.x + Math.cos(a) * r, -h * 0.5, this.target.z + Math.sin(a) * r);
      cone.rotation.z = Math.cos(a) * -0.22;
      cone.rotation.x = Math.sin(a) * -0.22;
      cone.isVisible = false;
      this.spikes.push({ mesh: cone, baseY: -h * 0.5, topY: h * 0.42 });
    }
    this._from = new V3();
  }
  onRelease(): void {
    this.shard.isVisible = true;
    this.setHaloVisible(true);
    if (this.game.mage.worldHand) this.game.mage.worldHand(this._from);
    else this._from.copyFrom(this.origin);
    this._from.y = Math.max(1.3, this._from.y);
    const dx = this.target.x - this._from.x, dy = 0.6 - this._from.y, dz = this.target.z - this._from.z;
    this.shard.rotation.x = Math.PI / 2 - Math.atan2(dy, Math.hypot(dx, dz));
    this.shard.rotation.y = Math.atan2(dx, dz);
  }
  travel(dt: number): boolean {
    const u = sat(this.phaseT / this.flightTime);
    const x = lerp(this._from.x, this.target.x, u);
    const z = lerp(this._from.z, this.target.z, u);
    const y = lerp(this._from.y, 0.6, u);
    this.shard.position.set(x, y, z);
    this.halo.position.copyFrom(this.shard.position);
    this.spriteColor(this.halo, 0.7, 1.1);
    this.emit(this.main, dt * 30, this.shard.position, radialVel(0.8, 0.2));
    return u >= 1;
  }
  onImpact(): void {
    this.shard.isVisible = false;
    this.setHaloVisible(false);
    for (const s of this.spikes) s.mesh.isVisible = true;
    this.emit(this.main, 22, this.target, radialVel(3.6, 1.8), true);
    this.emit(this.detail, 26, this.target, radialVel(6, 2.4), true);
    this.emit(this.smoke, 12, this.target, radialVel(2.0, 1.0), true);
    Units.applyAoE(this.target.x, this.target.z, this.p.radius, this.p.damage, { slow: this.p.slow ?? undefined });
    this.iceDisc = this.sprite('iceDisc', 'softDisc', null, true, 'normal');
    this.iceDisc.position.set(this.target.x, 0.05, this.target.z);
    this.iceDisc.scaling.set(this.p.radius * 2, this.p.radius * 2, 1);
  }
  impact(dt: number): boolean {
    const k = this.phaseProgress();
    for (const s of this.spikes) {
      s.mesh.position.y = lerp(s.baseY, s.topY, easeOutCubic(sat(k * 1.25)));
      this.emit(this.detail, dt * 4, s.mesh.position, radialVel(0.6, 0.4));
    }
    this.spriteColor(this.iceDisc, 0.5 * (1 - k * 0.4), 0.9);
    return k >= 1;
  }
  aftermath(_dt: number): boolean {
    const k = this.phaseProgress();
    for (const s of this.spikes) s.mesh.position.y = lerp(s.topY, s.topY - 0.9, k);
    this.spriteColor(this.iceDisc, 0.5 * (1 - k), 0.9);
    return k >= 1;
  }
}

/* ------------------------------ 雷霆之矛 ------------------------------ */
export class ThunderCast extends SpellCast {
  skyMark!: FxSpriteMesh;
  spear!: BABYLON.Mesh;
  boltGlow!: FxSpriteMesh;
  chainQueue!: Array<{ from: BABYLON.Vector3; to: Enemy; delay: number }>;
  chainArcs!: Array<{ mesh: BABYLON.Mesh; t: number }>;
  flash: FxSpriteMesh | null = null;

  buildSpell(): void {
    this.impactDur = 0.3;
    this.aftermathDur = 1.0;
    this.flightTime = 0.001;
    /* 天空锚点 */
    this.skyMark = this.sprite('skyMark', 'star', null);
    this.skyMark.position.set(this.target.x, 15, this.target.z);
    this.skyMark.scaling.set(3.4, 3.4, 1);
    /* 主雷矛：粗管 + 光晕 */
    this.spear = this.mesh('Cylinder', { height: 13.5, diameter: 0.30, tessellation: 6 }, this.core);
    this.spear.position.set(this.target.x, 7.2, this.target.z);
    this.spear.isVisible = false;
    this.boltGlow = this.haloSprite('boltGlow', 'softDisc', [0.42, 0.9]);
    this.boltGlow.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.boltGlow.scaling.set(2.2, 6, 1);
    this.setHaloVisible(false);
    this.chainQueue = [];
    this.chainArcs = [];
  }
  windup(dt: number): boolean {
    const k = this.phaseProgress();
    this.spriteColor(this.skyMark, 0.3 + 0.5 * k * (0.6 + 0.4 * Math.sin(this.total * 34)), 1.2);
    this.skyMark.rotation.z = this.total * 1.8;
    this.emit(this.detail, dt * 8, this.skyMark.position, radialVel(1.4, -1.2));
    return this.phaseT >= this.p.windup;
  }
  onRelease(): void {
    this.spear.position.y = 21;
    this.spear.isVisible = true;
    this.setHaloVisible(true);
    this.boltGlow.position.set(this.target.x, 4.5, this.target.z);
    this.game.cinematic.shake = Math.max(this.game.cinematic.shake, 0.4);
  }
  travel(dt: number): boolean {
    this.spear.position.y -= dt * 90;
    this.boltGlow.position.y = Math.max(3, (this.spear.position.y - 6.7) * 0.62);
    this.emit(this.detail, dt * 40, {
      x: this.target.x, y: Math.max(0.5, this.spear.position.y - 6.7), z: this.target.z,
    }, radialVel(2.4, 1.2));
    return this.spear.position.y - 6.7 <= 1.2;
  }
  onImpact(): void {
    this.spear.isVisible = false;
    this.skyMark.isVisible = false;
    this.setHaloVisible(false);
    this.emit(this.main, 24, this.target, radialVel(5, 2.2), true);
    this.emit(this.detail, 30, this.target, radialVel(8, 4), true);
    this.emit(this.smoke, 14, this.target, radialVel(2.4, 1.4), true);
    const victims = Units.applyAoE(this.target.x, this.target.z, this.p.radius, this.p.damage);
    /* 链式跳弧：延迟依次劈向最近的未命中亡灵 */
    let src = this.target;
    for (let i = 0; i < (this.p.chain ? this.p.chain.count : 0); i++) {
      let best: Enemy | null = null, bestD = this.p.chain ? this.p.chain.range : 0;
      for (const e of Units.enemies) {
        if (!e.alive || victims.includes(e)) continue;
        const d = Math.hypot(e.x - src.x, e.z - src.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (!best) break;
      victims.push(best);
      this.chainQueue.push({ from: src.clone(), to: best, delay: 0.09 * (i + 1) });
      src = new V3(best.x, 0, best.z);
    }
    this.flash = this.sprite('thunderFlash', 'softDisc', null, true);
    this.flash.position.set(this.target.x, 0.1, this.target.z);
    this.flash.scaling.set(this.p.radius * 2.4, this.p.radius * 2.4, 1);
  }
  _makeArc(from: { x: number; y?: number; z: number }, to: Enemy): void {
    const path = [];
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      path.push(new V3(
        lerp(from.x, to.x, t) + randSpread(0.5),
        lerp(from.y === undefined ? 1.1 : from.y, to.rig ? to.rig.height * 0.6 : 1.0, t) + randSpread(0.4) + Math.sin(t * Math.PI) * 0.8,
        lerp(from.z, to.z, t) + randSpread(0.5)));
    }
    const arc = this.mesh('Tube', { path, radius: 0.09, tessellation: 5, cap: BABYLON.Mesh.NO_CAP }, this.core);
    this.chainArcs.push({ mesh: arc, t: 0 });
  }
  impact(dt: number): boolean {
    const k = this.phaseProgress();
    if (this.flash) this.spriteColor(this.flash, (1 - k) * 0.55, 1.5);
    for (let i = this.chainQueue.length - 1; i >= 0; i--) {
      const q = this.chainQueue[i];
      q.delay -= dt;
      if (q.delay <= 0) {
        this._makeArc(q.from, q.to);
        if (q.to.alive) q.to.takeDamage(this.p.chain ? this.p.chain.damage : 0);
        this.emit(this.detail, 10, new V3(q.to.x, 1.0, q.to.z), radialVel(4, 2), true);
        this.chainQueue.splice(i, 1);
      }
    }
    return k >= 1;
  }
  aftermath(dt: number): boolean {
    const k = this.phaseProgress();
    for (let i = this.chainArcs.length - 1; i >= 0; i--) {
      const a = this.chainArcs[i];
      a.t += dt;
      a.mesh.visibility = Math.max(0, 1 - a.t / 0.4);
      if (a.mesh.visibility <= 0) { a.mesh.dispose(); this.chainArcs.splice(i, 1); }
    }
    if (this.flash) this.spriteColor(this.flash, (1 - k) * 0.2, 1.5);
    return k >= 1;
  }
}

/* 构造签名统一的 Cast 类注册表（start 按法术 id 实例化） */
type CastCtor = new (game: Game, def: SpellDef, aim: { x: number; z: number }, p: SpellProfile) => SpellCast;
export const CAST_CLASSES: Record<number, CastCtor> = { 1: FireballCast, 2: FrostCast, 3: ThunderCast };

/* ------------------------------ 法术管理器 ------------------------------ */
export const SPELLS = {
  defs: DEFS,
  casts: [] as SpellCast[],
  cooldowns: {} as Record<string, number>,
  cooldownTotals: {} as Record<string, number>,
  budget: { casts: 3, particlesPerFrame: 520 },
  lastRejectReason: null as string | null,
  _autoTimer: 0.4,
  /* 以下私有状态原 JS 以 undefined 起步，这里显式声明同一初值（行为等价） */
  _autoCastT: undefined as number | undefined,
  _autoMuzzle: null as { x: number; y: number; z: number; t: number } | null,
  _muzzleEmitter: null as FxEmitter | null,
  profile,

  isReady(id: number): boolean { return (this.cooldowns[id] || 0) <= 0; },
  cdRemaining(id: number): number { return this.cooldowns[id] || 0; },
  cdFraction(id: number): number {
    const total = this.cooldownTotals[id] || 1;
    return sat((this.cooldowns[id] || 0) / total);
  },
  poseOwner(): SpellCast | null { return this.casts.length ? this.casts[this.casts.length - 1] : null; },

  start(game: Game, id: number, aim: { x: number; z: number }): boolean {
    const def = DEFS.find((d) => d.id === Number(id));
    if (!def) return this._reject('unknown');
    if (!DIRECTOR.inRun()) return this._reject('battle');
    /* DIRECTOR.ownsSpell 形参为 string；其内部 CONFIG.spellOf 会 Number() 归一，传数字等价 */
    if (!DIRECTOR.ownsSpell(String(id))) return this._reject('locked');
    if (!this.isReady(id)) return this._reject('cooldown');
    if (this.casts.length >= this.budget.casts) return this._reject('cast-limit');
    const p = profile(id);
    let cast: SpellCast | null = null;
    try {
      cast = new CAST_CLASSES[id](game, def, aim, p!);
      this.casts.push(cast);
      cast.init();
    } catch (error: any) {
      if (cast) {
        const at = this.casts.indexOf(cast);
        if (at >= 0) this.casts.splice(at, 1);
        cast.dispose();
      }
      console.error('[spells] ' + def.name + ' 创建失败，已回收: ' + (error && error.stack ? error.stack : error));
      return this._reject('error');
    }
    this.cooldowns[id] = this.cooldownTotals[id] = p!.cooldown;
    this.lastRejectReason = null;
    return true;
  },
  _reject(reason: string): boolean { this.lastRejectReason = reason; return false; },

  /* 自动魔弹需在营地研习后才会加入战斗。 */
  updateAuto(game: Game, dt: number): void {
    if (!DIRECTOR || DIRECTOR.state !== 'battle' || !DIRECTOR.ownsBolt()) return;
    const auto = CONFIG.HERO.autoBolt;
    this._autoTimer -= dt;
    if (this._autoTimer > 0) return;
    const mp = game.mage.root.position;
    const target = Units.nearestEnemy(mp.x, mp.z, auto.range);
    if (!target) { this._autoTimer = 0.12; return; }
    this._autoTimer = auto.interval;
    game.mage.gem.computeWorldMatrix(true);
    const from = game.mage.gem.getAbsolutePosition();
    Units.spawnProjectile({
      fromX: from.x, fromY: from.y, fromZ: from.z,
      target, speed: auto.speed, damage: auto.damage * DIRECTOR.spellPowerMul(),
      colorHex: auto.color, kind: 'bolt', faction: 'hero', size: 0.85,
      bounces: DIRECTOR.level('resounding'),
    });
    game.mage.faceTo(target.x - mp.x, target.z - mp.z);
    this._autoMuzzle = { x: from.x, y: from.y, z: from.z, t: FX.time };
  },

  /* 自动施法术式：燎原/凛冬/雷狱天赋点亮后，冷却完毕自动投向最密集敌群。
     目标评分 = 半径内邻居数 + 靠近防线权重；0.25s 节流，O(n²) 只在就绪时发生。 */
  updateAutoCasts(game: Game, dt: number): void {
    if (!DIRECTOR || DIRECTOR.state !== 'battle' || DIRECTOR.completedDelves === 0) return;
    this._autoCastT = (this._autoCastT || 0) - dt;
    if (this._autoCastT > 0) return;
    this._autoCastT = 0.25;
    const AUTO_KEY: Record<number, string> = { 1: 'autoFire', 2: 'autoFrost', 3: 'autoThunder' };
    const mp = game.mage.root.position;
    for (const id of [1, 2, 3]) {
      if (!DIRECTOR.ownsSpell(String(id)) || DIRECTOR.level(AUTO_KEY[id]) <= 0) continue;
      if (!this.isReady(id)) continue;
      if (this.casts.length >= this.budget.casts) continue;
      const p = profile(id)!;
      const point = this.autoTargetPoint(p.radius, id);
      if (!point) continue;
      if (Math.hypot(point.x - mp.x, point.z - mp.z) > p.range) continue;
      this.start(game, id, point);
    }
  },
  targetPoint(enemy: SpellTargetEnemy | null, id: number): { x: number; z: number } | null {
    const p = profile(id);
    if (!p || !enemy || !enemy.alive) return null;
    const hero = { x: CONFIG.HERO.position[0], z: CONFIG.FIELD.heroZ };
    let toward: SpellTargetEnemy | { x: number; z: number } = hero, near = 4.2;
    for (const ally of Units.allies) {
      if (!ally.alive) continue;
      const d = Math.hypot(ally.x - enemy.x, ally.z - enemy.z);
      if (d < near) { near = d; toward = ally; }
    }
    const dx = toward.x - enemy.x, dz = toward.z - enemy.z;
    const remaining = Math.hypot(dx, dz);
    const reach = enemy.def.reach + (toward === hero ? 0.3 : 0);
    const speed = enemy.speedNow ? enemy.speedNow() : enemy.def.speed;
    const range = Math.hypot(enemy.x - hero.x, enemy.z - hero.z);
    const flight = p.flightSpeed > 0 ? range / (p.flightSpeed + speed) : 0;
    const travel = Math.min(Math.max(0, remaining - reach), speed * (p.windup + 0.16 + flight));
    if (toward === hero && enemy.z > hero.z + 14) return { x: enemy.x, z: enemy.z - travel };
    const k = remaining > 0 ? travel / remaining : 0;
    return { x: enemy.x + dx * k, z: enemy.z + dz * k };
  },
  autoTargetPoint(radius: number, id: number): { x: number; z: number } | null {
    const p = profile(id || 1);
    if (!p) return null;
    let best: Enemy | null = null, bestScore = 0;
    for (const e of Units.enemies) {
      if (!e.alive) continue;
      if (Math.hypot(e.x - CONFIG.HERO.position[0], e.z - CONFIG.FIELD.heroZ) > p.range) continue;
      let score = 1 + (CONFIG.FIELD.heroZ + 46 - e.z) * 0.04; /* 越靠近防线越优先 */
      for (const o of Units.enemies) {
        if (o === e || !o.alive) continue;
        if (Math.hypot(o.x - e.x, o.z - e.z) <= radius) score += 1;
      }
      if (score > bestScore) { bestScore = score; best = e; }
    }
    return best ? this.targetPoint(best, id || 1) : null;
  },
  autoMuzzleFlash(_game: Game): void {
    const m = this._autoMuzzle;
    if (!m || FX.time - m.t > 0.08) return;
    const [r, g, b] = FX.hexToRgb(CONFIG.HERO.autoBolt.color);
    if (!this._muzzleEmitter) {
      this._muzzleEmitter = new FX.Emitter(FX.layers.spark, {
        life: [0.1, 0.22], size0: [0.05, 0.11], size1: [0.01, 0.02], alpha: [0.5, 0.85],
        color: [r, g, b], drag: 3, turb: 0.3,
      });
    }
    this._muzzleEmitter.burst(4, m.x, m.y, m.z, radialVel(1.6, 0.2));
  },

  update(game: Game, dt: number): void {
    for (const id in this.cooldowns) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
    this.updateAuto(game, dt);
    this.updateAutoCasts(game, dt);
    this.autoMuzzleFlash(game);
    for (let i = this.casts.length - 1; i >= 0; i--) {
      const c = this.casts[i];
      try { c.update(dt); }
      catch (error: any) {
        console.error('[spells] ' + ((c.def && c.def.name) || c.constructor.name) + ' 更新失败，中止该法术: ' + (error && error.stack ? error.stack : error));
        try { c.dispose(); } catch (e: any) { console.error('[spells] 法术清理再次失败: ' + e); }
        c.disposed = true;
      }
      if (c.finished || c.disposed) {
        try { c.dispose(); } catch (e: any) { console.error('[spells] 法术清理失败: ' + e); }
        this.casts.splice(i, 1);
      }
    }
    /* 姿态驱动：最后一次施法持有姿态 */
    const owner = this.poseOwner();
    if (owner && game) {
      const k = owner.phaseProgress();
      game.mage.setSpellPose(owner.phase, k, 3, owner.p.color, owner.def.id);
      game.mage.setCast(owner.phase === 'windup' ? smooth(k) : Math.max(0, game.mage.castAmount - dt * 2));
    } else if (game) {
      game.mage.setSpellPose('idle', 0, 3);
      game.mage.setCast(0);
    }
  },

  abortAll(): void {
    for (const c of this.casts) c.dispose();
    this.casts.length = 0;
    for (const k in this.cooldowns) this.cooldowns[k] = 0;
    FX.clear();
  },
  reset(): void {
    this.abortAll();
    this._autoTimer = 0.4;
    this._autoCastT = 0;
    this._autoMuzzle = null;
    this.lastRejectReason = null;
  },
};

// TODO(阶段2末)：全部模块转换后移除此全局桥
(window as unknown as { SPELLS: typeof SPELLS }).SPELLS = SPELLS;
