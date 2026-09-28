/* ============================================================================
   projectiles.ts — 共享池化的追踪弹（英雄魔弹 / 猎手箭矢）
   自 dev/entities.js 拆出为 ESM；数值与行为保持与原文一致。
   与 units 的环：Units.enemies（回响碎片跳弹索敌）只在 update() 运行期读取，
   模块初始化期不触碰 Units —— ESM 活绑定下安全，允许循环 import。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { FX, type FxSpriteMesh } from '../particles';
import { nid } from './rigs';
import { hitSpark } from './effects';
import { Units, type Unit } from './units';
import type { Game } from '../scene';

const V3 = BABYLON.Vector3;
const C3 = BABYLON.Color3;
const C4 = BABYLON.Color4;

type FxEmitter = InstanceType<typeof FX.Emitter>;

const PROJECTILE_CAP = 96; // TODO(阶段3)：进 config

/* 发射参数（Units.spawnProjectile 透传，技能系统经 window 桥共用） */
export interface ProjectileSpawnOpts {
  fromX: number; fromY: number; fromZ: number;
  target: Unit;
  speed: number;
  damage: number;
  colorHex: string;
  kind: 'arrow' | 'bolt';
  faction?: string;
  size?: number;
  bounces?: number;
}

/* 池化弹体：mesh 按.kind/colorHex 复用，切换时重建 */
export interface Projectile {
  active: boolean;
  kind: 'arrow' | 'bolt' | null;
  mesh: BABYLON.Mesh | null;
  ownMaterial: boolean;
  target: Unit | null;
  speed: number;
  damage: number;
  colorHex: string;
  faction: string;
  lastPos: BABYLON.Vector3;
  size: number;
  bounces: number;
}

/* ------------------------------ 追踪弹池 ------------------------------ */
export class ProjectilePool {
  game: Game;
  scene: BABYLON.Scene;
  list: Projectile[];
  trailGlow: FxEmitter;
  _tmp: BABYLON.Vector3;

  constructor(game: Game) {
    this.game = game;
    this.scene = game.scene;
    this.list = [];
    this.trailGlow = new FX.Emitter(FX.layers.glow, {
      life: [0.16, 0.3], size0: [0.10, 0.2], size1: [0.02, 0.05], alpha: [0.35, 0.6],
      drag: 2.4, turb: 0.3,
    });
    this._tmp = new V3();
  }
  _make(kind: 'arrow' | 'bolt', hex: string): { mesh: BABYLON.Mesh; ownMaterial: boolean } {
    if (kind === 'arrow') {
      const mesh = BABYLON.MeshBuilder.CreateCapsule(nid('arrow'), { height: 0.5, radius: 0.022, tessellation: 5 }, this.scene);
      const mat = new BABYLON.StandardMaterial(nid('arrowMat'), this.scene);
      mat.diffuseColor = new C3(0.1, 0.1, 0.1);
      mat.emissiveColor = C3.FromHexString(hex).scale(0.7);
      mat.specularColor = new C3(0, 0, 0);
      mesh.material = mat;
      mesh.isPickable = false;
      return { mesh, ownMaterial: true };
    }
    const mesh = FX.makeSprite(this.scene, nid('bolt'), FX.textures.glow, 'add', new C4(1, 1, 1, 0.95));
    mesh.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    mesh.scaling.set(0.55, 0.55, 1);
    return { mesh, ownMaterial: true };
  }
  spawn(opts: ProjectileSpawnOpts): Projectile {
    let p: Projectile | null = null;
    for (const q of this.list) if (!q.active) { p = q; break; }
    if (!p) {
      if (this.list.length >= PROJECTILE_CAP) { p = this.list[0]; }
      else {
        p = { active: false, kind: null, mesh: null, ownMaterial: true, target: null, speed: 0, damage: 0, colorHex: '#fff', faction: '', lastPos: new V3(), size: 1, bounces: 0 };
        this.list.push(p);
      }
    }
    if (p.kind !== opts.kind || p.colorHex !== opts.colorHex) {
      if (p.mesh) { p.mesh.material!.dispose(); p.mesh.dispose(); }
      const made = this._make(opts.kind, opts.colorHex);
      p.mesh = made.mesh; p.ownMaterial = made.ownMaterial;
      p.kind = opts.kind; p.colorHex = opts.colorHex;
    }
    p.active = true;
    p.mesh!.setEnabled(true);
    p.mesh!.position.set(opts.fromX, opts.fromY, opts.fromZ);
    p.lastPos.set(opts.fromX, opts.fromY, opts.fromZ);
    p.target = opts.target;
    p.speed = opts.speed;
    p.damage = opts.damage;
    p.faction = opts.faction || 'hero';
    p.size = opts.size || 1;
    p.bounces = opts.bounces || 0;
    const [r, g, b] = FX.hexToRgb(opts.colorHex);
    if (p.kind !== 'arrow') {
      (p.mesh as FxSpriteMesh)._spriteMat!.setColor4('uColor', new C4(r * 1.4, g * 1.4, b * 1.4, 0.95));
      p.mesh!.scaling.set(0.5 * p.size, 0.5 * p.size, 1);
    } else {
      (p.mesh!.material as BABYLON.StandardMaterial).emissiveColor = C3.FromHexString(opts.colorHex).scale(0.7);
    }
    return p;
  }
  update(dt: number): void {
    for (const p of this.list) {
      if (!p.active) continue;
      const t = p.target;
      const alive = !!(t && t.alive && t.rig);
      const tx = alive ? t!.x : p.lastPos.x;
      const ty = alive ? (t!.rig.height * 0.55) : p.lastPos.y;
      const tz = alive ? t!.z : p.lastPos.z;
      const pos = p.mesh!.position;
      const dx = tx - pos.x, dy = ty - pos.y, dz = tz - pos.z;
      const dist = Math.max(0.001, Math.hypot(dx, dy, dz));
      const step = p.speed * dt;
      if (dist <= step + 0.35) {
        /* 命中（或目标已亡的能量消散） */
        p.active = false;
        p.mesh!.setEnabled(false);
        if (alive) {
          t!.takeDamage(p.damage);
          hitSpark(this.game, tx, ty, tz, p.colorHex);
        } else {
          hitSpark(this.game, pos.x, pos.y, pos.z, p.colorHex);
        }
        /* 回响碎片：英雄魔弹命中后弹片跳向邻近亡灵（伤害逐跳 55% 衰减） */
        if (p.faction === 'hero' && p.kind === 'bolt' && p.bounces > 0) {
          let hop: Unit | null = null, hopD = 9;
          for (const e of Units.enemies) {
            if (!e.alive || e === t) continue;
            const d = Math.hypot(e.x - tx, e.z - tz);
            if (d < hopD) { hopD = d; hop = e; }
          }
          if (hop) {
            this.spawn({
              fromX: tx, fromY: ty, fromZ: tz,
              target: hop, speed: p.speed, damage: p.damage * 0.55,
              colorHex: p.colorHex, kind: 'bolt', faction: 'hero',
              size: p.size * 0.85, bounces: p.bounces - 1,
            });
          }
        }
        continue;
      }
      pos.x += (dx / dist) * step;
      pos.y += (dy / dist) * step;
      pos.z += (dz / dist) * step;
      p.lastPos.copyFrom(pos);
      if (p.kind === 'arrow') {
        p.mesh!.rotation.x = Math.PI / 2 - Math.atan2(dy, Math.hypot(dx, dz));
        p.mesh!.rotation.y = Math.atan2(dx, dz);
      }
      const [r, g, b] = FX.hexToRgb(p.colorHex);
      this.trailGlow.cfg.color = [r, g, b];
      this.trailGlow.stream(1.6, pos.x, pos.y, pos.z, () => ({ x: 0, y: 0, z: 0 }));
    }
  }
  clear(): void {
    for (const p of this.list) { p.active = false; if (p.mesh) p.mesh.setEnabled(false); }
  }
  dispose(): void {
    for (const p of this.list) {
      if (p.mesh) { if (p.ownMaterial && p.mesh.material) p.mesh.material.dispose(); p.mesh.dispose(); }
    }
    this.list.length = 0;
  }
}
