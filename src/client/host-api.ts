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

/**
 * 一条 UserText 规则对原文一个范围的声明。
 *
 * 宿主校验得很严（`validateCandidate`）：`start`/`end` 必须是整数、`start >= from`、
 * `end > start`、`end <= text.length`，且 `id` 必须等于注册规则的 id。任一不满足
 * 就会抛错，导致**整段文本退回纯文本**，所以字段名与语义必须严格对齐。
 */
export interface UserTextMatch<Data> {
  /** 必须等于注册规则的 id。 */
  id: string
  /** 范围起点，含。 */
  start: number
  /** 范围终点，不含。 */
  end: number
  /** 交给同键 renderer 的数据。 */
  data: Data
}

/**
 * 一条 UserText 匹配规则。
 *
 * 从 `from` 开始找**下一个**命中：计算器按起点最早的候选逐个消费，因此规则只要能
 * 返回下一个范围即可，不需要自己处理整段文本。
 */
export interface UserTextRule<Data> {
  /** 稳定 id；`conversation.user.text.node` 的键与它同名。禁止取 `text`（宿主保留）。 */
  readonly id: string
  /** 同起点时的优先级；数值小的先被采用。 */
  readonly order: number
  /** 查找下一个命中；没有则返回 `undefined`。 */
  match(text: string, from: number): UserTextMatch<Data> | undefined
}

/**
 * `uiConversation` 服务里本功能用到的子集。
 *
 * 这是把「模型看到的原文」与「用户看到的显示」分开的官方通道：注册规则定位范围，
 * 再向 `conversation.user.text.node` 注册同键 renderer 决定外观。
 */
export interface UiConversationService {
  /** 已发送用户文本的匹配规则表。 */
  readonly userText: {
    /** 注册规则；返回用于注销的函数。 */
    register<Data>(rule: UserTextRule<Data>): () => void
  }
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
  effect(effect: (() => (() => void) | void), label?: string): void
  /**
   * 可选：某个服务可用时运行一段子逻辑，回调收到带该服务的子上下文。
   *
   * 用于把可选依赖（`configForms`）与插件核心职责分开：缺少设置服务的部署里，
   * 回调不会运行，各功能仍按默认开关工作。
   */
  inject?(keys: readonly string[], callback: (scope: ClientPluginContext) => void): unknown
  /**
   * 按名字直接取一个服务；未提供时返回 `undefined`。
   *
   * 与 `inject` 的区别在于**不建立依赖也不等待**：可以随时调用（例如一次点击的
   * 处理函数里），既不会让插件因为缺该服务而整体不加载，也不需要写进包的
   * `inject` 声明。`conversation` 这类不在服务目录里、只能按名字拿到的服务正需要
   * 这条通道。
   *
   * 注意：名字未知时实现**可能抛错**，调用方必须自行兜住。
   * @param name - 服务名，例如 `conversation`。
   * @returns 服务实例；该部署未提供时为 `undefined`。
   */
  get?<T>(name: string): T | undefined
}

/**
 * 一次引用插入：chip 在草稿里的显示投影与模型投影。
 *
 * `ref` 是 owner（引用源）自己解释的不透明值，`label`/`appearance`/`clipboardText`
 * 是插入时刻缓存的显示投影。`source: "reference"` 这个官方引用源的 codec 会把
 * `ref` **原样**作为模型可见内容，因此完整正文放进 `ref`、短标签放进 `label`，
 * 输入框就只显示标签而模型拿到全文。
 */
export interface ReferenceInsertion {
  /** 引用源名；本插件用官方的 `reference`。 */
  source: string
  /** 源自己解释的不透明引用值；对 `reference` 源而言就是模型可见正文。 */
  ref: string
  /** 输入框里的显示标签。 */
  label: string
  /** 可选域图标；`appearance` 只接受宿主定义的三个域。 */
  appearance?: 'session' | 'file' | 'folder'
  /** 剪贴板与持久化投影（复制/回填时使用），绝不是模型形态。 */
  clipboardText: string
}

/** 草稿里一个已渲染的引用（此处用到的子集）。 */
export interface InputOccurrence {
  /** 该引用在草稿内的稳定标识。 */
  occurrenceId: string
  /** 引用源名。 */
  source: string
  /** 源自己解释的引用值。 */
  ref: string
  /** 在 clipboard projection 中的偏移；不是 `insertText` 使用的 detect 坐标。 */
  offset: number
  /** clipboard projection 中占据的长度（等于 `clipboardText` 的长度）。 */
  length: number
  /** 显示标签。 */
  label: string
  /** 剪贴板/持久化投影。 */
  clipboardText: string
  /** owner 解析失败标记；会阻止提交。 */
  invalid?: boolean
}

/**
 * 草稿快照（此处用到的子集）。
 *
 * `phase` 是插入的守卫依据：`plain`/`claimed` 允许插入，`adjudicating`（正在裁决
 * 命令或引用）与 `submitting`（已提交、等待落定）期间写入会被拒绝。
 */
export interface InputState {
  /** 草稿的 clipboard projection（引用 chip 显示为 clipboardText）。 */
  draft: string
  /** 草稿版本号；插入时作为乐观并发的前置条件。 */
  draftRev?: number
  /** 草稿当前阶段。 */
  phase: 'plain' | 'claimed' | 'adjudicating' | 'submitting'
  /** 草稿里的引用，按文档顺序排列；其 offset/length 属于 clipboard projection。 */
  occurrences?: readonly InputOccurrence[]
  /** 编辑器 detect projection；每个 reference/command chip 对应一个 U+FFFC。 */
  detectText?: string
}

/** `useInput` 这类订阅式快照 selector hook 的最小类型。 */
export type SnapshotSelectorHook<T> = <R>(selector: (snapshot: T) => R) => R

/**
 * 草稿写入动作面（`conversation.input.overlay` 等槽位作为标准 props 提供）。
 *
 * 两个方法的共同点是都要求传入 `captureInsertion()` 给出的 span，且都会在
 * `phase` 冻结或 `draftRev` 过期时返回 `false`（而不是抛错）。
 */
export interface InputActions {
  /**
   * 捕获当前插入位点。
   *
   * 返回编辑器里当前选区；**没有选区时返回草稿末尾的折叠 span** —— 用户选中
   * 会话正文时 composer 并无选区，因此这条兜底正好让引用追加到草稿末尾。
   */
  captureInsertion(): { start: number; end: number; draftRev: number }
  /**
   * 用纯文本替换该 span（一次不可分割的可撤销编辑）。
   * @returns 是否写入成功；`false` 表示 `phase` 冻结或 `draftRev` 过期。
   */
  insertText(text: string, span: { start: number; end: number; draftRev: number }): boolean
}

/** 单个会话的输入 facade（此处用到的子集）。 */
export interface SessionInputFacade {
  /** 该会话草稿的快照存储。 */
  state: { getSnapshot(): InputState; subscribe(listener: () => void): () => void }
  /**
   * 插入一个引用 chip。
   *
   * 不在 README 的公开 API 清单里，因此是**可选**成员：缺失时调用方必须降级为
   * 纯文本写入。
   * @returns 是否写入成功。
   */
  insertReference?(
    insertion: ReferenceInsertion,
    span: { start: number; end: number; draftRev: number },
  ): boolean
}

/** `conversation` 服务（此处用到的子集）。 */
export interface ConversationService {
  /** 取某个会话作用域对应的输入 facade。 */
  input: { for(actx: unknown): SessionInputFacade }
}

/** `sessions` 服务（此处用到的子集）。 */
export interface SessionsClientService {
  /**
   * 取某个会话的会话作用域上下文。
   * @param sessionId - 会话 id。
   * @returns 会话作用域；该会话未被保留时为 `undefined`。
   */
  scope(sessionId: string): unknown | undefined
}

/**
 * loader 注入到打包工厂中的 `require`。发布产物用它取 `react` 与宿主暴露的
 * `@deepseek-ai/dsh-client-ui-primitives`；Host 服务改由 `ctx` 传入，因此该别名
 * 描述的是契约而非实际用法。
 */
export type ModuleRequire = (id: string) => unknown

/**
 * Markdown 渲染所需的 chrome 文案。
 *
 * 这些 key 在宿主的 chat namespace 下，我们的插件有自己的 namespace，因此要自己
 * 提供一份等值文案。**不能省略**：宿主渲染代码块时直接读
 * `labels.code.copyLabel`，无保护地解引用，传 `undefined` 会让含代码块的引用
 * 在渲染时抛 `TypeError`。
 */
export interface MarkdownLabels {
  /** 代码块与脚注的界面文案。 */
  code: {
    /** 复制按钮的文案。 */
    copyLabel: string
    /** 复制成功后的文案。 */
    copiedLabel: string
    /** 代码块工具栏文案。 */
    toolbarLabels: {
      /** 代码块的类型标签。 */
      codeLabel: string
      /** 「自动换行」文案。 */
      wrapLabel: string
      /** 「取消自动换行」文案。 */
      unwrapLabel: string
    }
  }
  /** 脚注区的标题。 */
  footnotes: string
}

/** 宿主 `MarkdownText` 组件接受的 props（此处用到的子集）。 */
export interface MarkdownTextProps {
  /** 要渲染的 Markdown 源文本。 */
  readonly text: string
  /** 是否处于流式追加状态；静态内容传 `false`。 */
  readonly streaming?: boolean
  /** chrome 文案；缺省时含代码块的内容会崩，因此本插件总是传入。 */
  readonly labels?: MarkdownLabels
  /** 排版密度：`body` 用于消息正文，`compact` 用于次要区域。 */
  readonly variant?: 'body' | 'compact'
}

/**
 * 宿主暴露的 UI 原语模块（此处用到的子集）。
 *
 * 与我们的插件同处 loader 的静态模块白名单，因此可以从打包工厂的 `require`
 * 直接取到 —— 宿主自己的 `ui-reference` 插件就是这么用它的。取不到时（例如换到
 * 一份更旧的宿主）必须退回纯文本，不能整块浮窗失效。
 */
export interface UiPrimitives {
  /** 与助手回复**同一个** Markdown 渲染器。 */
  MarkdownText: import('react').ComponentType<MarkdownTextProps>
}
