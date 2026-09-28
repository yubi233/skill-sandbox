// 阶段1桥接：按旧 dev/build.mjs 的 SOURCE_ORDER 以副作用方式执行 IIFE 脚本。
// ES 静态 import 严格按列出顺序求值，等价于旧拼接顺序。
// 阶段2逐文件转 TS 后本文件删除。
import './babylon-globals';
import '../render/particles';
import '../core/config';
import '../render/scene';
import '../../dev/entities.js';
import '../../dev/skills.js';
import '../core/director';
import '../../dev/ui.js';
import '../../dev/main.js';

// 阶段2桥接：为 TS 版 DIRECTOR 接线世界钩子（entities/skills 转换后改为直接引用）。
import { DIRECTOR, AllyLike } from '../core/director';
type AnyRecord = Record<string, unknown>;
const w = window as unknown as AnyRecord;
DIRECTOR.bindWorld({
  clearWorld: () => (w.Units as { clear(): void })?.clear(),
  spawnEnemy: (defKey, x, z) => (w.Units as { spawnEnemy(k: string, x: number, z: number): unknown }).spawnEnemy(defKey, x, z),
  spawnAlly: (key, stats) => (w.Units as { spawnAlly(k: string, s: unknown): unknown }).spawnAlly(key, stats),
  allies: () => (w.Units as { allies: unknown[] }).allies as AllyLike[],
  aliveEnemies: () => (w.Units as { aliveEnemies(): Array<{ alive: boolean }> }).aliveEnemies(),
  dyingCount: () => (w.Units as { dying: unknown[] }).dying.length,
  resetSpells: () => (w.SPELLS as { reset(): void })?.reset(),
  shake: (amount) => {
    const g = w.__game as { cinematic: { shake: number } } | undefined;
    if (g) g.cinematic.shake = Math.max(g.cinematic.shake, amount);
  },
  applyTheme: (theme) => (w.__game as { applyTheme(t: unknown): void } | undefined)?.applyTheme(theme),
});
