/**
 * 浏览器侧打包配置（tsdown / rolldown）。
 *
 * DSH 把动态 client 插件当作一个 classic script 加载，产物必须调用
 * `window.__ModuleLoader__.load({ id, factory })`。这里用 banner/intro/footer
 * 三个输出选项生成这层外壳，因此不需要再手工拼接字符串。
 *
 * 产物：`lib/client.js`（单文件、自包含）。
 */
import type { UserConfig } from 'tsdown'

/** 写入 `__ModuleLoader__.load` 的插件 id，必须与 package.json 的 name 一致。 */
const PLUGIN_ID = 'dsh-git-toolkit'

/**
 * 生成到产物顶部的文件头。
 *
 * 这里用行注释而非块注释：rolldown 会剥掉 banner 每行行首的空白，
 * 块注释的 ` * ` 会退化成 `*`，行注释则不受影响。
 */
const HEADER = `// ${PLUGIN_ID} · 浏览器侧（由 tsdown 从 src/client 构建）。
// 请勿直接编辑：修改 TypeScript 源码后运行 \`pnpm build\`。`

export default {
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  // 清理交给 `pnpm clean`，避免本工具清空 lib/ 时连 Host 侧产物一起删掉。
  clean: false,
  // loader 会提供 React；把它打进来会产生第二个实例。
  deps: { neverBundle: ['react'] },
  define: { 'process.env.NODE_ENV': '"production"' },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `${HEADER}\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
} satisfies UserConfig
