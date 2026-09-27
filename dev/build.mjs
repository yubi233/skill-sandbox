/* 把源码分片 + babylon.js 内联成单文件 HTML(双击即可运行,离线可用) */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dev = dirname(fileURLToPath(import.meta.url));
const ws = join(dev, '..');

const shell = readFileSync(join(dev, 'page.html.src'), 'utf8');
const babylon = readFileSync(join(dev, 'vendor', 'babylon.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');
/* assets/*.png → window.__TEX_PNG 贴图素材(particles.js 解码后原位升级程序化贴图) */
const assetsDir = join(dev, 'assets');
let texData = '';
try {
  const files = readdirSync(assetsDir).filter((f) => f.endsWith('.png'));
  if (files.length) {
    texData = 'window.__TEX_PNG={' + files.map((f) => {
      const key = f.replace(/\.png$/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
      return JSON.stringify(key) + ':' + JSON.stringify('data:image/png;base64,' + readFileSync(join(assetsDir, f)).toString('base64'));
    }).join(',') + '};\n;\n';
  }
} catch (e) { }
const app = texData + ['particles.js', 'core.js', 'skills.js', 'ui.js', 'main.js']
  .map((f) => readFileSync(join(dev, f), 'utf8'))
  .join('\n;\n')
  .replace(/<\/script/gi, '<\\/script');

const out = shell
  .replace('/*__BABYLON__*/', () => babylon)
  .replace('/*__APP__*/', () => app);

const target = join(ws, 'element-skill-sandbox.html');
writeFileSync(target, out);
console.log('built ->', target, (out.length / 1024 / 1024).toFixed(2) + ' MB');
