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

/** 一次 slot 注册：哪个 slot、哪个占用者 id（或键），以及其 locale。 */
export interface SlotOptions {
  /** slot 名，例如 `conversation.hero.options`。 */
  name: string
  /** 该 slot 内稳定的占用者 id。键化 slot（如 `plugins.bundle.config`）不用它。 */
  id?: string
  /** 键化 slot 的键；与 `id` 二选一。 */
  key?: string
  /** 在该 slot 各占用者之间的排序序号。 */
  order?: number
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
  /** 绑定一个 namespace，得到该 namespace 下的翻译函数。 */
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
}

/** 设置文档里一个 namespace 的只读视图。 */
export interface SettingsNamespaceView {
  /** 插件条目 id，即设置 namespace。 */
  ns: string
  /** 当前生效的完整值（base 与 user 合并后）。 */
  value?: unknown
  /** 文档版本；写入时作为乐观并发的前置条件。 */
  revision?: number
  /** 用户显式写入过的字段。 */
  user?: unknown
  /** 只读部署时为 false。 */
  writable?: boolean
}

/** 设置文档在浏览器侧的镜像快照。 */
export interface SettingsDocumentSnapshot {
  /** `idle`/`loading` 表示尚未读到 Host 的答案。 */
  status: 'idle' | 'loading' | 'ready'
  /** 读到的文档；尚未读到时为 undefined。 */
  view?: {
    /** Host 当前服务的全部 namespace。 */
    namespaces: readonly SettingsNamespaceView[]
    /** 整个文档是否可写。 */
    writable?: boolean
  }
}

/** 一个 namespace 的表单控制器快照。 */
export interface ConfigFormSnapshot {
  /** `unavailable` 表示 Host 未服务该 namespace。 */
  status: 'loading' | 'idle' | 'ready' | 'unavailable'
  /** 解码后的当前值。 */
  value?: unknown
  /** 文档版本。 */
  revision?: number
  /** 是否可写。 */
  writable: boolean
}

/** 一个 namespace 的表单控制器（此处用到的子集）。 */
export interface ConfigFormController {
  /** 当前快照；引用稳定到下次变化。 */
  getSnapshot(): ConfigFormSnapshot
  /** 订阅快照变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
  /** 写入一个字段；返回 Host 是否接受。 */
  set(field: string, value: unknown): Promise<boolean>
}

/** 此处用到的 configForms 服务子集。 */
export interface ConfigFormsService {
  /** 取某个 namespace 的表单控制器（按 entry id 缓存）。 */
  get(entryId: string): ConfigFormController
  /** 设置文档的共享镜像。 */
  describe(): {
    getSnapshot(): SettingsDocumentSnapshot
    subscribe(listener: () => void): () => void
  }
  /**
   * 在 Host 服务任意一个给定 namespace 期间保持一段注册。
   * @param namespaces - 关注的 namespace。
   * @param register - 服务到达时调用；返回释放函数。
   * @returns 结束监视并释放当前注册的函数。
   */
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

/** 传给 `apply` 的浏览器上下文。 */
export interface ClientPluginContext {
  /** slot 注册表（在 `inject` 中声明）。 */
  slots: SlotsService
  /** locale 注册表（在 `inject` 中声明）。 */
  locale: LocaleService
  /** 设置表单（在 `inject` 中声明）。 */
  configForms: ConfigFormsService
  /** 运行一次可销毁的副作用；回调的返回值为销毁函数。 */
  effect(effect: () => (() => void) | void, label?: string): void
  /**
   * 可选：某个服务可用时运行一段子逻辑，回调收到带该服务的子上下文。
   *
   * 用于把可选依赖（`configForms`）与插件核心职责分开：缺少设置服务的部署里，
   * 回调不会运行，各功能仍按默认开关工作。
   */
  inject?(keys: readonly string[], callback: (scope: ClientPluginContext) => void): unknown
}

/**
 * loader 注入到打包工厂中的 `require`。发布产物只用它来取 `react`；
 * Host 服务改由 `ctx` 传入，因此该别名描述的是契约而非实际用法。
 */
export type ModuleRequire = (id: string) => unknown
