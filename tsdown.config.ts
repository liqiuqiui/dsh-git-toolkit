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
const PLUGIN_ID = 'dsh-toolkit'

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
  // loader 会提供 React；把它打进来会产生第二个实例。`@deepseek-ai/schemastery`
  // 只被 Host 侧使用，这里显式声明不打包，避免将来某次 import 把它带进浏览器产物。
  // `react-dom` 与 `@deepseek-ai/dsh-client-ui-primitives` 同样由 loader 提供：
  // 前者用于把浮窗 portal 到 `document.body`，后者是宿主自己的 Markdown 渲染器
  // （借用它，浮窗才能与助手回复排版一致）。两者都不能打进产物 —— primitives 会
  // 拖进整棵宿主 UI 依赖树，react-dom 则会产生第二个 React 实例。
  deps: {
    neverBundle: [
      'react',
      'react-dom',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/schemastery',
    ],
  },
  define: { 'process.env.NODE_ENV': '"production"' },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `${HEADER}\nwindow.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
    intro: [
      'var module = { exports: {} }; var exports = module.exports;',
      // 把 loader 的 `require` 提升到模块级：`apply(ctx)` 收不到它，而
      // `primitives.ts` 需要在**运行时**、而不是模块求值时去取宿主的 UI 原语
      // （静态 import 会在旧版宿主上让整个插件加载失败）。
      'var __dshToolkitRequire = typeof require === "function" ? require : undefined;',
    ].join('\n'),
    footer: 'return module.exports; } });',
  },
} satisfies UserConfig
