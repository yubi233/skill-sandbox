/* ============================================================================
   events.ts — 类型化事件队列（阶段3：core → render 的唯一通道）
   参考 3d_survivors_like_0922 的 drained typed event union：
   - core（director/战斗规则）只 push 事件，绝不调用 render；
   - render（main 每帧）drain 一次，分发给 UI/FX/遥测；
   - 队列带上限，超限丢弃并计数（丢弃可见，不静默）。
   替代对象：DIRECTOR.on/emit 回调表与 entities 内散落的 FX 直呼（阶段3接线）。
   ========================================================================== */

import type { ThemeColors } from './config';

/** 事件载体里的最小单位视图（避免 render 类型漏进 core）。 */
export interface EventUnitView {
  x: number;
  z: number;
  name: string;
  scale: number;
  boss?: boolean;
  eye?: string;
  color?: string;
  trim?: string;
}

export type GameEvent =
  /* —— 循环状态（UI 表面切换 / 横幅） —— */
  | { type: 'reset' }
  | { type: 'camp' }
  | { type: 'delve'; record: number }
  | { type: 'wave'; wave: number; hasBoss: boolean; banner: string }
  | { type: 'clear'; wave: number; bonus: number }
  | { type: 'retreat'; wave: number; gold: number }
  | { type: 'defeat'; wave: number }
  | { type: 'theme'; theme: ThemeColors; wave: number }
  /* —— 战斗结算（FX 位置反馈 / HUD 计数） —— */
  | { type: 'hit'; x: number; y: number; z: number; amount: number; colorHex: string }
  | { type: 'kill'; x: number; y: number; z: number; gold: number; def: EventUnitView }
  | { type: 'ally-down'; x: number; y: number; z: number; def: EventUnitView }
  | { type: 'hurt'; hp: number; maxHp: number }
  | { type: 'laststand' }
  | { type: 'gold'; gained: number; total: number }
  /* —— 军团 / 成长 —— */
  | { type: 'summon'; name: string; trim: string }
  | { type: 'upgrade'; key: string; name: string; level: number }
  | { type: 'reject-summon'; name: string; reason: 'gold' | 'cap' | 'slot' | 'locked' | 'state' }
  | { type: 'reject-upgrade'; name: string; reason: 'gold' | 'locked' | 'max' | 'unknown' | 'camp' | 'first-delve' }
  /* —— 法术（audio/FX 的挂点；当前技能层直接驱动 FX，保留类型位） —— */
  | { type: 'cast-start'; id: number; name: string; colorHex: string };

/** 带上限与丢弃计数的排水队列。 */
export class EventQueue<T> {
  private items: T[] = [];
  /** 超限丢弃的事件数（遥测可见；正常帧远达不到上限）。 */
  dropped = 0;

  constructor(private readonly cap = 240) {}

  push(event: T): void {
    if (this.items.length >= this.cap) {
      this.dropped++;
      return;
    }
    this.items.push(event);
  }

  /** 每帧一次：把本帧事件复制进调用方缓冲并清空（复用数组，零分配稳态）。 */
  drain(out: T[]): void {
    out.length = 0;
    for (let i = 0; i < this.items.length; i++) out.push(this.items[i]);
    this.items.length = 0;
  }
}

/** 全局游戏事件队列（core 侧 push；render 侧 main 每帧 drain）。 */
export const gameEvents = new EventQueue<GameEvent>();
