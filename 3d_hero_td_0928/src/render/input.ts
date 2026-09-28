/* ==========================================================================
   input.ts — 死灵防线 3D · 输入与瞄准
   （自 dev/main.js 移植为 ESM，阶段2 第8步；数值与行为保持与原文一致）
   1–3 选择法术，鼠标左键向落点释放，空格向自动锁定目标释放；
   F / G 召唤已解锁盟友；右键拖动环绕镜头（相机输入已在 scene.ts 挂接），
   右键轻点取消选择，滚轮缩放。
   keys/mouse/aimPoint/rightDown 与 tryCast/castAtAutoTarget/updateAim 全部
   收敛进 attachInput(game, canvas)，按次创建——与原 boot 闭包语义一致
   （页面只 boot 一次，状态等价于单例）。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { CONFIG } from '../core/config';
import { DIRECTOR } from '../core/director';
import { SPELLS } from './skills';
import { checkCast, pickFrontTarget } from '../core/rules/combat';
import { UI } from './ui';
import { Units } from './entities/units';
import type { Game } from './scene';

/* —— main.ts 的统一时间步需按原序列在 lateUpdate 之后、UI.update 之前调用 updateAim。
   Game 接口定稿于 scene.ts，这里以交叉类型声明 attachInput 追加的字段；
   boot 先 attachInput 再启动渲染循环，tick 首帧执行时恒已赋值。 */
export type GameWithAim = Game & { __updateAim: (dt: number) => void };

export function attachInput(game: Game, canvas: HTMLCanvasElement): void {
  const keys: Record<string, boolean> = {};
  void keys; /* 原 dev/main.js 遗留的未用状态，保留声明以逐字对齐 */
  const mouse = { x: canvas.clientWidth * 0.5, y: canvas.clientHeight * 0.5, dirty: false };
  const aimPoint = new BABYLON.Vector3(0, 0, 6);
  let rightDown: { x: number; y: number } | null = null;

  const isEditing = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
  };

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      UI.clearSelection();
      UI.togglePanel(false);
      game.ring.setVisible(false);
      e.preventDefault();
      return;
    }
    if (isEditing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const spellDef = CONFIG.SPELLS.find((s) => s.hotkey === e.key);
    if (spellDef) {
      /* DIRECTOR.ownsSpell 形参为 string，其内部 CONFIG.spellOf 会 Number() 归一 */
      if (DIRECTOR.inRun() && DIRECTOR.ownsSpell(String(spellDef.id))) UI.select(spellDef.id);
      e.preventDefault();
      return;
    }
    const allyDef = CONFIG.ALLIES.find((a) => a.hotkey.toLowerCase() === e.key.toLowerCase());
    if (allyDef) {
      if (DIRECTOR.inRun() && DIRECTOR.ownsAlly(allyDef.key)) DIRECTOR.summon(allyDef.key);
      e.preventDefault();
      return;
    }
    if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      if (!e.repeat) castAtAutoTarget();
      e.preventDefault();
      return;
    }
    if (e.key.toLowerCase() === 'n' && DIRECTOR.state === 'intermission') {
      DIRECTOR.startNextNow();
      e.preventDefault();
    }
    if (e.key.toLowerCase() === 'r' && !e.repeat) {
      DIRECTOR.retreat();
      e.preventDefault();
    }
  });

  function trackPointer(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    mouse.x = e.clientX - rect.left;
    mouse.y = e.clientY - rect.top;
    mouse.dirty = true;
  }
  canvas.addEventListener('pointermove', trackPointer);
  canvas.addEventListener('wheel', () => { mouse.dirty = true; }, { passive: true });
  canvas.addEventListener('pointerdown', (e) => {
    trackPointer(e);
    if (e.button === 0) {
      updateAim(0);
      tryCast(aimPoint);
    } else if (e.button === 2) {
      rightDown = { x: e.clientX, y: e.clientY };
    }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (e.button !== 2 || !rightDown) return;
    const distance = Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y);
    rightDown = null;
    if (distance < 6) {
      /* 右键轻点：取消选择 */
      UI.clearSelection();
      game.ring.setVisible(false);
    }
  });
  canvas.addEventListener('pointercancel', () => { rightDown = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  function tryCast(point: { x: number; z: number }) {
    const def = SPELLS.defs.find((d) => d.id === UI.selectedId);
    const mp = game.mage.root.position;
    const check = checkCast({
      inRun: DIRECTOR.inRun(),
      selectedId: UI.selectedId,
      known: !!def,
      owned: !!def && DIRECTOR.ownsSpell(String(def.id)),
      cooldownReady: !!def && SPELLS.isReady(def.id),
      distance: Math.hypot(point.x - mp.x, point.z - mp.z),
      range: def ? def.range : Infinity,
    });
    if (check === 'no-selection') { UI.toast('点击法术栏，或按 1 选择火球术'); return false; }
    if (check === 'cooldown') { UI.toast((def as NonNullable<typeof def>).name + ' · 冷却中'); return false; }
    if (check === 'out-of-range') { UI.toast('超出射程 · ' + (def as NonNullable<typeof def>).range + ' m'); return false; }
    if (check !== 'ok' || !def) return false;
    const ok = SPELLS.start(game, def.id, point);
    if (!ok) UI.toast(SPELLS.lastRejectReason === 'error' ? '释放异常，法术已回收' : '上一法术仍在释放');
    return ok;
  }

  function castAtAutoTarget() {
    if (!DIRECTOR.inRun()) return false;
    if (!UI.selectedId) { UI.select(1); }
    const def = SPELLS.defs.find((d) => d.id === UI.selectedId);
    if (!def) return;
    const mp = game.mage.root.position;
    /* 自动锁定：射程内最靠前的正面威胁（策略在 core/rules/combat.ts） */
    const target = pickFrontTarget(Units.enemies, def.range);
    /* targetPoint 仅在敌人存活/注册表命中失败时为 null，上方已过滤存活；
       非空断言只作用于类型层，运行时与原 JS 直传一致 */
    const point = target
      ? SPELLS.targetPoint(target, def.id)!
      : new BABYLON.Vector3(mp.x, 0, Math.min(mp.z + 12, CONFIG.FIELD.spawnZ));
    return tryCast(point);
  }

  let pickFrame = 0;
  function updateAim(dt: number): void {
    pickFrame++;
    const idle = !mouse.dirty && !rightDown;
    if (!idle || pickFrame % 4 === 0) {
      mouse.dirty = false;
      const pick = game.scene.pick(mouse.x, mouse.y, (m) => m === game.ground);
      if (pick && pick.hit && pick.pickedPoint) {
        aimPoint.copyFrom(pick.pickedPoint);
        aimPoint.y = 0;
      }
    }
    const id = UI.selectedId;
    const def = SPELLS.defs.find((d) => d.id === id);
    /* ownsSpell 形参为 string，其内部 CONFIG.spellOf 会 Number() 归一（id 为 null 同样 false） */
    const show = !!(DIRECTOR.inRun() && def && DIRECTOR.ownsSpell(String(id)) && def.groundTarget);
    game.ring.setVisible(show);
    if (show) {
      const mp = game.mage.root.position;
      const distance = Math.hypot(aimPoint.x - mp.x, aimPoint.z - mp.z);
      game.ring.update(dt, aimPoint, distance <= def.range, def.radius, def.color);
    }
  }

  (game as GameWithAim).__updateAim = updateAim;
}
