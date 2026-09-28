/* ============================================================================
   hp_bar.ts — 头顶血条（自 dev/entities.js 拆出为 ESM）
   父公告板承载旋转，子条在父本地空间里缩放/平移 → 任何镜头角度下血条都正确。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { FX, type FxSpriteMesh } from '../particles';
import type { EnemyDef } from '../../core/config';
import { nid } from './rigs';
import type { Unit } from './units';

const C4 = BABYLON.Color4;
const { clamp } = FX;

/* ------------------------------ 头顶血条 ------------------------------ */
export class HpBar {
  unit: Unit;
  width: number;
  bg: FxSpriteMesh;
  fg: FxSpriteMesh;

  constructor(scene: BABYLON.Scene, unit: Unit) {
    this.unit = unit;
    const w = clamp(1.15 * ((unit.def as EnemyDef).scale || 1), 1.0, 3.2);
    this.width = w;
    /* 父公告板承载旋转，子条在父本地空间里缩放/平移 → 任何镜头角度下血条都正确 */
    this.bg = FX.makeSprite(scene, nid('hpBg'), FX.textures.softDisc, 'normal', new C4(0.02, 0.03, 0.04, 0.92));
    this.bg.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    this.bg.scaling.set(w, 0.17, 1);
    this.fg = FX.makeSprite(scene, nid('hpFg'), FX.textures.softDisc, 'add', new C4(0.35, 1, 0.5, 0.95));
    this.fg.parent = this.bg;
    this.fg.position.y = 0;
    this.setColor(1);
    this.setVisible(false);
  }
  setColor(k: number): void {
    /* 血量低时由绿转红 */
    const r = clamp(0.35 + (1 - k) * 0.75, 0, 1);
    const g = clamp(1.0 - (1 - k) * 0.45, 0, 1);
    this.fg._spriteMat!.setColor4('uColor', new C4(r, g, 0.42, 0.95));
  }
  setVisible(v: boolean): void {
    this.bg.setEnabled(v);
  }
  update(): void {
    const u = this.unit;
    const k = clamp(u.hp / u.maxHp, 0, 1);
    this.bg.position.set(u.rig.root.position.x, u.rig.height + 0.58, u.rig.root.position.z);
    /* 父平面缩放为 w×0.17，子条在 [-0.5, 0.5] 本地区间内左锚收缩 */
    this.fg.position.x = -0.5 * (1 - k);
    this.fg.scaling.set(Math.max(0.001, k), 0.74, 1);
    this.setColor(k);
  }
  dispose(): void {
    this.bg.material!.dispose();
    this.fg.material!.dispose();
    this.bg.dispose();
  }
}
