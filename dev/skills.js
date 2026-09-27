/* ============================================================================
   skills.js — 五阶法术 / 有界几何特效 / 独立施法快照
   结构升级而非粒子堆叠：术式 → 多重 → 法阵 → 领域 → 灾厄。
   所有几何及材质均归 ResourceOwner；共享 FX 贴图绝不随法术释放。
   ========================================================================== */
(function (global) {
  'use strict';
  const V3 = BABYLON.Vector3, C3 = BABYLON.Color3, C4 = BABYLON.Color4;
  const { clamp, lerp, rand, randSpread, easeOutCubic } = FX;
  const TAU = Math.PI * 2;
  let uid = 0;
  const nid = name => name + '_' + (++uid);
  const sat = n => clamp(n, 0, 1);
  const smooth = n => { n = sat(n); return n * n * (3 - 2 * n); };
  const positive = (n, fallback) => Number.isFinite(Number(n)) && Number(n) > 0 ? Number(n) : fallback;
  const levelOf = (n, fallback) => clamp(Math.round(positive(n, fallback)), 1, 5);
  const PHASES = ['windup', 'release', 'travel', 'impact', 'aftermath'];
  const PHASE_LABEL = { windup: '蓄力 · 术式展开', release: '释放 · 破封', travel: '展开 / 飞行', impact: '爆发 · 命中', aftermath: '余波 · 残留' };
  const LEVELS = [
    { level: 1, name: '初阶', description: '紧凑单体，清晰弹道与局部命中。' },
    { level: 2, name: '进阶', description: '多重主体、分支与有节奏的二次冲击。' },
    { level: 3, name: '高阶', description: '旋转法阵、轨道结构与独立余波。' },
    { level: 4, name: '领域', description: '大型几何覆盖战场，领域持续作用。' },
    { level: 5, name: '灾厄', description: '长蓄力、独特天灾主体与持久地裂。' },
  ];
  // 有效参数 = 旧字段 × 当前等级编辑倍率 × 固定等级倍率。
  // count 只调细节密度；主体数量另设上限，绝不随滑块无界生成。
  const LEVEL_SCALE = [null,
    { count: 0.60, size: 0.66, speed: 1.12, period: 0.78, range: 0.68, radius: 0.78, windup: 0.52, cooldown: 0.78 },
    { count: 0.82, size: 0.83, speed: 1.06, period: 0.88, range: 0.84, radius: 0.90, windup: 0.76, cooldown: 0.90 },
    { count: 1.00, size: 1.00, speed: 1.00, period: 1.00, range: 1.00, radius: 1.00, windup: 1.00, cooldown: 1.00 },
    { count: 1.18, size: 1.25, speed: 0.96, period: 1.10, range: 1.12, radius: 1.26, windup: 1.48, cooldown: 1.35 },
    { count: 1.38, size: 1.58, speed: 0.92, period: 1.20, range: 1.25, radius: 1.60, windup: 2.10, cooldown: 1.80 },
  ];
  const DEFS = [
    { id: 1, name: '寒霜之矛', ultimateName: '冰枪风暴', form: '抛射物', hotkey: '1', color: '#79d2ff', range: 30, radius: 3.5, windup: 0.58, cooldown: 0.95, groundTarget: false },
    { id: 2, name: '雷霆之矛', ultimateName: '雷神审判', form: '锯齿射线', hotkey: '2', color: '#c9a6ff', range: 32, radius: 3.6, windup: 0.65, cooldown: 1.10, groundTarget: false },
    { id: 3, name: '陨火天降', ultimateName: '末日陨星', form: '天降 AOE', hotkey: '3', color: '#ff9440', range: 34, radius: 4.4, windup: 0.76, cooldown: 1.65, groundTarget: true },
    { id: 4, name: '星光束', ultimateName: '天穹轨道炮', form: '贯穿光束', hotkey: '4', color: '#8fe0ff', range: 40, radius: 3.7, windup: 0.67, cooldown: 1.30, groundTarget: false },
    { id: 5, name: '伏特禁城', ultimateName: '雷狱', form: '持续领域', hotkey: '5', color: '#7b6bff', range: 26, radius: 5.2, windup: 0.65, cooldown: 1.80, groundTarget: true },
    { id: 6, name: '冰川王冠', ultimateName: '冰川纪元', form: '自身增益', hotkey: '6', color: '#7ff0e6', range: 18, radius: 4.5, windup: 0.66, cooldown: 1.80, groundTarget: true },
    { id: 7, name: '疾风裂空', ultimateName: '龙卷裂隙', form: '位移', hotkey: '7', color: '#86ffd0', range: 15, radius: 3.8, windup: 0.46, cooldown: 1.25, groundTarget: false },
    { id: 8, name: '岩牙突刺', ultimateName: '群山崩塌', form: '直线近战', hotkey: '8', color: '#e0a86a', range: 12, radius: 3.9, windup: 0.58, cooldown: 1.15, groundTarget: false },
    { id: 9, name: '王之财宝', ultimateName: '天地乖离', form: '剑雨投射', hotkey: '9', color: '#ffcf6b', range: 36, radius: 4.2, windup: 0.64, cooldown: 1.35, groundTarget: false },
  ];

  function profile(game, id, requestedLevel) {
    const def = DEFS.find(d => d.id === Number(id));
    if (!def) return null;
    const raw = game && game.params && game.params.skills && game.params.skills[def.id] || {};
    const level = levelOf(requestedLevel === undefined ? raw.level : requestedLevel, def.id === 3 ? 5 : 3);
    const tier = raw.tiers && raw.tiers[level] || {};
    const scale = LEVEL_SCALE[level];
    const mul = key => positive(raw[key], 1) * positive(tier[key], 1) * scale[key];
    const period = mul('period');
    const windup = Math.max(0.16, def.windup * scale.windup * period);
    const color = typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : def.color;
    const size = mul('size');
    return {
      level, levelName: LEVELS[level - 1].name, name: def.name, ultimateName: def.ultimateName,
      color, count: mul('count'), speed: mul('speed'), size, period,
      range: def.range * scale.range, radius: def.radius * size * scale.radius,
      windup, cooldown: Math.max(windup + 0.18, def.cooldown * scale.cooldown * period),
    };
  }

  function texture(name, fallback) {
    return FX.textures[name] || FX.textures[fallback || 'ring'] || FX.textures.softDisc || FX.textures.glow;
  }
  function aimNode(node, dir) {
    node.rotation.x = -Math.asin(clamp(dir.y, -1, 1));
    node.rotation.y = Math.atan2(dir.x, dir.z);
  }
  function radialVel(speed, up) {
    return () => {
      const a = rand(0, TAU), v = rand(0.45, 1) * speed;
      return { x: Math.cos(a) * v, y: rand(-0.2, 0.7) * speed + (up || 0), z: Math.sin(a) * v };
    };
  }
  function positionAt(center, radius, angle, height) {
    return new V3(center.x + Math.cos(angle) * radius, height, center.z + Math.sin(angle) * radius);
  }
  function fadeGroup(group, alpha) {
    const a = sat(alpha);
    if (group._fxMeshes) for (const mesh of group._fxMeshes) mesh.visibility = a;
    else group.visibility = a;
  }

  /* 每一个对象明确拥有节点和材质，子节点不会漏材质，共用材质只释放一次。 */
  class ResourceOwner {
    constructor(game, rgb) {
      this.game = game; this.scene = game.scene; this.rgb = rgb;
      this.nodes = []; this.materials = new Set(); this.tinted = []; this.emitters = [];
      this.disposed = false;
    }
    own(node, parent) {
      this.nodes.push(node);
      if ('isPickable' in node) node.isPickable = false;
      if (parent) node.parent = parent;
      if (node.material) {
        this.materials.add(node.material);
        for (let p = parent; p; p = p.parent) if (p._fxMeshes) p._fxMeshes.push(node);
      }
      return node;
    }
    group(name, parent) {
      const node = new BABYLON.TransformNode(nid(name), this.scene);
      node._fxMeshes = [];
      return this.own(node, parent);
    }
    mat(name, glow, alpha, solid) {
      const mat = new BABYLON.StandardMaterial(nid(name), this.scene);
      mat.diffuseColor = new C3(0, 0, 0);
      mat.emissiveColor = new C3(0, 0, 0);
      mat.specularColor = new C3(solid ? 0.22 : 0, solid ? 0.25 : 0, solid ? 0.3 : 0);
      mat.specularPower = solid ? 52 : 12;
      mat.disableLighting = !solid;
      mat.backFaceCulling = false;
      mat.alpha = alpha === undefined ? 1 : alpha;
      if (mat.alpha < 1) {
        mat.alphaMode = BABYLON.Constants.ALPHA_ADD;
        mat.disableDepthWrite = true;
      }
      this.materials.add(mat);
      this.tinted.push({ mat, glow, solid: !!solid });
      this.tintMaterials();
      return mat;
    }
    mesh(type, opts, mat, parent, name) {
      const mesh = BABYLON.MeshBuilder['Create' + type](nid(name || type), opts, this.scene);
      mesh.material = mat;
      return this.own(mesh, parent);
    }
    sprite(name, tex, parent, ground, blending) {
      const mesh = FX.makeSprite(this.scene, nid(name), texture(tex), blending || 'add', new C4(1, 1, 1, 0));
      if (ground) mesh.rotation.x = Math.PI / 2;
      return this.own(mesh, parent);
    }
    spriteColor(mesh, alpha, intensity) {
      const k = intensity === undefined ? 1 : intensity;
      if (!mesh._fxColor) mesh._fxColor = new C4(0, 0, 0, 0);
      const c = mesh._fxColor;
      c.r = this.rgb[0] * k; c.g = this.rgb[1] * k; c.b = this.rgb[2] * k; c.a = sat(alpha);
      mesh._spriteMat.setColor4('uColor', c);
    }
    tintMaterials() {
      for (const rec of this.tinted) {
        rec.mat.emissiveColor.set(this.rgb[0] * rec.glow, this.rgb[1] * rec.glow, this.rgb[2] * rec.glow);
        if (rec.solid) rec.mat.diffuseColor.set(this.rgb[0] * 0.45, this.rgb[1] * 0.45, this.rgb[2] * 0.45);
      }
    }
    emitter(layer, cfg, tint, tint2) {
      const e = new FX.Emitter(FX.layers[layer] || FX.layers.glow, cfg);
      e.tint = tint || 0; e.tint2 = tint2 || 0;
      this.emitters.push(e);
      return e;
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      for (const e of this.emitters) { e.alive = false; e._acc = 0; }
      this.emitters.length = 0;
      // doNotRecurse=true：所有子节点在本表内，禁止隐式重复销毁。
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const node = this.nodes[i];
        if (!node.isDisposed || !node.isDisposed()) node.dispose(true, false);
      }
      for (const mat of this.materials) mat.dispose(false, false);
      this.nodes.length = 0; this.materials.clear(); this.tinted.length = 0;
    }
  }

  /* 稀疏分层法阵：留出负空间，不铺满高亮白色圆盘。 */
  class Rune {
    constructor(owner, center, level, tex) {
      this.owner = owner; this.root = owner.group('ritual'); this.root.position.copyFrom(center);
      this.rings = [];
      const count = level < 3 ? 1 : level === 3 ? 2 : level === 4 ? 3 : 4;
      for (let i = 0; i < count; i++) {
        const mesh = owner.sprite('runeLayer', i === 0 ? 'ring' : (tex || 'rune'), this.root, true);
        const r = 1 - i * 0.20;
        mesh.scaling.set(r * 2, r * 2, 1);
        mesh.position.y = 0.045 + i * 0.055;
        this.rings.push({ mesh, spin: (i % 2 ? -1 : 1) * (0.17 + i * 0.11), alpha: i ? 0.47 : 0.66 });
      }
      this.root.setEnabled(false);
    }
    update(time, radius, alpha, center) {
      this.root.setEnabled(alpha > 0.002);
      if (center) this.root.position.copyFrom(center);
      this.root.scaling.set(radius, 1, radius);
      for (const r of this.rings) {
        r.mesh.rotation.z = time * r.spin;
        this.owner.spriteColor(r.mesh, alpha * r.alpha, 0.95);
      }
    }
  }

  /* 固定点数、固定 tube，更新 instance；无全零初始路径，无每帧创建网格。 */
  class Arc {
    constructor(owner, mat, radius, parent, points) {
      this.owner = owner; this.phase = rand(0, TAU); this.clock = 1;
      this.path = Array.from({ length: points || 16 }, (_, i) => new V3(0, i * 0.05, 0));
      this.mesh = owner.mesh('Tube', { path: this.path, radius, tessellation: 5, updatable: true, cap: BABYLON.Mesh.NO_CAP }, mat, parent, 'arc');
      this.mesh.setEnabled(false);
    }
    update(dt, from, to, time, amp, bow) {
      this.mesh.setEnabled(true);
      this.clock += dt;
      if (this.clock < 0.045) return;
      this.clock = 0;
      const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
      const len = Math.max(0.001, Math.hypot(dx, dy, dz));
      const nx = dx / len, ny = dy / len, nz = dz / len;
      const h = Math.hypot(nx, nz);
      const ux = h < 0.001 ? 1 : nz / h, uz = h < 0.001 ? 0 : -nx / h;
      const vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux;
      const tick = Math.floor(time * 22);
      for (let i = 0; i < this.path.length; i++) {
        const t = i / (this.path.length - 1), env = Math.sin(t * Math.PI);
        const j = Math.sin(i * 31.7 + tick * 19.3 + this.phase) * amp * env;
        const k = Math.cos(i * 17.9 - tick * 12.7 + this.phase) * amp * env * 0.6;
        this.path[i].set(from.x + dx * t + ux * j + vx * k,
          from.y + dy * t + vy * k + env * (bow || 0),
          from.z + dz * t + uz * j + vz * k);
      }
      BABYLON.MeshBuilder.CreateTube(null, { path: this.path, instance: this.mesh }, this.owner.scene);
    }
    hide() { this.mesh.setEnabled(false); }
  }

  class Shockwave extends ResourceOwner {
    constructor(game, pos, rgb, radius, duration, opts) {
      super(game, rgb); opts = opts || {};
      this.radius = radius; this.duration = Math.max(0.1, duration); this.t = 0; this.done = false;
      this.alpha = opts.alpha === undefined ? 0.7 : opts.alpha;
      this.mesh = this.sprite('shockwave', opts.tex || 'ring', null, true);
      this.mesh.position.set(pos.x, opts.y === undefined ? 0.09 : opts.y, pos.z);
      this.mesh.scaling.set(0.01, 0.01, 1);
    }
    update(dt) {
      this.t += dt;
      const u = sat(this.t / this.duration);
      const diameter = 2 * this.radius * (0.12 + 0.88 * easeOutCubic(u));
      // CreatePlane 的局部平面是 XY；旋到地面后仍然必须缩放 X/Y，不能 X/Z。
      this.mesh.scaling.set(diameter, diameter, 1);
      this.spriteColor(this.mesh, this.alpha * Math.pow(1 - u, 1.4), 1.15);
      this.done = u >= 1;
    }
  }

  /* 黑色焦痕 + 分叉实体地裂 + 少量悬浮碎片；在法术结束后独立渐隐。 */
  class Residue extends ResourceOwner {
    constructor(cast, kind, duration) {
      super(cast.game, cast.rgb.slice());
      this.t = 0; this.duration = duration; this.done = false;
      this.center = cast.target.clone(); this.radius = cast.p.radius;
      this.root = this.group('residue'); this.root.position.copyFrom(this.center);
      this.root.position.y = 0.035;
      const dark = this.sprite('scarShadow', 'softDisc', this.root, true, 'normal');
      dark.scaling.set(this.radius * 1.95, this.radius * 1.95, 1);
      dark._spriteMat.setColor4('uColor', new C4(0.012, 0.016, 0.024, kind === 'ice' ? 0.22 : 0.65));
      this.dark = dark;
      const KIND_TEX = { fire: 'meteorScar', ice: 'iceScar', electric: 'voltScar', earth: 'earthScar', gold: 'goldScar' };
      const aiKey = KIND_TEX[kind] || null;
      const markTex = kind === 'wind' ? 'vortex' : kind === 'star' ? 'star'
        : (aiKey && FX.textures[aiKey] ? aiKey : 'fracture');
      this.markTex = markTex;
      /* AI 贴图(白光+alpha,中低调为主)比程序化裂纹笔画淡,按贴图来源定强度 */
      this.markBoost = markTex !== 'fracture' && markTex !== 'vortex' && markTex !== 'star' ? 0.70 : 0.36;
      this.mark = this.sprite('fracturePrint', markTex, this.root, true);
      this.mark.position.y = 0.025;
      this.mark.scaling.set(this.radius * 1.8, this.radius * 1.8, 1);
      this.edge = this.mat('fractureEdge', 0.76, 0.80);
      this.bits = [];
      const n = cast.level < 3 ? 3 : cast.level === 5 ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + 0.12, path = [];
        for (let j = 0; j < 6; j++) {
          const r = (j / 5) * this.radius * (0.75 + (i % 3) * 0.1);
          const aa = a + Math.sin(j * 6.3 + i * 3.4) * 0.13;
          path.push(new V3(Math.cos(aa) * r, 0.04 + j * 0.001, Math.sin(aa) * r));
        }
        this.mesh('Tube', { path, radius: cast.level >= 4 ? 0.044 : 0.027, tessellation: 4 }, this.edge, this.root, 'groundCrack');
        if (cast.level >= 3) {
          const branch = [path[2].clone(), path[3].add(new V3(Math.cos(a + 1) * this.radius * 0.15, 0, Math.sin(a + 1) * this.radius * 0.15)),
            path[4].add(new V3(Math.cos(a + 0.7) * this.radius * 0.22, 0, Math.sin(a + 0.7) * this.radius * 0.22))];
          this.mesh('Tube', { path: branch, radius: 0.021, tessellation: 4 }, this.edge, this.root, 'crackBranch');
        }
      }
    }
    update(dt) {
      this.t += dt;
      const u = sat(this.t / this.duration), alpha = 1 - smooth((u - 0.20) / 0.80);
      fadeGroup(this.root, alpha);
      this.spriteColor(this.mark, alpha * (this.markBoost || 0.36) * (0.9 + 0.1 * Math.sin(this.t * 8)), 0.75);
      this.done = u >= 1;
    }
  }

  /* 五段生命周期。等级和计时在 start 锁定；同级颜色/密度/尺寸/速度实时刷新。 */
  class Cast extends ResourceOwner {
    constructor(game, def, aim, p) {
      super(game, FX.hexToRgb(p.color));
      this.def = def; this.level = p.level; this.p = p; this.startedProfile = Object.assign({}, p);
      this.phase = 'windup'; this.phaseT = 0; this.total = 0; this.finished = false;
      this.windupDur = p.windup; this.cooldown = p.cooldown;
      this.releaseDur = (0.10 + this.level * 0.02) * p.period;
      this.impactDur = (0.24 + this.level * 0.105) * p.period;
      this.aftermathDur = (0.75 + this.level * 0.34) * p.period;
      this.travelDuration = 1; this.flight = 0; this.lift = 0; this.kick = 0;
      const mp = game.mage.root.position;
      this.startGround = new V3(mp.x, 0, mp.z);
      this.dir = new V3(aim.x - mp.x, 0, aim.z - mp.z);
      const dist = this.dir.length();
      if (dist < 0.05) this.dir.set(Math.sin(game.mage.facing || 0), 0, Math.cos(game.mage.facing || 0));
      this.dir.normalize();
      this.aimDist = Math.min(p.range, dist < 0.05 ? Math.min(5, p.range) : dist);
      this.target = this.startGround.add(this.dir.scale(this.aimDist));
      this.side = new V3(this.dir.z, 0, -this.dir.x);
      this.origin = game.mage.worldHand ? game.mage.worldHand().clone() : new V3(mp.x, 1.8, mp.z);
      this.focus = this.target.clone();
      this.stone = this.mat('darkSurface', 0.10, 1, true);
      this.body = this.mat('facetedBody', 0.34, 1, true);
      this.core = this.mat('luminousEdge', 1.35, 1);
      this.edge = this.mat('haloEdge', 1.00, 0.72);
      this.veil = this.mat('thinVeil', 0.75, 0.16);
      this.casterRune = new Rune(this, this.startGround, this.level, 'rune');
      this.targetRune = new Rune(this, this.target, this.level, def.id === 6 || def.id === 1 ? 'star' : 'rune');
      this.orb = this.sprite('handCharge', 'star');
      this.orb.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
      this.orb.scaling.set(0.01, 0.01, 1);
      this.main = this.emitter('glow', {
        life: [0.35, 0.85], size0: [0.18, 0.46], size1: [0.04, 0.13], alpha: [0.35, 0.70],
        drag: 1.7, turb: 1.0, jitter: 0.28,
      }, 1.1, 0.38);
      this.detail = this.emitter('spark', {
        life: [0.24, 0.68], size0: [0.07, 0.15], size1: [0.012, 0.04], alpha: [0.55, 0.90],
        drag: 1.8, turb: 0.6, gravity: 2.0,
      }, 1.5, 0.7);
      this.smoke = this.emitter('smoke', {
        life: [0.8, 1.65], size0: [0.5, 0.9], size1: [1.6, 2.9], alpha: [0.07, 0.16],
        color: [0.13, 0.16, 0.20], color2: [0.05, 0.07, 0.10], drag: 1.0, turb: 0.65,
      });
      this.sync();
    }
    init() { this.buildSpell(); this.notify(); }
    notify() {
      if (SKILLS.poseOwner(this.game) === this && this.game.onPhase) {
        this.game.onPhase(PHASE_LABEL[this.phase], this.level === 5 ? this.def.ultimateName : this.def.name + ' · ' + this.p.levelName);
      }
    }
    sync() {
      this.p = profile(this.game, this.def.id, this.level);
      this.rgb = FX.hexToRgb(this.p.color);
      this.tintMaterials();
      for (const e of this.emitters) {
        if (e.tint) e.cfg.color = this.rgb.map(c => c * e.tint);
        if (e.tint2) e.cfg.color2 = this.rgb.map(c => c * e.tint2);
        e.sizeMul = Math.min(3, this.p.size); e.speedMul = Math.min(5, this.p.speed);
      }
    }
    emit(e, amount, pos, velocity, burst) {
      if (!e || this.disposed) return;
      const wanted = Math.max(0, amount * Math.min(6, this.p.count));
      const n = Math.min(wanted, SKILLS._particlesLeft, burst ? 72 : 32);
      if (n <= 0) return;
      SKILLS._particlesLeft -= Math.ceil(n);
      if (burst) e.burst(Math.floor(n), pos.x, pos.y, pos.z, velocity);
      else e.stream(n, pos.x, pos.y, pos.z, velocity);
    }
    shock(radius, duration, alpha, y) {
      SKILLS.addTransient(new Shockwave(this.game, this.target, this.rgb.slice(), radius, duration, { alpha, y }));
    }
    residue(kind) {
      SKILLS.addTransient(new Residue(this, kind, this.aftermathDur + 1.2 + this.level * 0.18));
    }
    phaseProgress() {
      const duration = this.phase === 'windup' ? this.windupDur : this.phase === 'release' ? this.releaseDur :
        this.phase === 'travel' ? this.travelDuration : this.phase === 'impact' ? this.impactDur : this.aftermathDur;
      return sat(this.phaseT / Math.max(0.01, duration));
    }
    update(dt) {
      if (this.finished || this.disposed) return;
      this.sync();
      this.total += dt; this.phaseT += dt; this.kick *= Math.exp(-dt * 6.5);
      const done = this[this.phase](dt);
      this.updateRituals();
      if (done) this.advance();
    }
    updateRituals() {
      const windup = this.phase === 'windup';
      const k = windup ? smooth(this.phaseT / this.windupDur) : 1;
      const tail = this.phase === 'aftermath' ? 1 - this.phaseProgress() : 1;
      const casterAlpha = windup ? 0.2 + 0.75 * k : this.phase === 'release' ? 1 - this.phaseProgress() : 0;
      this.casterRune.update(this.total, (0.8 + this.level * 0.26) * Math.sqrt(this.p.size), casterAlpha, this.startGround);
      this.targetRune.update(this.total, this.p.radius, (windup ? 0.13 + k * 0.50 : 0.48) * tail, this.target);
      if (windup) {
        const hand = this.game.mage.worldHand ? this.game.mage.worldHand() : this.origin;
        this.origin.copyFrom(hand); this.orb.position.copyFrom(hand);
        const s = (0.3 + 0.75 * k) * Math.sqrt(this.p.size);
        this.orb.scaling.set(s, s, 1); this.orb.rotation.z = this.total * 2.8;
        this.spriteColor(this.orb, 0.30 + 0.35 * k, 1.1);
      } else this.spriteColor(this.orb, this.phase === 'release' ? 0.5 * (1 - this.phaseProgress()) : 0, 1.2);
    }
    windup(dt) {
      const k = smooth(this.phaseT / this.windupDur);
      this.emit(this.main, dt * (10 + 12 * k), this.origin, () => ({ x: randSpread(0.5), y: rand(0.2, 0.9), z: randSpread(0.5) }));
      this.lift = this.level === 5 ? k * 0.35 : 0;
      if (this.preview) this.preview(dt, k);
      return this.phaseT >= this.windupDur;
    }
    release(dt) {
      if (this.releaseSpell) this.releaseSpell(dt, this.phaseProgress());
      return this.phaseT >= this.releaseDur;
    }
    impact(dt) {
      const k = this.phaseProgress();
      if (this.impactSpell) this.impactSpell(dt, k);
      this.lift *= Math.exp(-dt * 7);
      return k >= 1;
    }
    aftermath(dt) {
      const k = this.phaseProgress();
      if (this.aftermathSpell) this.aftermathSpell(dt, k);
      this.lift *= Math.exp(-dt * 9);
      return k >= 1;
    }
    advance() {
      const next = PHASES.indexOf(this.phase) + 1;
      if (next >= PHASES.length) { this.finished = true; return; }
      this.phase = PHASES[next]; this.phaseT = 0;
      if (this.phase === 'release') {
        if (this.game.mage.worldHand) this.origin.copyFrom(this.game.mage.worldHand());
        this.emit(this.detail, 8 + this.level * 2, this.origin, radialVel(2, 0.8), true);
        if (this.onRelease) this.onRelease();
      }
      if (this.phase === 'impact') {
        this.kick = 0.08 + this.level * 0.13;
        this.shock(this.p.radius, 0.45 + this.level * 0.10, 0.55);
        if (this.level >= 4) this.shock(this.p.radius * 0.72, 1.05, 0.35, 0.15);
        this.emit(this.main, 12 + this.level * 3, this.target, radialVel(2 + this.level, 2), true);
        this.emit(this.detail, 18 + this.level * 4, this.target, radialVel(4 + this.level, 3), true);
        if (this.onImpact) this.onImpact();
      }
      if (this.phase === 'aftermath' && this.onAftermath) this.onAftermath();
      this.notify();
    }
    dispose() {
      this.finished = true;
      super.dispose();
      // 姿态与镜头只由 SKILLS.update 统一写入；旧技能销毁绝不打断新动作。
    }
  }

  function spear(owner, parent, length) {
    const root = owner.group('iceLance', parent);
    const blade = owner.mesh('Cylinder', { height: length * 0.48, diameterTop: 0, diameterBottom: length * 0.14, tessellation: 4 }, owner.body, root);
    blade.rotation.x = Math.PI / 2; blade.position.z = length * 0.33;
    const shaft = owner.mesh('Cylinder', { height: length * 0.68, diameter: length * 0.035, tessellation: 6 }, owner.core, root);
    shaft.rotation.x = Math.PI / 2;
    const fins = owner.mesh('Box', { width: length * 0.27, height: length * 0.026, depth: length * 0.22 }, owner.edge, root);
    fins.position.z = -length * 0.22;
    return root;
  }

  /* 宝具剪影精灵:剑/枪贴图沿 +y 铺开(剑尖朝纹理顶),rollTo 让剑尖指向飞行方向且正面朝相机。 */
  function weaponSprite(owner, tex, length) {
    const mesh = owner.sprite('weaponBlade', tex, null);
    mesh.scaling.set(length * 0.34, -length, 1);
    return mesh;
  }

  /* 轴向公告板:+y 对准 dir,法线取相机方向在垂直于 dir 平面上的投影。 */
  function rollTo(mesh, dir, camPos) {
    const y = dir.normalize();
    const toCam = camPos.subtract(mesh.position);
    const d = toCam.x * y.x + toCam.y * y.y + toCam.z * y.z;
    toCam.x -= y.x * d; toCam.y -= y.y * d; toCam.z -= y.z * d;
    if (toCam.lengthSquared() < 1e-8) toCam.set(y.z || 1, 0, -y.x);
    toCam.normalize();
    const x = V3.Cross(y, toCam);
    mesh.rotationQuaternion = BABYLON.Quaternion.FromRotationMatrix(
      BABYLON.Matrix.FromValues(x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, toCam.x, toCam.y, toCam.z, 0, 0, 0, 0, 1));
  }

  /* 宝库门扉:波纹贴图 + 边框环,平面法线沿 +z;root 由 aimNode 指向射向。 */
  function gateNode(owner) {
    const root = owner.group('treasureGate');
    const ripple = owner.sprite('gateRipple', 'gate', root);
    ripple.scaling.set(2.6, 2.6, 1);
    const rim = owner.mesh('Torus', { diameter: 2.75, thickness: 0.075, tessellation: 28 }, owner.edge, root);
    rim.rotation.x = Math.PI / 2;
    return { root, ripple, rim };
  }

  /* 1 · 冰枪风暴：单矛 → 三矛 → 环绕矛 → 冰枪领域 → 空中枪阵轮番钉地。 */
  class FrostSpearCast extends Cast {
    buildSpell() {
      this.lances = [];
      const n = [1, 3, 5, 9, 13][this.level - 1];
      this.armory = this.group('frostArmory');
      for (let i = 0; i < n; i++) {
        const mesh = spear(this, this.armory, i === 0 && this.level === 5 ? 4.5 : 2.6);
        this.lances.push({ mesh, a: i * TAU / Math.max(1, n - 1), start: new V3(), end: new V3(), heading: new V3() });
      }
      this.iceBed = this.group('iceImpactCrown'); this.iceBed.position.copyFrom(this.target); this.iceBed.setEnabled(false);
      this.crystals = [];
      const count = [3, 5, 8, 12, 18][this.level - 1];
      for (let i = 0; i < count; i++) {
        const a = i / count * TAU;
        const mesh = this.mesh('Cylinder', { height: 1, diameterTop: 0, diameterBottom: 0.42, tessellation: 4 }, i % 3 ? this.body : this.edge, this.iceBed);
        this.crystals.push({ mesh, a, h: 1.2 + (i % 4) * 0.5 });
      }
      if (this.level >= 3) {
        this.skySeal = new Rune(this, this.target.add(new V3(0, 7.5, 0)), this.level, 'star');
      }
      this.travelDuration = Math.max(0.45, this.aimDist / 23) + (this.level >= 4 ? 0.65 : 0);
      this.preview(0, 0);
    }
    preview(dt, k) {
      for (let i = 0; i < this.lances.length; i++) {
        const rec = this.lances[i], a = rec.a + this.total * 0.5;
        if (this.level >= 4) {
          const r = i === 0 ? 0 : this.p.radius * 0.68;
          rec.mesh.position.set(this.target.x + Math.cos(a) * r, 7 + (i % 3) * 0.9 + this.level * 0.5, this.target.z + Math.sin(a) * r);
          rec.heading.set(0, -1, 0); aimNode(rec.mesh, rec.heading);
        } else {
          const r = i === 0 ? 0 : 0.7 + this.level * 0.18;
          rec.mesh.position.copyFrom(this.origin).addInPlace(new V3(this.side.x * Math.cos(a) * r, Math.sin(a) * r, this.side.z * Math.cos(a) * r));
          aimNode(rec.mesh, this.dir);
        }
        rec.mesh.scaling.setAll(this.p.size * (0.18 + 0.82 * k));
        fadeGroup(rec.mesh, 0.15 + 0.70 * k);
      }
      if (this.skySeal) this.skySeal.update(this.total, this.p.radius * 0.8, k * 0.68);
    }
    onRelease() {
      for (let i = 0; i < this.lances.length; i++) {
        const rec = this.lances[i]; rec.start.copyFrom(rec.mesh.position);
        const r = i === 0 ? 0 : this.p.radius * (this.level >= 4 ? 0.72 : 0.22);
        rec.end.copyFrom(positionAt(this.target, r, rec.a, 0.8));
      }
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      for (let i = 0; i < this.lances.length; i++) {
        const rec = this.lances[i], delay = this.level >= 4 ? (i % 4) * 0.09 : i * 0.025;
        const u = sat((this.flight - delay) / (1 - delay)), k = u * u;
        V3.LerpToRef(rec.start, rec.end, k, rec.mesh.position);
        if (this.level < 4) rec.mesh.position.y += Math.sin(u * Math.PI) * (0.45 + this.level * 0.25);
        rec.end.subtractToRef(rec.start, rec.heading); rec.heading.normalize(); aimNode(rec.mesh, rec.heading);
        rec.mesh.scaling.setAll(this.p.size); fadeGroup(rec.mesh, 1);
      }
      const at = this.lances[Math.floor(this.total * 17) % this.lances.length].mesh.position;
      this.emit(this.main, dt * 36, at, radialVel(0.9, 0.4));
      this.emit(this.detail, dt * 18, at, radialVel(1.7, 0.7));
      if (this.skySeal) this.skySeal.update(this.total, this.p.radius * 0.8, 0.60 * (1 - sat(this.flight)));
      return this.flight >= 1;
    }
    onImpact() { this.iceBed.setEnabled(true); this.residue('ice'); }
    impactSpell(dt, k) {
      for (let i = 0; i < this.crystals.length; i++) {
        const rec = this.crystals[i], grow = easeOutCubic(sat((k - (i % 3) * 0.06) * 2));
        const h = rec.h * this.p.size * grow;
        rec.mesh.position.set(Math.cos(rec.a) * this.p.radius * 0.65, h * 0.42, Math.sin(rec.a) * this.p.radius * 0.65);
        rec.mesh.scaling.set(this.p.size * grow, h, this.p.size * grow);
        rec.mesh.rotation.z = -Math.cos(rec.a) * 0.35; rec.mesh.rotation.x = Math.sin(rec.a) * 0.35;
      }
      this.emit(this.smoke, dt * 14, this.target, radialVel(1.5, 1.0));
    }
    aftermathSpell(dt, k) {
      fadeGroup(this.armory, 1 - smooth(k)); fadeGroup(this.iceBed, 1 - smooth((k - 0.25) / 0.75));
      this.iceBed.position.y = -k * this.p.size * 0.35;
      this.emit(this.detail, dt * 7 * (1 - k), this.target, radialVel(1.5, 0.7));
    }
  }

  /* 2 · 雷神审判：分支电矛与高空审判之剑，和电笼型雷狱保持不同剪影。 */
  class ThunderLanceCast extends Cast {
    buildSpell() {
      this.arcs = []; this.a = new V3(); this.b = new V3();
      const n = [1, 3, 5, 7, 9][this.level - 1];
      for (let i = 0; i < n; i++) this.arcs.push(new Arc(this, i ? this.edge : this.core, i ? 0.045 : 0.10 * this.p.size));
      this.judgment = this.group('judgmentSword'); this.judgment.position.copyFrom(this.target);
      this.judgment.setEnabled(this.level === 5);
      const blade = this.mesh('Cylinder', { height: 9, diameterTop: 1.25, diameterBottom: 0, tessellation: 4 }, this.body, this.judgment);
      blade.position.y = 4.5;
      const spine = this.mesh('Box', { width: 0.12, height: 7.9, depth: 0.14 }, this.core, this.judgment); spine.position.y = 5.0;
      const guard = this.mesh('Box', { width: 5.2, height: 0.24, depth: 0.48 }, this.core, this.judgment); guard.position.y = 9;
      const pommel = this.mesh('Cylinder', { height: 2.4, diameterTop: 0.2, diameterBottom: 0.4, tessellation: 6 }, this.body, this.judgment); pommel.position.y = 10.1;
      this.pillar = this.mesh('Cylinder', { height: 1, diameter: 1, tessellation: 10 }, this.veil);
      this.pillar.position.copyFrom(this.target); this.pillar.setEnabled(false);
      if (this.level >= 3) this.halo = new Rune(this, this.target.add(new V3(0, this.level === 5 ? 11 : 7, 0)), this.level, 'rune');
      this.travelDuration = (0.28 + this.level * 0.10) * this.p.period;
    }
    preview(dt, k) {
      if (this.halo) this.halo.update(-this.total, this.p.radius * 0.72, k * 0.65);
      if (this.level === 5) {
        this.judgment.position.y = 2.5 + (1 - k) * 1.8;
        this.judgment.rotation.y = this.total * 0.3;
        this.judgment.scaling.setAll(0.5 + 0.5 * k);
        fadeGroup(this.judgment, k * 0.55);
      }
    }
    onRelease() { this.pillar.setEnabled(true); this.pillar.scaling.set(0.01, 0.01, 0.01); }
    drawArcs(dt, amount) {
      for (let i = 0; i < this.arcs.length; i++) {
        const a = i / this.arcs.length * TAU + this.total * 0.15;
        if (this.level < 3) this.a.copyFrom(this.origin);
        else this.a.set(this.target.x + (i ? Math.cos(a) * this.p.radius * 0.65 : 0), this.level === 5 ? 12 : 7, this.target.z + (i ? Math.sin(a) * this.p.radius * 0.65 : 0));
        this.b.set(this.target.x + (i ? Math.cos(a + 0.6) * this.p.radius * 0.75 : 0), 0.12, this.target.z + (i ? Math.sin(a + 0.6) * this.p.radius * 0.75 : 0));
        this.arcs[i].update(dt, this.a, this.b, this.total + i, (0.2 + this.level * 0.12) * amount);
        this.arcs[i].mesh.visibility = amount * (i ? 0.8 : 1);
      }
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      this.drawArcs(dt, 0.75 + Math.sin(this.total * 36) * 0.18);
      if (this.level === 5) {
        this.judgment.position.y = lerp(2.5, 0.1, Math.pow(sat(this.flight), 2));
        this.judgment.scaling.setAll(1); fadeGroup(this.judgment, 1);
      }
      this.emit(this.detail, dt * 55, this.target, radialVel(4.5, 3));
      return this.flight >= 1;
    }
    onImpact() { this.residue('electric'); }
    impactSpell(dt, k) {
      this.drawArcs(dt, 1 - k * 0.65);
      const h = this.level === 5 ? 14 : 3 + this.level;
      this.pillar.position.y = h / 2;
      this.pillar.scaling.set((0.4 + Math.sin(k * Math.PI) * 0.65) * this.p.size, h, (0.4 + Math.sin(k * Math.PI) * 0.65) * this.p.size);
      this.pillar.visibility = (1 - k) * 0.75;
      if (this.halo) this.halo.update(this.total, this.p.radius * (0.72 + k * 0.22), 0.55 * (1 - k));
      if (this.level === 5) this.judgment.position.y = -0.2;
    }
    onAftermath() { for (const a of this.arcs) a.hide(); this.pillar.setEnabled(false); }
    aftermathSpell(dt, k) {
      fadeGroup(this.judgment, 1 - smooth(k));
      this.emit(this.detail, dt * 12 * (1 - k), this.target, radialVel(2.6, 1.3));
    }
  }

  /* 3 · 末日陨星：黑色岩壳、熔融环带、碎星卫星、冲击坑与翻起的岩板。 */
  class MeteorCast extends Cast {
    buildSpell() {
      this.meteor = this.group('apocalypseMeteor');
      this.rockRadius = [0.72, 0.90, 1.18, 1.62, 2.40][this.level - 1];
      const rock = this.mesh('Sphere', { diameter: 2, segments: 7 }, this.stone, this.meteor);
      rock.convertToFlatShadedMesh();
      for (let i = 0; i < (this.level >= 3 ? 4 : 2); i++) {
        const seam = this.mesh('Torus', { diameter: 1.94, thickness: 0.055 + i * 0.005, tessellation: 22 }, this.core, this.meteor);
        seam.rotation.set(0.4 + i * 0.68, i * 0.8, i * 0.42);
      }
      this.fragments = [];
      const n = [0, 2, 4, 6, 9][this.level - 1];
      for (let i = 0; i < n; i++) {
        const mesh = this.mesh('Sphere', { diameter: 1, segments: 5 }, i % 3 ? this.stone : this.body);
        mesh.convertToFlatShadedMesh(); this.fragments.push({ mesh, a: i / n * TAU });
      }
      this.skyStart = this.target.add(new V3(-2.5 - this.level * 0.35, 7.5 + this.level * 1.20, 2));
      this.meteor.position.copyFrom(this.skyStart);
      this.crater = this.group('impactCrater'); this.crater.position.copyFrom(this.target); this.crater.setEnabled(false);
      this.slabs = [];
      const slabs = [4, 6, 8, 12, 16][this.level - 1];
      for (let i = 0; i < slabs; i++) {
        const mesh = this.mesh('Box', { width: 1, height: 0.5, depth: 1.4 }, i % 4 === 0 ? this.body : this.stone, this.crater);
        this.slabs.push({ mesh, a: i / slabs * TAU, seed: 0.7 + (i % 4) * 0.16 });
      }
      this.blast = this.mesh('Sphere', { diameter: 2, segments: 16, slice: 0.5 }, this.veil);
      this.blast.position.copyFrom(this.target); this.blast.setEnabled(false);
      this.travelDuration = (0.75 + this.level * 0.23) * this.p.period;
      this.preview(0, 0);
    }
    preview(dt, k) {
      this.meteor.scaling.setAll(this.rockRadius * this.p.size * (0.24 + k * 0.76));
      this.meteor.rotation.x = this.total * 0.18; this.meteor.rotation.z = this.total * 0.15;
      fadeGroup(this.meteor, 0.18 + 0.7 * k);
      this.orbitFragments(k, true);
    }
    orbitFragments(k, preview) {
      const size = this.rockRadius * this.p.size;
      for (let i = 0; i < this.fragments.length; i++) {
        const f = this.fragments[i], a = f.a + this.total * 0.45;
        const r = size * (1.55 + (i % 2) * 0.3);
        f.mesh.position.set(this.meteor.position.x + Math.cos(a) * r,
          this.meteor.position.y + (preview ? Math.sin(a) * size * 0.45 : size + i * 0.28),
          this.meteor.position.z + Math.sin(a) * r);
        f.mesh.scaling.setAll(this.p.size * (0.24 + (i % 3) * 0.11) * (0.3 + k * 0.7));
        f.mesh.rotation.y = this.total + i; f.mesh.rotation.x = this.total * 0.7;
        f.mesh.visibility = preview ? 0.2 + 0.65 * k : 1;
      }
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      const k = Math.pow(sat(this.flight), 1.75);
      V3.LerpToRef(this.skyStart, this.target, k, this.meteor.position);
      this.meteor.position.y += this.rockRadius * this.p.size * 0.55 * k;
      this.meteor.scaling.setAll(this.rockRadius * this.p.size);
      this.meteor.rotation.x += dt * 0.75; this.meteor.rotation.z += dt * 0.53;
      fadeGroup(this.meteor, 1); this.orbitFragments(1, false);
      this.emit(this.main, dt * 45, this.meteor.position, radialVel(1.8, 2.2));
      this.emit(this.detail, dt * 34, this.meteor.position, radialVel(2.8, 4.3));
      this.emit(this.smoke, dt * 16, this.meteor.position, radialVel(0.8, 1.5));
      return this.flight >= 1;
    }
    onImpact() {
      this.meteor.setEnabled(false); for (const f of this.fragments) f.mesh.setEnabled(false);
      this.crater.setEnabled(true); this.blast.setEnabled(true); this.residue('fire');
    }
    impactSpell(dt, k) {
      for (const s of this.slabs) {
        const r = this.p.radius * (0.34 + 0.37 * easeOutCubic(k));
        const h = Math.sin(k * Math.PI) * this.p.size * (1.0 + s.seed);
        s.mesh.position.set(Math.cos(s.a) * r, 0.25 + h, Math.sin(s.a) * r);
        s.mesh.rotation.set(Math.cos(s.a) * 0.75 * k, -s.a, Math.sin(s.a) * 0.75 * k);
        s.mesh.scaling.set(this.p.size * s.seed, this.p.size * s.seed, this.p.size * s.seed);
      }
      const r = this.p.radius * (0.16 + 0.84 * easeOutCubic(k));
      this.blast.scaling.set(r, r * 0.28, r); this.blast.visibility = Math.pow(1 - k, 2) * 0.7;
      this.emit(this.smoke, dt * 24, this.target, radialVel(2.5, 2.2));
      this.emit(this.main, dt * 30 * (1 - k), this.target, radialVel(3, 4));
    }
    onAftermath() { this.blast.setEnabled(false); }
    aftermathSpell(dt, k) {
      fadeGroup(this.crater, 1 - smooth((k - 0.45) / 0.55));
      this.crater.position.y = -Math.pow(k, 2) * this.p.size * 0.5;
      const a = this.total * 2.3, at = positionAt(this.target, this.p.radius * 0.32, a, 0.2);
      this.emit(this.main, dt * 16 * (1 - k), at, radialVel(0.6, 1.7));
      this.emit(this.smoke, dt * 13 * (1 - k), at, radialVel(0.5, 2.0));
      this.emit(this.detail, dt * 12 * (1 - k), at, radialVel(1.4, 2.0));
    }
  }

  function stretchBeam(mesh, from, to, width) {
    const d = to.subtract(from), length = Math.max(0.01, d.length());
    d.scaleInPlace(1 / length);
    mesh.position.copyFrom(from).addInPlace(to).scaleInPlace(0.5);
    mesh.scaling.set(width, length, width);
    const axis = V3.Cross(V3.Up(), d);
    mesh.rotationQuaternion = axis.lengthSquared() < 0.00001 ? BABYLON.Quaternion.RotationAxis(V3.Right(), d.y < 0 ? Math.PI : 0) :
      BABYLON.Quaternion.RotationAxis(axis.normalize(), Math.acos(clamp(d.y, -1, 1)));
  }

  /* 4 · 天穹轨道炮：多层准直器锁定，星核收束后贯穿地表。 */
  class StarBeamCast extends Cast {
    buildSpell() {
      this.cannon = this.group('orbitalCannon');
      this.rings = [];
      const n = this.level + 1;
      for (let i = 0; i < n; i++) {
        const ring = this.mesh('Torus', { diameter: 2.3 + (i % 2) * 1.0, thickness: 0.045, tessellation: 48 }, this.edge, this.cannon);
        ring.position.y = (i - n / 2) * 0.7;
        this.rings.push(ring);
      }
      this.star = this.mesh('Polyhedron', { type: 1, size: 0.6 }, this.core, this.cannon);
      this.beams = [];
      for (let i = 0; i < (this.level === 5 ? 5 : 2); i++) {
        const beam = this.mesh('Cylinder', { diameter: 1, height: 1, tessellation: 16 }, i ? this.veil : this.core);
        beam.setEnabled(false); this.beams.push(beam);
      }
      this.crown = new Rune(this, this.target.add(new V3(0, this.level >= 4 ? 9 : 0.15, 0)), this.level, 'star');
      this.travelDuration = (0.7 + this.level * 0.23) * this.p.period;
      this.preview(0, 0);
    }
    preview(dt, k) {
      const at = this.level >= 4 ? this.target.add(new V3(0, 11 + this.level * 0.5, 0)) : this.origin.add(this.dir.scale(1.3));
      this.cannon.position.copyFrom(at);
      if (this.level < 4) this.cannon.rotation.x = Math.PI / 2;
      this.cannon.scaling.setAll(this.p.size * (0.25 + k * 0.6));
      this.cannon.rotation.y = this.total * 0.5;
      this.star.rotation.set(this.total, this.total * 0.7, this.total * 0.4);
      fadeGroup(this.cannon, 0.2 + k * 0.7);
      this.crown.update(this.total, this.p.radius * 0.60, k * 0.50);
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      const k = sat(this.flight), envelope = Math.min(1, k * 9) * (0.83 + 0.17 * Math.sin(this.total * 24));
      for (let i = 0; i < this.beams.length; i++) {
        const beam = this.beams[i]; beam.setEnabled(true);
        const from = this.cannon.position.clone();
        if (i > 1) {
          const a = i * TAU / 3 + this.total;
          from.x += Math.cos(a) * 2.1; from.z += Math.sin(a) * 2.1;
        }
        stretchBeam(beam, from, this.target.add(new V3(0, 0.18, 0)), this.p.size * (i === 0 ? 0.26 : i === 1 ? 1.0 : 0.1) * envelope);
      }
      this.cannon.rotation.y += dt * 2.0;
      this.rings.forEach((r, i) => { r.rotation.z = Math.sin(this.total * 1.5 + i) * 0.3; });
      this.crown.update(-this.total, this.p.radius * 0.62, 0.6);
      this.emit(this.detail, dt * 65, this.target, radialVel(4, 3));
      if (Math.floor((this.total - dt) * 3) !== Math.floor(this.total * 3)) this.shock(this.p.radius * 0.6, 0.6, 0.33);
      return this.flight >= 1;
    }
    onImpact() { this.residue('star'); this.kick = this.level * 0.13; }
    impactSpell(dt, k) {
      for (const b of this.beams) b.visibility = 1 - smooth(k);
      this.crown.update(this.total, this.p.radius * (0.6 + k * 0.45), 0.6 * (1 - k));
      this.cannon.scaling.setAll(this.p.size * (0.85 + k * 0.3));
      fadeGroup(this.cannon, 1 - k);
    }
    onAftermath() { for (const b of this.beams) b.setEnabled(false); this.cannon.setEnabled(false); }
    aftermathSpell(dt, k) { this.emit(this.detail, dt * 12 * (1 - k), this.target, radialVel(2.1, 1.2)); }
  }

  /* 5 · 雷狱：立柱组成电笼，连接穹顶和多层环形电弧。 */
  class VoltBastionCast extends Cast {
    buildSpell() {
      this.prison = this.group('stormPrison'); this.prison.position.copyFrom(this.target);
      this.pylons = []; this.arcs = []; this.from = new V3(); this.to = new V3();
      const n = [3, 4, 6, 8, 10][this.level - 1];
      for (let i = 0; i < n; i++) {
        const node = this.group('pylon', this.prison);
        const pillar = this.mesh('Cylinder', { height: 3.3, diameterTop: 0.13, diameterBottom: 0.55, tessellation: 5 }, this.stone, node);
        pillar.position.y = 1.65;
        const gem = this.mesh('Polyhedron', { type: 1, size: 0.26 }, this.core, node); gem.position.y = 3.45;
        this.pylons.push(node);
        this.arcs.push(new Arc(this, this.core, 0.048, this.prison, 14));
        if (this.level >= 3) this.arcs.push(new Arc(this, this.edge, 0.025, this.prison, 14));
      }
      this.roof = new Rune(this, this.target.add(new V3(0, 7, 0)), this.level, 'rune');
      this.singularity = this.mesh('Sphere', { diameter: 1, segments: 16 }, this.veil, this.prison);
      this.singularity.position.y = 3.4;
      this.travelDuration = (0.8 + this.level * 0.36) * this.p.period;
      this.preview(0, 0);
    }
    preview(dt, k) {
      this.pylons.forEach((p, i) => {
        const a = i * TAU / this.pylons.length;
        p.position.set(Math.cos(a) * this.p.radius * 0.72, -(1 - k) * 3, Math.sin(a) * this.p.radius * 0.72);
        p.scaling.setAll(this.p.size); fadeGroup(p, 0.2 + k * 0.8);
      });
      this.singularity.scaling.setAll(this.p.size * (0.2 + k));
      this.roof.root.position.y = 3.45 * this.p.size;
      this.roof.update(this.total, this.p.radius * 0.70, k * 0.4);
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      const n = this.pylons.length, h = 3.45 * this.p.size;
      this.pylons.forEach(p => { p.position.y = 0; });
      for (let i = 0; i < this.arcs.length; i++) {
        const a = (i % n) * TAU / n, b = ((i + 1) % n) * TAU / n, r = this.p.radius * 0.72;
        this.from.set(Math.cos(a) * r, h, Math.sin(a) * r);
        if (i >= n) this.to.set(0, h * 1.35, 0);
        else this.to.set(Math.cos(b) * r, h * (0.45 + 0.35 * Math.sin(this.total * 3 + i)), Math.sin(b) * r);
        this.arcs[i].update(dt, this.from, this.to, this.total + i, 0.35 + this.level * 0.04, 0.4);
      }
      this.roof.update(-this.total, this.p.radius * 0.72, 0.7);
      this.singularity.scaling.setAll(this.p.size * (1 + Math.sin(this.total * 11) * 0.2));
      this.emit(this.detail, dt * 55, this.target.add(new V3(0, h * 0.5, 0)), radialVel(3, 0.5));
      return this.flight >= 1;
    }
    onImpact() { this.residue('electric'); }
    impactSpell(dt, k) {
      this.prison.scaling.set(1 + k * 0.18, 1 - k * 0.25, 1 + k * 0.18);
      this.singularity.scaling.setAll(this.p.size * (1 + k * 5)); this.singularity.visibility = 1 - k;
      for (const a of this.arcs) a.mesh.visibility = 1 - k;
      this.roof.update(this.total, this.p.radius * (0.72 + k * 0.25), 0.6 * (1 - k));
    }
    onAftermath() { for (const a of this.arcs) a.hide(); }
    aftermathSpell(dt, k) {
      fadeGroup(this.prison, 1 - smooth(k)); this.prison.position.y = -k * this.p.size * 2;
      this.emit(this.detail, dt * 15 * (1 - k), this.target, radialVel(2, 1.7));
    }
  }

  /* 6 · 冰川纪元：冻结地面，尖晶按同心波次生长成巨型王冠。 */
  class GlacialCrownCast extends Cast {
    buildSpell() {
      this.glacier = this.group('glacier'); this.glacier.position.copyFrom(this.target);
      this.spikes = [];
      const n = [5, 8, 12, 18, 26][this.level - 1];
      for (let i = 0; i < n; i++) {
        const spike = this.group('iceObelisk', this.glacier);
        const shell = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 5 }, this.body, spike);
        shell.position.y = 0.5;
        const edge = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 0.11, height: 1.05, tessellation: 4 }, this.core, spike);
        edge.position.set(0.1, 0.52, 0.12);
        this.spikes.push({ mesh: spike, angle: i * 2.399963, r: 0.25 + (i % 4) * 0.18, h: (1.7 + (i % 5) * 0.65) * (i % 4 === 0 ? 1.4 : 1) });
      }
      this.dome = this.mesh('Sphere', { diameter: 2, segments: 24, slice: 0.5 }, this.veil, this.glacier);
      this.dome.scaling.setAll(0.01);
      this.snow = this.emitter('spark', { life: [1.4, 2.6], size0: [0.05, 0.13], size1: [0.02, 0.06], alpha: [0.3, 0.7], gravity: 0.6, drag: 0.15, turb: 0.8 }, 1.0, 0.7);
      this.travelDuration = (0.45 + this.level * 0.25) * this.p.period;
      this.glacier.setEnabled(false);
    }
    onRelease() { this.glacier.setEnabled(true); }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      const k = sat(this.flight);
      this.spikes.forEach((s, i) => {
        const grow = easeOutCubic(sat((k - (i % 4) * 0.1) * 1.8));
        s.mesh.position.set(Math.cos(s.angle) * this.p.radius * s.r, -0.05, Math.sin(s.angle) * this.p.radius * s.r);
        s.mesh.scaling.set(this.p.size * grow * 0.85, s.h * this.p.size * grow, this.p.size * grow * 0.85);
        s.mesh.rotation.z = -Math.cos(s.angle) * 0.26; s.mesh.rotation.x = Math.sin(s.angle) * 0.26;
      });
      this.dome.scaling.set(this.p.radius * k, this.p.radius * k * 0.5, this.p.radius * k);
      this.dome.visibility = 0.38 * (1 - k);
      this.emit(this.smoke, dt * 20, this.target, radialVel(3.5, 0.25));
      return this.flight >= 1;
    }
    onImpact() { this.residue('ice'); this.dome.setEnabled(false); }
    impactSpell(dt, k) {
      this.glacier.scaling.setAll(1 + Math.sin(k * Math.PI) * 0.04);
      const at = positionAt(this.target, this.p.radius * 0.6, this.total * 8, 7);
      this.emit(this.snow, dt * 55, at, () => ({ x: randSpread(2), y: -1.4, z: randSpread(2) }));
    }
    aftermathSpell(dt, k) {
      const at = positionAt(this.target, this.p.radius * 0.5, this.total * 5, 6);
      this.emit(this.snow, dt * 35 * (1 - k), at, () => ({ x: randSpread(1), y: -1.1, z: randSpread(1) }));
      fadeGroup(this.glacier, 1 - smooth((k - 0.25) / 0.75)); this.glacier.position.y = -k * k * 1.5;
    }
  }

  /* 7 · 龙卷裂隙：位移残像后留下螺旋风壁，五阶形成持续龙卷。 */
  class WindRipCast extends Cast {
    buildSpell() {
      this.vortex = this.group('windVortex'); this.vortex.position.copyFrom(this.target);
      this.spirals = [];
      const h = this.level === 5 ? 12 : 2 + this.level * 1.2;
      for (let j = 0; j < (this.level >= 4 ? 5 : 3); j++) {
        const path = [];
        for (let i = 0; i < 70; i++) {
          const u = i / 69, a = u * TAU * 2.2 + j * TAU / 5, r = (0.22 + u * 0.74) * this.p.radius * 0.55;
          path.push(new V3(Math.cos(a) * r, u * h, Math.sin(a) * r));
        }
        const ribbon = this.mesh('Tube', { path, radius: j % 2 ? 0.08 : 0.035, tessellation: 4 }, j % 2 ? this.edge : this.core, this.vortex);
        this.spirals.push(ribbon);
      }
      this.rings = [];
      for (let i = 0; i < this.level + 2; i++) {
        const disc = this.sprite('windSlice', 'vortex', this.vortex, true);
        disc.position.y = i * h / (this.level + 2); const r = this.p.radius * (0.45 + i * 0.12);
        disc.scaling.set(r, r, 1); this.rings.push(disc);
      }
      this.debris = [];
      for (let i = 0; i < this.level * 3; i++) {
        const rock = this.mesh('Polyhedron', { type: 3, size: 0.18 + (i % 3) * 0.1 }, this.stone, this.vortex);
        this.debris.push(rock);
      }
      this.ghosts = [];
      for (let i = 0; i < 5; i++) {
        const ghost = this.mesh('Cylinder', { diameterTop: 0.28, diameterBottom: 0.8, height: 1.7, tessellation: 6 }, this.veil);
        ghost.position.copyFrom(V3.Lerp(this.startGround, this.target, i / 5)); ghost.position.y = 1;
        ghost.setEnabled(false); this.ghosts.push(ghost);
      }
      this.travelDuration = (0.35 + this.level * 0.28) * this.p.period;
      this.vortex.scaling.setAll(0.01);
    }
    preview(dt, k) {
      this.vortex.scaling.setAll(0.25 + k * 0.25); this.vortex.rotation.y = this.total * 2;
      fadeGroup(this.vortex, k * 0.35);
      this.rings.forEach(r => this.spriteColor(r, k * 0.15));
    }
    onRelease() { this.ghosts.forEach(g => g.setEnabled(true)); }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      const k = sat(this.flight);
      if (SKILLS.poseOwner(this.game) === this) {
        const dash = easeOutCubic(sat(k * 3));
        this.game.mage.root.position.x = lerp(this.startGround.x, this.target.x, dash);
        this.game.mage.root.position.z = lerp(this.startGround.z, this.target.z, dash);
        this.lift = Math.sin(dash * Math.PI) * 0.8;
      }
      this.vortex.scaling.setAll(0.45 + Math.min(1, k * 2) * 0.55);
      this.vortex.rotation.y += dt * (3.5 + this.level * 0.45);
      fadeGroup(this.vortex, 0.85);
      this.rings.forEach((r, i) => { r.rotation.z = this.total * (i % 2 ? -2 : 1); this.spriteColor(r, 0.3); });
      this.debris.forEach((r, i) => {
        const a = this.total * 2.0 + i * 2.399, y = (i % 6 + 1) * (this.level === 5 ? 1.6 : 0.65);
        const radius = this.p.radius * (0.25 + y * 0.035);
        r.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius); r.rotation.set(this.total + i, this.total * 2, i);
      });
      this.ghosts.forEach((g, i) => { g.visibility = Math.max(0, 0.55 - k - i * 0.03); });
      this.emit(this.detail, dt * 40, this.target, radialVel(4, 3));
      return this.flight >= 1;
    }
    onImpact() { this.residue('wind'); }
    impactSpell(dt, k) { this.vortex.rotation.y += dt * 5; this.vortex.scaling.set(1 + k * 0.25, 1 - k * 0.25, 1 + k * 0.25); }
    aftermathSpell(dt, k) {
      this.vortex.rotation.y += dt * 4 * (1 - k); fadeGroup(this.vortex, 1 - smooth(k));
      this.rings.forEach(r => this.spriteColor(r, 0.3 * (1 - k)));
      this.vortex.scaling.y = Math.max(0.01, 0.75 - k * 0.74);
    }
  }

  /* 8 · 群山崩塌：大地沿施法方向撕裂，地脉依次抬升成山脊。 */
  class RockFangCast extends Cast {
    buildSpell() {
      this.mountains = this.group('tectonicRidge'); this.peaks = [];
      const n = [4, 6, 9, 15, 22][this.level - 1];
      for (let i = 0; i < n; i++) {
        const root = this.group('mountainPeak', this.mountains);
        const rock = this.mesh('Cylinder', { diameterTop: 0.12, diameterBottom: 1.6, height: 1, tessellation: 5 }, this.stone, root);
        rock.position.y = 0.5;
        const fissure = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 0.13, height: 0.94, tessellation: 4 }, this.core, root);
        fissure.position.set(0.15, 0.5, 0.46);
        const isRing = this.level >= 4 && i >= 6;
        const a = i * 2.399, along = (i % 6 + 1) / 6;
        const at = isRing ? positionAt(this.target, this.p.radius * (0.40 + i % 3 * 0.18), a, 0) : V3.Lerp(this.startGround, this.target, along);
        this.peaks.push({ mesh: root, at, delay: isRing ? 0.25 + (i % 4) * 0.1 : along * 0.3, h: (1.6 + (i % 5) * 0.85) * this.p.size, a });
        root.scaling.setAll(0.001); root.position.copyFrom(at);
      }
      this.travelDuration = (0.45 + this.level * 0.18) * this.p.period;
      this.dust = this.emitter('debris', { life: [0.6, 1.6], size0: [0.1, 0.3], size1: [0.07, 0.15], alpha: [0.8, 1], gravity: 9, drag: 0.4, turb: 0.2 }, 0.45, 0.17);
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      this.peaks.forEach((p, i) => {
        const k = easeOutCubic(sat((this.flight - p.delay) / (1 - p.delay)));
        p.mesh.scaling.set(this.p.size * (0.5 + k * 0.5), Math.max(0.001, p.h * k), this.p.size * (0.5 + k * 0.5));
        p.mesh.rotation.set(Math.cos(p.a) * 0.18 * k, p.a, Math.sin(p.a) * 0.23 * k);
        if (k > 0 && !p.burst) {
          p.burst = true; this.emit(this.dust, 7, p.at, radialVel(4, 4), true);
          if (i % 3 === 0) SKILLS.addTransient(new Shockwave(this.game, p.at, this.rgb, this.p.size * 1.4, 0.5, { alpha: 0.35 }));
        }
      });
      this.kick = Math.max(this.kick, this.level * 0.055);
      return this.flight >= 1;
    }
    onImpact() { this.residue('earth'); }
    impactSpell(dt, k) {
      this.emit(this.dust, dt * 35 * (1 - k), this.target.add(new V3(0, 3, 0)), radialVel(3.5, 5));
      this.emit(this.smoke, dt * 30, this.target, radialVel(3, 1.5));
      this.peaks.forEach((p, i) => { p.mesh.position.y = Math.sin(k * Math.PI) * (0.1 + (i % 3) * 0.10); });
    }
    aftermathSpell(dt, k) {
      fadeGroup(this.mountains, 1 - smooth((k - 0.25) / 0.75));
      this.peaks.forEach(p => { p.mesh.position.y = -p.h * k * k * 0.7; });
      this.emit(this.smoke, dt * 15 * (1 - k), this.target, radialVel(1.6, 0.8));
    }
  }

  /* 9 · 王之财宝:金色门扉开启宝库。
     一至三级:门阵 + 单轮剑雨;四级:宝库穹顶 + 天穹法印(旧五级形态,乖离剑按反馈移除)。
     五级宝库全开:玩家脚底超大召唤法阵 + 头顶十二门,每门五剑、0.5 秒一轮共五轮 2.5 秒,
     落点为玩家选中处(底部不配法阵),命中后钉地再归还宝库。 */
  class GateTreasuryCast extends Cast {
    buildSpell() {
      this.gates = [];
      this.shots = [];
      this.volleyT = 0;
      const overhead = this.level === 5;
      const nearCaster = this.level <= 2;
      const n = [1, 3, 6, 14, 12][this.level - 1];
      for (let i = 0; i < n; i++) {
        const gate = gateNode(this);
        const rec = {
          root: gate.root, ripple: gate.ripple, rim: gate.rim,
          a: i * TAU / n + (i % 2) * 0.16, ring: i % 2, heading: new V3(),
        };
        this.gates.push(rec);
        if (nearCaster) {
          const spread = n === 1 ? 0 : (i - (n - 1) / 2) * 0.85;
          rec.root.position.copyFrom(this.startGround.add(this.dir.scale(1.5)).addInPlace(this.side.scale(spread)));
          rec.root.position.y = 1.95 + (n === 3 && i === 1 ? 0.55 : 0);
          const aimAt = this.target.add(this.side.scale(spread * 1.7));
          aimAt.subtractToRef(rec.root.position, rec.heading); rec.heading.normalize();
        } else if (overhead) {
          rec.root.position.copyFrom(positionAt(this.startGround, 4.6 * this.p.size, rec.a, 7.4 + (i % 2) * 0.8));
          this.target.subtractToRef(rec.root.position, rec.heading); rec.heading.normalize();
        } else {
          const ringR = this.p.radius * (rec.ring ? 1.05 : 1.5) * (this.level === 4 ? 1.15 : 1);
          rec.root.position.copyFrom(positionAt(this.target, ringR, rec.a, (rec.ring ? 5.6 : 3.8) + this.level * 0.5));
          this.target.subtractToRef(rec.root.position, rec.heading); rec.heading.normalize();
        }
        aimNode(rec.root, rec.heading);
      }
      /* 飞剑:1–4 级每门一把错峰齐射;五级每门五把,五轮 × 0.5 秒,轮内再错峰 */
      const rounds = overhead ? 5 : 1;
      const T = (nearCaster ? 0.5 : 0.8) + this.level * 0.12 + (nearCaster ? this.aimDist / 40 : 0.2);
      for (let r = 0; r < rounds; r++) {
        for (let i = 0; i < n; i++) {
          const gate = this.gates[i];
          const len = (i % 2 ? 2.2 : 2.3) * (this.level === 4 && i === 0 ? 1.35 : 1);
          const sword = weaponSprite(this, i % 2 ? 'spearBlade' : 'blade', len);
          const streak = this.sprite('bladeStreak', 'beamGlow', null);
          streak.setEnabled(false);
          const delayFrac = nearCaster ? i * 0.10 : (i % 4) * 0.12 + i * 0.026;
          const er = overhead ? this.p.radius * (0.10 + (i % 4) * 0.06) : this.p.radius * (0.18 + (i % 4) * 0.20);
          this.shots.push({
            gate, sword, streak, len, round: r,
            start: new V3(),
            end: positionAt(this.target, er, overhead ? i * 2.399 + r * 1.71 : gate.a * 1.7 + 0.35, 0.5),
            flyDir: new V3(),
            launchAt: overhead ? r * 0.5 + (i / n) * 0.5 : delayFrac * T,
            flightDur: overhead ? 0.42 + this.aimDist * 0.01 : (1 - delayFrac) * T,
            landed: false,
          });
        }
      }
      this.volleyEnd = this.shots.reduce((m, s) => Math.max(m, s.launchAt + s.flightDur), 0);
      this.travelDuration = this.volleyEnd;
      if (this.level === 3 || this.level === 4) {
        this.skySeal = new Rune(this, this.target.add(new V3(0, this.level === 4 ? 11.5 : 8, 0)), this.level, 'rune');
      }
      if (overhead) {
        this.grandSeal = this.sprite('grandSeal', 'grandCircle', null, true);
        this.grandSeal.position.copyFrom(this.startGround);
        this.grandSeal.position.y = 0.055;
      }
      this.preview(0, 0);
    }
    /* 五级脚底巨型法阵取代常规施法/落点法阵,底部不配落点圈。 */
    updateRituals() {
      if (this.level !== 5) { super.updateRituals(); return; }
      const windup = this.phase === 'windup';
      const k = windup ? smooth(this.phaseT / this.windupDur) : 1;
      if (windup) {
        const hand = this.game.mage.worldHand ? this.game.mage.worldHand() : this.origin;
        this.origin.copyFrom(hand); this.orb.position.copyFrom(hand);
        const s = (0.3 + 0.75 * k) * Math.sqrt(this.p.size);
        this.orb.scaling.set(s, s, 1); this.orb.rotation.z = this.total * 2.8;
        this.spriteColor(this.orb, 0.30 + 0.35 * k, 1.1);
      } else {
        this.spriteColor(this.orb, this.phase === 'release' ? 0.5 * (1 - this.phaseProgress()) : 0, 1.2);
      }
    }
    preview(dt, k) {
      for (let i = 0; i < this.gates.length; i++) {
        const rec = this.gates[i];
        const open = smooth(sat((k - (i % 3) * 0.07) * 1.7));
        if (this.level === 3 || this.level === 4) {
          const a = rec.a + this.total * 0.22;
          const ringR = this.p.radius * (rec.ring ? 1.05 : 1.5) * (this.level === 4 ? 1.15 : 1);
          rec.root.position.copyFrom(positionAt(this.target, ringR, a, (rec.ring ? 5.6 : 3.8) + this.level * 0.5));
          this.target.subtractToRef(rec.root.position, rec.heading); rec.heading.normalize();
          aimNode(rec.root, rec.heading);
        } else if (this.level === 5) {
          const a = rec.a + this.total * 0.16;
          rec.root.position.copyFrom(positionAt(this.startGround, 4.6 * this.p.size, a, 7.4 + (i % 2) * 0.8));
          this.target.subtractToRef(rec.root.position, rec.heading); rec.heading.normalize();
          aimNode(rec.root, rec.heading);
        }
        rec.root.scaling.setAll(this.p.size * (0.22 + 0.78 * open));
        fadeGroup(rec.root, 0.16 + 0.84 * open);
        this.spriteColor(rec.ripple, (0.18 + 0.72 * open) * (0.86 + 0.14 * Math.sin(this.total * 5.5 + i * 1.7)), 1.15);
        rec.ripple.rotation.z = this.total * 0.35 * (i % 2 ? -1 : 1);
      }
      for (const s of this.shots) {
        const open = smooth(sat((k - s.round * 0.05) * 1.7));
        const sw = this.p.size * (0.3 + 0.7 * open);
        s.sword.scaling.set(s.len * 0.34 * sw, -s.len * sw, 1);
        s.sword.position.copyFrom(s.gate.root.position).addInPlace(s.gate.heading.scale((0.42 - s.round * 0.22) * this.p.size));
        rollTo(s.sword, s.gate.heading, this.game.camera.position);
        this.spriteColor(s.sword, 0.12 + 0.88 * open, 1.05);
        s.streak.setEnabled(false);
      }
      if (this.skySeal) this.skySeal.update(-this.total, this.p.radius * 0.85, k * 0.55);
      if (this.grandSeal) {
        const grow = 0.25 + 0.75 * smooth(k);
        this.grandSeal.scaling.set(19 * this.p.size * grow, 19 * this.p.size * grow, 1);
        this.grandSeal.rotation.z = this.total * 0.10;
        this.spriteColor(this.grandSeal, (0.18 + 0.55 * k) * (0.9 + 0.1 * Math.sin(this.total * 2.2)), 1.1);
      }
    }
    onRelease() {
      for (const s of this.shots) {
        s.start.copyFrom(s.gate.root.position).addInPlace(s.gate.heading.scale((0.42 - s.round * 0.22) * this.p.size));
        s.landed = false;
      }
    }
    travel(dt) {
      this.volleyT += dt * this.p.speed;
      for (let i = 0; i < this.shots.length; i++) {
        const s = this.shots[i];
        const u = sat((this.volleyT - s.launchAt) / s.flightDur);
        if (u <= 0) continue;
        if (u < 1) {
          V3.LerpToRef(s.start, s.end, u * u, s.sword.position);
          if (this.level < 4) s.sword.position.y += Math.sin(u * Math.PI) * (0.5 + this.level * 0.3);
          s.end.subtractToRef(s.start, s.flyDir); s.flyDir.normalize();
          rollTo(s.sword, s.flyDir, this.game.camera.position);
          s.sword.scaling.set(s.len * 0.34 * this.p.size, -s.len * this.p.size, 1);
          this.spriteColor(s.sword, 1, 1.05);
          s.streak.setEnabled(true);
          stretchBeam(s.streak, s.sword.position.add(s.flyDir.scale(-s.len * this.p.size * 0.8)),
            s.sword.position, this.p.size * 0.10);
          this.spriteColor(s.streak, 0.32 + 0.16 * Math.sin(this.total * 20 + i * 1.3), 1.25);
          this.emit(this.main, dt * 10, s.sword.position, radialVel(0.7, 0.3));
          this.emit(this.detail, dt * 6, s.sword.position, radialVel(1.5, 0.5));
        } else {
          s.streak.setEnabled(false);
          if (!s.landed) {
            s.landed = true;
            s.sword.position.copyFrom(s.end);
            s.end.subtractToRef(s.start, s.flyDir); s.flyDir.normalize();
            rollTo(s.sword, s.flyDir, this.game.camera.position);
            s.sword.scaling.set(s.len * 0.34 * this.p.size, -s.len * this.p.size, 1);
            this.spriteColor(s.sword, 1, 1.05);
            this.emit(this.main, 4, s.end, radialVel(1.2, 0.7), true);
            this.emit(this.detail, 6 + this.level, s.end, radialVel(2.6, 1.6), true);
          }
        }
      }
      if (this.skySeal) this.skySeal.update(-this.total, this.p.radius * 0.85, 0.55 * (1 - sat(this.volleyT / this.travelDuration)));
      if (this.grandSeal) {
        this.grandSeal.rotation.z = this.total * 0.12;
        this.spriteColor(this.grandSeal, 0.68 + 0.06 * Math.sin(this.total * 2.2), 1.1);
      }
      return this.volleyT >= this.volleyEnd;
    }
    onImpact() {
      this.residue('gold');
    }
    impactSpell(dt, k) {
      for (const s of this.shots) {
        if (s.landed) s.sword.position.y = 0.5 - k * 0.16;
        s.streak.setEnabled(false);
        this.spriteColor(s.sword, 1, 1.05);
      }
      if (this.grandSeal) {
        this.grandSeal.rotation.z += dt * 0.35;
        this.spriteColor(this.grandSeal, 0.68 * (1 - k * 0.5), 1.1);
      }
      if (Math.floor((this.total - dt) * 3) !== Math.floor(this.total * 3)) {
        this.shock(this.p.radius * 0.55, 0.55, 0.3);
      }
      this.emit(this.smoke, dt * 10, this.target, radialVel(1.4, 0.9));
    }
    onAftermath() {
    }
    aftermathSpell(dt, k) {
      const gateOut = 1 - smooth(k / 0.6);
      for (let i = 0; i < this.gates.length; i++) {
        const rec = this.gates[i];
        fadeGroup(rec.root, gateOut);
        this.spriteColor(rec.ripple, gateOut * (0.86 + 0.14 * Math.sin(this.total * 5 + i)), 1.1);
      }
      const swordOut = 1 - smooth((k - 0.3) / 0.7);
      for (const s of this.shots) {
        this.spriteColor(s.sword, swordOut, 1.05);
        if (s.landed) s.sword.position.y = 0.34 - k * 0.22;
      }
      if (this.grandSeal) {
        this.grandSeal.rotation.z += dt * 0.18;
        this.spriteColor(this.grandSeal, 0.68 * (1 - smooth(k)), 1.1);
      }
      if (this.skySeal) this.skySeal.update(-this.total, this.p.radius * 0.85, 0.5 * (1 - k));
      this.emit(this.detail, dt * 9 * (1 - k), this.target, radialVel(1.6, 0.8));
    }
  }

  const CAST_CLASSES = { 1: FrostSpearCast, 2: ThunderLanceCast, 3: MeteorCast, 4: StarBeamCast,
    5: VoltBastionCast, 6: GlacialCrownCast, 7: WindRipCast, 8: RockFangCast, 9: GateTreasuryCast };
  const SKILLS = {
    defs: DEFS, LEVELS, profile, phaseLabel: PHASE_LABEL,
    casts: [], transients: [], cooldowns: {}, cooldownTotals: {}, _particlesLeft: 480,
    budget: { casts: 6, ultimates: 2, transients: 48, particlesPerFrame: 480 },
    setLevel(game, id, level) {
      const raw = game.params.skills[id];
      if (!raw) return null;
      raw.level = levelOf(level, 3);
      return profile(game, id);
    },
    poseOwner(game) {
      for (let i = this.casts.length - 1; i >= 0; i--) {
        const c = this.casts[i];
        if (c.game === game && !c.finished && !c.disposed) return c;
      }
      return null;
    },
    addTransient(t) {
      while (this.transients.length >= this.budget.transients) this.transients.shift().dispose();
      this.transients.push(t);
    },
    isReady(id) { return (this.cooldowns[id] || 0) <= 0; },
    start(game, id, aim) {
      const def = DEFS.find(d => d.id === Number(id));
      if (!def || !this.isReady(id) || this.casts.length >= this.budget.casts) return false;
      const p = profile(game, id);
      if (p.level === 5 && this.casts.filter(c => c.level === 5).length >= this.budget.ultimates) return false;
      const cast = new CAST_CLASSES[id](game, def, aim, p);
      this.casts.push(cast); this._game = game;
      try { cast.init(); } catch (error) { cast.dispose(); this.casts.pop(); throw error; }
      game.mage.faceTo(cast.dir.x, cast.dir.z);
      this.cooldowns[id] = this.cooldownTotals[id] = p.cooldown;
      return true;
    },
    abortAll() {
      for (const c of this.casts) c.dispose();
      for (const t of this.transients) t.dispose();
      this.casts.length = 0; this.transients.length = 0;
      if (this._game) {
        const g = this._game; g.mage.setCast(0); g.mage.yOffset = 0;
        g.mage.setSpellPose('idle', 0, 3);
        g.cinematic.focus = null; g.cinematic.intensity = 0; g.cinematic.shake = 0;
      }
      FX.clear();
    },
    update(dt) {
      this._particlesLeft = this.budget.particlesPerFrame;
      for (const id in this.cooldowns) this.cooldowns[id] = Math.max(0, this.cooldowns[id] - dt);
      for (let i = this.casts.length - 1; i >= 0; i--) {
        const c = this.casts[i]; c.update(dt);
        if (c.finished) { c.dispose(); this.casts.splice(i, 1); }
      }
      for (let i = this.transients.length - 1; i >= 0; i--) {
        const t = this.transients[i]; t.update(dt);
        if (t.done) { t.dispose(); this.transients.splice(i, 1); }
      }
      const game = this._game;
      if (!game) return;
      const owner = this.poseOwner(game);
      const cine = game.cinematic;
      if (owner) {
        const k = owner.phaseProgress();
        game.mage.setSpellPose(owner.phase, k, owner.level, owner.p.color, owner.def.id);
        game.mage.setCast(owner.phase === 'windup' ? smooth(k) : Math.max(0, game.mage.castAmount - dt * 2));
        game.mage.yOffset = owner.def.id === 7 ? owner.lift : 0;
        const targetIntensity = owner.level >= 4 ? (owner.level === 5 ? 1 : 0.5) * (owner.phase === 'aftermath' ? 1 - k : 1) : 0;
        cine.focus = owner.focus;
        cine.intensity += (targetIntensity - cine.intensity) * Math.min(1, dt * 3);
        cine.shake = Math.max(cine.shake * Math.exp(-dt * 8), owner.kick);
      } else {
        game.mage.setSpellPose('idle', 0, 3); game.mage.setCast(0); game.mage.yOffset = 0;
        cine.intensity *= Math.exp(-dt * 3); cine.shake *= Math.exp(-dt * 8);
        if (cine.intensity < 0.001) { cine.focus = null; cine.intensity = 0; }
      }
    },
  };
  global.SKILLS = SKILLS;
})(window);
