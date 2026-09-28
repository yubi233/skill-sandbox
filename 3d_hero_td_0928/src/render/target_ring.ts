/* ============================================================================
   target_ring.ts — 地面落点圈（复用）
   自 dev/core.js 拆出为 ESM（阶段2 第3步）；数值与行为保持与原文一致。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { FX, type FxSpriteMesh } from './particles';

const C4 = BABYLON.Color4;

/* ------------------------------ 地面落点圈（复用） ------------------------------ */
export class TargetRing {
  scene: BABYLON.Scene;
  ring: FxSpriteMesh;
  disc: FxSpriteMesh;
  spin: number;
  visible: boolean;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    const ring = FX.makeSprite(scene, 'aimRing', FX.textures.ring, 'add', new C4(0.3, 1, 0.6, 1));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.05;
    ring.scaling.set(6, 6, 1);
    const disc = FX.makeSprite(scene, 'aimDisc', FX.textures.softDisc, 'add', new C4(0.3, 1, 0.6, 0.5));
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.035;
    disc.scaling.set(5.2, 5.2, 1);
    this.ring = ring; this.disc = disc;
    this.spin = 0;
    this.visible = false;
    this.setVisible(false);
  }
  setVisible(v: boolean): void {
    this.visible = v;
    this.ring.setEnabled(v);
    this.disc.setEnabled(v);
  }
  update(dt: number, pos: { x: number; z: number }, inRange: boolean, radius: number, colorHex: string): void {
    if (!this.visible) return;
    this.spin += dt * 0.55 * (inRange ? 1 : -1.6);
    this.ring.rotation.z = this.spin;
    this.disc.rotation.z = -this.spin * 0.35;
    this.ring.position.x = pos.x; this.ring.position.z = pos.z;
    this.disc.position.x = pos.x; this.disc.position.z = pos.z;
    const s = radius * 2;
    this.ring.scaling.x = this.ring.scaling.y = s;
    this.disc.scaling.x = this.disc.scaling.y = s * 0.86;
    const col = inRange ? colorHex : '#ff5f5f';
    const [r, g, b] = FX.hexToRgb(col);
    const pulse = 0.82 + Math.sin(FX.time * 6) * 0.12;
    this.ring._spriteMat!.setColor4('uColor', new C4(r * 1.6, g * 1.6, b * 1.6, 0.95 * pulse));
    this.disc._spriteMat!.setColor4('uColor', new C4(r, g, b, 0.32));
  }
}
