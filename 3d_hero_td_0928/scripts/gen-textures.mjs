// assets/*.png → src/generated/textures.ts（内联 dataURI，替代旧 __TEX_PNG 注入）。
// 由 npm run build / gen:textures 调用；键名规则与旧 dev/build.mjs 一致（连字符转驼峰）。
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const assetsDir = join(root, 'assets');
const outFile = join(root, 'src', 'generated', 'textures.ts');

const files = readdirSync(assetsDir).filter((f) => f.endsWith('.png'));
const entries = files.map((f) => {
  const key = f.replace(/\.png$/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
  const uri = 'data:image/png;base64,' + readFileSync(join(assetsDir, f)).toString('base64');
  return { key, uri };
});
const seen = new Set();
for (const { key } of entries) {
  if (seen.has(key)) throw new Error(`贴图键冲突: ${key}`);
  seen.add(key);
}

mkdirSync(dirname(outFile), { recursive: true });
const body = entries.map(({ key, uri }) => `  ${JSON.stringify(key)}: ${JSON.stringify(uri)},`).join('\n');
writeFileSync(
  outFile,
  `/* 由 scripts/gen-textures.mjs 生成；勿手改。来源目录：assets/*.png */\n` +
    `export const TEX_PNG: Record<string, string> = {\n${body}\n};\n`,
);
console.log(`textures.ts <- ${entries.length} 个贴图 (${entries.map((e) => e.key).join(', ')})`);
