/* ============================================================================
   particles.ts — 粒子内核（自 dev/particles.js 移植为 ESM；原文已删，git 历史保留）
   · 程序化 canvas 贴图(径向渐变光斑 / 火花 / 烟雾 / 碎屑 / 法阵圈)
   · BufferGeometry+Points 等价实现:BABYLON.Mesh(isUnIndexed) + ShaderMaterial
     + MATERIAL_PointFillMode(gl.POINTS),对象池复用,零 GC 热路径
   · 运动扰动:多重正弦(curl-ish)场,禁止直线匀速
   · 尺寸 & 透明度随生命周期「先起后落」包络
   ========================================================================== */
import { TEX_PNG } from '../generated/textures';
import * as BABYLON from '@babylonjs/core';

/* ------------------------------ 类型 ------------------------------ */
/* makeTexture 第三参的贴图种类 —— 与下方 TEXTURE_DRAW 的键一一对应 */
export type FxTextureKind =
  | 'glow' | 'spark' | 'smoke' | 'debris' | 'ring' | 'softDisc' | 'slash'
  | 'rune' | 'fracture' | 'star' | 'vortex' | 'crystal'
  | 'groundNoise' | 'daylightGrass' | 'beamGlow' | 'blade' | 'spearBlade';

/* 混合模式:'add' 加色发光 / 'normal' 普通 alpha 混合 */
export type FxBlending = 'add' | 'normal';

interface Vec3Like { x: number; y: number; z: number; }
/* velFn(k, n, 出生点) → 初速度 */
type EmitVelFn = (k: number, n: number, pos: Vec3Like) => Vec3Like;

/* Emitter 配置(调用方只传子集,缺省项由 DEFAULT_EMIT 补全) */
export interface EmitterCfg {
  rate?: number;
  life?: [number, number];
  size0?: [number, number];
  size1?: [number, number];
  alpha?: [number, number];
  color?: number[];
  color2?: [number, number, number] | null;
  speed?: [number, number];
  drag?: number;
  gravity?: number;
  turb?: number;
  envType?: number;
  jitter?: number;
}

/* Object.assign({}, DEFAULT_EMIT, cfg) 之后的已解析配置形状 */
interface ResolvedEmitCfg {
  rate: number;
  life: [number, number];
  size0: [number, number];
  size1: [number, number];
  alpha: [number, number];
  color: number[];
  color2: [number, number, number] | null;
  speed: [number, number];
  drag: number;
  gravity: number;
  turb: number;
  envType: number;
  jitter?: number;
}

/* layer.add() 的单粒子初始状态 */
interface ParticleInit {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  size0: number; size1: number;
  alpha: number;
  r: number; g: number; b: number;
  r2?: number; g2?: number; b2?: number;
  drag?: number; gravity?: number; turb?: number; envType?: number;
}

/* makeSprite 返回的网格:挂载 _spriteMat 供运行时实时改色 */
export interface FxSpriteMesh extends BABYLON.Mesh {
  _spriteMat?: BABYLON.ShaderMaterial;
}

/* ------------------------------ 数学工具 ------------------------------ */
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const randSpread = (a: number): number => (Math.random() * 2 - 1) * a;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const easeOutBack = (t: number): number => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
function rgbToHex(r: number, g: number, b: number): string {
  const f = (v: number) => ('0' + Math.round(clamp(v, 0, 1) * 255).toString(16)).slice(-2);
  return '#' + f(r) + f(g) + f(b);
}

/* 多重正弦扰动场(等价 curl noise 的低成本近似) */
function turbField(x: number, y: number, z: number, t: number, phase: number, out: Vec3Like): Vec3Like {
  out.x = Math.sin(y * 1.7 + t * 1.30 + phase) + 0.55 * Math.sin(z * 2.9 - t * 0.83 + phase * 1.7);
  out.y = Math.sin(z * 1.9 - t * 1.10 + phase * 0.7) + 0.55 * Math.sin(x * 3.1 + t * 0.91);
  out.z = Math.sin(x * 1.5 + t * 1.22 + phase * 1.3) + 0.55 * Math.sin(y * 2.3 - t * 1.02);
  return out;
}

/* --------------------------- 程序化 canvas 贴图 --------------------------- */
function radial(ctx: CanvasRenderingContext2D, size: number, cx: number, cy: number, r: number, stops: Array<[number, string]>): void {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const s of stops) g.addColorStop(s[0], s[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}

const TEXTURE_DRAW: Record<FxTextureKind, (ctx: CanvasRenderingContext2D, s: number) => void> = {
  /* 主发光光斑:亮核 + 柔和衰减 */
  glow(ctx, s) {
    radial(ctx, s, s / 2, s / 2, s / 2, [
      [0.00, 'rgba(255,255,255,1)'],
      [0.10, 'rgba(255,255,255,0.86)'],
      [0.24, 'rgba(255,255,255,0.42)'],
      [0.45, 'rgba(255,255,255,0.13)'],
      [0.72, 'rgba(255,255,255,0.035)'],
      [1.00, 'rgba(255,255,255,0)'],
    ]);
  },
  /* 火花:极亮核心 + 十字星芒 */
  spark(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createLinearGradient(0, 0, s, 0);
    g.addColorStop(0.0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    g.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, s * 0.455, s, s * 0.09);
    const g2 = ctx.createLinearGradient(0, 0, 0, s);
    g2.addColorStop(0.0, 'rgba(255,255,255,0)');
    g2.addColorStop(0.5, 'rgba(255,255,255,0.75)');
    g2.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(s * 0.455, 0, s * 0.09, s);
    radial(ctx, s, s / 2, s / 2, s * 0.19, [
      [0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.6)'], [1, 'rgba(255,255,255,0)'],
    ]);
  },
  /* 烟雾:多个软团 + 边缘径向遮罩 */
  smoke(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + i * 0.7;
      const rr = s * (0.10 + 0.13 * ((i * 37) % 10) / 10);
      const cx = s / 2 + Math.cos(a) * s * 0.17;
      const cy = s / 2 + Math.sin(a) * s * 0.17;
      radial(ctx, s, cx, cy, rr * 2.1, [
        [0, 'rgba(255,255,255,0.32)'], [0.55, 'rgba(255,255,255,0.12)'], [1, 'rgba(255,255,255,0)'],
      ]);
    }
    radial(ctx, s, s / 2, s / 2, s * 0.34, [
      [0, 'rgba(255,255,255,0.42)'], [0.6, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)'],
    ]);
    /* 边缘遮罩 */
    ctx.globalCompositeOperation = 'destination-in';
    radial(ctx, s, s / 2, s / 2, s / 2, [
      [0, 'rgba(255,255,255,1)'], [0.62, 'rgba(255,255,255,0.85)'], [1, 'rgba(255,255,255,0)'],
    ]);
    ctx.globalCompositeOperation = 'source-over';
  },
  /* 碎屑:不规则石块 */
  debris(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    ctx.translate(s / 2, s / 2);
    ctx.beginPath();
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = s * (0.16 + 0.13 * Math.abs(Math.sin(i * 2.3 + 1.1)));
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(-s * 0.2, -s * 0.2, s * 0.25, s * 0.25);
    g.addColorStop(0, 'rgba(255,255,255,0.98)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0.18)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },
  /* 法阵 / 落点圈:亮环 + 刻度 */
  ring(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    radial(ctx, s, s / 2, s / 2, s / 2, [
      [0.00, 'rgba(255,255,255,0)'],
      [0.55, 'rgba(255,255,255,0.02)'],
      [0.70, 'rgba(255,255,255,0.16)'],
      [0.80, 'rgba(255,255,255,0.92)'],
      [0.86, 'rgba(255,255,255,0.30)'],
      [1.00, 'rgba(255,255,255,0)'],
    ]);
    ctx.translate(s / 2, s / 2);
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2;
      const long = i % 3 === 0;
      ctx.strokeStyle = 'rgba(255,255,255,' + (long ? 0.85 : 0.35) + ')';
      ctx.lineWidth = long ? s * 0.014 : s * 0.008;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * s * (long ? 0.38 : 0.42), Math.sin(a) * s * (long ? 0.38 : 0.42));
      ctx.lineTo(Math.cos(a) * s * 0.47, Math.sin(a) * s * 0.47);
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },
  /* 柔和圆盘(地面残留 / 辉光) */
  softDisc(ctx, s) {
    radial(ctx, s, s / 2, s / 2, s / 2, [
      [0.00, 'rgba(255,255,255,0.75)'],
      [0.35, 'rgba(255,255,255,0.42)'],
      [0.62, 'rgba(255,255,255,0.14)'],
      [0.85, 'rgba(255,255,255,0.03)'],
      [1.00, 'rgba(255,255,255,0)'],
    ]);
  },
  /* 风刃 / 裂痕:柳叶形亮痕 */
  slash(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    ctx.translate(s / 2, s / 2);
    for (let k = -1; k <= 1; k++) {
      ctx.beginPath();
      ctx.moveTo(-s * 0.46, k * s * 0.16);
      ctx.quadraticCurveTo(0, k * s * 0.16 - s * 0.13, s * 0.46, k * s * 0.16);
      ctx.quadraticCurveTo(0, k * s * 0.16 + s * 0.13, -s * 0.46, k * s * 0.16);
      const g = ctx.createLinearGradient(0, k * s * 0.16 - s * 0.12, 0, k * s * 0.16 + s * 0.12);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,' + (k === 0 ? 0.95 : 0.4) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  },
  rune(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    ctx.save(); ctx.translate(s / 2, s / 2);
    const circle = (r: number, a: number, w: number) => {
      ctx.strokeStyle = 'rgba(255,255,255,' + a + ')'; ctx.lineWidth = w;
      ctx.beginPath(); ctx.arc(0, 0, s * r, 0, Math.PI * 2); ctx.stroke();
    };
    circle(0.455, 0.8, 1.6); circle(0.43, 0.38, 1); circle(0.335, 0.65, 1.4); circle(0.305, 0.24, 1);
    for (let j = 0; j < 2; j++) {
      ctx.rotate(Math.PI / 3); ctx.beginPath();
      for (let i = 0; i <= 3; i++) {
        const a = i * Math.PI * 2 / 3, x = Math.sin(a) * s * 0.305, y = Math.cos(a) * s * 0.305;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.58)'; ctx.lineWidth = 1.5; ctx.stroke();
    }
    for (let i = 0; i < 72; i++) {
      ctx.save(); ctx.rotate(i * Math.PI / 36);
      ctx.strokeStyle = 'rgba(255,255,255,' + (i % 6 ? 0.38 : 0.85) + ')';
      ctx.lineWidth = i % 6 ? 1 : 2;
      ctx.beginPath(); ctx.moveTo(0, -s * 0.437); ctx.lineTo(0, -s * (i % 6 ? 0.446 : 0.471)); ctx.stroke();
      if (i % 3 === 0) {
        ctx.translate(0, -s * 0.382); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(-4, -6); ctx.lineTo(2, 0); ctx.lineTo(-3, 6);
        ctx.moveTo(2, 0); ctx.lineTo(5, -5); ctx.moveTo(-4, 2); ctx.lineTo(4, 5); ctx.stroke();
      }
      ctx.restore();
    }
    circle(0.10, 0.28, 1); ctx.restore();
  },
  fracture(ctx, s) {
    ctx.clearRect(0, 0, s, s); ctx.save(); ctx.translate(s / 2, s / 2);
    ctx.lineCap = 'round';
    for (let i = 0; i < 13; i++) {
      const angle = i * Math.PI * 2 / 13;
      const points: Array<[number, number]> = [];
      for (let j = 0; j < 7; j++) {
        const a = angle + Math.sin(i * 9 + j * 13) * 0.14, r = s * j * 0.068;
        points.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.08)';
        ctx.lineWidth = pass ? 1.6 : 8; ctx.beginPath();
        points.forEach((p, j) => j ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.stroke();
      }
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      const p = points[3]; ctx.beginPath(); ctx.moveTo(...p);
      ctx.lineTo(p[0] + Math.cos(angle + 0.6) * s * 0.12, p[1] + Math.sin(angle + 0.6) * s * 0.12);
      ctx.lineTo(p[0] + Math.cos(angle + 0.9) * s * 0.20, p[1] + Math.sin(angle + 0.9) * s * 0.20); ctx.stroke();
    }
    ctx.restore();
  },
  star(ctx, s) {
    radial(ctx, s, s / 2, s / 2, s * 0.45, [[0, 'rgba(255,255,255,0.6)'], [0.12, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']]);
    ctx.save(); ctx.translate(s / 2, s / 2);
    for (let i = 0; i < 8; i++) {
      ctx.rotate(Math.PI / 4); const r = i % 2 ? s * 0.29 : s * 0.48;
      const g = ctx.createLinearGradient(0, 0, 0, -r);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-s * 0.018, 0); ctx.lineTo(0, -r); ctx.lineTo(s * 0.018, 0); ctx.fill();
    }
    ctx.restore();
  },
  vortex(ctx, s) {
    ctx.clearRect(0, 0, s, s); ctx.save(); ctx.translate(s / 2, s / 2);
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 80; j++) {
        const u = j / 80, a = i * Math.PI * 0.4 + u * Math.PI * 1.4, r = s * (0.05 + u * 0.40);
        ctx.strokeStyle = 'rgba(255,255,255,' + (Math.sin(u * Math.PI) * 0.7) + ')';
        ctx.lineWidth = 1 + Math.sin(u * Math.PI) * s * 0.012;
        ctx.beginPath(); ctx.arc(0, 0, r, a, a + 0.045); ctx.stroke();
      }
    }
    ctx.restore();
  },
  crystal(ctx, s) {
    ctx.clearRect(0, 0, s, s); ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.05); ctx.lineTo(s * 0.67, s * 0.60);
    ctx.lineTo(s * 0.5, s * 0.94); ctx.lineTo(s * 0.33, s * 0.60); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(s * 0.5, s * 0.08); ctx.lineTo(s * 0.5, s * 0.9); ctx.stroke();
  },
  /* 明亮中性地表：低对比、周期噪声只提供质感，不把主题色乘成黑泥。 */
  groundNoise(ctx, s) {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    const hash = (x: number, y: number) => {
      const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    const vn = (x: number, y: number, period: number) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      const xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const x0 = xi % period, x1 = (xi + 1) % period;
      const y0 = yi % period, y1 = (yi + 1) % period;
      return lerp(lerp(hash(x0, y0), hash(x1, y0), u), lerp(hash(x0, y1), hash(x1, y1), u), v);
    };
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let f = 0, amp = 0.55, freq = 4;
        for (let o = 0; o < 3; o++) {
          f += amp * vn((x / s) * freq, (y / s) * freq, freq);
          amp *= 0.5; freq *= 2;
        }
        const grit = hash(x * 1.7, y * 2.3) * 0.025;
        const t = clamp(f * 0.92 + grit, 0, 1);
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 220 + t * 32;
        d[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  },
  /* 彩色草地素材解码前/失败时的实色回退；与法术的白色 alpha 贴图不同。 */
  daylightGrass(ctx, s) {
    TEXTURE_DRAW.groundNoise(ctx, s);
    const img = ctx.getImageData(0, 0, s, s);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const light = d[i] / 255;
      d[i] = 183 * light; d[i + 1] = 206 * light; d[i + 2] = 137 * light;
    }
    ctx.putImageData(img, 0, 0);
  },
  /* 光束辉光:横向柔边(用于柱状 beam 的 opacity/emissive) */
  beamGlow(ctx, s) {
    const img = ctx.createImageData(s, s);
    const d = img.data;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (x / s - 0.5) * 2;
        const dy = (y / s - 0.5) * 2;
        const r = Math.sqrt(dx * dx + dy * dy);
        const a = Math.pow(clamp(1 - r, 0, 1), 1.7);
        const i = (y * s + x) * 4;
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  },
  /* 宝具剑刃剪影:剑尖朝上(无贴图时的程序化回退,游戏内被 assets/blade.png 原位升级) */
  blade(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    const w = s * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.moveTo(w, s * 0.04);
    ctx.lineTo(w + s * 0.075, s * 0.20);
    ctx.lineTo(w + s * 0.075, s * 0.62);
    ctx.lineTo(w - s * 0.075, s * 0.62);
    ctx.lineTo(w - s * 0.075, s * 0.20);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(w - s * 0.012, s * 0.12, s * 0.024, s * 0.5);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.moveTo(w - s * 0.17, s * 0.615);
    ctx.quadraticCurveTo(w, s * 0.70, w + s * 0.17, s * 0.615);
    ctx.lineTo(w + s * 0.17, s * 0.685);
    ctx.quadraticCurveTo(w, s * 0.735, w - s * 0.17, s * 0.685);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(w - s * 0.035, s * 0.69, s * 0.07, s * 0.22);
    ctx.beginPath();
    ctx.arc(w, s * 0.935, s * 0.055, 0, Math.PI * 2);
    ctx.fill();
  },
  /* 宝具长枪剪影:菱形枪尖朝上(无贴图时的程序化回退) */
  spearBlade(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    const w = s * 0.5;
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.beginPath();
    ctx.moveTo(w, s * 0.04);
    ctx.lineTo(w + s * 0.085, s * 0.24);
    ctx.lineTo(w, s * 0.44);
    ctx.lineTo(w - s * 0.085, s * 0.24);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(w - s * 0.085, s * 0.25);
    ctx.lineTo(w - s * 0.15, s * 0.34);
    ctx.lineTo(w - s * 0.05, s * 0.37);
    ctx.closePath();
    ctx.moveTo(w + s * 0.085, s * 0.25);
    ctx.lineTo(w + s * 0.15, s * 0.34);
    ctx.lineTo(w + s * 0.05, s * 0.37);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(w - s * 0.055, s * 0.44, s * 0.11, s * 0.05);
    ctx.fillRect(w - s * 0.022, s * 0.49, s * 0.044, s * 0.47);
    ctx.beginPath();
    ctx.arc(w, s * 0.975, s * 0.035, 0, Math.PI * 2);
    ctx.fill();
  },
};

function makeTexture(scene: BABYLON.Scene, name: string, size: number, key: FxTextureKind): BABYLON.DynamicTexture {
  const groundAlbedo = key === 'groundNoise' || key === 'daylightGrass';
  const dt = new BABYLON.DynamicTexture('tex_' + name, { width: size, height: size }, scene, groundAlbedo);
  const ctx = dt.getContext() as unknown as CanvasRenderingContext2D;
  TEXTURE_DRAW[key](ctx, size);
  dt.update(false);
  dt.hasAlpha = !groundAlbedo;
  dt.wrapU = dt.wrapV = groundAlbedo ? BABYLON.Texture.WRAP_ADDRESSMODE : BABYLON.Texture.CLAMP_ADDRESSMODE;
  return dt;
}

/* --------------------- 点云层(BufferGeometry+Points 等价) --------------------- */
const POINT_VS = `
    precision highp float;
    attribute vec3 position;
    attribute vec4 color;
    attribute float size;
    uniform mat4 worldViewProjection;
    uniform float pointScale;
    uniform float maxPointSize;
    varying vec4 vColor;
    void main() {
      vec4 clip = worldViewProjection * vec4(position, 1.0);
      gl_Position = clip;
      gl_PointSize = clip.w > 0.0 ? clamp(size * pointScale / max(clip.w, 0.01), 1.0, maxPointSize) : 1.0;
      vColor = color;
    }`;
const POINT_FS = `
    precision highp float;
    varying vec4 vColor;
    uniform sampler2D diffuseSampler;
    void main() {
      vec4 tex = texture2D(diffuseSampler, gl_PointCoord);
      float a = clamp(tex.a * vColor.a, 0.0, 1.0);
      if (a < 0.003) discard;
      gl_FragColor = vec4(vColor.rgb * tex.rgb, a);
    }`;

class PointLayer {
  static _shaderReady = false;
  capacity: number;
  count: number;
  name: string;
  px: Float32Array; py: Float32Array; pz: Float32Array;
  vx: Float32Array; vy: Float32Array; vz: Float32Array;
  life: Float32Array; maxLife: Float32Array;
  size0: Float32Array; size1: Float32Array;
  alpha0: Float32Array;
  cr: Float32Array; cg: Float32Array; cb: Float32Array;
  cr2: Float32Array; cg2: Float32Array; cb2: Float32Array;
  drag: Float32Array; grav: Float32Array;
  turb: Float32Array; phase: Float32Array;
  envType: Float32Array; /* 1=先起后落包络 0=线性衰减 */
  gpuPos: Float32Array;
  gpuCol: Float32Array;
  gpuSize: Float32Array;
  mesh: BABYLON.Mesh;
  material: BABYLON.ShaderMaterial;

  constructor(scene: BABYLON.Scene, name: string, capacity: number, texture: BABYLON.Texture, blending: FxBlending) {
    this.capacity = capacity;
    this.count = 0;
    this.name = name;
    /* —— 对象池:SoA 结构体数组,死粒子换尾复用 —— */
    this.px = new Float32Array(capacity); this.py = new Float32Array(capacity); this.pz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity); this.vy = new Float32Array(capacity); this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity); this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity); this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.cr = new Float32Array(capacity); this.cg = new Float32Array(capacity); this.cb = new Float32Array(capacity);
    this.cr2 = new Float32Array(capacity); this.cg2 = new Float32Array(capacity); this.cb2 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity); this.grav = new Float32Array(capacity);
    this.turb = new Float32Array(capacity); this.phase = new Float32Array(capacity);
    this.envType = new Float32Array(capacity); /* 1=先起后落包络 0=线性衰减 */

    /* —— GPU 侧缓冲 —— */
    this.gpuPos = new Float32Array(capacity * 3);
    this.gpuCol = new Float32Array(capacity * 4);
    this.gpuSize = new Float32Array(capacity);

    const mesh = new BABYLON.Mesh('fx_' + name, scene);
    mesh.isUnIndexed = true;
    mesh.setVerticesData('position', this.gpuPos, true, 3);
    mesh.setVerticesData('color', this.gpuCol, true, 4);
    mesh.setVerticesData('size', this.gpuSize, true, 1);
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;

    if (!PointLayer._shaderReady) {
      BABYLON.Effect.ShadersStore.fxPointsVertexShader = POINT_VS;
      BABYLON.Effect.ShadersStore.fxPointsFragmentShader = POINT_FS;
      BABYLON.Effect.ShadersStore.fxSpriteVertexShader = SPRITE_VS;
      BABYLON.Effect.ShadersStore.fxSpriteFragmentShader = SPRITE_FS;
      PointLayer._shaderReady = true;
    }
    const mat = new BABYLON.ShaderMaterial('fxMat_' + name, scene, { vertex: 'fxPoints', fragment: 'fxPoints' }, {
      attributes: ['position', 'color', 'size'],
      uniforms: ['worldViewProjection', 'pointScale', 'maxPointSize'],
      samplers: ['diffuseSampler'],
    });
    mat.setTexture('diffuseSampler', texture);
    mat.setFloat('pointScale', 600);
    const gl = (scene.getEngine() as BABYLON.ThinEngine)._gl;
    mat.setFloat('maxPointSize', gl ? gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1] : 128);
    mat.fillMode = BABYLON.Material.PointFillMode;
    mesh.setEnabled(false);
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;
    mat.alphaMode = blending === 'add' ? BABYLON.Constants.ALPHA_ADD : BABYLON.Constants.ALPHA_COMBINE;
    mat.needAlphaBlending = () => true;
    mesh.material = mat;
    this.mesh = mesh;
    this.material = mat;
  }

  setPointScale(v: number): void { this.material.setFloat('pointScale', v); }

  add(p: ParticleInit): number {
    let i = this.count;
    if (i >= this.capacity) return -1;
    this.count++;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx; this.vy[i] = p.vy; this.vz[i] = p.vz;
    this.life[i] = 0; this.maxLife[i] = p.life;
    this.size0[i] = p.size0; this.size1[i] = p.size1;
    this.alpha0[i] = p.alpha;
    this.cr[i] = p.r; this.cg[i] = p.g; this.cb[i] = p.b;
    this.cr2[i] = p.r2 !== undefined ? p.r2 : p.r;
    this.cg2[i] = p.g2 !== undefined ? p.g2 : p.g;
    this.cb2[i] = p.b2 !== undefined ? p.b2 : p.b;
    this.drag[i] = p.drag !== undefined ? p.drag : 1.2;
    this.grav[i] = p.gravity || 0;
    this.turb[i] = p.turb !== undefined ? p.turb : 1;
    this.phase[i] = Math.random() * 6.283;
    this.envType[i] = p.envType !== undefined ? p.envType : 1;
    return i;
  }

  kill(i: number): void {
    if (this.count <= 0) { this.count = 0; return; }
    const last = --this.count;
    if (i !== last) {
      this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
      this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
      this.life[i] = this.life[last]; this.maxLife[i] = this.maxLife[last];
      this.size0[i] = this.size0[last]; this.size1[i] = this.size1[last]; this.alpha0[i] = this.alpha0[last];
      this.cr[i] = this.cr[last]; this.cg[i] = this.cg[last]; this.cb[i] = this.cb[last];
      this.cr2[i] = this.cr2[last]; this.cg2[i] = this.cg2[last]; this.cb2[i] = this.cb2[last];
      this.drag[i] = this.drag[last]; this.grav[i] = this.grav[last];
      this.turb[i] = this.turb[last]; this.phase[i] = this.phase[last];
      this.envType[i] = this.envType[last];
    }
  }

  update(dt: number, time: number): void {
    let i = 0;
    while (i < this.count) {
      const life = this.life[i] + dt;
      if (life >= this.maxLife[i]) { this.kill(i); continue; }
      this.life[i] = life;
      const u = life / this.maxLife[i];

      /* 多重正弦扰动 —— 拒绝直线匀速 */
      const tb = this.turb[i];
      if (tb > 0) {
        const ph = this.phase[i];
        const x = this.px[i] * 0.32, y = this.py[i] * 0.32, z = this.pz[i] * 0.32;
        this.vx[i] += (Math.sin(y * 1.7 + time * 1.30 + ph) + 0.55 * Math.sin(z * 2.9 - time * 0.83 + ph * 1.7)) * tb * dt;
        this.vy[i] += (Math.sin(z * 1.9 - time * 1.10 + ph * 0.7) + 0.55 * Math.sin(x * 3.1 + time * 0.91)) * tb * dt;
        this.vz[i] += (Math.sin(x * 1.5 + time * 1.22 + ph * 1.3) + 0.55 * Math.sin(y * 2.3 - time * 1.02)) * tb * dt;
      }
      const dragF = 1 - clamp(this.drag[i], 0, 12) * dt;
      this.vx[i] *= dragF; this.vy[i] *= dragF; this.vz[i] *= dragF;
      this.vy[i] -= this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;

      /* 尺寸 / 透明度:先起后落 */
      const env = this.envType[i] > 0.5 ? Math.sin(Math.PI * Math.pow(u, 0.82)) : (1 - u);
      const size = (this.size0[i] + (this.size1[i] - this.size0[i]) * u) * (0.30 + 0.85 * env);
      const alpha = this.alpha0[i] * env * (this.envType[i] > 0.5 ? 1.12 : 1);

      const o3 = i * 3, o4 = i * 4;
      this.gpuPos[o3] = this.px[i]; this.gpuPos[o3 + 1] = this.py[i]; this.gpuPos[o3 + 2] = this.pz[i];
      this.gpuCol[o4] = lerp(this.cr[i], this.cr2[i], u);
      this.gpuCol[o4 + 1] = lerp(this.cg[i], this.cg2[i], u);
      this.gpuCol[o4 + 2] = lerp(this.cb[i], this.cb2[i], u);
      this.gpuCol[o4 + 3] = alpha;
      this.gpuSize[i] = size;
      i++;
    }
    this.upload();
  }

  upload(): void {
    this.mesh.setEnabled(this.count > 0);
    const sub = this.mesh.subMeshes && this.mesh.subMeshes[0];
    if (sub) { sub.verticesStart = 0; sub.verticesCount = this.count; }
    if (!this.count) return;
    this.mesh.updateVerticesData('position', this.gpuPos, false);
    this.mesh.updateVerticesData('color', this.gpuCol, false);
    this.mesh.updateVerticesData('size', this.gpuSize, false);
    const sm = this.mesh.subMeshes && this.mesh.subMeshes[0];
    if (sm) { sm.verticesStart = 0; sm.verticesCount = this.count; }
  }
}

/* ------------------------ 通用贴图四边形(辉光/法阵) ------------------------ */
const SPRITE_VS = `
    precision highp float;
    attribute vec3 position;
    attribute vec2 uv;
    uniform mat4 worldViewProjection;
    varying vec2 vUV;
    void main() {
      gl_Position = worldViewProjection * vec4(position, 1.0);
      vUV = uv;
    }`;
const SPRITE_FS = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D diffuseSampler;
    uniform vec4 uColor;
    uniform float meshAlpha;
    void main() {
      vec4 tex = texture2D(diffuseSampler, vUV);
      float a = clamp(tex.a * uColor.a * meshAlpha, 0.0, 1.0);
      if (a < 0.002) discard;
      gl_FragColor = vec4(uColor.rgb * tex.rgb, a);
    }`;

function makeSprite(scene: BABYLON.Scene, name: string, texture: BABYLON.Texture, blending?: FxBlending, color?: BABYLON.Color4): FxSpriteMesh {
  const mesh = BABYLON.MeshBuilder.CreatePlane('spr_' + name, { size: 1, updatable: false }, scene) as FxSpriteMesh;
  mesh.isPickable = false;
  const mat = new BABYLON.ShaderMaterial('sprMat_' + name, scene, { vertex: 'fxSprite', fragment: 'fxSprite' }, {
    attributes: ['position', 'uv'],
    uniforms: ['worldViewProjection', 'uColor', 'meshAlpha'],
    samplers: ['diffuseSampler'],
  });
  mat.setTexture('diffuseSampler', texture);
  mat.setColor4('uColor', color || new BABYLON.Color4(1, 1, 1, 1));
  mat.setFloat('meshAlpha', 1);
  mat.onBindObservable.add(() => mat.setFloat('meshAlpha', mesh.visibility));
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;
  mat.alphaMode = blending === 'add' ? BABYLON.Constants.ALPHA_ADD : BABYLON.Constants.ALPHA_COMBINE;
  mat.needAlphaBlending = () => true;
  mesh.material = mat;
  mesh._spriteMat = mat;
  return mesh;
}

/* ------------------------------ 发射器 ------------------------------ */
const DEFAULT_EMIT: ResolvedEmitCfg = {
  rate: 0,
  life: [0.6, 1.2],
  size0: [0.5, 1.0],
  size1: [0.15, 0.4],
  alpha: [0.7, 1.0],
  color: [1, 1, 1],
  color2: null,
  speed: [1, 3],
  drag: 1.4,
  gravity: 0,
  turb: 1,
  envType: 1,
};

class Emitter {
  layer: PointLayer;
  cfg: ResolvedEmitCfg;
  _acc: number;
  alive: boolean;
  sizeMul: number;
  speedMul: number;
  tint: number;      /* >0 时按主色实时着色(编辑器改色即时生效) */
  tint2: number;

  /* 每个技能至少持有「主体层 + 细节层」两个 Emitter */
  constructor(layer: PointLayer, cfg?: EmitterCfg | null) {
    this.layer = layer;
    this.cfg = Object.assign({}, DEFAULT_EMIT, cfg || {});
    this._acc = 0;
    this.alive = true;
    this.sizeMul = 1;
    this.speedMul = 1;
    this.tint = 0;      /* >0 时按主色实时着色(编辑器改色即时生效) */
    this.tint2 = 0;
  }
  burst(n: number, x: number, y: number, z: number, velFn?: EmitVelFn): void {
    if (!this.alive) return;
    n = Math.min(160, Math.max(0, Math.floor(n)));
    const c = this.cfg;
    const j = c.jitter || 0;
    const sm = this.sizeMul, sp = this.speedMul;
    for (let k = 0; k < n; k++) {
      const px = x + randSpread(j), py = y + randSpread(j), pz = z + randSpread(j);
      const v = velFn ? velFn(k, n, { x: px, y: py, z: pz }) : { x: 0, y: 0, z: 0 };
      this.layer.add({
        x: px, y: py, z: pz,
        vx: v.x * sp, vy: v.y * sp, vz: v.z * sp,
        life: rand(c.life[0], c.life[1]),
        size0: rand(c.size0[0], c.size0[1]) * sm,
        size1: rand(c.size1[0], c.size1[1]) * sm,
        alpha: rand(c.alpha[0], c.alpha[1]),
        r: c.color[0], g: c.color[1], b: c.color[2],
        r2: c.color2 ? c.color2[0] : undefined,
        g2: c.color2 ? c.color2[1] : undefined,
        b2: c.color2 ? c.color2[2] : undefined,
        drag: c.drag, gravity: c.gravity, turb: c.turb,
        envType: c.envType,
      });
    }
  }
  /* 连续发射:n = 本次帧的粒子数预算(可为小数,内部累计) */
  stream(n: number, x: number, y: number, z: number, velFn?: EmitVelFn): void {
    this._acc += n;
    let guard = 96;
    while (this._acc >= 1 && guard-- > 0) {
      this._acc -= 1;
      this.burst(1, x, y, z, velFn);
    }
    if (this._acc > 8) this._acc = 8;
  }
}

/* ------------------------------ 全局 FX 注册表 ------------------------------ */
export const FX = {
  clamp, lerp, rand, randSpread, smoothstep, easeOutCubic, easeOutBack, hexToRgb, rgbToHex,
  turbField, makeTexture, makeSprite, PointLayer, Emitter,
  layers: {} as Record<string, PointLayer>,
  textures: {} as Record<string, BABYLON.DynamicTexture>,
  time: 0,
  init(scene: BABYLON.Scene) {
    /* 主体层(加色发光)+ 细节层(火花/碎屑)+ 烟雾层(普通混合) */
    this.textures.glow = makeTexture(scene, 'glow', 128, 'glow');
    this.textures.spark = makeTexture(scene, 'spark', 128, 'spark');
    this.textures.smoke = makeTexture(scene, 'smoke', 128, 'smoke');
    this.textures.debris = makeTexture(scene, 'debris', 64, 'debris');
    this.textures.ring = makeTexture(scene, 'ring', 256, 'ring');
    this.textures.softDisc = makeTexture(scene, 'softDisc', 256, 'softDisc');
    this.textures.slash = makeTexture(scene, 'slash', 256, 'slash');
    this.textures.beamGlow = makeTexture(scene, 'beamGlow', 128, 'beamGlow');
    this.textures.groundNoise = makeTexture(scene, 'groundNoise', 256, 'groundNoise');
    for (const name of ['rune', 'fracture', 'star', 'vortex', 'crystal'] as const) {
      this.textures[name] = makeTexture(scene, name, name === 'crystal' ? 128 : 512, name);
    }
    this.textures.blade = makeTexture(scene, 'blade', 512, 'blade');
    this.textures.spearBlade = makeTexture(scene, 'spearBlade', 512, 'spearBlade');
    this.textures.grandCircle = makeTexture(scene, 'grandCircle', 512, 'rune');

    /* 内联素材贴图(scripts/gen-textures.mjs 扫描 assets/*.png 注入 src/generated/textures.ts 的 TEX_PNG):
       无同名程序化版本时先建占位纹理,图像解码后原位改写同一张 DynamicTexture,
       ShaderMaterial 无需重建;加载失败或无素材时保持程序化回退。 */
    const inlineTex = TEX_PNG;
    /* 仅有素材时分配彩色草地；否则 core 继续使用中性 groundNoise × 主题色。 */
    delete this.textures.daylightGrass;
    if (inlineTex && inlineTex.daylightGrass) {
      this.textures.daylightGrass = makeTexture(scene, 'daylightGrass', 512, 'daylightGrass');
    }
    if (inlineTex) {
      for (const name in inlineTex) {
        if (!this.textures[name]) this.textures[name] = makeTexture(scene, name, 512, 'softDisc');
        const dyn = this.textures[name];
        const img = new Image();
        img.onload = () => {
          try {
            if (scene.isDisposed) return;
            const size = dyn.getSize().width;
            const ctx = dyn.getContext() as unknown as CanvasRenderingContext2D;
            ctx.clearRect(0, 0, size, size);
            ctx.drawImage(img, 0, 0, size, size);
            dyn.update(false);
            (dyn as BABYLON.DynamicTexture & { _aiLoaded?: boolean })._aiLoaded = true;
          } catch (e) { }
        };
        img.src = inlineTex[name];
      }
    }

    this.layers.glow = new PointLayer(scene, 'glow', 3000, this.textures.glow, 'add');
    this.layers.spark = new PointLayer(scene, 'spark', 2400, this.textures.spark, 'add');
    this.layers.smoke = new PointLayer(scene, 'smoke', 1100, this.textures.smoke, 'normal');
    this.layers.debris = new PointLayer(scene, 'debris', 700, this.textures.debris, 'normal');
    return this;
  },
  setPointScale(v: number) {
    for (const k in this.layers) this.layers[k].setPointScale(v);
  },
  update(dt: number) {
    /* 时钟唯一写入点是 game.update（主流水线），此处不再自增全局时间 */
    for (const k in this.layers) this.layers[k].update(dt, this.time);
  },
  aliveCount(): number {
    let n = 0;
    for (const k in this.layers) n += this.layers[k].count;
    return n;
  },
  clear() {
    for (const k in this.layers) { this.layers[k].count = 0; this.layers[k].upload(); }
  },
};

// 调试手柄：保留为控制台探针入口（参考 survivors 的 window.__game；core 层禁 window 由门禁强制）
if (typeof window !== 'undefined') {
  (window as unknown as { FX: typeof FX }).FX = FX;
}
