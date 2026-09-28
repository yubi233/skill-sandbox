// 阶段1桥接：旧 IIFE 脚本期望全局 BABYLON 与 __TEX_PNG。
// 阶段2逐文件转 TS 后本文件与 src/legacy/ 一并删除。
import * as BABYLON from '@babylonjs/core';
import { TEX_PNG } from '../generated/textures';

(window as unknown as { BABYLON: unknown }).BABYLON = BABYLON;
(window as unknown as { __TEX_PNG: Record<string, string> }).__TEX_PNG = TEX_PNG;
