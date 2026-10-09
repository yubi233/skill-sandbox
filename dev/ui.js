/* ============================================================================
   ui.js — 技能栏 / 操作说明 / VFX 编辑器面板(所有参数实时生效)
   ========================================================================== */
(function (global) {
  'use strict';

  /* --------------------------- 程序化技能图标 --------------------------- */
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawIcon(ctx, id, hex) {
    const s = 64;
    /* 背景 */
    const bg = ctx.createLinearGradient(0, 0, s, s);
    bg.addColorStop(0, '#121a2c');
    bg.addColorStop(1, '#0a0f1c');
    roundRect(ctx, 2, 2, s - 4, s - 4, 12);
    ctx.fillStyle = bg;
    ctx.fill();
    /* 主色辉光底 */
    const glow = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s * 0.55);
    glow.addColorStop(0, hex + '55');
    glow.addColorStop(1, hex + '00');
    ctx.fillStyle = glow;
    roundRect(ctx, 2, 2, s - 4, s - 4, 12);
    ctx.fill();

    ctx.save();
    ctx.translate(s / 2, s / 2);
    ctx.strokeStyle = hex;
    ctx.fillStyle = hex;
    ctx.lineWidth = 3.4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = hex;
    ctx.shadowBlur = 9;

    switch (id) {
      case 1: /* 寒霜之矛:斜置长矛 */
        ctx.rotate(-Math.PI / 4);
        ctx.beginPath(); ctx.moveTo(-18, 0); ctx.lineTo(12, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(12, -6); ctx.lineTo(22, 0); ctx.lineTo(12, 6); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-18, -6); ctx.lineTo(-12, 0); ctx.lineTo(-18, 6); ctx.closePath(); ctx.fill();
        break;
      case 2: /* 雷霆之矛:锯齿闪电 */
        ctx.beginPath();
        ctx.moveTo(4, -22); ctx.lineTo(-8, -2); ctx.lineTo(0, -2); ctx.lineTo(-6, 22);
        ctx.lineTo(12, 0); ctx.lineTo(2, 0); ctx.lineTo(10, -22); ctx.closePath();
        ctx.fill();
        break;
      case 3: /* 陨火天降:陨石 + 地面 */
        ctx.beginPath(); ctx.arc(4, -8, 11, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(-20, -20); ctx.lineTo(-8, -12); ctx.moveTo(-16, -6); ctx.lineTo(-6, -4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(-22, 18); ctx.lineTo(22, 18); ctx.stroke();
        break;
      case 4: /* 星光束:贯穿光束 */
        ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(22, 0); ctx.stroke();
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(-20, -8); ctx.lineTo(20, -8); ctx.moveTo(-20, 8); ctx.lineTo(20, 8); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); ctx.fill();
        break;
      case 5: /* 伏特禁城:电墙领域 */
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-12, -12); ctx.lineTo(-4, -4); ctx.lineTo(-11, 2); ctx.lineTo(-2, 10);
        ctx.moveTo(12, -12); ctx.lineTo(5, -5); ctx.lineTo(12, 1); ctx.lineTo(4, 11);
        ctx.stroke();
        break;
      case 6: /* 冰川王冠:冰晶环 */
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.55;
          const x = Math.cos(a) * 17, y = Math.sin(a) * 11 + 6;
          ctx.beginPath();
          ctx.moveTo(x, y - 12); ctx.lineTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.closePath();
          ctx.fill();
        }
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.ellipse(0, 8, 19, 7, 0, 0, Math.PI * 2); ctx.stroke();
        break;
      case 7: /* 疾风裂空:风旋 + 位移箭头 */
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(-4, 2, 14, Math.PI * 0.2, Math.PI * 1.35); ctx.stroke();
        ctx.beginPath(); ctx.arc(-2, -2, 8, Math.PI * 0.15, Math.PI * 1.1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(2, -18); ctx.lineTo(18, -4); ctx.lineTo(6, -2); ctx.closePath(); ctx.fill();
        break;
      case 8: /* 岩牙突刺:石牙尖刺 */
        ctx.beginPath(); ctx.moveTo(-22, 16); ctx.lineTo(22, 16); ctx.stroke();
        for (let i = 0; i < 3; i++) {
          const x = -15 + i * 15;
          const h = 18 + (i % 2) * 8;
          ctx.beginPath();
          ctx.moveTo(x - 8, 16); ctx.lineTo(x, 16 - h); ctx.lineTo(x + 8, 16); ctx.closePath();
          ctx.fill();
        }
        break;
      case 9: /* 王之财宝:金色门扉波纹 + 飞剑 */
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(0, -4, 19, Math.PI * 0.12, Math.PI * 0.88); ctx.stroke();
        ctx.beginPath(); ctx.arc(0, -4, 12.5, Math.PI * 0.18, Math.PI * 0.82); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, 22); ctx.lineTo(0, -12); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(-4.5, -12); ctx.lineTo(4.5, -12); ctx.closePath(); ctx.fill();
        ctx.lineWidth = 3.2;
        ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(9, -9); ctx.stroke();
        break;
      case 10: /* 魔弹连射:三连扇形弹幕 */
        for (let i = -1; i <= 1; i++) {
          ctx.save();
          ctx.translate(i * 10, 3);
          ctx.rotate(i * 0.38);
          ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(0, 10); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(0, -21); ctx.lineTo(-5, -12); ctx.lineTo(5, -12); ctx.closePath(); ctx.fill();
          ctx.lineWidth = 2.4;
          ctx.beginPath(); ctx.moveTo(-4, 14); ctx.lineTo(0, 20); ctx.lineTo(4, 14); ctx.stroke();
          ctx.restore();
        }
        break;
      case 11: /* 怒涛裂岸:卷浪 + 漩涡 */
        ctx.lineWidth = 3.4;
        ctx.beginPath();
        ctx.moveTo(-15, 20);
        ctx.quadraticCurveTo(-19, 0, -4, -6);
        ctx.quadraticCurveTo(6, -10, 8, -20);
        ctx.stroke();
        ctx.beginPath(); ctx.arc(9, -12, 7, Math.PI * 0.85, Math.PI * 1.9); ctx.stroke();
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.ellipse(-2, 15, 14, 5, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.ellipse(-2, 15, 7, 2.5, 0, 0, Math.PI * 2); ctx.stroke();
        break;
    }
    ctx.restore();
  }

  function iconDataURL(id, hex) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    drawIcon(c.getContext('2d'), id, hex);
    return c.toDataURL();
  }

  /* ------------------------------ 提示浮层 ------------------------------ */
  let toastTimer = 0;
  function toast(msg, dur) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), dur || 1500);
  }

  /* ------------------------------ 编辑器控件 ------------------------------ */
  function addGroup(parent, title, color, open) {
    const g = document.createElement('details');
    g.className = 'grp';
    if (open) g.open = true;
    const sum = document.createElement('summary');
    const caret = document.createElement('span');
    caret.className = 'caret';
    sum.appendChild(caret);
    if (color) {
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = color;
      sw.style.color = color;
      sum.appendChild(sw);
    }
    sum.appendChild(document.createTextNode(title));
    g.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'grp-body';
    g.appendChild(body);
    parent.appendChild(g);
    return body;
  }

  function addRange(parent, label, min, max, step, get, set, fmt) {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    const name = document.createElement('span');
    name.textContent = label;
    const val = document.createElement('span');
    val.className = 'val';
    lbl.appendChild(name); lbl.appendChild(val);
    wrap.appendChild(lbl);
    const input = document.createElement('input');
    input.type = 'range';
    input.setAttribute('aria-label', label);
    input.min = min; input.max = max; input.step = step;
    input.value = get();
    const show = () => { val.textContent = fmt ? fmt(parseFloat(input.value)) : parseFloat(input.value).toFixed(step < 0.1 ? 3 : step < 1 ? 2 : 1); };
    show();
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      set(v);
      show();
    });
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return { input, refresh: () => { input.value = get(); show(); } };
  }

  function addColor(parent, label, get, set) {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    const lbl = document.createElement('div');
    lbl.className = 'lbl';
    lbl.textContent = label;
    wrap.appendChild(lbl);
    const input = document.createElement('input');
    input.type = 'color';
    input.setAttribute('aria-label', label);
    input.value = get();
    input.addEventListener('input', () => set(input.value));
    wrap.appendChild(input);
    parent.appendChild(wrap);
    return { input, refresh: () => { input.value = get(); } };
  }

  function addCheck(parent, label, get, set) {
    const wrap = document.createElement('div');
    wrap.className = 'ctl';
    const lbl = document.createElement('label');
    lbl.className = 'chk';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!get();
    input.addEventListener('change', () => set(input.checked));
    lbl.appendChild(input);
    lbl.appendChild(document.createTextNode(label));
    wrap.appendChild(lbl);
    parent.appendChild(wrap);
    return { input, refresh: () => { input.checked = !!get(); } };
  }

  /* ------------------------------ 主 UI ------------------------------ */
  const UI = {
    selectedId: 0,
    refreshers: [],
    slots: [],
    toast: (msg, dur) => toast(msg, dur),
    init(game) {
      this.game = game;
      this.buildSkillBar(game);
      const levelbar = document.getElementById('levelbar');
      for (const tier of SKILLS.LEVELS) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'level-step' + (tier.level === 5 ? ' ultimate' : '');
        button.dataset.level = tier.level;
        button.setAttribute('aria-label', '等级 ' + tier.level + ' · ' + tier.name);
        button.innerHTML = '<span class="level-number">LV.' + tier.level + '</span><span class="level-name">' + tier.name + '</span>';
        button.addEventListener('click', () => this.setLevel(tier.level)); levelbar.appendChild(button);
      }
      const resize = () => {
        const dock = document.getElementById('spell-dock');
        document.documentElement.style.setProperty('--dock-space', (dock.getBoundingClientRect().height + 24) + 'px');
        game.camera.viewport.y = window.innerWidth > 760 ? 0.19 : 0;
        game.camera.viewport.height = window.innerWidth > 760 ? 0.81 : 1;
        game.engine.resize();
      };
      const toggleEditor = () => {
        const ed = document.getElementById('editor'), open = ed.classList.contains('collapsed');
        ed.classList.toggle('collapsed', !open); document.body.classList.toggle('editor-open', open);
        document.getElementById('editor-content').hidden = !open;
        const button = document.getElementById('editor-toggle'); button.textContent = open ? '收起' : '展开';
        button.setAttribute('aria-expanded', String(open)); resize();
      };
      document.getElementById('editor-toggle').addEventListener('click', e => { e.stopPropagation(); toggleEditor(); });
      document.getElementById('editor-head').addEventListener('click', toggleEditor);
      document.getElementById('help-toggle').addEventListener('click', () => {
        const card = document.getElementById('help-card'); card.hidden = !card.hidden;
        document.getElementById('help-toggle').setAttribute('aria-expanded', String(!card.hidden));
      });
      document.getElementById('btn-cast').addEventListener('click', () => game.castSelected());
      document.getElementById('btn-reset').addEventListener('click', () => {
        SKILLS.abortAll(); game.demoTimer = -1;
        game.timeScale = 1; this.setPhase('待机');
        SKILLS.clearCooldowns();
        const merge = (target, fresh) => {
          for (const key in fresh) {
            if (fresh[key] && typeof fresh[key] === 'object') merge(target[key] || (target[key] = {}), fresh[key]);
            else target[key] = fresh[key];
          }
        };
        merge(game.params, Core.defaultParams());
        game.applyGlobal(); game.applyEnv(); game.applyPost(); game.applyCamera();
        this.select(3); this.slots.forEach(s => { s.img.src = iconDataURL(s.def.id, game.params.skills[s.def.id].color); });
        toast('五级配置与场景参数已恢复');
      });
      document.getElementById('btn-demo').addEventListener('click', () => {
        game.demoTimer = game.demoTimer >= 0 ? -1 : 0;
        if (game.demoTimer >= 0) game.demoIndex = 0;
        toast(game.demoTimer >= 0 ? '自动演示 · 按各技能已选等级，完整播放后切换' : '演示已停止');
      });
      document.getElementById('btn-cam-copy').addEventListener('click', () => {
        const cam = game.camera;
        const r = (v) => Math.round(v * 1000) / 1000;
        const data = {
          alpha: r(cam.alpha), beta: r(cam.beta), radius: r(cam.radius), fov: r(cam.fov),
          target: [r(cam.target.x), r(cam.target.y), r(cam.target.z)],
          position: [r(cam.position.x), r(cam.position.y), r(cam.position.z)],
        };
        const text = JSON.stringify(data);
        const done = () => toast('镜头数据已复制 · ' + text);
        const fallback = () => {
          const ta = document.createElement('textarea');
          ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { toast('复制失败 · ' + text); }
          ta.remove();
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, fallback);
        } else fallback();
      });
      this.select(3);
      new ResizeObserver(resize).observe(document.getElementById('spell-dock'));
      window.addEventListener('resize', resize);
      resize();
    },

    buildSkillBar(game) {
      const bar = document.getElementById('skillbar');
      bar.innerHTML = '';
      this.slots = [];
      /* 按元素分组展示（火/冰/雷/水/土/风/圣/暗），快捷键仍绑定技能 id */
      const ordered = SKILLS.defs.slice().sort((a, b) => (a.elementOrder - b.elementOrder) || (a.id - b.id));
      for (const def of ordered) {
        const element = SKILLS.elementOf(def.element);
        const slot = document.createElement('button');
        slot.type = 'button';
        slot.setAttribute('aria-label', def.hotkey + ' · ' + def.name);
        slot.title = (element ? element.name + ' · ' : '') + def.name;
        slot.dataset.element = def.element;
        if (element) slot.style.setProperty('--element-color', element.color);
        slot.className = 'slot';
        slot.dataset.id = def.id;
        const img = document.createElement('img');
        img.src = iconDataURL(def.id, game.params.skills[def.id].color);
        slot.appendChild(img);
        const key = document.createElement('div');
        key.className = 'key';
        key.textContent = def.hotkey;
        slot.appendChild(key);
        const lvl = document.createElement('div'); lvl.className = 'slot-level'; slot.appendChild(lvl);
        const status = document.createElement('div'); status.className = 'slot-status'; slot.appendChild(status);
        const cd = document.createElement('div'); cd.className = 'cd'; slot.appendChild(cd);
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = def.name;
        slot.appendChild(nm);
        /* 元素标记：名牌上方的单字（火/冰/雷/水/土/风/圣/暗） */
        const el = document.createElement('div');
        el.className = 'slot-element';
        el.textContent = element ? element.name : '';
        if (element) el.style.color = element.color;
        slot.appendChild(el);
        slot.addEventListener('click', () => this.select(def.id));
        bar.appendChild(slot);
        slot.appendChild(status);
        this.slots.push({ def, slot, img, cd, lvl, status });
      }
    },

    buildEditor(game) {
      const body = document.getElementById('editor-body');
      body.innerHTML = '';
      this.refreshers = [];
      const p = game.params;
      if (this.selectedId) {
        const id = this.selectedId, sp = p.skills[id], tier = sp.tiers[sp.level];
        const note = document.createElement('p'); note.className = 'editor-note';
        note.textContent = SKILLS.profile(game, id).name + ' · LV.' + sp.level + ' 独立配置。颜色全等级共享，其余倍率仅影响本级。'; body.appendChild(note);
        const selected = addGroup(body, '当前等级 · 实时配置', sp.color, true);
        this.refreshers.push(addColor(selected, '技能颜色', () => sp.color, v => {
          sp.color = v; this.slots.find(s => s.def.id === id).img.src = iconDataURL(id, v); this.refreshBrief();
        }));
        for (const [key, label, min, max] of [['count', '粒子密度倍率', 0.25, 2], ['size', '技能规模倍率', 0.5, 1.6], ['speed', '弹道速度倍率', 0.5, 2], ['period', '持续周期倍率', 0.5, 2]]) {
          this.refreshers.push(addRange(selected, label, min, max, 0.05, () => tier[key], v => { tier[key] = v; this.refreshBrief(); }, v => v.toFixed(2) + ' ×'));
        }
      }

      /* —— 全局 —— */
      const gGlobal = addGroup(body, '光照与氛围', '#6fc3ff', false);
      this.refreshers.push(addRange(gGlobal, '雾密度', 0, 0.05, 0.001,
        () => p.global.fogDensity, (v) => { p.global.fogDensity = v; game.applyGlobal(); }));
      this.refreshers.push(addColor(gGlobal, '雾颜色', () => p.global.fogColor, (v) => { p.global.fogColor = v; game.applyGlobal(); }));
      this.refreshers.push(addRange(gGlobal, '曝光 Exposure', 0.2, 3, 0.01,
        () => p.global.exposure, (v) => { p.global.exposure = v; game.applyGlobal(); }));
      this.refreshers.push(addRange(gGlobal, '对比度 Contrast', 0.6, 1.8, 0.01,
        () => p.global.contrast, (v) => { p.global.contrast = v; game.applyGlobal(); }));
      this.refreshers.push(addRange(gGlobal, '环境光强度', 0, 0.8, 0.005,
        () => p.global.ambient, (v) => { p.global.ambient = v; game.applyGlobal(); }, (v) => v.toFixed(2)));

      /* —— 瞄准指示器 —— */
      const gAim = addGroup(body, '瞄准指示器', '#4dff9a', false);
      this.refreshers.push(addCheck(gAim, '显示落点圈', () => p.aim.enabled, (v) => p.aim.enabled = v));
      this.refreshers.push(addRange(gAim, '圈半径倍率', 0.4, 2, 0.01,
        () => p.aim.radius, (v) => p.aim.radius = v));
      this.refreshers.push(addColor(gAim, '射程内颜色', () => p.aim.colorOk, (v) => p.aim.colorOk = v));
      this.refreshers.push(addColor(gAim, '超程颜色', () => p.aim.colorBad, (v) => p.aim.colorBad = v));
      this.refreshers.push(addRange(gAim, '不透明度', 0.1, 1, 0.01,
        () => p.aim.opacity, (v) => p.aim.opacity = v));
      this.refreshers.push(addRange(gAim, '旋转速度', -2, 3, 0.01,
        () => p.aim.spin, (v) => p.aim.spin = v));

      /* —— 环境 —— */
      const gEnv = addGroup(body, '环境', '#8fa3c8', false);
      this.refreshers.push(addColor(gEnv, '地面颜色', () => p.env.groundColor, (v) => { p.env.groundColor = v; game.applyEnv(); }));
      this.refreshers.push(addRange(gEnv, '地面高光', 0, 0.5, 0.005,
        () => p.env.groundSpec, (v) => { p.env.groundSpec = v; game.applyEnv(); }));
      this.refreshers.push(addRange(gEnv, '噪声缩放', 2, 30, 0.5,
        () => p.env.noiseScale, (v) => { p.env.noiseScale = v; game.applyEnv(); }));
      this.refreshers.push(addRange(gEnv, '月光强度', 0, 0.6, 0.005,
        () => p.env.moon, (v) => { p.env.moon = v; game.applyEnv(); }));
      this.refreshers.push(addColor(gEnv, '月光颜色', () => p.env.moonColor, (v) => { p.env.moonColor = v; game.applyEnv(); }));

      /* —— 后期 —— */
      const gPost = addGroup(body, '后期处理', '#b79bff', false);
      this.refreshers.push(addCheck(gPost, 'Bloom 开关', () => p.post.bloom, (v) => { p.post.bloom = v; game.applyPost(); }));
      this.refreshers.push(addRange(gPost, 'Bloom 阈值', 0, 1.5, 0.01,
        () => p.post.threshold, (v) => { p.post.threshold = v; game.applyPost(); }));
      this.refreshers.push(addRange(gPost, 'Bloom 强度', 0, 2, 0.01,
        () => p.post.weight, (v) => { p.post.weight = v; game.applyPost(); }));
      this.refreshers.push(addRange(gPost, 'Bloom 半径', 8, 128, 1,
        () => p.post.kernel, (v) => { p.post.kernel = v; game.applyPost(); }));
      this.refreshers.push(addRange(gPost, '暗角 Vignette', 0, 3, 0.01,
        () => p.post.vignette, (v) => { p.post.vignette = v; game.applyPost(); }));
      this.refreshers.push(addRange(gPost, '颗粒 Grain', 0, 40, 0.5,
        () => p.post.grain, (v) => { p.post.grain = v; game.applyPost(); }));
      this.refreshers.push(addCheck(gPost, 'FXAA 抗锯齿', () => p.post.fxaa, (v) => { p.post.fxaa = v; game.applyPost(); }));

      /* —— 相机 —— */
      const gCam = addGroup(body, '相机', '#7ef0d2', false);
      this.refreshers.push(addRange(gCam, '跟随距离', 9, 44, 0.5,
        () => p.camera.distance, (v) => { p.camera.distance = v; game.camera.radius = v; }));
      this.refreshers.push(addRange(gCam, '俯仰角 β', 0.35, 1.25, 0.01,
        () => p.camera.beta, (v) => { p.camera.beta = v; game.camera.beta = v; }));
      this.refreshers.push(addRange(gCam, '视场角 FOV', 0.4, 1.2, 0.005,
        () => p.camera.fov, (v) => { p.camera.fov = v; game.applyCamera(); }));
      this.refreshers.push(addRange(gCam, '跟随平滑度', 0.02, 0.4, 0.005,
        () => p.camera.smooth, (v) => p.camera.smooth = v));

    },

    refreshAll() {
      for (const r of this.refreshers) if (r && r.refresh) r.refresh();
    },

    select(id) {
      if (!SKILLS.defs.some(d => d.id === id)) return;
      this.selectedId = id;
      for (const s of this.slots) {
        s.slot.classList.toggle('sel', s.def.id === id); s.slot.setAttribute('aria-pressed', String(s.def.id === id));
      }
      this.refreshBrief(); this.buildEditor(this.game);
    },
    setLevel(level) {
      if (!this.selectedId) this.select(3);
      SKILLS.setLevel(this.game, this.selectedId, level);
      this.refreshBrief(); this.buildEditor(this.game);
    },
    refreshBrief() {
      const p = SKILLS.profile(this.game, this.selectedId);
      if (!p) return;
      /* 高阶描述来自 skill-catalog（唯一来源），UI 不再维护副本 */
      const put = (id, value) => { document.getElementById(id).textContent = value; };
      put('hud-skill', p.level === 5 ? p.ultimateName : p.name);
      put('skill-index', 'SPELL / ' + String(this.selectedId).padStart(2, '0'));
      put('skill-badge', 'LV.' + p.level + ' · ' + p.levelName);
      document.getElementById('skill-badge').classList.toggle('ultimate', p.level === 5);
      put('skill-origin', p.level === 5 ? p.name + ' / 禁忌大法术' : '第 ' + p.level + ' 阶 · ' + p.levelName);
      const def = SKILLS.defs.find(d => d.id === this.selectedId);
      put('skill-brief', p.level >= 4 ? def.description : SKILLS.LEVELS[p.level - 1].description);
      /* 系别徽标（洛克世界 18 系） */
      const elementMeta = SKILLS.elementOf(def.element);
      const chip = document.getElementById('skill-element');
      if (chip && elementMeta) {
        chip.hidden = false;
        chip.textContent = elementMeta.name + '系';
        chip.title = elementMeta.key.toUpperCase();
        chip.style.color = elementMeta.color;
        chip.style.borderColor = elementMeta.color;
      }
      put('skill-range', p.range.toFixed(0) + ' m'); put('skill-windup', p.windup.toFixed(2) + ' s'); put('skill-cooldown', p.cooldown.toFixed(2) + ' s');
      put('level-description', p.levelName + ' · 本级参数独立保存');
      put('cast-label', p.level === 5 ? '释放大法术' : '释放技能');
      document.documentElement.style.setProperty('--skill-color', p.color);
      document.querySelectorAll('.level-step').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.level) === p.level)));
      for (const s of this.slots) {
        const level = this.game.params.skills[s.def.id].level;
        s.lvl.textContent = 'LV.' + level; s.lvl.classList.toggle('ultimate', level === 5);
      }
    },
    clearSelection() {
      this.selectedId = 0;
      for (const s of this.slots) { s.slot.classList.remove('sel'); s.slot.setAttribute('aria-pressed', 'false'); }
      const chip = document.getElementById('skill-element');
      if (chip) chip.hidden = true;
      document.getElementById('hud-skill').textContent = '选择你的法术';
      document.getElementById('skill-origin').textContent = '按 1–9 / 0 / - 或点击技能卡';
      document.getElementById('skill-brief').textContent = '已释放的法术将继续完成。';
      document.getElementById('cast-label').textContent = '选择技能';
    },
    setPhase(text) {
      const node = document.getElementById('hud-phase');
      if (node.textContent !== text) node.textContent = text || '待机';
    },
    update(dt) {
      /* 冷却/按钮/阶段的 DOM 写入全部走脏检查,值没变不碰 DOM */
      for (const s of this.slots) {
        const left = SKILLS.cooldowns[s.def.id] || 0, total = SKILLS.cooldownTotals[s.def.id] || 1;
        const ratio = Math.max(0, Math.min(1, left / total)).toFixed(3);
        if (ratio !== s.lastRatio) { s.cd.style.transform = 'scaleY(' + ratio + ')'; s.lastRatio = ratio; }
        const cooling = left > 0;
        if (cooling !== s.lastCooling) { s.slot.classList.toggle('cooling', cooling); s.lastCooling = cooling; }
        const status = left > 0 ? left.toFixed(1) + ' s' : 'READY';
        if (status !== s.lastStatus) { s.status.textContent = status; s.lastStatus = status; }
      }
      const left = SKILLS.cooldowns[this.selectedId] || 0;
      const disabled = !this.selectedId || left > 0;
      const castBtn = document.getElementById('btn-cast');
      if (castBtn.disabled !== disabled) castBtn.disabled = disabled;
      const meta = !this.selectedId ? '1–9 / 0 / - / 选择' : left > 0 ? left.toFixed(1) + ' s / 恢复中' : 'LV.' + this.game.params.skills[this.selectedId].level + ' / SPACE';
      if (meta !== this._meta) { document.getElementById('cast-meta').textContent = meta; this._meta = meta; }
      const demo = this.game.demoTimer >= 0;
      if (demo !== this._demo) {
        this._demo = demo;
        document.getElementById('btn-demo').setAttribute('aria-pressed', String(demo));
        document.getElementById('demo-label').textContent = demo ? '停止演示' : '自动演示';
      }
      const cast = SKILLS.poseOwner(this.game), phases = ['windup', 'release', 'travel', 'impact', 'aftermath'];
      const index = cast ? phases.indexOf(cast.phase) : -1;
      /* 脏检查键由 UI 自持，不再向技能实例写缓存字段 */
      const phaseKey = cast ? cast.level + '|' + cast.def.id + '|' + index : '-';
      if (phaseKey !== this._phaseKey) {
        this._phaseKey = phaseKey;
        document.querySelectorAll('.phase-step').forEach((node, i) => {
          node.classList.toggle('active', i === index); node.classList.toggle('done', i < index);
        });
        document.getElementById('phase-source').textContent = cast ? (cast.level === 5 ? cast.def.ultimateName : cast.def.name) + ' · LV.' + cast.level : '选择落点，释放你的法术。';
      }
    },

    setHud(fps, particles) {
      document.getElementById('hud-fps').textContent = fps;
      document.getElementById('hud-particles').textContent = particles;
    },
  };

  global.UI = UI;
})(window);
