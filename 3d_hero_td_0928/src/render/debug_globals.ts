/* ============================================================================
   debug_globals.ts — 浏览器调试手柄（仅 render 侧挂载）
   阶段2 的模块级 window 桥集中于此：core 层保持零 window（分层门禁强制），
   控制台探针（window.CONFIG / window.DIRECTOR / window.__game 等）仍可用。
   生命周期：保留为长期调试手柄（参考 3d_survivors_like_0922 的 window.__game），
   不随迁移删除。
   ========================================================================== */

import { CONFIG } from '../core/config';
import { DIRECTOR } from '../core/director';

if (typeof window !== 'undefined') {
  const w = window as unknown as Record<string, unknown>;
  w.CONFIG = CONFIG;
  w.DIRECTOR = DIRECTOR;
}
