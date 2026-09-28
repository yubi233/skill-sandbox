// dist/index.html → 项目根 legion-breaker.html（离线单文件，预览 URL 保持不变）。
import { copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const from = join(root, 'dist', 'index.html');
const to = join(root, 'legion-breaker.html');
copyFileSync(from, to);
const mb = (statSync(to).size / 1024 / 1024).toFixed(2);
console.log(`built -> ${to} (${mb} MB)`);
