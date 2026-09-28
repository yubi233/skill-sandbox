/* ============================================================================
   resource_owner.ts — 显式资源归属（自 dev/entities.js 拆出为 ESM）
   节点/材质/发射器登记后统一回收，共享材质绝不误删；
   dev/skills.js 的 SpellCast 基类仍经 window.ResourceOwner 桥接继承本类。
   ========================================================================== */
import * as BABYLON from '@babylonjs/core';
import { FX, type EmitterCfg } from '../particles';
import { nid } from './rigs';

/* FX.Emitter 未以命名导出（挂在 FX 注册表上），取其实例类型 */
type FxEmitter = InstanceType<typeof FX.Emitter>;

/* ------------------------------ 资源归属 ------------------------------ */
export class ResourceOwner {
  scene: BABYLON.Scene;
  nodes: BABYLON.Node[];
  materials: Set<BABYLON.Material>;
  emitters: FxEmitter[];
  disposed: boolean;

  constructor(scene: BABYLON.Scene) {
    this.scene = scene;
    this.nodes = [];
    this.materials = new Set();
    this.emitters = [];
    this.disposed = false;
  }
  own<T extends BABYLON.Node>(node: T, parent?: BABYLON.Node): T {
    this.nodes.push(node);
    if ('isPickable' in node) (node as unknown as { isPickable: boolean }).isPickable = false;
    if (parent) node.parent = parent;
    const mat = (node as unknown as { material?: BABYLON.Material | null }).material;
    if (mat) this.materials.add(mat);
    return node;
  }
  group(name: string, parent?: BABYLON.Node): BABYLON.TransformNode {
    const node = new BABYLON.TransformNode(nid(name), this.scene);
    return this.own(node, parent);
  }
  mesh(type: string, opts: unknown, mat: BABYLON.Material | null, parent?: BABYLON.Node, name?: string): BABYLON.Mesh {
    const creator = (BABYLON.MeshBuilder as unknown as Record<string, (n: string, o: any, s: BABYLON.Scene) => BABYLON.Mesh>)['Create' + type];
    const built = creator(nid(name || type), opts, this.scene);
    built.material = mat;
    return this.own(built, parent);
  }
  emitter(layer: string, cfg?: EmitterCfg | null): FxEmitter {
    const e = new FX.Emitter(FX.layers[layer] || FX.layers.glow, cfg);
    this.emitters.push(e);
    return e;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const e of this.emitters) { e.alive = false; e._acc = 0; }
    this.emitters.length = 0;
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      if (!node.isDisposed || !node.isDisposed()) node.dispose(true, false);
    }
    for (const mat of this.materials) mat.dispose(false, false);
    this.nodes.length = 0; this.materials.clear();
  }
}
