/**
 * dsh-toolkit · 浏览器侧入口。
 *
 * 这个文件只做「装配」，不含任何功能实现：
 *
 *   1. 注册工具包自身的文案（`locale.ts`，命名空间 = 插件 id）；
 *   2. 可选地接上 Host 设置文档，得到开关读数与详情页开关区块
 *      （`settings.ts`：设置服务不存在时这段整体不运行，各功能按默认值工作）；
 *   3. 遍历 `features/registry.ts`，把每个功能交给它自己的 `register` 去占槽位，
 *      并顺带注册该功能自己的文案命名空间（`<插件 id>/<功能 id>`）。
 *
 * `tsdown.config.ts` 把该模块打包成 CommonJS，并包装为
 * `window.__ModuleLoader__.load({ id, factory })`；此处不直接与 loader 交互，
 * 不 import 任何 `@deepseek-ai/*` 包，模块作用域内也没有 DOM 副作用。
 */
import { isolateFeature } from '../diagnostics.js'
import { PLUGIN_ID } from '../shared.js'
import {
  clientFeatureContext,
  type ClientFeatureEntry,
  type FeatureRegistrationOptions,
} from './feature.js'
import { CLIENT_FEATURES } from './features/registry.js'
import type { ClientPluginContext } from './host-api.js'
import { TOOLKIT_DICTS } from './locale.js'
import { installToggles } from './settings.js'
import { toggleStore } from './toggles.js'

/** 插件 id：loader 行 id、浏览器 factory id，以及 locale 根命名空间。 */
export const name: string = PLUGIN_ID

/**
 * git-branch 的纯逻辑再导出，供测试直接调用。
 *
 * `branchCopyText` 决定点击徽标时复制什么，`writeClipboard` 是剪贴板通道本身。
 * 暴露它们就能在 Node 里断言「复制的是分支名，而不是 tooltip 里的整串描述」
 * 以及「Clipboard API 不可用或被拒绝时退回 `execCommand`」，不必渲染组件或
 * 真的碰系统剪贴板。
 */
export { branchCopyText, writeClipboard } from './features/git-branch/clipboard.js'

/**
 * 该侧强依赖的 Host services：slot 注册表和 locale 注册表。
 *
 * `configForms` **不**在这里：设置页只是功能开关的一个可选宿主，缺少它的部署
 * 也应当能跑各功能本身（见 `settings.ts` 的可选注入）。
 */
export const inject: readonly string[] = ['slots', 'locale']

/**
 * 一个功能的开关读取函数。
 * @param entry - 功能的注册表项。
 * @returns 该功能此刻是否开启；设置尚未到达时用共享默认值兜底。
 */
function isEnabled(entry: ClientFeatureEntry): boolean {
  return toggleStore().isEnabled(entry.configKey)
}

/**
 * 装配一个功能，并把它自己的文案命名空间一起注册。
 *
 * 文案与 UI 放在同一段里：任一步失败，这个功能就整体缺席，而不是留下一半的界面
 * 配着取不到文案的 `t()`。
 * @param ctx - 浏览器上下文。
 * @param entry - 功能的注册表项。
 * @param options - 插件 id、locale 服务与开关读取。
 */
function applyFeature(
  ctx: ClientPluginContext,
  entry: ClientFeatureEntry,
  options: FeatureRegistrationOptions,
): void {
  const feature = clientFeatureContext(ctx, entry, options)
  ctx.effect(
    () => ctx.locale.register(feature.namespace, entry.feature.locale),
    `dsh-toolkit: locale ${feature.namespace}`,
  )
  entry.feature.register(feature)
}

/**
 * 逐个装配功能，每个都在故障隔离中运行。
 *
 * 抽成独立函数，是为了让「一个功能抛错不影响其他功能」可被测试直接驱动。
 * @param ctx - 浏览器上下文。
 * @param entries - 要装配的功能；默认为注册表里的全部功能。
 * @param options - 插件 id、locale 服务与开关读取。
 */
export function applyClientFeatures(
  ctx: ClientPluginContext,
  entries: readonly ClientFeatureEntry[] = CLIENT_FEATURES,
  options: FeatureRegistrationOptions = { pluginId: PLUGIN_ID, locale: ctx.locale, isEnabled },
): void {
  for (const entry of entries) {
    isolateFeature('client', entry.id, () => {
      applyFeature(ctx, entry, options)
    })
  }
}

/**
 * 装配浏览器侧。
 * @param ctx - 带有 `slots` 与 `locale` services 的浏览器上下文。
 */
export function apply(ctx: ClientPluginContext): void {
  isolateFeature('client', 'locale', () => {
    ctx.effect(() => ctx.locale.register(PLUGIN_ID, TOOLKIT_DICTS), 'dsh-toolkit: locale')
  })

  // 详情页开关：只有在设置服务存在时才装配。`ctx.inject` 的回调拿到的是带
  // `configForms` 的子上下文，因此这里不需要把它写进 `inject`（写进去会变成
  // 硬依赖，缺设置服务的部署里整个插件的 UI 都不会出现）。
  isolateFeature('client', 'toggles', () => {
    const injectService = ctx.inject
    if (typeof injectService !== 'function') return
    injectService.call(ctx, ['configForms'], (scope) => {
      // `inject` 的回调可能在服务就绪时才触发（那时 `apply` 早已返回），所以这里
      // 再包一层隔离：开关页装配失败不该连累各功能本身。
      isolateFeature('client', 'toggles', () => {
        installToggles(ctx, scope as ClientPluginContext, PLUGIN_ID)
      })
    })
  })

  applyClientFeatures(ctx)
}
