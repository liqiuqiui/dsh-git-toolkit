/**
 * dsh-toolkit · 浏览器侧 · 宿主 UI 原语。
 *
 * ## 为什么需要这个通道
 *
 * loader 通过 `factory: (require) => …` 把模块解析权交给插件，但那个 `require`
 * 只存在于 factory 的作用域里，`apply(ctx)` 收不到它。宿主自己的插件是在**模块
 * 顶层**直接 `require("@deepseek-ai/dsh-client-ui-primitives")` 解决的。
 *
 * 我们**不能**照抄静态 import：那个调用在模块求值时就会执行，宿主若没有这个包
 * （更旧的版本、或该模块被移出白名单），抛错发生在插件加载阶段 —— 整个插件连同
 * git-branch 一起消失。要的是「这一个功能优雅降级」，所以必须延后且能捕获。
 *
 * `tsdown.config.ts` 的 `intro` 因此插入一行，把 factory 的 `require` 提升成
 * 模块级变量；这里再显式声明，并只解析一次。
 */
import type { ComponentType } from 'react'

import type { MarkdownTextProps, ModuleRequire, UiPrimitives } from './host-api.js'

/**
 * 打包 `intro` 注入的模块级 `require`。
 *
 * 声明为可能缺失：直接在 Node/测试环境里跑源码（没有经过 tsdown 包装）时这个
 * 变量根本不存在，那种情况下应当当作「宿主原语不可用」，而不是抛错。
 */
declare const __dshToolkitRequire: ModuleRequire | undefined

/** loader 白名单里宿主 UI 原语的模块名。 */
const PRIMITIVES_ID = '@deepseek-ai/dsh-client-ui-primitives'

/**
 * 从 loader 取宿主的 UI 原语。
 *
 * 拿到与拿不到都只试一次：`require` 的决定在进程生命周期内不会变，而浮窗每次
 * 悬停都要用，没必要重复一次必然失败的调用。
 * @param require - loader 的模块解析函数；缺失时判定为不可用。
 * @returns 宿主原语模块；不可用时为 `null`。
 */
export function resolvePrimitives(require: ModuleRequire | undefined): UiPrimitives | null {
  if (typeof require !== 'function') return null
  try {
    const mod = require(PRIMITIVES_ID) as Partial<UiPrimitives> | undefined
    if (mod === undefined || mod === null) return null
    const MarkdownText = mod.MarkdownText
    // 只认真正可渲染的东西：旧版宿主的导出形状可能不同。
    if (MarkdownText === undefined || MarkdownText === null) return null
    return { MarkdownText }
  } catch {
    // 模块不在白名单里时 loader 会抛错。这是可预期的降级路径，不是异常。
    return null
  }
}

/** 本进程内取到的宿主原语；不可用时为 `null`。 */
export const HOST_PRIMITIVES: UiPrimitives | null = resolvePrimitives(
  typeof __dshToolkitRequire === 'undefined' ? undefined : __dshToolkitRequire,
)

/** 宿主的 Markdown 渲染器；不可用时为 `null`。 */
export const HostMarkdownText: ComponentType<MarkdownTextProps> | null =
  HOST_PRIMITIVES === null ? null : HOST_PRIMITIVES.MarkdownText
