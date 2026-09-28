// 阶段1桥接：按旧 dev/build.mjs 的 SOURCE_ORDER 以副作用方式执行 IIFE 脚本。
// ES 静态 import 严格按列出顺序求值，等价于旧拼接顺序。
// 阶段2逐文件转 TS 后本文件删除。
import './babylon-globals';
import '../../dev/particles.js';
import '../../dev/config.js';
import '../../dev/core.js';
import '../../dev/entities.js';
import '../../dev/skills.js';
import '../../dev/director.js';
import '../../dev/ui.js';
import '../../dev/main.js';
