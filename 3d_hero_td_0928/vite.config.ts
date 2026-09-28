import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 产物约定：dist/index.html 为自包含单文件（Babylon 与贴图全部内联），
// copy-artifact.mjs 再复制到项目根目录 legion-breaker.html（离线可玩，README 契约）。
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 12000,
  },
  plugins: [viteSingleFile()],
});
