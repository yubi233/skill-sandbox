/* QA 截图流水线：CDP 控制 headless Chrome，逐技能逐级施法、手动步进到关键帧、截图。
   零依赖（Node >= 22 原生 WebSocket + fetch）。用法：
     node dev/tools/qa_shot.mjs            # 截取 9 技能 × 5 级，输出 dev/qa/levels/*.png
     node dev/tools/qa_shot.mjs 3 5        # 只截技能 3 的 5 级
   截图前用 dev/tools/qa_montage.py 拼对比图。 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = Number(process.env.QA_PORT || 9333);
const PAGE_URL = 'file://' + path.join(ROOT, 'element-skill-sandbox.html');
const OUT = path.join(ROOT, 'dev/qa/levels');
const W = 1600, H = 1000;

/* 施法后步进到哪个阶段截帧：travel 中后期主体完全展开 */
const SHOT_PHASE = { travel: 0.72, impact: 0.35 };

function log(...a) { console.error('[qa]', ...a); }

async function waitPort(port, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch('http://127.0.0.1:' + port + '/json/version');
      if (r.ok) return r.json();
    } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Chrome 调试端口 ' + port + ' 未就绪');
}

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.waiters = new Map(); this.buf = ''; 
    ws.addEventListener('message', ev => this.onData(ev.data)); }
  onData(raw) {
    const s = typeof raw === 'string' ? raw : String(raw);
    let msg; try { msg = JSON.parse(s); } catch { return; }
    if (!msg.id || !this.waiters.has(msg.id)) return;
    const { resolve, reject } = this.waiters.get(msg.id);
    this.waiters.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiters.delete(id); reject(new Error('CDP 超时: ' + method)); }, 45000);
      this.waiters.set(id, { resolve: r => { clearTimeout(timer); resolve(r); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function newTarget() {
  const r = await fetch('http://127.0.0.1:' + PORT + '/json/new?' + encodeURIComponent(PAGE_URL), { method: 'PUT' });
  if (!r.ok) throw new Error('创建目标失败: ' + r.status);
  return r.json();
}

/* 注入到页面的 QA 助手：手动步进 + 状态回报 */
const HELPER = `
window.__qa = {
  ready() { return !!(window.__game && window.__game.scene && window.SKILLS); },
  errors() { return (window.__errors || []).slice(); },
  reset() {
    const g = window.__game;
    g.renderPaused = true;
    window.SKILLS.abortAll();
    window.SKILLS.clearCooldowns();
    window.__qa._fired = false;
    return true;
  },
  fire(id, level) {
    const g = window.__game;
    window.SKILLS.abortAll(); window.SKILLS.clearCooldowns();
    /* 必须走 UI 选择/设级：refreshBrief 只在 select/setLevel 里调用，
       否则左侧面板会停留在启动默认等级，截图无法自证当前等级。 */
    if (window.UI && window.UI.select && window.UI.setLevel) {
      window.UI.select(id); window.UI.setLevel(level);
    } else window.SKILLS.setLevel(g, id, level);
    const m = g.mage.root.position, f = g.mage.facing || 0;
    const aim = new BABYLON.Vector3(m.x + Math.sin(f) * 17, 0, m.z + Math.cos(f) * 17);
    const ok = window.SKILLS.start(g, id, aim);
    return { ok, reason: window.SKILLS.lastRejectReason };
  },
  step(n) {
    const g = window.__game;
    g.renderPaused = true;
    for (let i = 0; i < n; i++) {
      g.engine.beginFrame(); g.tick(1 / 60); g.engine.endFrame();
    }
    const c = window.SKILLS.casts[0];
    return c ? { phase: c.phase, prog: c.phaseProgress(), total: +c.total.toFixed(2), lv: c.level } : null;
  },
  done() {
    const c = window.SKILLS.casts[0];
    return c ? { phase: c.phase, prog: c.phaseProgress() } : null;
  },
  cleanup() { window.SKILLS.abortAll(); window.SKILLS.clearCooldowns(); return true; },
  /* 锁定机位后补渲染一帧：绕过 lateUpdate 的电影感推拉，读技能拓扑用侧视 3/4 机位。
     同时隐藏试炼场符纹光盘(arenaRune)，否则中央青光会压住技能主体。 */
  frame(level) {
    const g = window.__game;
    const disc = g.scene.getMeshByName('arenaRune');
    if (disc) disc.setEnabled(false);
    g.cinematic.shake = 0; g.cinematic.intensity = 0;
    const m = g.mage.root.position, f = g.mage.facing || 0;
    const tx = m.x + Math.sin(f) * 17, tz = m.z + Math.cos(f) * 17;
    const cam = g.camera;
    cam.target.set((m.x + tx) / 2, 1.7 + level * 0.75, (m.z + tz) / 2);
    cam.alpha = -f + 0.55;      /* 与施法方向垂直的侧视，拓扑最易读 */
    cam.beta = 1.00;
    cam.radius = 15 + level * 2.7;
    cam.fov = 0.92;
    g.render();
    return true;
  }
};`;

async function main() {
  const only = process.argv.slice(2).map(Number);
  /* 默认全量；只截部分时走命令行参数。全量列表等到页面就绪后从注册表派生（见下） */
  const ids = only.length ? only : null;

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  log('启动 Chrome …');
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-crash-reporter', '--disable-breakpad',
    '--remote-debugging-port=' + PORT,
    '--no-first-run', '--no-default-browser-check',
    '--user-data-dir=' + path.join(ROOT, 'dev/.qa-profile'),
    '--window-size=' + W + ',' + H,
    /* 注意：不要加 --use-gl=angle，会让渲染进程崩溃；SwiftShader 走 ANGLE 即可 */
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
    '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let chromeLog = '';
  chrome.stderr.on('data', d => { chromeLog += d; if (process.env.QA_DEBUG) process.stderr.write(d); });

  const results = [];
  let cdp = null;
  try {
    await waitPort(PORT);
    const target = await newTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });
    cdp = new CDP(ws);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await cdp.send('Page.navigate', { url: PAGE_URL });

    /* 等游戏就绪 */
    let ready = false;
    for (let i = 0; i < 120 && !ready; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const r = await cdp.send('Runtime.evaluate', { expression: '!!(window.__game && window.__game.scene && window.SKILLS)', returnByValue: true });
        ready = !!r.result.value;
      } catch {}
    }
    if (!ready) throw new Error('页面游戏未就绪');
    log('游戏就绪');

    await cdp.send('Runtime.evaluate', { expression: HELPER, returnByValue: true });

    const ev = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: false });
      if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    };

    const allIds = ids || await ev('window.SKILL_CATALOG.map(s => s.id)');

    for (const id of allIds) {
      for (let level = 1; level <= 5; level++) {
        await ev('window.__qa.reset()');
        const fired = await ev(`window.__qa.fire(${id}, ${level})`);
        if (!fired.ok) { log(`技能 ${id} LV${level} 施法失败: ${fired.reason}`); results.push({ id, level, error: fired.reason }); continue; }

        /* 先粗步进推到 travel，再细步进推到中后期（主体完全展开） */
        let st = null, guard = 0;
        const travelIdx = PHASE_ORDER.indexOf('travel');
        while (guard++ < 400) {
          st = await ev('window.__qa.step(12)');
          if (!st || PHASE_ORDER.indexOf(st.phase) >= travelIdx) break;
        }
        guard = 0;
        while (st && st.phase === 'travel' && st.prog < SHOT_PHASE.travel && guard++ < 80) {
          st = await ev('window.__qa.step(4)');
        }
        /* 锁定机位 + 补渲染一帧，再截图 */
        await ev(`window.__qa.frame(${level})`);
        const file = path.join(OUT, `s${id}_l${level}.png`);
        const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        /* 等级断言：截图必须来自本级的施法实例，防止文件名与实际等级错位 */
        const lvMismatch = st && st.lv !== level;
        results.push({ id, level, castLevel: st && st.lv, phase: st && st.phase, prog: st && +(st.prog).toFixed(2), mismatch: !!lvMismatch });
        log(`技能 ${id} LV${level} @ ${st ? st.phase + ' ' + Math.round(st.prog * 100) + '%' : '?'}`
          + (st ? '  cast=' + st.lv : '') + (lvMismatch ? '  !! 等级错位' : ''));
        await ev('window.__qa.cleanup()');
      }
    }

    const errs = await ev('window.__qa.errors()');
    if (errs.length) { log('页面错误 ' + errs.length + ' 条:'); errs.slice(0, 10).forEach(e => log('  ' + String(e).slice(0, 300))); }
    writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ results, errors: errs }, null, 2));
    log('完成 ' + results.length + ' 帧 → ' + OUT);
  } finally {
    if (cdp) cdp.close();
    chrome.kill('SIGTERM');
    try { rmSync(path.join(ROOT, 'dev/.qa-profile'), { recursive: true, force: true }); } catch {}
  }
}

const PHASE_ORDER = ['windup', 'release', 'travel', 'impact', 'aftermath'];

main().catch(e => { console.error('[qa] 失败:', e.message); process.exit(1); });
