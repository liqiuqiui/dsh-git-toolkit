/**
 * message-quote 功能 · 选区探测与判定。
 *
 * 宿主**没有**内建的会话选区菜单（`ui-chat` 产物里 `getSelection` /
 * `selectionchange` / `mouseup` 全是 0 处），所以「选中文字 → 浮出菜单」这件事
 * 必须由本插件自己做：自己监听事件、自己判断这段选区该不该响应、自己算坐标。
 *
 * 为了能单测，判定逻辑 {@link shouldOffer} 被写成不碰 DOM 的纯函数；只有
 * {@link readSelection} 读浏览器状态。这样边界条件（折叠、太短、在输入框内、
 * 不在正文里）可以逐个断言，而不必在测试里搭一套 DOM。
 *
 * 本模块在模块作用域不触碰 DOM，因此可以直接在 Node 里 `import` 后测纯函数。
 *
 * 下面几个选择器是宿主的**内部标记**而非契约（`0.2.1-rc.5` 实测存在），因此
 * 集中声明在本文件顶部：升级如果改名，只需要改这一处。
 */
import { serializeRange } from './serialize.js'

/** 正文流容器：只在会话正文里响应；输入框不在其内。 */
export const TRANSCRIPT_SELECTOR = '[data-chat-flow]'

/** 输入框相关标记；在这些元素内选中文字不弹菜单。 */
export const COMPOSER_SELECTOR = '[data-composer-input],[data-composer-card]'

/** 每一轮的外层容器，其 `data-chat-turn` 是轮次序号。 */
export const TURN_SELECTOR = '[data-chat-turn]'

/**
 * 助手回复的节点容器。
 *
 * 宿主给流里的每个节点标了 `data-chat-flow-kind`，取值是节点的 `kind`：
 * `user` / `steering`（用户消息）、`assistant-step`（助手回复）、`turn-process`
 * （工具调用与思考）、`turn-trigger`（轮次触发）。引用只对助手回复开放。
 */
export const ASSISTANT_SELECTOR = '[data-chat-flow-kind="assistant-step"]'

/**
 * 能被引用的最短选区（字符数）。
 *
 * 设成 2 是为了滤掉单击产生的单字符选区与误触：单个字符作为「参考资料」没有
 * 意义，而那种选区几乎总是意外产生的。
 */
export const MIN_LENGTH = 2

/** 判定一次选区是否该弹菜单所需的全部事实。 */
export interface SelectionFlags {
  /** 选区是否折叠（折叠 = 只是光标，没有选中任何东西）。 */
  readonly collapsed: boolean
  /** 选区文本长度（已 trim）。 */
  readonly textLength: number
  /** 选区是否有端点落在输入框内。 */
  readonly inComposer: boolean
  /** 选区两端是否都落在会话正文流内。 */
  readonly inTranscript: boolean
  /** 选区两端是否都落在**助手回复**里。 */
  readonly inAssistant: boolean
}

/**
 * 判定一次选区是否该弹菜单。
 *
 * 纯函数：不读浏览器状态，因此所有边界条件都能直接断言。
 * @param flags - 选区事实。
 * @returns 是否应当浮出引用菜单。
 */
export function shouldOffer(flags: SelectionFlags): boolean {
  if (flags.collapsed) return false
  if (flags.textLength < MIN_LENGTH) return false
  // 用户在自己的输入框里选词是要改写自己的草稿，不该弹「引用」。
  if (flags.inComposer) return false
  if (!flags.inTranscript) return false
  // 只引用助手回复：引用用户自己发过的话没有意义，而且会让人误以为那是新内容。
  return flags.inAssistant
}

/** 一次可引用的选区。 */
export interface SelectionSnapshot {
  /** 选中的正文（首尾空白已去掉）。 */
  readonly text: string
  /** 选区在视口坐标系里的矩形，用于给浮层定位。 */
  readonly rect: DOMRect
  /** 内容所在轮次；反查不到时为 `undefined`。 */
  readonly turn?: number | undefined
}

/**
 * 把 DOM 节点归一到元素：文本节点取父元素。
 * @param node - 选区端点所在的节点。
 * @returns 对应的元素；无法归一（文档节点、孤立节点）时为 `null`。
 */
function elementOf(node: Node | null): Element | null {
  if (node === null) return null
  if (node.nodeType === 1 /* Node.ELEMENT_NODE */) return node as Element
  return node.parentElement
}

/**
 * 从元素反查它所属的轮次序号。
 *
 * 宿主自己在滚动定位时也是用 `Number(...)` + `Number.isSafeInteger` 读同一个
 * 属性，因此这里的解析口径与宿主一致。
 * @param element - 选区端点所在的元素。
 * @returns 轮次序号；不在某个轮次内或属性异常时为 `undefined`。
 */
export function readTurn(element: Element): number | undefined {
  const host = element.closest(TURN_SELECTOR)
  if (host === null) return undefined
  const raw = host.getAttribute('data-chat-turn')
  if (raw === null) return undefined
  const turn = Number(raw)
  return Number.isSafeInteger(turn) ? turn : undefined
}

/**
 * 把选区序列化成 Markdown，任何意外都退回空串。
 *
 * 序列化要遍历 DOM，遇到不认识的节点结构有可能抛错。这个功能的价值在于「引用」，
 * 不在于「格式」：抛错会让菜单根本不出现，所以这里兜住异常，由调用方退回纯文本。
 * @param range - 用户选区。
 * @returns Markdown 正文；失败时为空串。
 */
function markdownOf(range: Range): string {
  try {
    return serializeRange(range)
  } catch (error) {
    console.warn('[dsh-toolkit] message-quote：选区格式还原失败，退回纯文本', error)
    return ''
  }
}

/**
 * 读取当前可引用的选区。
 *
 * 用户选中会话正文时 composer 并无焦点，因此这里读的是 `window.getSelection()`
 * 而不是编辑器的插入位点 —— 两者是不同的东西（编辑器位点由
 * `inputActions.captureInsertion()` 负责）。
 * @param view - 取选区的窗口；默认全局 `window`（可注入是为了将来能测）。
 * @returns 可引用的选区快照；不该响应时为 `null`。
 */
export function readSelection(view: Window = window): SelectionSnapshot | null {
  const selection = view.getSelection()
  if (selection === null || selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  const plain = selection.toString().trim()
  // 选中内容的**格式**必须在这里就保住：`toString()` 之后的纯文本已经丢了行内
  // 代码、代码块围栏、粗体与列表符号，事后再想还原是不可能的。
  const text = markdownOf(range) || plain
  const start = elementOf(range.startContainer)
  const end = elementOf(range.endContainer)
  if (start === null || end === null) return null

  const flags: SelectionFlags = {
    collapsed: range.collapsed,
    // 长度门槛按纯文本算：选中一段代码后 Markdown 会变长，但「太短不弹」判断的
    // 是用户实际选了多少字。
    textLength: plain.length,
    inComposer: start.closest(COMPOSER_SELECTOR) !== null || end.closest(COMPOSER_SELECTOR) !== null,
    // 两端都必须落在正文流里：跨区域拖选（正文 → 输入框、正文 → 侧栏）不响应。
    inTranscript:
      start.closest(TRANSCRIPT_SELECTOR) !== null && end.closest(TRANSCRIPT_SELECTOR) !== null,
    // 两端都必须在助手回复里：用户消息、工具调用、轮次触发都不给引用。
    inAssistant:
      start.closest(ASSISTANT_SELECTOR) !== null && end.closest(ASSISTANT_SELECTOR) !== null,
  }
  if (!shouldOffer(flags)) return null

  const rect = range.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return null

  return { text, rect, turn: readTurn(start) }
}
