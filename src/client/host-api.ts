/**
 * 本插件消费的浏览器端 Host API 的最小结构化类型。
 *
 * 真实声明位于 Harness 客户端包中，而这些包不是本仓库的依赖
 * （插件以纯文件形式针对运行时浏览器发布）。这些 interface 精确描述
 * `apply` 触及的内容，使 Client 端无需导入 `@deepseek-ai/*` 也能通过类型检查。
 *
 * loader 交给打包工厂一个 `require`，可解析 `react`（以及 Host 服务）；
 * bundle 本身由 `tsdown.config.ts` 包装进
 * `window.__ModuleLoader__.load`，因此本模块只需要类型，绝不调用 loader。
 */
import type { ComponentType } from 'react'

/** 插件为其提供词典的 locale id。 */
export type LocaleId = 'zh' | 'en'

/** 一个 namespace 的消息表。 */
export type MessageDict = Readonly<Record<string, string>>

/** locale 服务为每个 namespace 注册的词典。 */
export type LocaleDictionaries = Readonly<Record<LocaleId, MessageDict>>

/** 一次 slot 注册：哪个 slot、哪个占用者 id，以及其 locale。 */
export interface SlotOptions {
  /** slot 名，例如 `conversation.hero.options`。 */
  name: string
  /** 该 slot 内稳定的占用者 id。 */
  id: string
  /** 在该 slot 各占用者之间的排序序号。 */
  order: number
  /** 占用者所获得的 `t` 对应的 locale namespace。 */
  locale: string
}

/** 此处用到的 slots 服务子集。 */
export interface SlotsService {
  /** 每当 `slotName` 可用时运行 `callback`；其返回值用于销毁。 */
  inject(slotName: string, callback: () => () => void): void
  /** 注册一个占用者；返回的函数用于注销。 */
  register<P extends object>(options: SlotOptions, component: ComponentType<P>): () => void
}

/** 此处用到的 locale 服务子集。 */
export interface LocaleService {
  /** 注册一个 namespace 的词典；返回的函数用于注销。 */
  register(namespace: string, dictionaries: LocaleDictionaries): () => void
}

/** 传给 `apply` 的浏览器上下文。 */
export interface ClientPluginContext {
  /** slot 注册表（在 `inject` 中声明）。 */
  slots: SlotsService
  /** locale 注册表（在 `inject` 中声明）。 */
  locale: LocaleService
  /** 运行一次可销毁的副作用；回调的返回值为销毁函数。 */
  effect(effect: () => (() => void) | void, label?: string): void
}

/**
 * loader 注入到打包工厂中的 `require`。发布产物只用它来取 `react`；
 * Host 服务改由 `ctx` 传入，因此该别名描述的是契约而非实际用法。
 */
export type ModuleRequire = (id: string) => unknown
