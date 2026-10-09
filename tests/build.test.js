'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { ROOT } = require('./helpers/harness');

/* 在内存中执行 dev/build.mjs（不写文件），允许注入 readdir/readFileSync 模拟故障 */
function runBuild(overrides = {}) {
  const buildPath = path.join(ROOT, 'dev', 'build.mjs');
  const source = fs.readFileSync(buildPath, 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace('import.meta.url', JSON.stringify(pathToFileURL(buildPath).href));
  let output = null;
  let target = null;
  vm.runInNewContext(source, {
    readFileSync: overrides.readFileSync || fs.readFileSync,
    readdirSync: overrides.readdirSync || fs.readdirSync,
    writeFileSync: (p, s) => { target = p; output = s; },
    join: path.join,
    dirname: path.dirname,
    fileURLToPath,
    console: { log() {}, warn() {} },
  }, { filename: buildPath });
  return { output, target };
}

test('构建产物与 dev 源码一致（防止只改生成物）', () => {
  const { output } = runBuild();
  const committed = fs.readFileSync(path.join(ROOT, 'element-skill-sandbox.html'), 'utf8');
  assert.strictEqual(output, committed,
    'element-skill-sandbox.html 与 dev 源码构建结果不一致，请运行 node dev/build.mjs');
});

test('单张贴图读取失败必须让构建失败', () => {
  const real = fs.readFileSync.bind(fs);
  const broken = path.join('dev', 'assets', 'rune.png');
  assert.throws(() => runBuild({
    readFileSync: (file, ...rest) => {
      if (String(file).endsWith(broken)) {
        throw Object.assign(new Error('EACCES injected'), { code: 'EACCES' });
      }
      return real(file, ...rest);
    },
  }), /贴图素材读取失败/);
});

test('贴图键冲突必须让构建失败', () => {
  assert.throws(() => runBuild({ readdirSync: () => ['rune.png', 'rune.png'] }), /贴图键冲突/);
});

test('素材目录缺失：警告并回退程序化贴图', () => {
  const missing = Object.assign(new Error('no such directory'), { code: 'ENOENT' });
  const { output } = runBuild({ readdirSync: () => { throw missing; } });
  assert.ok(!output.includes('window.__TEX_PNG={'), '缺失素材目录时不应内联贴图');
  assert.ok(output.includes('global.SKILLS = SKILLS'), '应用代码缺失');
});
