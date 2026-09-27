/* ==========================================================================
   main.js — 输入、瞄准、演示与统一时间步
   1–9 选择技能，[] 切换等级，空格向前释放，WASD 移动。
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
    const canvas = document.getElementById('scene');
    const game = Core.createGame(canvas);
    global.__game = game;
    UI.init(game);

    game.onPhase = (label, skillName) => UI.setPhase(skillName + ' · ' + label);
    const keys = {};
    const mouse = { x: canvas.clientWidth * 0.5, y: canvas.clientHeight * 0.5 };
    let aimPoint = new BABYLON.Vector3(0, 0, 8);
    let rightDown = null;

    function isEditing(target) {
      return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        cancelCast();
        e.preventDefault();
        return;
      }
      if (isEditing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '9') {
        UI.select(Number(e.key));
        e.preventDefault();
        return;
      }
      if (e.key === '[' || e.key === ']') {
        if (UI.selectedId) {
          const current = game.params.skills[UI.selectedId].level;
          UI.setLevel(Math.max(1, Math.min(5, current + (e.key === ']' ? 1 : -1))));
        }
        e.preventDefault();
        return;
      }
      if (e.code === 'Space' && e.target.tagName !== 'BUTTON') {
        if (!e.repeat) game.castSelected();
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') keys.w = true;
      if (k === 's' || k === 'arrowdown') keys.s = true;
      if (k === 'a' || k === 'arrowleft') keys.a = true;
      if (k === 'd' || k === 'arrowright') keys.d = true;
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || k === 'arrowup') keys.w = false;
      if (k === 's' || k === 'arrowdown') keys.s = false;
      if (k === 'a' || k === 'arrowleft') keys.a = false;
      if (k === 'd' || k === 'arrowright') keys.d = false;
    });
    function clearKeys() {
      keys.w = keys.s = keys.a = keys.d = false;
      rightDown = null;
    }
    window.addEventListener('blur', clearKeys);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) clearKeys();
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
      mouse.dirty = true;
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
      if (distance < 6) cancelCast();
    });
    canvas.addEventListener('pointercancel', () => { rightDown = null; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    function cancelCast() {
      game.demoTimer = -1;
      for (let i = SKILLS.casts.length - 1; i >= 0; i--) {
        const cast = SKILLS.casts[i];
        if (cast.phase === 'windup' || cast.phase === 'release') {
          cast.dispose();
          SKILLS.casts.splice(i, 1);
        }
      }
      UI.clearSelection();
      game.ring.setVisible(false);
      UI.setPhase('待机');
      UI.toast('已取消蓄力与选择 · 已释放的法术继续完成');
    }

    function tryCast(point) {
      const id = UI.selectedId;
      if (!id) { UI.toast('先按 1–9 选择技能'); return false; }
      const def = SKILLS.defs.find(d => d.id === id);
      const profile = SKILLS.profile(game, id);
      if (!def || !profile) return false;
      if (!SKILLS.isReady(id)) { UI.toast(def.name + ' · 能量恢复中'); return false; }
      const mp = game.mage.root.position;
      const distance = Math.hypot(point.x - mp.x, point.z - mp.z);
      if (def.groundTarget && distance > profile.range) {
        UI.toast('超出当前等级射程 · ' + Math.round(profile.range) + ' m');
        return false;
      }
      game.mage.faceTo(point.x - mp.x, point.z - mp.z);
      const ok = SKILLS.start(game, id, point);
      if (!ok) UI.toast('法术能量正在释放，请稍候');
      return ok;
    }

    function forwardTarget(id, offset) {
      const profile = SKILLS.profile(game, id);
      const mp = game.mage.root.position;
      const direction = game.camera.getDirection(BABYLON.Vector3.Forward());
      direction.y = 0;
      if (direction.lengthSquared() < 0.001) direction.set(0, 0, 1);
      direction.normalize();
      const angle = offset || 0;
      const x = direction.x * Math.cos(angle) - direction.z * Math.sin(angle);
      const z = direction.x * Math.sin(angle) + direction.z * Math.cos(angle);
      const distance = Math.min(profile.range * 0.68, profile.level === 5 ? 8.0 : 6.7);
      return new BABYLON.Vector3(mp.x + x * distance, 0, mp.z + z * distance);
    }

    game.castSelected = function () {
      if (!UI.selectedId) { UI.select(3); }
      aimPoint = forwardTarget(UI.selectedId);
      return tryCast(aimPoint);
    };

    let pickFrame = 0;
    function updateAim(dt) {
      pickFrame++;
      /* 地面射线拾取每帧都有分配:鼠标未动、非拖拽、非移动时每4帧重投一次 */
      const idle = !mouse.dirty && !rightDown && game.moveInput.x === 0 && game.moveInput.z === 0;
      if (!idle || pickFrame % 4 === 0) {
        mouse.dirty = false;
        const pick = game.scene.pick(mouse.x, mouse.y, m => m === game.ground);
        if (pick && pick.hit && pick.pickedPoint) {
          aimPoint.copyFrom(pick.pickedPoint);
          aimPoint.y = 0;
        }
      }
      const id = UI.selectedId;
      const def = SKILLS.defs.find(d => d.id === id);
      const show = !!(def && def.groundTarget && game.params.aim.enabled);
      game.ring.setVisible(show);
      if (show) {
        const profile = SKILLS.profile(game, id);
        const mp = game.mage.root.position;
        const distance = Math.hypot(aimPoint.x - mp.x, aimPoint.z - mp.z);
        game.ring.update(dt, aimPoint, distance <= profile.range, profile.radius, game.params.aim);
      }
    }

    game.demoTimer = -1;
    game.demoIndex = 0;
    const demoOrder = [3, 2, 6, 4, 5, 1, 7, 8, 9];
    function updateDemo(dt) {
      if (game.demoTimer < 0) return;
      // 大法术完整收招后再接下一招，避免八种元素叠成白屏。
      const active = SKILLS.casts.some(c => !c.finished);
      if (active) { game.demoTimer = 0; return; }
      game.demoTimer += dt;
      if (game.demoTimer < 0.85) return;
      const id = demoOrder[game.demoIndex % demoOrder.length];
      if (!SKILLS.isReady(id)) return;
      UI.select(id);
      aimPoint = forwardTarget(id, Math.sin(game.demoIndex * 1.1) * 0.22);
      if (tryCast(aimPoint)) {
        game.demoIndex++;
        game.demoTimer = 0;
      }
    }

    let hudT = 0;
    game.tick = function (dt) {
      dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.05)) : 0;
      game.frameDt = dt;
      game.moveInput.x = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);
      game.moveInput.z = (keys.w ? 1 : 0) - (keys.s ? 1 : 0);
      updateAim(dt);
      updateDemo(dt);
      SKILLS.update(dt);
      FX.update(dt);
      UI.update(dt);
      if (SKILLS.casts.length === 0 && game.demoTimer < 0) UI.setPhase('待机');
      hudT += dt;
      if (hudT >= 0.25) {
        hudT = 0;
        UI.setHud(Math.round(game.engine.getFps()), FX.aliveCount());
      }
      game.scene.render();
    };

    let lastNativeFrame = performance.now();
    let lastRenderedFrame = lastNativeFrame;
    game.renderPaused = false;
    const draw = (now) => {
      const dt = Math.min((now - lastRenderedFrame) / 1000, 0.05);
      lastRenderedFrame = now;
      try {
        game.tick(dt * (game.timeScale ?? 1));
      } catch (e) {
        const message = 'tick: ' + (e && e.stack ? e.stack : String(e));
        if (!global.__errors.includes(message)) global.__errors.push(message);
      }
    };
    game.engine.runRenderLoop(() => {
      const now = performance.now(); lastNativeFrame = now;
      if (!game.renderPaused) draw(now);
    });
    // 部分嵌入式 WebView 在页面可见时仍暂停 RAF；仅在原生帧停滞时补帧。
    const watchdog = setInterval(() => {
      const now = performance.now();
      if (document.hidden || game.renderPaused || now - lastNativeFrame < 250) return;
      game.engine.beginFrame();
      try { draw(now); } finally { game.engine.endFrame(); }
    }, 33);
    window.addEventListener('pagehide', () => clearInterval(watchdog), { once: true });
    UI.toast('末日陨星已就绪 · 点击释放，或按空格');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
