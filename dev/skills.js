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
  /* 技能元数据唯一来源是 skill-catalog.js；此处只组装运行时视图 */
  const DEFS = SKILL_CATALOG.map(s => ({
    id: s.id, name: s.name, ultimateName: s.ultimateName, form: s.form, hotkey: s.hotkey,
    element: s.element, elementOrder: (SkillCatalog.elementOf(s.element) || {}).order || 99,
    color: s.color, level: s.level, range: s.range, radius: s.radius, windup: s.windup,
    cooldown: s.cooldown, groundTarget: s.groundTarget, description: s.description, demoOrder: s.demoOrder,
  }));

  function profile(game, id, requestedLevel) {
    const def = DEFS.find(d => d.id === Number(id));
    if (!def) return null;
    const raw = game && game.params && game.params.skills && game.params.skills[def.id] || {};
    const level = levelOf(requestedLevel === undefined ? raw.level : requestedLevel, def.level || 3);
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
    mat(name, glow, alpha, solid, diffuse) {
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
      this.tinted.push({ mat, glow, solid: !!solid, diffuse });
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
        if (rec.solid) {
          /* diffuse 覆盖：亮底材质（浪体飘带）靠顶点色出水→白沫渐变，
             默认 rgb*0.45 深底会把顶点色压黑 */
          const d = rec.diffuse;
          rec.mat.diffuseColor.set(d ? d[0] : this.rgb[0] * 0.45, d ? d[1] : this.rgb[1] * 0.45,
            d ? d[2] : this.rgb[2] * 0.45);
        }
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
      const KIND_TEX = { fire: 'meteorScar', ice: 'iceScar', electric: 'voltScar', earth: 'earthScar', gold: 'goldScar', normal: 'arcaneScar', water: 'waterScar' };
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

  /* 五段生命周期。等级和计时在 start 锁定；同级颜色/密度/尺寸/速度实时刷新。
     构造函数只做无副作用快照，场景资源全部在 init 分配——任一步失败都能整体回收。 */
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
      this.controlsMovement = false;
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
    }
    /* 资源分配集中在 init：start() 对构造+init 整体 try/catch，失败即 dispose 回滚 */
    init() {
      this.stone = this.mat('darkSurface', 0.10, 1, true);
      this.body = this.mat('facetedBody', 0.34, 1, true);
      this.core = this.mat('luminousEdge', 1.35, 1);
      this.edge = this.mat('haloEdge', 1.00, 0.72);
      this.veil = this.mat('thinVeil', 0.75, 0.16);
      this.casterRune = new Rune(this, this.startGround, this.level, 'rune');
      this.targetRune = new Rune(this, this.target, this.level, this.def.id === 6 || this.def.id === 1 ? 'star' : 'rune');
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
      this.buildSpell();
      this.notify();
    }
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

  /* 1 · 冰枪风暴：五级分野在「弹道编排」而非冰矛数量。
     L1 手中单矛直刺 → L2 主矛飞行中裂成三矛 → L3 五矛悬停上空再轮番钉地 →
     L4 空中枪阵分组钉地 → L5 十三矛 + 加长主矛的枪阵风暴。 */
  class FrostSpearCast extends Cast {
    buildSpell() {
      this.lances = [];
      const n = [1, 3, 5, 9, 13][this.level - 1];
      this.mode = ['solo', 'split', 'hover', 'array', 'array'][this.level - 1];
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
      this.travelDuration = Math.max(0.45, this.aimDist / 23)
        + (this.level >= 4 ? 0.65 : 0) + (this.mode === 'hover' ? 0.55 : 0);
      this.preview(0, 0);
    }
    preview(dt, k) {
      /* L1/L2 从手中起手；L3 起主体跃迁到落点上空，构成枪阵预备 */
      const airborne = this.level >= 3;
      for (let i = 0; i < this.lances.length; i++) {
        const rec = this.lances[i], a = rec.a + this.total * 0.5;
        if (airborne) {
          const r = i === 0 ? 0 : this.p.radius * 0.68;
          rec.mesh.position.set(this.target.x + Math.cos(a) * r, 6.5 + (i % 3) * 0.9 + this.level * 0.5, this.target.z + Math.sin(a) * r);
          rec.heading.set(0, -1, 0); aimNode(rec.mesh, rec.heading);
        } else {
          const r = i === 0 ? 0 : 0.7 + this.level * 0.18;
          rec.mesh.position.copyFrom(this.origin).addInPlace(new V3(this.side.x * Math.cos(a) * r, Math.sin(a) * r, this.side.z * Math.cos(a) * r));
          aimNode(rec.mesh, this.dir);
        }
        /* L2 分裂前只露主矛，另外两支留到飞行中裂开 */
        const hidden = this.mode === 'split' && i > 0;
        rec.mesh.setEnabled(!hidden);
        rec.mesh.scaling.setAll(this.p.size * (0.18 + 0.82 * k));
        fadeGroup(rec.mesh, hidden ? 0 : 0.15 + 0.70 * k);
      }
      if (this.skySeal) this.skySeal.update(this.total, this.p.radius * 0.8, k * 0.68);
    }
    onRelease() {
      for (let i = 0; i < this.lances.length; i++) {
        const rec = this.lances[i]; rec.start.copyFrom(rec.mesh.position);
        const r = i === 0 ? 0 : this.p.radius *
          (this.level >= 4 ? 0.72 : this.mode === 'split' ? 0.45 : 0.22);
        rec.end.copyFrom(positionAt(this.target, r, rec.a, 0.8));
      }
    }
    aimLance(rec, from) {
      rec.end.subtractToRef(from, rec.heading); rec.heading.normalize();
      aimNode(rec.mesh, rec.heading);
      rec.mesh.scaling.setAll(this.p.size); fadeGroup(rec.mesh, 1);
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      for (let i = 0; i < this.lances.length; i++) {
        const rec = this.lances[i];
        if (this.mode === 'split') {
          /* L2：主矛飞行至四成时裂开，副矛自矛尖散射 */
          if (i === 0) {
            const u = sat(this.flight);
            V3.LerpToRef(rec.start, rec.end, u * u, rec.mesh.position);
            rec.mesh.position.y += Math.sin(u * Math.PI) * 0.7;
            rec.mesh.setEnabled(true); this.aimLance(rec, rec.start);
          } else if (this.flight > 0.4) {
            const t = sat((this.flight - 0.4) / 0.6);
            V3.LerpToRef(this.lances[0].mesh.position, rec.end, t * t, rec.mesh.position);
            rec.mesh.position.y += Math.sin(t * Math.PI) * 0.5;
            rec.mesh.setEnabled(true); this.aimLance(rec, this.lances[0].mesh.position);
          } else { rec.mesh.setEnabled(false); }
        } else if (this.mode === 'hover') {
          /* L3：先悬停在落点上空蓄势，四成半后轮番钉地 */
          const u = sat(this.flight);
          if (u < 0.45) {
            rec.mesh.position.copyFrom(rec.start);
            rec.mesh.position.y += Math.sin(this.total * 3 + i) * 0.16;
            rec.heading.set(0, -1, 0); aimNode(rec.mesh, rec.heading);
            rec.mesh.scaling.setAll(this.p.size); fadeGroup(rec.mesh, 1);
          } else {
            const t = (u - 0.45) / 0.55;
            V3.LerpToRef(rec.start, rec.end, t * t, rec.mesh.position);
            this.aimLance(rec, rec.start);
          }
        } else {
          const delay = this.mode === 'array' ? (i % 4) * 0.09 : i * 0.025;
          const u = sat((this.flight - delay) / (1 - delay)), k = u * u;
          V3.LerpToRef(rec.start, rec.end, k, rec.mesh.position);
          if (this.mode !== 'array') rec.mesh.position.y += Math.sin(u * Math.PI) * (0.45 + this.level * 0.25);
          this.aimLance(rec, rec.start);
        }
      }
      const lead = this.lances[0].mesh.position;
      const at = this.mode === 'split' && this.flight <= 0.4 ? lead
        : this.lances[Math.floor(this.total * 17) % this.lances.length].mesh.position;
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

  /* 2 · 雷神审判：五级分野在「电弧的走位」而非电弧根数。
     L1 手中单弧直劈 → L2 落地后链式弹跳两段 → L3 高空法印 + 分支雷霆自天而降 →
     L4 落点环形雷网封地 → L5 十二米审判巨剑坠落 + 九道天雷。 */
  class ThunderLanceCast extends Cast {
    buildSpell() {
      this.arcs = []; this.a = new V3(); this.b = new V3(); this.na = new V3(); this.nb = new V3();
      this.mode = ['solo', 'bounce', 'sky', 'net', 'sky'][this.level - 1];
      const n = [1, 3, 5, 7, 9][this.level - 1];
      for (let i = 0; i < n; i++) this.arcs.push(new Arc(this, i ? this.edge : this.core, i ? 0.045 : 0.10 * this.p.size));
      /* L2 链式弹跳的三个落点：首段自手中劈下，其后两段贴地弹跳 */
      this.bouncePts = null;
      if (this.mode === 'bounce') {
        this.bouncePts = [0.42, 0.72, 1].map(t => {
          const p = V3.Lerp(this.startGround, this.target, Math.min(1, t));
          p.y = 0.14; return p;
        });
      }
      /* L4 落点环形雷网：地面一圈封口电弧 */
      this.netArcs = null;
      if (this.mode === 'net') {
        this.netArcs = [];
        for (let i = 0; i < 7; i++) this.netArcs.push(new Arc(this, this.edge, 0.032, null, 14));
      }
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
        /* L2 链式弹跳：手 → 落点 → 二次弹跳 → 终点，读作折线电弧 */
        if (this.mode === 'bounce') {
          const from = i === 0 ? this.origin : this.bouncePts[i - 1];
          const to = this.bouncePts[Math.min(i, this.bouncePts.length - 1)];
          this.arcs[i].update(dt, from, to, this.total + i, (0.2 + this.level * 0.12) * amount, 0.32);
          this.arcs[i].mesh.visibility = amount;
          continue;
        }
        const a = i / this.arcs.length * TAU + this.total * 0.15;
        if (this.mode === 'solo') this.a.copyFrom(this.origin);
        else this.a.set(this.target.x + (i ? Math.cos(a) * this.p.radius * 0.65 : 0), this.level === 5 ? 12 : 7, this.target.z + (i ? Math.sin(a) * this.p.radius * 0.65 : 0));
        this.b.set(this.target.x + (i ? Math.cos(a + 0.6) * this.p.radius * 0.75 : 0), 0.12, this.target.z + (i ? Math.sin(a + 0.6) * this.p.radius * 0.75 : 0));
        this.arcs[i].update(dt, this.a, this.b, this.total + i, (0.2 + this.level * 0.12) * amount);
        this.arcs[i].mesh.visibility = amount * (i ? 0.8 : 1);
      }
    }
    /* L4 环形雷网：落点周围一圈贴地电弧，随爆发向外扩张 */
    drawNet(dt, amount, expand) {
      if (!this.netArcs) return;
      const n = this.netArcs.length, r = this.p.radius * (1.0 + 0.22 * expand);
      for (let i = 0; i < n; i++) {
        const a0 = i * TAU / n, a1 = (i + 1) * TAU / n;
        this.na.set(this.target.x + Math.cos(a0) * r, 0.14, this.target.z + Math.sin(a0) * r);
        this.nb.set(this.target.x + Math.cos(a1) * r, 0.14, this.target.z + Math.sin(a1) * r);
        this.netArcs[i].update(dt, this.na, this.nb, this.total * 3 + i, 0.55 * amount, 0.22);
        this.netArcs[i].mesh.visibility = amount * (0.75 + 0.25 * Math.sin(this.total * 18 + i));
      }
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      this.drawArcs(dt, 0.75 + Math.sin(this.total * 36) * 0.18);
      this.drawNet(dt, 0.8, 0);
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
      this.drawNet(dt, (1 - k * 0.8), k);
      const h = this.level === 5 ? 14 : 3 + this.level;
      this.pillar.position.y = h / 2;
      this.pillar.scaling.set((0.4 + Math.sin(k * Math.PI) * 0.65) * this.p.size, h, (0.4 + Math.sin(k * Math.PI) * 0.65) * this.p.size);
      this.pillar.visibility = (1 - k) * 0.75;
      if (this.halo) this.halo.update(this.total, this.p.radius * (0.72 + k * 0.22), 0.55 * (1 - k));
      if (this.level === 5) this.judgment.position.y = -0.2;
    }
    onAftermath() {
      for (const a of this.arcs) a.hide();
      if (this.netArcs) for (const a of this.netArcs) a.hide();
      this.pillar.setEnabled(false);
    }
    aftermathSpell(dt, k) {
      fadeGroup(this.judgment, 1 - smooth(k));
      this.emit(this.detail, dt * 12 * (1 - k), this.target, radialVel(2.6, 1.3));
    }
  }

  /* 3 · 末日陨星：五级分野在「飞行编排」而非陨石尺寸。
     L1 单星斜掠 → L2 双星错峰连坠 → L3 落点上空悬停蓄能后砸落 →
     L4 母星空中裂变、六子星抛射散落 → L5 三重连坠 + 地幔翻涌 + 持久地裂。 */
  class MeteorCast extends Cast {
    buildSpell() {
      /* 每级独有的编排：mode 飞行模式 / n 陨星数 / delay 副星错峰 / fission 裂变子星数 */
      const PLAN = [
        { mode: 'dive',    n: 1, delay: 0.00, fission: 0 },
        { mode: 'twin',    n: 2, delay: 0.34, fission: 0 },
        { mode: 'hover',   n: 1, delay: 0.00, fission: 0 },
        { mode: 'fission', n: 1, delay: 0.00, fission: 6 },
        { mode: 'triple',  n: 3, delay: 0.36, fission: 0 },
      ][this.level - 1];
      this.plan = PLAN;
      this.rockRadius = [0.72, 0.90, 1.18, 1.62, 2.40][this.level - 1];
      this.meteors = [];
      const baseSky = this.target.add(new V3(-2.5 - this.level * 0.35, 7.5 + this.level * 1.20, 2));
      for (let i = 0; i < PLAN.n; i++) {
        const root = this.group('apocalypseMeteor');
        const rock = this.mesh('Sphere', { diameter: 2, segments: 7 }, this.stone, root);
        rock.convertToFlatShadedMesh();
        const seams = this.level >= 3 ? 4 : 2;
        for (let s = 0; s < seams; s++) {
          const seam = this.mesh('Torus', { diameter: 1.94, thickness: 0.055 + s * 0.005, tessellation: 22 }, this.core, root);
          seam.rotation.set(0.4 + s * 0.68, s * 0.8, s * 0.42);
        }
        /* 主星全尺寸；副星缩小并在侧后方错开，编排一眼可读 */
        const start = i === 0 ? baseSky.clone() : baseSky.add(new V3(-1.7 * i, 2.3 * i, 1.4 * i));
        root.position.copyFrom(start);
        this.meteors.push({ root, r: i === 0 ? this.rockRadius : this.rockRadius * 0.60, delay: PLAN.delay * i, start });
      }
      this.meteor = this.meteors[0].root;
      this.skyStart = baseSky;

      this.fragments = [];
      const n = [0, 2, 4, 6, 9][this.level - 1];
      for (let i = 0; i < n; i++) {
        const mesh = this.mesh('Sphere', { diameter: 1, segments: 5 }, i % 3 ? this.stone : this.body);
        mesh.convertToFlatShadedMesh(); this.fragments.push({ mesh, a: i / n * TAU });
      }
      /* L4 裂变子星：母星飞至中段后抛向落点环，每颗独立落位 */
      this.shards = [];
      for (let i = 0; i < PLAN.fission; i++) {
        const mesh = this.mesh('Sphere', { diameter: 1, segments: 5 }, i % 2 ? this.body : this.core);
        mesh.convertToFlatShadedMesh(); mesh.setEnabled(false);
        this.shards.push({
          mesh, a: i / PLAN.fission * TAU,
          at: positionAt(this.target, this.p.radius * (0.30 + (i % 3) * 0.20), i / PLAN.fission * TAU, 0.25),
        });
      }
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
      for (const m of this.meteors) {
        m.root.scaling.setAll(m.r * this.p.size * (0.24 + k * 0.76));
        m.root.rotation.x = this.total * 0.18; m.root.rotation.z = this.total * 0.15;
        fadeGroup(m.root, 0.18 + 0.7 * k);
      }
      this.orbitFragments(k, true);
    }
    /* 飞行推进：编排差异全部集中在此 */
    meteorFlight(m, dt, u) {
      let k = Math.pow(u, 1.75);
      if (this.plan.mode === 'hover') {
        /* 前 45% 悬停在落点上空蓄能（熔缝增亮），其后急速砸落 */
        k = u < 0.45 ? 0.05 * (u / 0.45)
          : 0.05 + 0.95 * Math.pow((u - 0.45) / 0.55, 1.7);
      }
      V3.LerpToRef(m.start, this.target, k, m.root.position);
      m.root.position.y += m.r * this.p.size * 0.55 * k;
      m.root.scaling.setAll(m.r * this.p.size);
      m.root.rotation.x += dt * 0.75; m.root.rotation.z += dt * 0.53;
      fadeGroup(m.root, 1);
    }
    /* L4 空中裂变：母星中段炸开，子星抛物线散向各自落点 */
    fissionShards(u) {
      if (!this.shards.length) return;
      const burst = sat((u - 0.45) / 0.35);
      for (const s of this.shards) {
        s.mesh.setEnabled(burst > 0.01);
        if (burst <= 0.01) continue;
        V3.LerpToRef(this.meteor.position, s.at, burst, s.mesh.position);
        s.mesh.position.y += Math.sin(burst * Math.PI) * 2.0;
        s.mesh.scaling.setAll(this.p.size * 0.5);
        s.mesh.rotation.set(this.total * 3, this.total * 2.2, 0);
      }
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
      /* 每颗按自身错峰推进：副星延后起飞，形成连坠节奏 */
      for (const m of this.meteors) {
        const u = sat((this.flight - m.delay) / Math.max(0.12, 1 - m.delay));
        this.meteorFlight(m, dt, u);
      }
      this.fissionShards(sat(this.flight));
      this.orbitFragments(1, false);
      const lead = this.meteors[this.meteors.length - 1];
      this.emit(this.main, dt * 45, lead.root.position, radialVel(1.8, 2.2));
      this.emit(this.detail, dt * 34, lead.root.position, radialVel(2.8, 4.3));
      this.emit(this.smoke, dt * 16, lead.root.position, radialVel(0.8, 1.5));
      if (this.plan.mode === 'hover' && this.flight < 0.45) {
        /* 悬停蓄能：落点上空聚集高热核心 */
        this.emit(this.detail, dt * 30, this.target.add(new V3(0, 3.5, 0)), radialVel(1.2, 1.5));
      }
      return this.flight >= 1;
    }
    onImpact() {
      for (const m of this.meteors) m.root.setEnabled(false);
      for (const f of this.fragments) f.mesh.setEnabled(false);
      this.crater.setEnabled(true); this.blast.setEnabled(true); this.residue('fire');
    }
    impactSpell(dt, k) {
      /* L5 地幔翻涌：岩板持续起伏更久、幅度更大 */
      const surge = this.level === 5 ? 1.5 : 1.0;
      for (const s of this.slabs) {
        const r = this.p.radius * (0.34 + 0.37 * easeOutCubic(k));
        const h = Math.sin(k * Math.PI) * this.p.size * (1.0 + s.seed) * surge;
        s.mesh.position.set(Math.cos(s.a) * r, 0.25 + h, Math.sin(s.a) * r);
        s.mesh.rotation.set(Math.cos(s.a) * 0.75 * k, -s.a, Math.sin(s.a) * 0.75 * k);
        s.mesh.scaling.set(this.p.size * s.seed, this.p.size * s.seed, this.p.size * s.seed);
      }
      const r = this.p.radius * (0.16 + 0.84 * easeOutCubic(k));
      this.blast.scaling.set(r, r * 0.28, r); this.blast.visibility = Math.pow(1 - k, 2) * 0.7;
      this.emit(this.smoke, dt * 24, this.target, radialVel(2.5, 2.2));
      this.emit(this.main, dt * 30 * (1 - k), this.target, radialVel(3, 4));
      /* L4 裂变子星落地迸射 */
      for (const s of this.shards) {
        if (s.mesh.isEnabled()) this.emit(this.detail, dt * 8 * (1 - k), s.at, radialVel(2.4, 2.6));
      }
    }
    onAftermath() {
      this.blast.setEnabled(false);
      /* L5 持久地裂：子星与裂纹在余波中继续放热 */
      if (this.level >= 4) for (const s of this.shards) s.mesh.setEnabled(false);
    }
    aftermathSpell(dt, k) {
      fadeGroup(this.crater, 1 - smooth((k - 0.45) / 0.55));
      this.crater.position.y = -Math.pow(k, 2) * this.p.size * 0.5;
      const a = this.total * 2.3, at = positionAt(this.target, this.p.radius * 0.32, a, 0.2);
      this.emit(this.main, dt * 16 * (1 - k), at, radialVel(0.6, 1.7));
      this.emit(this.smoke, dt * 13 * (1 - k), at, radialVel(0.5, 2.0));
      this.emit(this.detail, dt * 12 * (1 - k), at, radialVel(1.4, 2.0));
      /* L5：裂纹余烬贯穿整个余波，残留更久 */
      if (this.level === 5) this.emit(this.detail, dt * 10 * (1 - k), at, radialVel(0.8, 1.2));
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

  /* 4 · 天穹轨道炮：五级分野在「光束的走法」而非准直环层数。
     L1 手持单束水平贯穿 → L2 主束贯穿落点后折射出侧向分束 →
     L3 细束聚能蓄势、末段猛然贯穿 → L4 炮口跃迁至天穹垂直轰击 →
     L5 五束齐贯 + 余波期环形余波持续扩散。 */
  class StarBeamCast extends Cast {
    buildSpell() {
      this.mode = ['solo', 'refract', 'charge', 'sky', 'sky'][this.level - 1];
      this.cannon = this.group('orbitalCannon');
      this.rings = [];
      const n = this.level + 1;
      for (let i = 0; i < n; i++) {
        const ring = this.mesh('Torus', { diameter: 2.3 + (i % 2) * 1.0, thickness: 0.045, tessellation: 48 }, this.edge, this.cannon);
        ring.position.y = (i - n / 2) * 0.7;
        this.rings.push(ring);
      }
      this.star = this.mesh('Polyhedron', { type: 1, size: 0.6 }, this.core, this.cannon);
      /* 束数按编排分配：L1 单束 / L2 主+两折射 / L3-L4 主副束 / L5 五束齐贯 */
      this.beams = [];
      const beamCount = [1, 3, 2, 2, 5][this.level - 1];
      for (let i = 0; i < beamCount; i++) {
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
      const k = sat(this.flight);
      let envelope;
      if (this.mode === 'charge') {
        /* L3 聚能延迟：前段细束蓄势抖动，过半后猛然贯穿 */
        envelope = k < 0.55
          ? 0.16 + 0.20 * Math.abs(Math.sin(k * 26))
          : 0.30 + 0.70 * easeOutCubic((k - 0.55) / 0.45);
      } else {
        envelope = Math.min(1, k * 9) * (0.83 + 0.17 * Math.sin(this.total * 24));
      }
      for (let i = 0; i < this.beams.length; i++) {
        const beam = this.beams[i]; beam.setEnabled(true);
        if (this.mode === 'refract' && i >= 1) {
          /* L2 折射：主束贯穿落点后向两侧弹射分束 */
          const a = (i === 1 ? 1 : -1) * (0.95 + 0.22 * Math.sin(this.total * 6));
          const to = this.target.add(new V3(Math.cos(a) * this.p.radius * 1.5, 0.45, Math.sin(a) * this.p.radius * 1.5));
          stretchBeam(beam, this.target.add(new V3(0, 0.2, 0)), to, this.p.size * 0.17 * envelope);
          continue;
        }
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
      /* L5 爆发期环形余波反复扩散 */
      if (this.level === 5 && Math.floor((this.total - dt) * 4) !== Math.floor(this.total * 4)) {
        this.shock(this.p.radius * 1.1, 0.7, 0.32);
      }
    }
    onAftermath() { for (const b of this.beams) b.setEnabled(false); this.cannon.setEnabled(false); }
    aftermathSpell(dt, k) {
      this.emit(this.detail, dt * 12 * (1 - k), this.target, radialVel(2.1, 1.2));
      /* L5 余波期环形余波持续，天穹轨道炮的收尾标志 */
      if (this.level === 5 && Math.floor((this.total - dt) * 3) !== Math.floor(this.total * 3)) {
        this.shock(this.p.radius * 1.25, 0.8, 0.28);
      }
    }
  }

  /* 5 · 雷狱：五级分野在「柱阵拓扑」而非柱子数量。
     L1 三柱链式闪击 → L2 四柱闭环电网 → L3 六柱穹顶法印 + 核心奇点 →
     L4 八柱拔地升成高塔、电弧上翻穹顶 → L5 内外双环十柱 + 持续放电 + 连锁崩解。 */
  class VoltBastionCast extends Cast {
    buildSpell() {
      this.prison = this.group('stormPrison'); this.prison.position.copyFrom(this.target);
      this.pylons = []; this.arcs = []; this.from = new V3(); this.to = new V3();
      /* 柱高与布阵按级分野；数量只是辅助读数 */
      const PLAN = [
        { n: 3,  h: 3.3, rings: [0.72],       pulse: 'chain'  },
        { n: 4,  h: 3.6, rings: [0.72],       pulse: 'loop'   },
        { n: 6,  h: 3.9, rings: [0.72],       pulse: 'loop'   },
        { n: 8,  h: 6.6, rings: [0.60],       pulse: 'tower'  },
        { n: 10, h: 5.2, rings: [0.40, 0.92], pulse: 'double' },
      ][this.level - 1];
      this.plan = PLAN;
      const doubleRing = PLAN.rings.length > 1;
      for (let i = 0; i < PLAN.n; i++) {
        const node = this.group('pylon', this.prison);
        const pillar = this.mesh('Cylinder', { height: PLAN.h, diameterTop: 0.13, diameterBottom: 0.55, tessellation: 5 }, this.stone, node);
        pillar.position.y = PLAN.h / 2;
        const gem = this.mesh('Polyhedron', { type: 1, size: 0.26 }, this.core, node); gem.position.y = PLAN.h + 0.15;
        /* L5 内环 4 柱 / 外环 6 柱各自均布并错角 */
        if (doubleRing) {
          const outer = i >= 4, idx = outer ? i - 4 : i;
          node._ring = outer ? 1 : 0;
          node._angle = idx * TAU / (outer ? 6 : 4) + (outer ? 0.31 : 0);
        } else { node._ring = 0; node._angle = i * TAU / PLAN.n; }
        this.pylons.push(node);
        this.arcs.push(new Arc(this, this.core, 0.048, this.prison, 14));
        if (this.level >= 3) this.arcs.push(new Arc(this, this.edge, 0.025, this.prison, 14));
      }
      this.roof = new Rune(this, this.target.add(new V3(0, PLAN.h + 3.7, 0)), this.level, 'rune');
      this.singularity = this.mesh('Sphere', { diameter: 1, segments: 16 }, this.veil, this.prison);
      this.singularity.position.y = PLAN.h + 0.1;
      this._lastBurst = -1;
      this.travelDuration = (0.8 + this.level * 0.36) * this.p.period;
      this.preview(0, 0);
    }
    pylonPos(node) {
      const r = this.p.radius * this.plan.rings[node._ring];
      return { x: Math.cos(node._angle) * r, z: Math.sin(node._angle) * r };
    }
    preview(dt, k) {
      /* L4 柱根从更深处拔起，读作"高塔自地底升起" */
      const rise = this.level === 4 ? 6.5 : 3;
      this.pylons.forEach(p => {
        const pos = this.pylonPos(p);
        p.position.set(pos.x, -(1 - k) * rise, pos.z);
        p.scaling.setAll(this.p.size); fadeGroup(p, 0.2 + k * 0.8);
      });
      this.singularity.scaling.setAll(this.p.size * (0.2 + k));
      this.roof.root.position.y = (this.plan.h + 0.15) * this.p.size;
      this.roof.update(this.total, this.p.radius * 0.70, k * 0.4);
    }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      const n = this.pylons.length, h = this.plan.h * this.p.size;
      this.pylons.forEach(p => { p.position.y = 0; });
      for (let i = 0; i < this.arcs.length; i++) {
        const from = this.pylons[i % n], to = this.pylons[(i + 1) % n];
        const ra = this.p.radius * this.plan.rings[from._ring], rb = this.p.radius * this.plan.rings[to._ring];
        this.from.set(Math.cos(from._angle) * ra, h, Math.sin(from._angle) * ra);
        if (i >= n) this.to.set(0, h * 1.35, 0);
        else this.to.set(Math.cos(to._angle) * rb, h * (0.45 + 0.35 * Math.sin(this.total * 3 + i)), Math.sin(to._angle) * rb);
        let amp = 0.35 + this.level * 0.04;
        /* L1 链式闪击：电流沿柱序依次窜过，只有当前那段满强度 */
        if (this.plan.pulse === 'chain') {
          const phase = ((this.total * 1.6 - i / this.arcs.length) % 1 + 1) % 1;
          amp *= 0.30 + 1.05 * Math.max(0, Math.sin(phase * Math.PI));
        }
        this.arcs[i].update(dt, this.from, this.to, this.total + i, amp, 0.4);
      }
      this.roof.update(-this.total, this.p.radius * 0.72, 0.7);
      this.singularity.scaling.setAll(this.p.size * (1 + Math.sin(this.total * 11) * 0.2));
      this.emit(this.detail, dt * 55, this.target.add(new V3(0, h * 0.5, 0)), radialVel(3, 0.5));
      return this.flight >= 1;
    }
    onImpact() { this.residue('electric'); this._lastBurst = -1; }
    impactSpell(dt, k) {
      this.prison.scaling.set(1 + k * 0.18, 1 - k * 0.25, 1 + k * 0.18);
      this.singularity.scaling.setAll(this.p.size * (1 + k * 5)); this.singularity.visibility = 1 - k;
      for (const a of this.arcs) a.mesh.visibility = 1 - k;
      this.roof.update(this.total, this.p.radius * (0.72 + k * 0.25), 0.6 * (1 - k));
      if (this.level === 5) {
        /* L5 连锁崩解：十柱按序向外炸开 + 核心持续放电 */
        const step = Math.floor(k * this.pylons.length);
        if (step !== this._lastBurst && step < this.pylons.length) {
          this._lastBurst = step;
          const pos = this.pylonPos(this.pylons[step]);
          SKILLS.addTransient(new Shockwave(this.game,
            new V3(this.target.x + pos.x, 0, this.target.z + pos.z), this.rgb,
            this.p.radius * 0.30, 0.5, { alpha: 0.55 }));
        }
        this.emit(this.detail, dt * 42, this.target.add(new V3(0, this.plan.h * 0.6, 0)), radialVel(5, 1.5));
      }
    }
    onAftermath() { for (const a of this.arcs) a.hide(); }
    aftermathSpell(dt, k) {
      fadeGroup(this.prison, 1 - smooth(k)); this.prison.position.y = -k * this.p.size * 2;
      this.emit(this.detail, dt * 15 * (1 - k), this.target, radialVel(2, 1.7));
    }
  }

  /* 6 · 冰川纪元：五级分野在「冻结方式」而非冰晶数量。
     L1 五锥单圈突刺 → L2 加一道冻结波环 → L3 环形山脊 + 冰罩首现 →
     L4 三重同心波分三批生长 → L5 中央巨型主冠 + 持续飘雪 + 永久冰面。 */
  class GlacialCrownCast extends Cast {
    buildSpell() {
      this.glacier = this.group('glacier'); this.glacier.position.copyFrom(this.target);
      this.spikes = [];
      const n = [5, 8, 12, 18, 26][this.level - 1];
      const threeBatches = this.level >= 4;
      for (let i = 0; i < n; i++) {
        const spike = this.group('iceObelisk', this.glacier);
        const shell = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 1, height: 1, tessellation: 5 }, this.body, spike);
        shell.position.y = 0.5;
        const edge = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 0.11, height: 1.05, tessellation: 4 }, this.core, spike);
        edge.position.set(0.1, 0.52, 0.12);
        /* L1-3 顺次错落；L4+ 明确的三批同心推进 */
        const batch = threeBatches ? i % 3 : i % 4;
        this.spikes.push({ mesh: spike, angle: i * 2.399963, r: 0.25 + (i % 4) * 0.18,
          h: (1.7 + (i % 5) * 0.65) * (i % 4 === 0 ? 1.4 : 1), batch });
      }
      /* L5 独占标志物：中央巨型主冠，最后升起 */
      this.crownMonolith = null;
      if (this.level === 5) {
        const crown = this.group('crownMonolith', this.glacier);
        const shell = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 1.6, height: 1, tessellation: 6 }, this.body, crown);
        shell.position.y = 0.5;
        const edge = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 0.2, height: 1.04, tessellation: 5 }, this.core, crown);
        edge.position.set(0.14, 0.52, 0.16);
        crown.scaling.setAll(0.001);
        this.crownMonolith = crown;
      }
      /* 冰罩是 L3+ 的领域分界，低阶保持开阔剪影 */
      this.dome = null;
      if (this.level >= 3) {
        this.dome = this.mesh('Sphere', { diameter: 2, segments: 24, slice: 0.5 }, this.veil, this.glacier);
        this.dome.scaling.setAll(0.01);
      }
      /* 冻结波环：L2 起一道，L4 起三重同心 */
      this.waves = [];
      const waveCount = this.level >= 4 ? 3 : this.level >= 2 ? 1 : 0;
      for (let i = 0; i < waveCount; i++) {
        const w = this.sprite('freezeWave', 'ring', this.glacier, true);
        w.scaling.setAll(0.01);
        this.waves.push(w);
      }
      this.snow = this.emitter('spark', { life: [1.4, 2.6], size0: [0.05, 0.13], size1: [0.02, 0.06], alpha: [0.3, 0.7], gravity: 0.6, drag: 0.15, turb: 0.8 }, 1.0, 0.7);
      this.travelDuration = (0.45 + this.level * 0.25) * this.p.period;
      this.glacier.setEnabled(false);
    }
    onRelease() { this.glacier.setEnabled(true); }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      const k = sat(this.flight);
      this.spikes.forEach((s, i) => {
        const stagger = this.level >= 4 ? s.batch * 0.26 : (i % 4) * 0.1;
        const grow = easeOutCubic(sat((k - stagger) * 1.8));
        s.mesh.position.set(Math.cos(s.angle) * this.p.radius * s.r, -0.05, Math.sin(s.angle) * this.p.radius * s.r);
        s.mesh.scaling.set(this.p.size * grow * 0.85, s.h * this.p.size * grow, this.p.size * grow * 0.85);
        s.mesh.rotation.z = -Math.cos(s.angle) * 0.26; s.mesh.rotation.x = Math.sin(s.angle) * 0.26;
      });
      if (this.crownMonolith) {
        const grow = easeOutCubic(sat((k - 0.45) * 2.2));
        this.crownMonolith.scaling.setAll(3.0 * this.p.size * grow);
      }
      if (this.dome) {
        this.dome.scaling.set(this.p.radius * k, this.p.radius * k * 0.5, this.p.radius * k);
        this.dome.visibility = 0.38 * (1 - k);
      }
      /* 冻结波逐层向外推进：一眼可读的同心波 */
      this.waves.forEach((w, i) => {
        const u = sat((k - i * 0.24) / 0.76);
        const r = this.p.radius * 1.6 * (0.06 + 0.94 * easeOutCubic(u));
        w.scaling.set(r, r, 1);
        this.spriteColor(w, (1 - Math.pow(u, 1.8)) * 0.72, 1.15);
      });
      this.emit(this.smoke, dt * 20, this.target, radialVel(3.5, 0.25));
      return this.flight >= 1;
    }
    onImpact() { this.residue('ice'); if (this.dome) this.dome.setEnabled(false); }
    impactSpell(dt, k) {
      this.glacier.scaling.setAll(1 + Math.sin(k * Math.PI) * 0.04);
      const at = positionAt(this.target, this.p.radius * 0.6, this.total * 8, 7);
      this.emit(this.snow, dt * 55, at, () => ({ x: randSpread(2), y: -1.4, z: randSpread(2) }));
      this.waves.forEach(w => this.spriteColor(w, 0.4 * (1 - k), 1.15));
    }
    aftermathSpell(dt, k) {
      const at = positionAt(this.target, this.p.radius * 0.5, this.total * 5, 6);
      /* L5 持续飘雪贯穿整个余波 */
      this.emit(this.snow, dt * (this.level === 5 ? 52 : 35) * (1 - k), at, () => ({ x: randSpread(1), y: -1.1, z: randSpread(1) }));
      this.waves.forEach(w => this.spriteColor(w, 0.32 * (1 - k), 1.15));
      fadeGroup(this.glacier, 1 - smooth((k - 0.25) / 0.75)); this.glacier.position.y = -k * k * 1.5;
    }
  }

  /* 7 · 龙卷裂隙：五级分野在「位移与风壁的耦合」，而非风壁粗细。
     L1 纯位移残像（无风壁） → L2 +螺旋风壁 → L3 +落点残留小旋风 →
     L4 +落点持续龙卷 → L5 撕裂式过冲位移 + 十二米巨龙卷 + 裹挟碎石。 */
  class WindRipCast extends Cast {
    buildSpell() {
      this.controlsMovement = true; /* travel 阶段驱动角色位移，归属由 moveOwner 仲裁 */
      this.vortex = this.group('windVortex'); this.vortex.position.copyFrom(this.target);
      const PLAN = [
        { spirals: 0, rings: 0, debris: 0,  h: 0,    tail: 0,   dash: 0 },
        { spirals: 3, rings: 3, debris: 4,  h: 5.6,  tail: 0,   dash: 0 },
        { spirals: 3, rings: 4, debris: 6,  h: 6.4,  tail: 1.1, dash: 0 },
        { spirals: 5, rings: 5, debris: 9,  h: 8.4,  tail: 3.6, dash: 0 },
        { spirals: 5, rings: 7, debris: 15, h: 12,   tail: 4.0, dash: 0.17 },
      ][this.level - 1];
      this.plan = PLAN;
      this.spirals = [];
      for (let j = 0; j < PLAN.spirals; j++) {
        const path = [];
        for (let i = 0; i < 70; i++) {
          const u = i / 69, a = u * TAU * 2.2 + j * TAU / 5, r = (0.22 + u * 0.74) * this.p.radius * 0.55;
          path.push(new V3(Math.cos(a) * r, u * PLAN.h, Math.sin(a) * r));
        }
        const ribbon = this.mesh('Tube', { path, radius: j % 2 ? 0.08 : 0.035, tessellation: 4 }, j % 2 ? this.edge : this.core, this.vortex);
        this.spirals.push(ribbon);
      }
      this.rings = [];
      for (let i = 0; i < PLAN.rings; i++) {
        const disc = this.sprite('windSlice', 'vortex', this.vortex, true);
        disc.position.y = i * PLAN.h / Math.max(1, PLAN.rings); const r = this.p.radius * (0.45 + i * 0.12);
        disc.scaling.set(r, r, 1); this.rings.push(disc);
      }
      this.debris = [];
      for (let i = 0; i < PLAN.debris; i++) {
        const rock = this.mesh('Polyhedron', { type: 3, size: 0.18 + (i % 3) * 0.1 }, this.stone, this.vortex);
        this.debris.push(rock);
      }
      this.ghosts = [];
      for (let i = 0; i < 5; i++) {
        const ghost = this.mesh('Cylinder', { diameterTop: 0.28, diameterBottom: 0.8, height: 1.7, tessellation: 6 }, this.veil);
        ghost.position.copyFrom(V3.Lerp(this.startGround, this.target, i / 5)); ghost.position.y = 1;
        ghost.setEnabled(false); this.ghosts.push(ghost);
      }
      /* L4+ 落点龙卷在余波中持续存在，尾迹期显著拉长 */
      if (PLAN.tail > 0) this.aftermathDur = PLAN.tail * this.p.period;
      this.travelDuration = (0.35 + this.level * 0.28) * this.p.period;
      this.vortex.scaling.setAll(0.01);
    }
    preview(dt, k) {
      /* L1 无风壁：位移本体保持干净，不预览旋涡 */
      this.vortex.scaling.setAll(this.plan.spirals ? 0.25 + k * 0.25 : 0.01);
      this.vortex.rotation.y = this.total * 2;
      fadeGroup(this.vortex, k * 0.35);
      this.rings.forEach(r => this.spriteColor(r, k * 0.15));
    }
    onRelease() { this.ghosts.forEach(g => g.setEnabled(true)); }
    travel(dt) {
      this.flight += dt * this.p.speed / this.travelDuration;
      const k = sat(this.flight);
      if (SKILLS.moveOwner(this.game) === this) {
        /* L5 撕裂位移：冲过落点再回拉，k=1 时精确回到 target */
        const dash = easeOutCubic(sat(k * 3)) + (this.plan.dash ? Math.sin(k * Math.PI) * this.plan.dash : 0);
        this.game.mage.root.position.x = lerp(this.startGround.x, this.target.x, dash);
        this.game.mage.root.position.z = lerp(this.startGround.z, this.target.z, dash);
        this.lift = Math.sin(Math.min(1, dash) * Math.PI) * 0.8;
      }
      if (this.plan.spirals) {
        this.vortex.scaling.setAll(0.45 + Math.min(1, k * 2) * 0.55);
        this.vortex.rotation.y += dt * (3.5 + this.level * 0.45);
        fadeGroup(this.vortex, 0.85);
      } else { this.vortex.setEnabled(false); }
      this.rings.forEach((r, i) => { r.rotation.z = this.total * (i % 2 ? -2 : 1); this.spriteColor(r, 0.3); });
      this.debris.forEach((r, i) => {
        const a = this.total * 2.0 + i * 2.399, y = (i % 6 + 1) * (this.plan.h >= 12 ? 1.6 : 0.65);
        const radius = this.p.radius * (0.25 + y * 0.035);
        r.position.set(Math.cos(a) * radius, y, Math.sin(a) * radius); r.rotation.set(this.total + i, this.total * 2, i);
      });
      this.ghosts.forEach((g, i) => { g.visibility = Math.max(0, 0.55 - k - i * 0.03); });
      this.emit(this.detail, dt * 40, this.target, radialVel(4, 3));
      return this.flight >= 1;
    }
    onImpact() { this.residue('wind'); }
    impactSpell(dt, k) {
      if (!this.plan.spirals) return;
      this.vortex.rotation.y += dt * 5; this.vortex.scaling.set(1 + k * 0.25, 1 - k * 0.25, 1 + k * 0.25);
    }
    aftermathSpell(dt, k) {
      if (this.plan.spirals) {
        this.vortex.rotation.y += dt * 4 * (1 - k); fadeGroup(this.vortex, 1 - smooth(k));
        /* L4/L5 持续龙卷：余波中保持全高，只在最后塌陷 */
        this.vortex.scaling.y = this.plan.tail > 0
          ? Math.max(0.01, 1 - Math.pow(k, 3))
          : Math.max(0.01, 0.75 - k * 0.74);
      }
      this.rings.forEach(r => this.spriteColor(r, 0.3 * (1 - k)));
      this.emit(this.detail, dt * (this.plan.tail > 0 ? 26 : 8) * (1 - k), this.target, radialVel(2.4, 2.2));
    }
  }

  /* 8 · 群山崩塌：五级分野在「地脉抬升的编排」而非山峰数量。
     L1 单排四岩 → L2 犬牙双排错位 → L3 地裂缝随推进撕开 →
     L4 直线与环形夹击 → L5 二十二岩 + 中央主峰 + 放射地裂。 */
  class RockFangCast extends Cast {
    buildSpell() {
      this.mountains = this.group('tectonicRidge'); this.peaks = [];
      const n = [4, 6, 9, 15, 22][this.level - 1];
      const doubleRow = this.level === 2;
      /* L4/L5 的直线段与环形段分界：环形是"夹击"读数，直线是推进主体 */
      const lineCount = this.level === 4 ? 6 : this.level === 5 ? 8 : n;
      for (let i = 0; i < n; i++) {
        const root = this.group('mountainPeak', this.mountains);
        const rock = this.mesh('Cylinder', { diameterTop: 0.12, diameterBottom: 1.6, height: 1, tessellation: 5 }, this.stone, root);
        rock.position.y = 0.5;
        const fissure = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 0.13, height: 0.94, tessellation: 4 }, this.core, root);
        fissure.position.set(0.15, 0.5, 0.46);
        const isRing = this.level >= 4 && i >= lineCount;
        const a = i * 2.399, along = (i % 6 + 1) / 6;
        let at;
        if (isRing) at = positionAt(this.target, this.p.radius * (0.40 + i % 3 * 0.18), a, 0);
        else {
          const t = Math.min(1, (i + 1) / lineCount);
          at = V3.Lerp(this.startGround, this.target, t);
          /* L2 犬牙双排：沿推进轴左右错开，剪影一眼可读 */
          if (doubleRow) at.addInPlace(this.side.scale((i % 2 ? 1 : -1) * 1.15));
        }
        this.peaks.push({ mesh: root, at, delay: isRing ? 0.25 + (i % 4) * 0.1 : along * 0.3,
          h: (1.6 + (i % 5) * 0.85) * this.p.size, a });
        root.scaling.setAll(0.001); root.position.copyFrom(at);
      }
      /* L5 中央主峰：全等级独占标志物，最后拔起 */
      if (this.level === 5) {
        const root = this.group('crownPeak', this.mountains);
        const rock = this.mesh('Cylinder', { diameterTop: 0.16, diameterBottom: 2.4, height: 1, tessellation: 6 }, this.stone, root);
        rock.position.y = 0.5;
        const fissure = this.mesh('Cylinder', { diameterTop: 0, diameterBottom: 0.2, height: 0.94, tessellation: 5 }, this.core, root);
        fissure.position.set(0.2, 0.5, 0.7);
        root.scaling.setAll(0.001); root.position.copyFrom(this.target);
        this.peaks.push({ mesh: root, at: this.target.clone(), delay: 0.62, h: 5.2 * this.p.size, a: 0 });
      }
      /* L3+ 地裂缝：随地脉推进逐步撕开的实体裂谷，低阶没有 */
      this.fissureMesh = null;
      if (this.level >= 3) {
        this.fissurePts = Array.from({ length: 14 }, () => new V3(0, -3, 0));
        this.fissureMesh = this.mesh('Tube', { path: this.fissurePts, radius: 0.11, tessellation: 4, updatable: true, cap: BABYLON.Mesh.NO_CAP }, this.edge, this.mountains, 'fissure');
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
      /* 地裂缝沿推进方向逐步撕开，未到达的一段埋在地下 */
      if (this.fissureMesh) {
        const reveal = sat(this.flight * 1.1), last = this.fissurePts.length - 1;
        for (let j = 0; j <= last; j++) {
          const u = j / last, base = V3.Lerp(this.startGround, this.target, u);
          if (u <= reveal) this.fissurePts[j].set(base.x + Math.sin(j * 3.7) * 0.35, 0.07, base.z + Math.cos(j * 2.9) * 0.35);
          else this.fissurePts[j].set(base.x, -3, base.z);
        }
        BABYLON.MeshBuilder.CreateTube(null, { path: this.fissurePts, instance: this.fissureMesh }, this.scene);
      }
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

  /* 10 · 魔弹连射：五级分野在「弹幕编排」。
     L1 掌前单发直射 → L2 三连错峰扇射 → L3 六弹环绕法印轮番俯冲 →
     L4 双环螺旋升空后地毯式倾泻 → L5 头顶十二弹光环四轮风暴 + 核心巨弹终结。 */
  const BULLET_DIR = new V3();
  class BarrageCast extends Cast {
    buildSpell() {
      this.shots = []; this.halo = []; this.volleyT = 0;
      const L = this.level;
      this.mode = ['direct', 'volley', 'orbit', 'fan', 'storm'][L - 1];
      const bullet = len => {
        const mesh = this.sprite('magicBullet', 'magicBullet', null);
        mesh.scaling.set(len * 0.30, -len, 1);
        return mesh;
      };
      const addShot = o => {
        const s = Object.assign({
          bullet: bullet(o.len || 1.2), streak: this.sprite('bulletStreak', 'beamGlow', null),
          haloRef: null, isCore: false, phase: 0, r0: 0, y0: 0, orbitR: 0, orbitY: 0,
          start: new V3(), end: new V3(), started: false, landed: false,
        }, o);
        s.streak.setEnabled(false);
        this.shots.push(s);
      };
      if (L === 5) {
        this.grandSeal = this.sprite('grandSeal', 'grandCircle', null, true);
        this.grandSeal.position.copyFrom(this.startGround);
        this.grandSeal.position.y = 0.055;
        for (let i = 0; i < 12; i++) this.halo.push(bullet(1.55));
        for (let r = 0; r < 4; r++) {
          for (let i = 0; i < 12; i++) {
            addShot({
              len: 1.4, haloRef: this.halo[i],
              end: positionAt(this.target, this.p.radius * (0.16 + ((i * 7) % 5) * 0.17), i * 2.399 + r * 1.13, 0.4),
              launchAt: r * 0.5 + (i / 12) * 0.42, flightDur: 0.44 + this.aimDist * 0.008,
            });
          }
        }
        addShot({ len: 3.8, isCore: true, haloRef: this.halo[0],
          end: this.target.add(new V3(0, 0.45, 0)),
          launchAt: 2.12, flightDur: 0.7 });
      } else if (L === 4) {
        /* 双环绕施法者螺旋升空，再分批砸向落点环带与中场合围 */
        for (let i = 0; i < 12; i++) {
          const outer = i >= 5;
          addShot({
            len: outer ? 1.7 : 1.55, phase: i * TAU / 12,
            r0: outer ? 2.5 : 1.55, y0: outer ? 3.5 : 2.2,
            end: outer
              ? positionAt(this.target, this.p.radius * (0.72 + ((i * 5) % 3) * 0.16), i * 2.399, 0.4)
              : this.startGround.add(this.dir.scale(this.aimDist * (0.45 + (i % 2) * 0.22)))
                .addInPlace(this.side.scale(((i % 3) - 1) * this.p.radius * 0.55))
                .addInPlace(new V3(0, 0.4, 0)),
            launchAt: 0.62 + i * 0.075, flightDur: 0.6,
          });
        }
      } else if (L === 3) {
        this.skySeal = new Rune(this, this.target.add(new V3(0, 7.2, 0)), L, 'rune');
        for (let i = 0; i < 6; i++) {
          addShot({
            len: 1.7, orbitR: this.p.radius * 1.05, orbitY: 6.4, phase: i * TAU / 6,
            end: positionAt(this.target, this.p.radius * (0.2 + ((i * 7) % 4) * 0.2), i * 2.399 + 0.6, 0.42),
            launchAt: i * 0.11, flightDur: 0.52,
          });
        }
      } else if (L === 2) {
        for (let i = 0; i < 3; i++) {
          addShot({
            len: 1.75, slot: i - 1,
            end: this.target.add(this.side.scale((i - 1) * this.p.radius * 0.42)).add(new V3(0, 0.45, 0)),
            launchAt: i * 0.15, flightDur: 0.4 + this.aimDist / 38,
          });
        }
      } else {
        addShot({ len: 2.0, slot: 0,
          end: this.target.add(new V3(0, 0.45, 0)),
          launchAt: 0.02, flightDur: 0.46 + this.aimDist / 34 });
      }
      this.volleyEnd = this.shots.reduce((m, s) => Math.max(m, s.launchAt + s.flightDur), 0);
      this.travelDuration = this.volleyEnd + 0.05;
      this.preview(0, 0);
    }
    orbitPos(s, out) {
      const a = s.phase + this.total * 1.75;
      out.set(this.target.x + Math.cos(a) * s.orbitR,
        s.orbitY + Math.sin(this.total * 2.1 + s.phase) * 0.28,
        this.target.z + Math.sin(a) * s.orbitR);
      return a;
    }
    spiralPos(s, out) {
      const a = s.phase + this.total * 2.6;
      out.set(this.startGround.x + Math.cos(a) * s.r0,
        s.y0 + Math.sin(this.total * 3.1 + s.phase) * 0.2,
        this.startGround.z + Math.sin(a) * s.r0);
      return a;
    }
    haloPos(i, out) {
      const a = i * TAU / 12 + this.total * 1.05;
      out.set(this.startGround.x + Math.cos(a) * 4.6 * this.p.size,
        7.3 + Math.sin(this.total * 1.9 + i * 0.52) * 0.3,
        this.startGround.z + Math.sin(a) * 4.6 * this.p.size);
      return a;
    }
    orientIdle(s, tangentA, tiltY) {
      BULLET_DIR.set(-Math.sin(tangentA), tiltY, Math.cos(tangentA)).normalize();
      rollTo(s.bullet, BULLET_DIR, this.game.camera.position);
      s.bullet.scaling.set(s.len * 0.30 * this.p.size, -s.len * this.p.size, 1);
      this.spriteColor(s.bullet, 0.72 + 0.28 * Math.sin(this.total * 7 + s.phase * 3), 1.05);
    }
    updateHalo(alpha) {
      for (let i = 0; i < this.halo.length; i++) {
        const m = this.halo[i];
        m.setEnabled(true);
        const a = this.haloPos(i, m.position);
        BULLET_DIR.set(-Math.sin(a), -0.12, Math.cos(a)).normalize();
        rollTo(m, BULLET_DIR, this.game.camera.position);
        m.scaling.set(1.25 * 0.30 * this.p.size, -1.25 * this.p.size, 1);
        this.spriteColor(m, alpha * (0.86 + 0.14 * Math.sin(this.total * 6 + i * 1.7)), 1.05);
      }
    }
    preview(dt, k) {
      const open = smooth(sat(k * 1.6));
      const sw = this.p.size * (0.35 + 0.65 * open);
      if (this.level === 5) this.updateHalo(0.22 + 0.6 * open);
      for (let i = 0; i < this.shots.length; i++) {
        const s = this.shots[i], b = s.bullet;
        if (this.mode === 'storm' && !s.isCore) { b.setEnabled(false); continue; }
        b.setEnabled(true);
        b.scaling.set(s.len * 0.30 * sw, -s.len * sw, 1);
        if (this.mode === 'orbit') {
          const a = this.orbitPos(s, b.position);
          this.orientIdle(s, a, 0.05);
        } else if (this.mode === 'fan') {
          const a = this.spiralPos(s, b.position);
          this.orientIdle(s, a, 0.35);
        } else if (s.isCore) {
          b.position.copyFrom(this.startGround);
          b.position.y = (4.2 + 1.4 * open) * this.p.size;
          rollTo(b, BULLET_DIR.set(0, -1, 0), this.game.camera.position);
          this.spriteColor(b, 0.3 + 0.7 * open, 1.15);
        } else {
          /* L1/L2：悬在掌前随蓄力前移，末端轻微呼吸浮动 */
          const lead = 0.85 + 1.2 * k;
          b.position.copyFrom(this.origin).addInPlace(this.dir.scale(lead));
          if (s.slot) b.position.addInPlace(this.side.scale(s.slot * 0.5));
          b.position.y += 0.12 * Math.sin(this.total * 3.2 + i * 1.9);
          rollTo(b, BULLET_DIR.copyFrom(this.dir), this.game.camera.position);
          this.spriteColor(b, 0.2 + 0.78 * open, 1.1);
        }
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
      this.emit(this.main, 8, this.origin, radialVel(1.4, 0.6), true);
      this.emit(this.detail, 10, this.origin, radialVel(2.2, 1.0), true);
    }
    travel(dt) {
      this.volleyT += dt * this.p.speed;
      if (this.halo.length) this.updateHalo(0.8);
      for (const s of this.shots) {
        const u = sat((this.volleyT - s.launchAt) / s.flightDur);
        if (u <= 0) {
          if (this.mode === 'orbit' || this.mode === 'fan') {
            s.bullet.setEnabled(true);
            const a = this.mode === 'orbit' ? this.orbitPos(s, s.bullet.position) : this.spiralPos(s, s.bullet.position);
            this.orientIdle(s, a, this.mode === 'orbit' ? 0.05 : 0.35);
          }
          continue;
        }
        if (u < 1) {
          if (!s.started) {
            s.started = true;
            s.bullet.setEnabled(true);
            if (s.haloRef) s.start.copyFrom(s.haloRef.position);
            else if (this.mode === 'orbit' || this.mode === 'fan') s.start.copyFrom(s.bullet.position);
            else s.start.copyFrom(this.origin);
            this.emit(this.detail, 5, s.start, radialVel(1.6, 0.6), true);
          }
          V3.LerpToRef(s.start, s.end, u * u, s.bullet.position);
          s.bullet.position.y += Math.sin(u * Math.PI) * (s.isCore ? 0.2 : this.mode === 'orbit' ? -0.3 : 0.55 + 0.12 * this.level);
          s.end.subtractToRef(s.start, BULLET_DIR); BULLET_DIR.normalize();
          rollTo(s.bullet, BULLET_DIR, this.game.camera.position);
          s.bullet.scaling.set(s.len * 0.30 * this.p.size, -s.len * this.p.size, 1);
          this.spriteColor(s.bullet, 1, 1.1);
          s.streak.setEnabled(true);
          stretchBeam(s.streak, s.bullet.position.add(BULLET_DIR.scale(-s.len * this.p.size * 0.75)),
            s.bullet.position, this.p.size * (s.isCore ? 0.34 : 0.13));
          this.spriteColor(s.streak, 0.34 + 0.18 * Math.sin(this.total * 22 + s.len * 9), 1.35);
          this.emit(this.main, dt * 12, s.bullet.position, radialVel(0.6, 0.2));
          this.emit(this.detail, dt * 7, s.bullet.position, radialVel(1.4, 0.4));
        } else if (!s.landed) {
          s.landed = true;
          s.streak.setEnabled(false);
          s.bullet.position.copyFrom(s.end);
          s.end.subtractToRef(s.start, BULLET_DIR); BULLET_DIR.normalize();
          rollTo(s.bullet, BULLET_DIR, this.game.camera.position);
          this.emit(this.main, 4, s.end, radialVel(1.1, 0.7), true);
          this.emit(this.detail, 6 + this.level, s.end, radialVel(2.4, 1.5), true);
          if (s.isCore) {
            this.shock(this.p.radius * 1.05, 0.7, 0.5);
            this.emit(this.main, 26, s.end, radialVel(3.2, 2.2), true);
          }
        }
      }
      if (this.skySeal) this.skySeal.update(-this.total, this.p.radius * 0.85, 0.55 * (1 - sat(this.volleyT / this.travelDuration)));
      if (this.grandSeal) {
        this.grandSeal.rotation.z = this.total * 0.14;
        this.spriteColor(this.grandSeal, 0.66 + 0.06 * Math.sin(this.total * 2.4), 1.1);
      }
      return this.volleyT >= this.volleyEnd;
    }
    onImpact() {
      this.residue('normal');
    }
    impactSpell(dt, k) {
      if (this.halo.length) this.updateHalo(0.7);
      for (const s of this.shots) {
        if (s.landed) {
          s.bullet.position.y = s.end.y - k * 0.22;
          this.spriteColor(s.bullet, 1, 1.05);
        }
        s.streak.setEnabled(false);
      }
      if (this.level === 5 && Math.floor((this.total - dt) * 3) !== Math.floor(this.total * 3)) {
        this.shock(this.p.radius * 0.5, 0.5, 0.28);
      }
      if (this.level >= 4) this.emit(this.smoke, dt * 9, this.target, radialVel(1.3, 0.8));
    }
    aftermathSpell(dt, k) {
      const out = 1 - smooth((k - 0.25) / 0.75);
      if (this.halo.length) this.updateHalo(0.7 * out);
      for (const s of this.shots) {
        this.spriteColor(s.bullet, out, 1.05);
        if (s.landed) s.bullet.position.y = s.end.y - (0.22 + k * 0.3);
      }
      if (this.grandSeal) {
        this.grandSeal.rotation.z += dt * 0.16;
        this.spriteColor(this.grandSeal, 0.66 * (1 - smooth(k)), 1.1);
      }
      if (this.skySeal) this.skySeal.update(-this.total, this.p.radius * 0.85, 0.5 * (1 - k));
      this.emit(this.detail, dt * 8 * (1 - k), this.target, radialVel(1.5, 0.7));
    }
  }

  /* 11 · 怒涛裂岸：水的视觉语言只有四件事——浪墙、白沫、水雾、涡潭。
     不用发光几何环、不用管线弧线（装饰线材已被用户两度否决）。
     L1 单浪拍岸 → L2 三浪错峰连推（潮线）→ L3 浪到卷成涡潭先吸后爆 →
     L4 涡潭持续：中央水柱 + 三股环形喷泉 + 内涌脉冲 →
     L5 沧海归墟：三重巨浪横扫 + 巨涡聚水成球升空砸落。 */
  const TIDAL_DIR = new V3();
  /* 飘带浪体剖面（局部系：x=行进向、y=上）：背底 → 浪壁上缘 → 卷管唇口。
     t 取到 0.8 停在波峰（0.785 处最高），再接卷管螺旋，轮廓无折返。
     卷管只绕 180°（100°→-80°）：绕满 270°+ 会自我叠层，半透明双面下像揉皱玻璃 */
  function tidalProfile(plane) {
    const len = plane * 0.9, H = plane * 0.78;
    const pts = [{ x: -len * 0.58, y: H * 0.02 }];
    for (let i = 0; i <= 8; i++) {
      const t = i * 0.1;
      pts.push({ x: -len * 0.5 + t * len, y: H * (0.10 + 0.86 * Math.sin(t * 2.0)) });
    }
    const cx = len * 0.30, cy = H * 0.80;
    for (let i = 0; i < 8; i++) {
      const a = (100 - i * 25.7) * Math.PI / 180, r = H * (0.24 - i * 0.017);
      pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return pts;
  }
  /* 横向切片数：9 片，几何完全一致（互不穿插），边缘靠顶点 alpha 渐隐 */
  const RB_SLICES = 9;
  /* 每浪 3 深度 × 3 并排 = 9 片飘带成"海浪"：
     深度向（沿行进向 dx）：后层涌浪（高、透、涌动慢）+ 主浪墙 + 前层低浪（矮、快）；
     并排向（沿横向 dz）：三列 ±RB_LAT 错开，各带一点行进错位与列高微差——
     顶缘参差、互不对齐，就是"一点点错开的感觉"。侧列透明度再压一档控叠加奶白 */
  const RB_LAYERS = [
    { h: 1.00, dx: 0.0, a: 1.00, phase: 0.0, wob: 1.0 },
    { h: 0.92, dx: -2.4, a: 0.55, phase: 2.4, wob: 0.75 },
    { h: 0.55, dx: 1.7, a: 0.50, phase: 4.2, wob: 1.30 },
  ];
  const RB_LAT = 1.8;                              /* 并排半间距（halfW≈3.3，侧列各露边 ~1.5m） */
  const RB_LAT_SHIFT = [-0.7, 0.15, 0.75];         /* 三列附加行进错位（小） */
  const RB_LAT_SCALE = [0.94, 1.0, 0.97];          /* 三列高度微差 → 顶缘参差 */
  const RB_LAT_ALPHA = [0.62, 0.80, 0.62];         /* 侧列更透 */
  const RB_LAT_DZ = [-RB_LAT, 0, RB_LAT];
  const RB_LAT_PHASE = [-1.1, 0, 0.9];
  class TidalCast extends Cast {
    buildSpell() {
      const L = this.level;
      this.mode = ['wave', 'tide', 'coil', 'spout', 'deluge'][L - 1];
      this.waves = []; this.fountains = []; this.tideT = 0; this.curlSpin = 0;
      this.vortex = null; this.coreOrb = null;
      /* 水感两介质：白沫（火花层·短命带重力）+ 水雾（辉光层·大团低透） */
      this.foam = this.emitter('spark', {
        life: [0.3, 0.85], size0: [0.07, 0.19], size1: [0.015, 0.05], alpha: [0.55, 0.95],
        drag: 1.35, turb: 0.55, gravity: 3.4,
      }, 0.85, 0.95);
      this.mist = this.emitter('glow', {
        life: [0.85, 1.8], size0: [0.5, 1.1], size1: [1.8, 3.2], alpha: [0.05, 0.13],
        drag: 0.7, turb: 0.75,
      }, 0.35, 0);
      /* 粗粒水花：喷泉/水柱的主体，颗粒大到远距离也能读出水柱 */
      this.gush = this.emitter('spark', {
        life: [0.5, 1.15], size0: [0.28, 0.62], size1: [0.07, 0.18], alpha: [0.6, 0.95],
        drag: 1.1, turb: 0.5, gravity: 2.4,
      }, 0.88, 1.0);
      /* 浪体雕塑：大团柔光泡沫，高阻尼+低重力让粒子锚在浪剖面上成形（不用贴图） */
      this.body = this.emitter('glow', {
        life: [0.34, 0.6], size0: [1.0, 2.2], size1: [0.6, 1.5], alpha: [0.32, 0.7],
        drag: 3.2, turb: 0.35, gravity: 0.5,
      }, 1.75, 1.95);
      /* 水体帷幕：更大更慢的低透光团，铺在浪壁中下部做"厚水"层叠 */
      this.swell = this.emitter('glow', {
        life: [0.5, 1.1], size0: [1.7, 3.0], size1: [1.2, 2.2], alpha: [0.10, 0.20],
        drag: 2.8, turb: 0.28, gravity: 0.25,
      }, 1.3, 1.55);
      const addWave = o => {
        const w = Object.assign({
          plane: 9, start: new V3(), end: new V3(), center: new V3(),
          launchAt: 0, flightDur: 0.72 + this.aimDist / 26, arrived: false, lane: 0,
          travel: new V3(), lateral: new V3(), lean: 0.2, anchors: null, halfW: 3,
        }, o);
        w.start.copyFrom(this.startGround).addInPlace(this.dir.scale(2.6)).addInPlace(this.side.scale(w.lane * this.p.radius * 0.55));
        w.end.copyFrom(this.target).addInPlace(this.side.scale(w.lane * this.p.radius * 0.6));
        w.end.subtractToRef(w.start, w.travel); w.travel.y = 0; w.travel.normalize();
        w.lateral.set(w.travel.z, 0, -w.travel.x);
        w.center.copyFrom(w.start); w.center.y = 0;
        w.halfW = w.plane * 0.30;
        w.anchors = this.buildAnchors(w.plane);
        /* 浪体：三层网格飘带层叠（FFXIV/LoL 系）。亮底+去饱和让顶点色出水→白沫且不被 ACES 旋绿。
           镜面归零是设计取舍：白沫粒子已承担高光闪烁，窄镜面条带只会往 Bloom 里加过亮像素 */
        w.mat = this.mat('waveBody', 0.26, 1, true, [0.62, 0.78, 1.0]);
        w.mat.specularColor.set(0, 0, 0);
        w.mat.alpha = 0;
        w.mat.disableDepthWrite = true;
        w.baseAlpha = 0.82;
        w.layers = this.buildRibbon(w);
        this.waves.push(w);
      };
      if (L === 1) addWave({ plane: 11 });
      else if (L === 2) {
        for (let i = 0; i < 3; i++) addWave({ plane: 8.6, lane: i - 1, launchAt: i * 0.24, flightDur: 0.66 + this.aimDist / 28 });
      } else if (L === 3) {
        addWave({ plane: 12, flightDur: 0.6 + this.aimDist / 28 });
        this.vortex = this.sprite('whirlpool', 'vortex', null, true);
        this.vortex.position.copyFrom(this.target); this.vortex.position.y = 0.06;
      } else if (L === 4) {
        this.vortex = this.sprite('whirlpool', 'vortex', null, true);
        this.vortex.position.copyFrom(this.target); this.vortex.position.y = 0.06;
        /* 中央水柱 + 三股环形喷泉（全部由白沫粒子构成，无几何体） */
        this.fountains.push({ pos: this.target.clone(), rate: 62, up: 9.2, spin: 2.2, r: 0.45 });
        for (let i = 0; i < 3; i++) {
          this.fountains.push({
            pos: positionAt(this.target, this.p.radius * 0.8, i * TAU / 3 + 0.6, 0),
            rate: 30, up: 5.8, spin: 1.6, r: 0.34,
          });
        }
      } else {
        for (let i = 0; i < 3; i++) addWave({ plane: 14, lane: i - 1, launchAt: i * 0.3, flightDur: 0.62 + this.aimDist / 30 });
        this.vortex = this.sprite('whirlpool', 'vortex', null, true);
        this.vortex.position.copyFrom(this.target); this.vortex.position.y = 0.06;
        this.fountains.push({ pos: this.target.clone(), rate: 80, up: 11, spin: 2.6, r: 0.6 });
        this.coreOrb = this.sprite('tideCore', 'softDisc', null);
        this.coreOrb.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        this.coreOrb.setEnabled(false);
      }
      this.waveEnd = this.waves.reduce((m, w) => Math.max(m, w.launchAt + w.flightDur), 0);
      this.holdDur = L === 3 ? 1.15 : L === 4 ? 2.5 : L === 5 ? 1.9 : 0;
      this.travelDuration = this.waveEnd + this.holdDur;
      this.preview(0, 0);
    }
    /* 浪剖面锚点（局部系：x=行进向，y=上）。粒子雕塑替代贴图，共 ~64 锚点分三个介质层。
       kind: face 浪壁 / crest 浪冠飞沫 / curl 卷管（滚动） / foot 浪脚 / spray 唇口飞沫
             / churn 低排涌沫与尾部翻涌（走大团帷幕介质） */
    buildAnchors(plane) {
      const len = plane * 0.9, H = plane * 0.78;
      const topY = t => H * (0.10 + 0.86 * Math.sin(t * 2.0));
      const pts = [];
      /* 浪壁上表面 */
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push({ kind: 'face', x: -len * 0.5 + t * len, y: topY(t), vx: 0.12, vy: 0.4, rate: 20 });
      }
      /* 浪冠飞沫：上表面之上的白沫冠，速度向上让碎沫跳出轮廓 */
      for (let i = 0; i <= 7; i++) {
        const t = 0.25 + i * 0.1;
        pts.push({ kind: 'crest', x: -len * 0.5 + t * len, y: topY(t) * 1.04,
          vx: 0.2, vy: 1.1, rate: 22 });
      }
      /* 浪壁内层四排：0.78/0.55/0.25 实体墙 + 0.12 低排涌沫（帷幕介质） */
      for (let i = 1; i <= 8; i++) {
        const t = i / 9;
        pts.push({ kind: 'face', x: -len * 0.5 + t * len, y: topY(t) * 0.78, vx: 0.09, vy: 0.35, rate: 16 });
      }
      for (let i = 1; i <= 8; i++) {
        const t = i / 9;
        pts.push({ kind: 'face', x: -len * 0.5 + t * len, y: topY(t) * 0.55, vx: 0.08, vy: 0.3, rate: 14 });
      }
      for (let i = 2; i <= 7; i++) {
        const t = i / 9;
        pts.push({ kind: 'face', x: -len * 0.5 + t * len, y: topY(t) * 0.25, vx: 0.05, vy: 0.2, rate: 12 });
      }
      for (let i = 1; i <= 6; i++) {
        const t = i / 7;
        pts.push({ kind: 'churn', x: -len * 0.5 + t * len, y: topY(t) * 0.12, vx: 0.03, vy: 0.15, rate: 13 });
      }
      /* 浪背后的翻涌尾迹：向上升腾的厚水帷幕 */
      for (let i = 0; i < 4; i++) {
        const f = i / 3;
        pts.push({ kind: 'churn', x: -len * (0.62 - f * 0.20), y: H * (0.08 + f * 0.14),
          vx: -0.15, vy: 0.7, rate: 14 });
      }
      const cx = len * 0.30, cy = H * 0.80;
      for (let i = 0; i < 9; i++) {
        const a = (100 - i * 34) * Math.PI / 180, r = H * (0.24 - i * 0.024);
        pts.push({ kind: 'curl', cx, cy, r, a, rate: 26 });
      }
      for (let i = 0; i <= 6; i++) {
        pts.push({ kind: 'foot', x: -len * 0.55 + (i / 6) * len * 1.05, y: H * 0.05,
          vx: 0, vy: 0.5, rate: 24 });
      }
      /* 卷管唇口四缕飞沫 */
      const aEnd = (100 - 8 * 34) * Math.PI / 180, rEnd = H * (0.24 - 8 * 0.024);
      const sv = [[0.9, 0.6], [1.3, 0.1], [0.7, 0.9], [1.1, 0.3]];
      for (let i = 0; i < 4; i++) {
        pts.push({ kind: 'spray', x: cx + Math.cos(aEnd) * rEnd, y: cy + Math.sin(aEnd) * rEnd,
          vx: sv[i][0], vy: sv[i][1], rate: 18 });
      }
      return pts;
    }
    /* 建飘带网格：3 深度 × 3 并排，每片剖面沿横向挤 9 片（片内几何一致）。
       顶点色：浪脚 0.48 起、>0.55H 过渡白沫，列缘 alpha 渐隐按"列自身跨度"算
       （|z-dz|/halfW，不能拿世界 z 否则侧列整体被压暗），层/列 alpha 叠乘。
       返回 9 条层记录，供 pose/wobble/enable 逐层操作 */
    buildRibbon(w) {
      const H0 = w.plane * 0.78;
      /* 水体色去饱和一档（0.45→白），高饱和蓝在 ACES 色调映射下会旋出青绿斑 */
      const wt = [this.rgb[0] * 0.45 + 0.55, this.rgb[1] * 0.45 + 0.55, this.rgb[2] * 0.45 + 0.55];
      const layers = [];
      for (let ci = 0; ci < RB_LAYERS.length; ci++) {
        const cfg = RB_LAYERS[ci];
        for (let col = 0; col < 3; col++) {
          const h = cfg.h * RB_LAT_SCALE[col];
          const H = H0 * h;
          const dz = RB_LAT_DZ[col];
          const aMul = cfg.a * RB_LAT_ALPHA[col];
          const prof = tidalProfile(w.plane).map(p => ({ x: p.x, y: p.y * h }));
          const paths = [];
          for (let i = 0; i < RB_SLICES; i++) {
            const u = (i / (RB_SLICES - 1)) * 2 - 1;
            paths.push(prof.map(p => new V3(p.x, p.y, u * w.halfW + dz)));
          }
          const mesh = this.mesh('Ribbon', {
            pathArray: paths, sideOrientation: BABYLON.Mesh.DOUBLESIDE, updatable: true,
          }, w.mat, null, 'waveRibbon');
          /* 颜色必须按 mesh 实际顶点数写：DOUBLESIDE 会把顶点翻倍（剖面点数×切片≠总顶点数），
             按剖面点数只写一半会让后半段顶点读越界内存——渲染成五彩噪点（实测 3-4 万像素）。
             高度/边距都从顶点位置反推，不依赖生成时的数组布局 */
          const n = mesh.getTotalVertices();
          const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
          const cols = new Array(n * 4);
          for (let i = 0; i < n; i++) {
            const yn = Math.max(0, pos[i * 3 + 1] / H), cf = sat((yn - 0.55) / 0.4);
            const edge = Math.min(1, Math.abs(pos[i * 3 + 2] - dz) / Math.max(0.01, w.halfW));
            cols[i * 4 + 0] = wt[0] + (1 - wt[0]) * cf;
            cols[i * 4 + 1] = wt[1] + (1 - wt[1]) * cf;
            cols[i * 4 + 2] = wt[2] + (1 - wt[2]) * cf;
            cols[i * 4 + 3] = (0.48 + 0.5 * yn) * (1 - 0.25 * edge) * aMul;
          }
          mesh.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, false, 4);
          mesh.hasVertexAlpha = true;
          layers.push({
            mesh, paths, prof, H,
            dx: cfg.dx + RB_LAT_SHIFT[col], dz,
            phase: cfg.phase + RB_LAT_PHASE[col], wob: cfg.wob,
          });
        }
      }
      return layers;
    }
    /* 飘带姿态：倾角与 emitWave 同式（atan(lean)*0.62），粒子锚才贴着浪面。
       基向量 X=倾倒后的行进向 / Y=倾斜轴 / Z=横向，rollTo 同款四元数，无需朝相机；
       9 片共用同一姿态，各自沿行进向偏 dx、沿横向偏 dz 形成深度×并排层叠 */
    poseRibbon(w, lean) {
      const th = Math.atan(lean) * 0.62, s = Math.sin(th), c = Math.cos(th);
      const Yx = s * w.travel.x, Yy = c, Yz = s * w.travel.z;
      const Zx = -w.travel.z, Zz = w.travel.x;
      const Xx = Yy * Zz, Xy = Yz * Zx - Yx * Zz, Xz = -Yy * Zx;
      const q = BABYLON.Quaternion.FromRotationMatrix(
        BABYLON.Matrix.FromValues(Xx, Xy, Xz, 0, Yx, Yy, Yz, 0, Zx, 0, Zz, 0, 0, 0, 0, 1));
      for (const L of w.layers) {
        L.mesh.position.set(
          w.center.x + w.travel.x * L.dx + w.lateral.x * L.dz, 0,
          w.center.z + w.travel.z * L.dx + w.lateral.z * L.dz);
        L.mesh.rotationQuaternion = q;
      }
    }
    /* 涌动：沿行进向滚动的微波，浪尖振幅大、浪脚钉住；instance 更新重算法线。
       振幅压到 0.03H——0.055H 时相邻片相位差会把曲面折出硬棱面；三层相位/速率错开 */
    wobbleRibbon(w) {
      const t = this.total;
      for (const L of w.layers) {
        if (!L.mesh.isEnabled()) continue;
        for (let i = 0; i < L.paths.length; i++) {
          const z = L.paths[i][0].z;   /* 含并排 dz，列间涌动相位自然错开 */
          const path = L.paths[i];
          for (let j = 0; j < path.length; j++) {
            const p = L.prof[j], yn = p.y / L.H;
            path[j].y = p.y +
              Math.sin(t * 4.6 * L.wob - p.x * 0.6 + z * 0.55 + L.phase) * L.H * 0.03 * yn;
          }
        }
        BABYLON.MeshBuilder.CreateRibbon(null, { pathArray: L.paths, instance: L.mesh });
      }
    }
    /* 沿剖面喷洒：中心移动 + 前倾旋转把局部锚点映射到世界，卷管锚点绕自身滚动 */
    emitWave(w, dt, mul) {
      const th = Math.atan(w.lean) * 0.62;
      const c = Math.cos(th), s = Math.sin(th);
      for (const a of w.anchors) {
        let ax, ay, avx, avy;
        if (a.kind === 'curl') {
          const ang = a.a - this.curlSpin;
          ax = a.cx + a.r * Math.cos(ang);
          ay = a.cy + a.r * Math.sin(ang);
          avx = Math.sin(ang) * 1.2; avy = -Math.cos(ang) * 1.2;
        } else { ax = a.x; ay = a.y; avx = a.vx; avy = a.vy; }
        const lx = ax * c + ay * s, ly = -ax * s + ay * c;
        const z = randSpread(w.halfW) * (0.85 + rand(0, 0.3));
        const px = w.center.x + w.travel.x * lx + w.lateral.x * z;
        const py = w.center.y + ly + randSpread(0.18);
        const pz = w.center.z + w.travel.z * lx + w.lateral.z * z;
        const wvx = avx * c + avy * s, wvy = -avx * s + avy * c;
        TIDAL_DIR.set(w.travel.x * wvx + randSpread(0.15), wvy + rand(0, 0.1), w.travel.z * wvx + randSpread(0.15));
        const em = (a.kind === 'spray' || a.kind === 'crest') ? this.foam
          : a.kind === 'churn' ? this.swell : this.body;
        this.emit(em, dt * a.rate * mul, { x: px, y: py, z: pz },
          () => ({ x: TIDAL_DIR.x, y: TIDAL_DIR.y, z: TIDAL_DIR.z }));
      }
    }
    spinVortex(dt, alpha, scale) {
      const v = this.vortex;
      v.setEnabled(true);
      v.rotation.z += dt * (this.mode === 'spout' ? 1.5 : this.mode === 'deluge' ? 1.2 : 1.0);
      const d = this.p.radius * (this.mode === 'deluge' ? 1.7 : this.mode === 'spout' ? 1.3 : 1.05) * scale;
      v.scaling.set(d * 2, d * 2, 1);
      this.spriteColor(v, alpha * (0.38 + 0.07 * Math.sin(this.total * 2.6)), 0.82);
    }
    /* 吸入流：外圈起沫、螺旋卷向中心 */
    suction(dt, ringR) {
      for (let i = 0; i < 3; i++) {
        const a = rand(0, TAU), r = ringR * rand(0.7, 1.25), ca = a + 0.8, v = rand(3.2, 6);
        TIDAL_DIR.set(-Math.cos(ca) * v, rand(0.3, 1.4), -Math.sin(ca) * v);
        this.emit(this.foam, dt * 40, { x: this.target.x + Math.cos(a) * r, y: rand(0.1, 0.5), z: this.target.z + Math.sin(a) * r },
          () => ({ x: TIDAL_DIR.x, y: TIDAL_DIR.y, z: TIDAL_DIR.z }));
      }
    }
    /* 喷泉：中心或环位向上喷沫，带旋转散角 */
    fountain(dt, f, alpha) {
      if (alpha <= 0.01) return;
      for (let i = 0; i < 3; i++) {
        const a = this.total * f.spin + i * TAU / 3 + rand(0, 0.5);
        TIDAL_DIR.set(Math.cos(a) * f.r * rand(0.6, 1.6), f.up * rand(0.75, 1.25), Math.sin(a) * f.r * rand(0.6, 1.6));
        this.emit(this.gush, dt * f.rate * alpha, { x: f.pos.x + Math.cos(a) * 0.35, y: 0.12, z: f.pos.z + Math.sin(a) * 0.35 },
          () => ({ x: TIDAL_DIR.x, y: TIDAL_DIR.y, z: TIDAL_DIR.z }));
      }
    }
    preview(dt, k) {
      const open = smooth(sat(k * 1.5));
      for (const w of this.waves) {
        if (w.layers) {
          for (const L of w.layers) L.mesh.setEnabled(true);
          w.center.copyFrom(w.start); w.center.y = 0;
          w.lean = 0.14 + 0.16 * open;
          this.poseRibbon(w, w.lean);
          this.wobbleRibbon(w);
          w.mat.alpha = w.baseAlpha * open;
        }
        if (dt > 0 && open > 0.02) this.emitWave(w, dt, open * 0.85);
      }
      if (this.vortex) this.vortex.setEnabled(false);
      if (this.coreOrb) this.coreOrb.setEnabled(false);
    }
    onRelease() {
      this.emit(this.foam, 12, { x: this.origin.x, y: 0.6, z: this.origin.z }, radialVel(2.6, 2.2), true);
      this.emit(this.mist, 6, { x: this.origin.x, y: 1, z: this.origin.z }, radialVel(1.2, 1), true);
    }
    travel(dt) {
      this.tideT += dt * this.p.speed;
      this.curlSpin += dt * 3.4;
      for (const w of this.waves) {
        const u = sat((this.tideT - w.launchAt) / w.flightDur);
        if (u <= 0) {
          w.center.copyFrom(w.start); w.center.y = 0;
          if (w.layers) {
            for (const L of w.layers) L.mesh.setEnabled(true);
            this.poseRibbon(w, w.lean);
            this.wobbleRibbon(w);
            w.mat.alpha = w.baseAlpha;
          }
          continue;
        }
        if (u < 1) {
          V3.LerpToRef(w.start, w.end, u, w.center);
          w.center.y = 0;
          w.lean = 0.42 + 0.78 * u;
          this.emitWave(w, dt, 1);
          if (w.layers) {
            for (const L of w.layers) L.mesh.setEnabled(true);
            this.poseRibbon(w, w.lean);
            this.wobbleRibbon(w);
            w.mat.alpha = w.baseAlpha;
          }
          /* 身后水雾拖尾 */
          this.emit(this.mist, dt * 18, { x: w.center.x - w.travel.x * 2.4, y: 1.9, z: w.center.z - w.travel.z * 2.4 }, radialVel(0.9, 0.6));
        } else if (!w.arrived) {
          w.arrived = true;
          if (w.layers) for (const L of w.layers) L.mesh.setEnabled(false);
          this.emit(this.gush, 34, { x: w.end.x, y: 0.5, z: w.end.z }, radialVel(3.8, 4.4), true);
          this.emit(this.foam, 56, { x: w.end.x, y: 0.5, z: w.end.z }, radialVel(3.8, 4.4), true);
          this.emit(this.foam, 30, { x: w.end.x, y: 1.2, z: w.end.z }, radialVel(2.2, 3.2), true);
          this.emit(this.mist, 24, { x: w.end.x, y: 0.9, z: w.end.z }, radialVel(2.0, 1.6), true);
          this.emit(this.swell, 14, { x: w.end.x, y: 0.7, z: w.end.z }, radialVel(2.6, 2.0), true);
          this.shock(this.p.radius * 0.85, 0.55, 0.32);
        }
      }
      const vortexIn = sat((this.tideT - this.waveEnd * 0.55) / 0.6);
      if (this.vortex && vortexIn > 0) {
        const scale = 1 + 0.35 * sat((this.tideT - this.waveEnd) / Math.max(0.01, this.holdDur));
        this.spinVortex(dt, vortexIn, scale);
        this.suction(dt, this.p.radius * scale);
      }
      for (const f of this.fountains) this.fountain(dt, f, vortexIn);
      if (this.coreOrb && this.waveEnd > 0 && this.tideT > this.waveEnd * 0.8) {
        const rise = sat((this.tideT - this.waveEnd * 0.8) / Math.max(0.01, this.holdDur * 0.95));
        this.coreOrb.setEnabled(true);
        const s = this.p.radius * (0.42 + 0.5 * smooth(rise));
        this.coreOrb.scaling.set(s, s, 1);
        this.coreOrb.position.copyFrom(this.target);
        this.coreOrb.position.y = 1.1 + rise * 5.2;
        this.spriteColor(this.coreOrb, 0.5 + 0.32 * smooth(rise), 1.12);
        this.emit(this.foam, dt * 26, { x: this.target.x, y: 0.4 + rise * 3, z: this.target.z }, radialVel(1.2, 2.2));
        this.emit(this.mist, dt * 10, { x: this.target.x, y: 0.4 + rise * 3.6, z: this.target.z }, radialVel(1.6, 1.4));
      }
      return this.tideT >= this.travelDuration;
    }
    onImpact() {
      this.residue('water');
      this.emit(this.gush, 28, { x: this.target.x, y: 0.7, z: this.target.z }, radialVel(4.2, 4.6), true);
      this.emit(this.foam, 42, { x: this.target.x, y: 0.7, z: this.target.z }, radialVel(4.2, 4.6), true);
      this.emit(this.mist, 22, { x: this.target.x, y: 1.1, z: this.target.z }, radialVel(2.2, 2.2), true);
      this.emit(this.swell, 10, { x: this.target.x, y: 0.8, z: this.target.z }, radialVel(2.4, 1.8), true);
      if (this.coreOrb) {
        this.shock(this.p.radius * 1.25, 0.8, 0.5);
        this.shock(this.p.radius * 0.75, 1.15, 0.32, 0.18);
        this.emit(this.gush, 40, { x: this.target.x, y: 1.2, z: this.target.z }, radialVel(5, 5.2), true);
        this.emit(this.foam, 46, { x: this.target.x, y: 1.4, z: this.target.z }, radialVel(5, 5.2), true);
      } else {
        this.shock(this.p.radius * 1.0, 0.6, 0.4);
      }
    }
    impactSpell(dt, k) {
      if (this.vortex) this.spinVortex(dt, 0.6 * (1 - k * 0.4), 1 + 0.2 * (1 - k));
      for (const f of this.fountains) this.fountain(dt, f, (1 - k) * 0.8);
      if (this.coreOrb) {
        const y = Math.max(0.6, this.coreOrb.position.y - dt * 16);
        this.coreOrb.position.y = y;
        this.spriteColor(this.coreOrb, y > 0.7 ? 0.65 : 0.55 * (1 - k), 1.05);
      }
      this.emit(this.foam, dt * 26 * (1 - k), { x: this.target.x, y: 0.5, z: this.target.z }, radialVel(3, 3.4));
      this.emit(this.mist, dt * 14 * (1 - k), { x: this.target.x, y: 0.9, z: this.target.z }, radialVel(1.4, 1.2));
    }
    aftermathSpell(dt, k) {
      const out = 1 - smooth(k);
      if (this.vortex) this.spinVortex(dt, 0.5 * out, 1.2);
      if (this.coreOrb) this.spriteColor(this.coreOrb, 0.5 * out, 1.05);
      this.emit(this.foam, dt * 9 * (1 - k), { x: this.target.x, y: 0.35, z: this.target.z }, radialVel(1.6, 2.4));
      this.emit(this.mist, dt * 6 * (1 - k), { x: this.target.x, y: 0.8, z: this.target.z }, radialVel(0.9, 0.9));
    }
  }

  const CAST_CLASSES = { 1: FrostSpearCast, 2: ThunderLanceCast, 3: MeteorCast, 4: StarBeamCast,
    5: VoltBastionCast, 6: GlacialCrownCast, 7: WindRipCast, 8: RockFangCast, 9: GateTreasuryCast,
    10: BarrageCast, 11: TidalCast };  /* 注册完整性双侧闭合：元数据合法（含元素归属）+ Cast 实现闭合 */
  function validateRegistry() {
    const problems = SkillCatalog.validate();
    const classIds = new Set(Object.keys(CAST_CLASSES).map(Number));
    for (const def of DEFS) {
      if (!classIds.has(def.id)) problems.push(def.name + ' 缺少 Cast 实现');
      if (!SkillCatalog.elementOf(def.element)) problems.push(def.name + ' 未知元素: ' + def.element);
    }
    for (const cid of classIds) if (!DEFS.some(d => d.id === cid)) problems.push('Cast 实现 #' + cid + ' 没有注册项');
    return problems;
  }
  {
    const problems = validateRegistry();
    if (problems.length) console.error('[skills] 技能注册表不完整:\n  ' + problems.join('\n  '));
  }
  const SKILLS = {
    defs: DEFS, LEVELS, profile, phaseLabel: PHASE_LABEL, validateRegistry,
    elementOf: key => SkillCatalog.elementOf(key),
    casts: [], transients: [], cooldowns: {}, cooldownTotals: {}, _particlesLeft: 480,
    lastRejectReason: null,
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
    /* 位移所有者与姿态所有者分离：只有声明 controlsMovement 的法术驱动角色位移，
       姿态被更新法术接管时，已启动的位移继续完成。 */
    moveOwner(game) {
      for (let i = this.casts.length - 1; i >= 0; i--) {
        const c = this.casts[i];
        if (c.game === game && !c.finished && !c.disposed && c.controlsMovement) return c;
      }
      return null;
    },
    /* 只取消未完成的蓄力/释放；已释放法术继续完成（交互契约见 README） */
    cancelPendingCasts(game) {
      let cancelled = 0;
      for (let i = this.casts.length - 1; i >= 0; i--) {
        const c = this.casts[i];
        if (game && c.game !== game) continue;
        if (c.phase === 'windup' || c.phase === 'release') {
          c.dispose();
          this.casts.splice(i, 1);
          cancelled++;
        }
      }
      return cancelled;
    },
    clearCooldowns() {
      for (const key in this.cooldowns) this.cooldowns[key] = 0;
    },
    addTransient(t) {
      while (this.transients.length >= this.budget.transients) this.transients.shift().dispose();
      this.transients.push(t);
    },
    isReady(id) { return (this.cooldowns[id] || 0) <= 0; },
    _reject(reason) { this.lastRejectReason = reason; return false; },
    start(game, id, aim) {
      const def = DEFS.find(d => d.id === Number(id));
      if (!def) return this._reject('unknown');
      if (!this.isReady(id)) return this._reject('cooldown');
      if (this.casts.length >= this.budget.casts) return this._reject('cast-limit');
      const p = profile(game, id);
      if (p.level === 5 && this.casts.filter(c => c.level === 5).length >= this.budget.ultimates) return this._reject('ultimate-limit');
      /* 构造只建快照、init 才分配资源：任一步失败都整体回收，不产生半初始化残留。
         先入列再 init，让 init 期间的姿态/阶段通知能看到自己（poseOwner）。 */
      let cast = null;
      try {
        cast = new CAST_CLASSES[id](game, def, aim, p);
        this.casts.push(cast);
        cast.init();
      } catch (error) {
        if (cast) {
          const at = this.casts.indexOf(cast);
          if (at >= 0) this.casts.splice(at, 1);
          cast.dispose();
        }
        console.error('[skills] ' + def.name + ' 创建失败，已回收: ' + (error && error.stack ? error.stack : error));
        return this._reject('error');
      }
      this._game = game;
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
      /* 逐实例异常隔离：单个法术/瞬态故障只回收自身，不拖垮其余法术与整帧渲染 */
      for (let i = this.casts.length - 1; i >= 0; i--) {
        const c = this.casts[i];
        try { c.update(dt); }
        catch (error) {
          console.error('[skills] ' + ((c.def && c.def.name) || c.constructor.name) + ' 更新失败，中止该法术: ' + (error && error.stack ? error.stack : error));
          try { c.dispose(); } catch (e) { console.error('[skills] 法术清理再次失败: ' + (e && e.stack ? e.stack : e)); }
          c.disposed = true;
        }
        if (c.finished || c.disposed) {
          try { c.dispose(); } catch (e) { console.error('[skills] 法术清理失败: ' + (e && e.stack ? e.stack : e)); }
          this.casts.splice(i, 1);
        }
      }
      for (let i = this.transients.length - 1; i >= 0; i--) {
        const t = this.transients[i];
        try { t.update(dt); }
        catch (error) {
          console.error('[skills] 瞬态特效更新失败，已回收: ' + (error && error.stack ? error.stack : error));
          try { t.dispose(); } catch (e) { console.error('[skills] 瞬态清理再次失败: ' + (e && e.stack ? e.stack : e)); }
          t.disposed = true;
        }
        if (t.done || t.disposed) {
          try { t.dispose(); } catch (e) { console.error('[skills] 瞬态清理失败: ' + (e && e.stack ? e.stack : e)); }
          this.transients.splice(i, 1);
        }
      }
      const game = this._game;
      if (!game) return;
      const owner = this.poseOwner(game);
      const cine = game.cinematic;
      if (owner) {
        const k = owner.phaseProgress();
        game.mage.setSpellPose(owner.phase, k, owner.level, owner.p.color, owner.def.id);
        game.mage.setCast(owner.phase === 'windup' ? smooth(k) : Math.max(0, game.mage.castAmount - dt * 2));
        /* 腾空高度跟随位移所有者，而不是姿态所有者 */
        const mover = this.moveOwner(game);
        game.mage.yOffset = mover ? mover.lift : 0;
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
