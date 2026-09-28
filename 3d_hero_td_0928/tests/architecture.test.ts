/* 阶段3e 验收：core 分层门禁。
   src/core/** 是纯逻辑层——禁止 import Babylon、禁止触碰 window/document/DOM。
   这条门禁是「无头验收 + 表测试直连 core」的前提，破坏即视为架构回归。 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const coreDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'core');

function coreFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full);
      else if (name.name.endsWith('.ts')) out.push(full);
    }
  };
  walk(coreDir);
  return out;
}

test('core 分层门禁：零 Babylon 引用', () => {
  for (const file of coreFiles()) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!/from ['"]@babylonjs/.test(src) && !/from ['"].*babylon/i.test(src),
      `${file} 引入了 Babylon——core 必须是纯逻辑层`);
  }
});

test('core 分层门禁：零 window/document/DOM 触碰（模块求值期与函数体内皆禁）', () => {
  for (const file of coreFiles()) {
    const src = readFileSync(file, 'utf8');
    assert.ok(!/\bwindow\b/.test(src), `${file} 触碰 window（shim 也必须带 typeof 守卫以外的方式归入 render）`);
    assert.ok(!/\bdocument\b/.test(src), `${file} 触碰 document`);
    assert.ok(!/\blocalStorage\b/.test(src), `${file} 触碰 localStorage`);
    assert.ok(!/\bnavigator\b/.test(src), `${file} 触碰 navigator`);
  }
});

test('core 分层门禁：不 import 任何 render 模块', () => {
  for (const file of coreFiles()) {
    const src = readFileSync(file, 'utf8');
    const bad = src.match(/from ['"][^'"]*(render|entities|skills|particles|scene|mage|ui)[^'"]*['"]/);
    assert.ok(!bad, `${file} 反向依赖 render 层: ${bad?.[0]}`);
  }
});

test('core 门禁覆盖检查：目录里确实有被测文件', () => {
  const files = coreFiles();
  assert.ok(files.length >= 5, `src/core 应至少有 config/director/events/rng/rules 等文件，实际 ${files.length}`);
  assert.ok(files.some((f) => f.endsWith('config.ts')), 'config.ts 应在 core 层');
  assert.ok(files.some((f) => f.endsWith('director.ts')), 'director.ts 应在 core 层');
  assert.ok(files.some((f) => f.endsWith('stats.ts')), 'rules/stats.ts 应在 core 层');
});
