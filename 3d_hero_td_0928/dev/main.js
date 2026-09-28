/* ==========================================================================
   main.js — 输入、瞄准与统一时间步
   1–3 选择法术，鼠标左键向落点释放，空格向自动锁定目标释放；
   F / G 召唤已解锁盟友；右键拖动环绕镜头，滚轮缩放。
   显式流水线：update(时间) → DIRECTOR(波次) → Units(实体) → SPELLS(法术)
   → FX(粒子) → lateUpdate(姿态/镜头) → UI → render。
   ========================================================================== */
(function (global) {
  'use strict';

  global.__errors = [];
  const originalError = console.error.bind(console);
  console.error = function () {
    global.__errors.push(Array.prototype.map.call(arguments, String).join(' '));
    originalError.apply(null, arguments);
  };
  window.addEventListener('error', (e) => {
    global.__errors.push('onerror: ' + e.message + ' @ ' + (e.filename || '') + ':' + e.lineno);
  });
  window.addEventListener('unhandledrejection', (e) => {
    global.__errors.push('unhandledrejection: ' + String(e.reason));
  });

  function boot() {
    /* 启动即校验注册表：数值接线问题一次全部暴露 */
    const problems = CONFIG.validate();
    if (problems.length) console.error('[config] 注册表校验失败: ' + problems.join(' | '));

    const canvas = document.getElementById('scene');
    const game = Core.createGame(canvas);
    global.__game = game;
    Units.bind(game);
    DIRECTOR.bind(game);
    UI.init(game);

    const keys = {};
    const mouse = { x: canvas.clientWidth * 0.5, y: canvas.clientHeight * 0.5 };
    let aimPoint = new BABYLON.Vector3(0, 0, 6);
    let rightDown = null;

    function isEditing(target) {
      return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        UI.clearSelection();
        UI.togglePanel(false);
        game.ring.setVisible(false);
        e.preventDefault();
        return;
      }
      if (isEditing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const spellDef = CONFIG.SPELLS.find((s) => s.hotkey === e.key);
      if (spellDef) {
        if (DIRECTOR.inRun() && DIRECTOR.ownsSpell(spellDef.id)) UI.select(spellDef.id);
        e.preventDefault();
        return;
      }
      const allyDef = CONFIG.ALLIES.find((a) => a.hotkey.toLowerCase() === e.key.toLowerCase());
      if (allyDef) {
        if (DIRECTOR.inRun() && DIRECTOR.ownsAlly(allyDef.key)) DIRECTOR.summon(allyDef.key);
        e.preventDefault();
        return;
      }
      if (e.code === 'Space' && e.target.tagName !== 'BUTTON') {
        if (!e.repeat) castAtAutoTarget();
        e.preventDefault();
        return;
      }
      if (e.key.toLowerCase() === 'n' && DIRECTOR.state === 'intermission') {
        DIRECTOR.startNextNow();
        e.preventDefault();
      }
      if (e.key.toLowerCase() === 'r' && !e.repeat) {
        DIRECTOR.retreat();
        e.preventDefault();
      }
    });

    function trackPointer(e) {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.dirty = true;
    }
    canvas.addEventListener('pointermove', trackPointer);
    canvas.addEventListener('wheel', () => { mouse.dirty = true; }, { passive: true });
    canvas.addEventListener('pointerdown', (e) => {
      trackPointer(e);
      if (e.button === 0) {
        updateAim(0);
        tryCast(aimPoint);
      } else if (e.button === 2) {
        rightDown = { x: e.clientX, y: e.clientY };
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button !== 2 || !rightDown) return;
      const distance = Math.hypot(e.clientX - rightDown.x, e.clientY - rightDown.y);
      rightDown = null;
      if (distance < 6) {
        /* 右键轻点：取消选择 */
        UI.clearSelection();
        game.ring.setVisible(false);
      }
    });
    canvas.addEventListener('pointercancel', () => { rightDown = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function tryCast(point) {
      if (!DIRECTOR.inRun()) return false;
      if (!UI.selectedId) { UI.toast('点击法术栏，或按 1 选择火球术'); return false; }
      if (!DIRECTOR.ownsSpell(UI.selectedId)) return false;
      const def = SPELLS.defs.find((d) => d.id === UI.selectedId);
      if (!def) return false;
      if (!SPELLS.isReady(def.id)) { UI.toast(def.name + ' · 冷却中'); return false; }
      const mp = game.mage.root.position;
      const distance = Math.hypot(point.x - mp.x, point.z - mp.z);
      if (distance > def.range) {
        UI.toast('超出射程 · ' + def.range + ' m');
        return false;
      }
      const ok = SPELLS.start(game, def.id, point);
      if (!ok) UI.toast(SPELLS.lastRejectReason === 'error' ? '释放异常，法术已回收' : '上一法术仍在释放');
      return ok;
    }

    function castAtAutoTarget() {
      if (!DIRECTOR.inRun()) return false;
      if (!UI.selectedId) { UI.select(1); }
      const def = SPELLS.defs.find((d) => d.id === UI.selectedId);
      if (!def) return;
      const mp = game.mage.root.position;
      /* 自动锁定：射程内最远的正面威胁（更靠近防线的敌人优先） */
      let target = null, bestZ = Infinity;
      for (const e of Units.enemies) {
        if (!e.alive) continue;
        const d = Math.hypot(e.x - mp.x, e.z - mp.z);
        if (d > def.range) continue;
        if (e.z < bestZ) { bestZ = e.z; target = e; }
      }
      const point = target ? SPELLS.targetPoint(target, def.id)
        : new BABYLON.Vector3(mp.x, 0, Math.min(mp.z + 12, CONFIG.FIELD.spawnZ));
      return tryCast(point);
    }

    let pickFrame = 0;
    function updateAim(dt) {
      pickFrame++;
      const idle = !mouse.dirty && !rightDown;
      if (!idle || pickFrame % 4 === 0) {
        mouse.dirty = false;
        const pick = game.scene.pick(mouse.x, mouse.y, (m) => m === game.ground);
        if (pick && pick.hit && pick.pickedPoint) {
          aimPoint.copyFrom(pick.pickedPoint);
          aimPoint.y = 0;
        }
      }
      const id = UI.selectedId;
      const def = SPELLS.defs.find((d) => d.id === id);
      const show = !!(DIRECTOR.inRun() && def && DIRECTOR.ownsSpell(id) && def.groundTarget);
      game.ring.setVisible(show);
      if (show) {
        const mp = game.mage.root.position;
        const distance = Math.hypot(aimPoint.x - mp.x, aimPoint.z - mp.z);
        game.ring.update(dt, aimPoint, distance <= def.range, def.radius, def.color);
      }
    }

    game.tick = function (dt) {
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
      game.frameDt = dt;
      game.update(dt);
      if (!game.paused) {
        DIRECTOR.update(dt);
        Units.update(dt);
        SPELLS.update(game, dt);
        FX.update(dt);
      }
      game.lateUpdate(dt);
      updateAim(dt);
      UI.update(dt);
      game.render();
    };

    let lastNativeFrame = performance.now();
    let lastRenderedFrame = lastNativeFrame;
    game.renderPaused = false;
    const draw = (now) => {
      const dt = Math.min((now - lastRenderedFrame) / 1000, 0.05);
      lastRenderedFrame = now;
      try {
        game.tick(dt);
      } catch (e) {
        const message = 'tick: ' + (e && e.stack ? e.stack : String(e));
        if (!global.__errors.includes(message)) global.__errors.push(message);
      }
    };
    game.engine.runRenderLoop(() => {
      const now = performance.now(); lastNativeFrame = now;
      if (!game.renderPaused) draw(now);
    });
    /* 部分嵌入式 WebView 在页面可见时仍暂停 RAF；仅在原生帧停滞时补帧 */
    const watchdog = setInterval(() => {
      const now = performance.now();
      if (document.hidden || game.renderPaused || now - lastNativeFrame < 250) return;
      game.engine.beginFrame();
      try { draw(now); } finally { game.engine.endFrame(); }
    }, 33);
    game.__watchdog = watchdog;
    window.addEventListener('pagehide', () => clearInterval(watchdog), { once: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
