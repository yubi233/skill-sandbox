'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/* Vite 管线（阶段1起）：产物为内联 Babylon 与贴图的单文件 HTML。
   「改源码必须重新构建」的完整性由 npm run verify（typecheck + 测试 + 构建）保证，
   此处校验产物自包含性与可复现构建。 */
test('构建产物存在且为自包含单文件', () => {
  const out = path.join(ROOT, 'legion-breaker.html');
  assert.ok(fs.existsSync(out), '缺少构建产物，请先运行 npm run build');
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(!html.includes('/*__BABYLON__*/') && !html.includes('/*__APP__*/'), '占位符必须全部替换');
  assert.ok(html.includes('死灵防线'), '页面标题应就位');
  assert.ok(!/<script[^>]+src=/.test(html), '不允许外部脚本引用（离线单文件契约）');
  assert.ok(html.includes('daylightGrass'), '贴图应内联');
  for (const marker of ['魔焰强化', 'unlockBolt', '走进余烬营地', '死灵防线战场']) {
    assert.ok(html.includes(marker), `产物缺少运行时标记: ${marker}`);
  }
});

test('构建幂等：重复构建产出一致', () => {
  const out = path.join(ROOT, 'legion-breaker.html');
  const before = fs.readFileSync(out);
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'pipe' });
  const after = fs.readFileSync(out);
  assert.ok(before.equals(after), '重复构建产物必须逐字节一致');
});
