'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('构建产物存在且无未替换占位符', () => {
  const out = path.join(ROOT, 'legion-breaker.html');
  assert.ok(fs.existsSync(out), '缺少构建产物，请先运行 node dev/build.mjs');
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(!html.includes('/*__BABYLON__*/') && !html.includes('/*__APP__*/'), '占位符必须全部替换');
  assert.ok(html.includes('死灵防线'), '页面标题应就位');
});

test('构建产物包含全部源码分片（改源码必须重新构建）', () => {
  const html = fs.readFileSync(path.join(ROOT, 'legion-breaker.html'), 'utf8');
  const sources = ['particles.js', 'config.js', 'core.js', 'entities.js', 'skills.js', 'director.js', 'ui.js', 'main.js'];
  let offset = 0;
  for (const file of sources) {
    /* 与构建器一致转义 HTML script 结束标签，校验完整源码且保持加载顺序。
       注释标记既会随美术文案过期，也无法发现标记不变但逻辑尚未重建。 */
    const source = fs.readFileSync(path.join(ROOT, 'dev', file), 'utf8').replace(/<\/script/gi, '<\\/script');
    const at = html.indexOf(source, offset);
    assert.ok(at >= 0, file + ' 完整源码未按顺序出现在产物中（源码已改但未重新构建？）');
    offset = at + source.length;
  }
});

test('构建幂等：重复构建产出一致', () => {
  const before = fs.readFileSync(path.join(ROOT, 'legion-breaker.html'));
  execFileSync(process.execPath, [path.join(ROOT, 'dev', 'build.mjs')], { stdio: 'pipe' });
  const after = fs.readFileSync(path.join(ROOT, 'legion-breaker.html'));
  assert.ok(after.equals(before), '重复构建产物必须逐字节一致，不能只比较长度');
});
