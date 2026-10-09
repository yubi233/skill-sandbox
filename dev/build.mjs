/* 把源码分片 + babylon.js 内联成单文件 HTML(双击即可运行,离线可用)
   源码清单按加载顺序声明；贴图读取失败/键冲突/占位符未替换都会让构建失败。 */
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const dev = dirname(fileURLToPath(import.meta.url));
const ws = join(dev, '..');

/* 应用源码分片,顺序即加载顺序(particles → catalog → core → skills → ui → main) */
const SOURCES = ['particles.js', 'skill-catalog.js', 'core.js', 'skills.js', 'ui.js', 'main.js'];

const shell = readFileSync(join(dev, 'page.html.src'), 'utf8');
const babylon = readFileSync(join(dev, 'vendor', 'babylon.js'), 'utf8')
  .replace(/<\/script/gi, '<\\/script');

/* assets/*.png → window.__TEX_PNG 贴图素材(particles.js 解码后原位升级程序化贴图)。
   目录缺失=可选项,警告并跳过(程序化贴图兜底);
   目录存在但单个文件读取失败=致命,构建失败(绝不静默丢失整批素材)。 */
const assetsDir = join(dev, 'assets');
let texData = '';
let assetFiles = null;
try {
  assetFiles = readdirSync(assetsDir).filter((f) => f.endsWith('.png'));
} catch (e) {
  if (e && e.code === 'ENOENT') console.warn('[build] 无贴图素材目录，跳过 AI 贴图内联: ' + assetsDir);
  else throw e;
}
if (assetFiles && assetFiles.length) {
  const entries = assetFiles.map((f) => {
    let data;
    try {
      data = readFileSync(join(assetsDir, f));
    } catch (e) {
      throw new Error('[build] 贴图素材读取失败: ' + f + ' — ' + ((e && e.message) || e));
    }
    const key = f.replace(/\.png$/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
    return { key, uri: 'data:image/png;base64,' + data.toString('base64') };
  });
  const seen = new Set();
  for (const { key } of entries) {
    if (seen.has(key)) throw new Error('[build] 贴图键冲突(文件名折叠出同名键): ' + key);
    seen.add(key);
  }
  texData = 'window.__TEX_PNG={' + entries.map(({ key, uri }) => JSON.stringify(key) + ':' + JSON.stringify(uri)).join(',') + '};\n;\n';
}
const app = texData + SOURCES
  .map((f) => readFileSync(join(dev, f), 'utf8'))
  .join('\n;\n')
  .replace(/<\/script/gi, '<\\/script');

const out = shell
  .replace('/*__BABYLON__*/', () => babylon)
  .replace('/*__APP__*/', () => app);

for (const marker of ['/*__BABYLON__*/', '/*__APP__*/']) {
  if (out.includes(marker)) throw new Error('[build] 占位符未替换: ' + marker);
}

const target = join(ws, 'element-skill-sandbox.html');
writeFileSync(target, out);
console.log('built ->', target, (out.length / 1024 / 1024).toFixed(2) + ' MB');
