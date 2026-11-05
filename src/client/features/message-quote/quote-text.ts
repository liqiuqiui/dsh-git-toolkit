/**
 * message-quote 功能 · 引用块拼装。
 *
 * 这里生成的是**模型最终看到的文本**，而不是输入框里的显示内容：插入时它被放进
 * 引用 chip 的 `ref` 字段，官方 `reference` 源在提交时把 `ref` 原样交给模型
 * （`codec.serialize = (ref) => ref`），输入框只显示 `label`。正文采用 Markdown 引用
 * 块，避免协议标签作为原始 XML 出现在已发送的聊天消息里。
 *
 * 因此这段文本要同时满足三件事：
 *
 *   1. **可溯源** —— 用标签包裹并带上轮次，模型能分清「引用来的内容」与「用户
 *      自己的话」；生态里已有同类先例（`<skill>name</skill>` 就是引用源的模型
 *      形态）。
 *   2. **不误导** —— 属性用协议字段而不是散文，避免被模型当成指令或自然语言。
 *   3. **长度可控** —— 引用正文会随草稿持久化，超长必须截断并显式标记，不能
 *      静默丢内容。
 *
 * 纯函数、零依赖、不触碰 DOM，因此可以直接在 Node 里单测。
 */

/** 引用正文的默认字符上限。 */
export const DEFAULT_LIMIT = 2000

/** 拼装引用块时可选的信息。 */
export interface QuoteMeta {
  /**
   * 内容所在的轮次序号。
   *
   * 由选区所在 DOM 的 `data-chat-turn` 反查；拿不到时省略该属性（属性缺失比
   * 写一个错误的轮次更好）。
   */
  readonly turn?: number | undefined
  /** 正文字符上限；默认 {@link DEFAULT_LIMIT}。 */
  readonly limit?: number | undefined
}

/** 代码块围栏行：行首三个及以上反引号，可带语言标识。 */
const FENCE_LINE = /^(`{3,})/u

/**
 * 截断后补齐未闭合的代码块围栏。
 *
 * 引用正文可能含代码块。若在代码块中间截断，围栏只剩开没有闭，Markdown 渲染器
 * 会把**后面所有内容**（包括截断提示）都吞进代码块里，浮窗显示就完全错了。
 * 截断本身无法避免，但可以补一个围栏把状态收干净。
 * @param text - 已被截断的正文。
 * @returns 围栏已闭合的正文；本来就没开围栏时原样返回。
 */
function closeOpenFence(text: string): string {
  let open: string | null = null
  for (const line of text.split('\n')) {
    const match = FENCE_LINE.exec(line)
    if (match === null) continue
    const fence = match[1] ?? ''
    if (open === null) {
      open = fence
    } else if (fence.length >= open.length && line.trim() === fence) {
      // 闭合围栏必须单独成行且不长于开启者，与 CommonMark 的规则一致。
      open = null
    }
  }
  return open === null ? text : `${text}\n${open}`
}

/**
 * 把一个选中的片段拼成引用块。
 *
 * 输出形如（已知轮次、未截断）：
 *
 * ```markdown
 * > **引用自第 3 轮**
 * >
 * > ……选中的正文……
 * ```
 *
 * 正文是**从 DOM 序列化出来的 Markdown**（见 `serialize.ts`）：行内代码、代码块、
 * 粗体、列表都保留原格式，因此引用块里可能出现嵌套的代码围栏 —— 这在 Markdown
 * 里是合法的（引用里的代码块），模型与浮窗都能正确解析。
 *
 * 截断时在正文后追加来源与截断提示，让用户和模型都知道内容不完整。
 * @param text - 选中的正文（Markdown）。
 * @param meta - 轮次与长度上限。
 * @returns 引用块文本。
 */
export function buildQuoteBlock(text: string, meta: QuoteMeta = {}): string {
  const limit = meta.limit ?? DEFAULT_LIMIT
  const body = text.trim()
  const total = body.length
  const truncated = limit > 0 && total > limit
  // 截断点可能落在代码块中间，先把围栏补上再逐行加引用前缀。
  const content = truncated ? closeOpenFence(body.slice(0, limit)) : body

  const source = meta.turn === undefined ? '引用内容' : `引用自第 ${meta.turn} 轮`
  const bodyLines = content.split('\n').map((line) => `> ${line}`).join('\n')
  const truncation = truncated ? `\n> ……（原文共 ${total} 字，引用已截断）` : ''
  return `> **${source}**\n>\n${bodyLines}${truncation}`
}

/** 引用块首行的两种形态：带轮次，或轮次未知。捕获组 1 = 轮次。 */
const QUOTE_HEADER = /^> \*\*(?:引用自第 (\d+) 轮|引用内容)\*\*$/u

/** {@link buildQuoteBlock} 在截断时追加的提示行。捕获组 1 = 原文总长度。 */
const QUOTE_TRUNCATION = /^> ……（原文共 (\d+) 字，引用已截断）$/u

/**
 * 从消息原文里解析出的一个引用块。
 *
 * 这是**显示层**的输入：{@link buildQuoteBlock} 生成的是给模型看的 Markdown，
 * 而聊天气泡按纯文本渲染（`white-space:pre-wrap`），不解析 Markdown，所以
 * 必须由本功能自己把块范围找出来，交给 {@link parseQuoteBlock} 的调用方换成
 * 与输入框一致的 chip。
 */
export interface ParsedQuoteBlock {
  /** 块在原文中的起始偏移（首行行首）。 */
  readonly start: number
  /** 块在原文中的结束偏移（不含块尾换行）。 */
  readonly end: number
  /** 内容所在轮次；`> **引用内容**` 形态没有轮次。 */
  readonly turn?: number | undefined
  /** 引用正文（已剥掉每行的 `> ` 前缀）。 */
  readonly body: string
  /** 是否发生过截断。 */
  readonly truncated: boolean
  /** 原文总长度；仅截断时存在。 */
  readonly total?: number | undefined
}

/**
 * 读取从 `start` 开始的一行（不含换行符）。
 * @param text - 原文。
 * @param start - 行首偏移。
 * @returns 行文本与行尾（下一个 `\n` 或文本末尾）。
 */
function readLine(text: string, start: number): { line: string; next: number } {
  const newline = text.indexOf('\n', start)
  if (newline < 0) return { line: text.slice(start), next: text.length }
  return { line: text.slice(start, newline), next: newline }
}

/**
 * 从 `start`（已确认为行首）解析一个引用块；不是引用块则返回 `undefined`。
 * @param text - 原文。
 * @param start - 候选块首偏移。
 * @returns 解析结果；首行不是引用块时头为 `undefined`。
 */
function readBlockAt(text: string, start: number): ParsedQuoteBlock | undefined {
  const head = readLine(text, start)
  const match = QUOTE_HEADER.exec(head.line)
  if (match === null) return undefined

  const turn = match[1] === undefined ? undefined : Number(match[1])
  if (turn !== undefined && !Number.isInteger(turn)) return undefined

  const lines: string[] = []
  let truncated = false
  let total: number | undefined
  let end = head.next

  // 从首行之后逐行吃掉属于本块的 `>` 行；遇到第一行不以 `>` 开头即结束。
  // 注意 `head.next` 指向首行末尾的**换行符本身**，所以起点要再往后挪一位，
  // 否则第一次 `readLine` 会从换行符开始、读出一个空行并立刻认定块已结束。
  let cursor = head.next < text.length ? head.next + 1 : text.length
  while (cursor < text.length) {
    const row = readLine(text, cursor)
    if (!row.line.startsWith('>')) break
    // 第二个引用标题意味着上一个块结束了。按 Markdown 语义，相邻的 `>` 行本属同一个
    // 块，但我们的块由 `buildQuoteBlock` 生成、每块都以标题开头，因此标题即边界。
    // 没有这条判断，连续插入两段引用会被解析成一整块，第二段的正文被吞进第一段。
    if (row.line !== head.line && QUOTE_HEADER.test(row.line)) break
    end = row.next
    cursor = row.next < text.length ? row.next + 1 : text.length

    const truncation = QUOTE_TRUNCATION.exec(row.line)
    if (truncation !== null) {
      truncated = true
      total = Number(truncation[1])
      continue
    }
    // `>` 是 buildQuoteBlock 写在标题与正文之间的分隔行；正文里的空行是 `> `。
    if (row.line === '>' && lines.length === 0) continue
    lines.push(row.line === '>' ? '' : row.line.slice(2))
  }

  // chip 的 ref 以换行结尾（见 `insert.ts` 的 `chipRef`），这样用户接着输入的文字
  // 落在引用块之外。这个换行属于块本身，一并吃进来，否则它会在 chip 后面留下一个
  // 多余的空白文本节点，显示成「chip 后多一个空格」。
  if (text[end] === '\n') end += 1

  return { start, end, turn, body: lines.join('\n'), truncated, total }
}

/**
 * 从 `from` 起查找下一个引用块。
 *
 * 只在**行首**匹配，避免把正文里恰好出现的 `> **…**` 误判成标题；匹配到首行后
 * 才按 `>` 行延伸，因此块内出现的任意内容都会被原样收进 {@link ParsedQuoteBlock.body}。
 * 找不到时返回 `undefined`（调用方据此交给宿主的默认纯文本渲染）。
 * @param text - 消息原文。
 * @param from - 起始偏移；默认从 0 开始。
 * @returns 下一个引用块；没有则 `undefined`。
 */
export function parseQuoteBlock(text: string, from = 0): ParsedQuoteBlock | undefined {
  let search = Math.max(0, from)
  while (search < text.length) {
    const start = text.indexOf('> **', search)
    if (start < 0) return undefined
    // 必须是行首：块外零散的 `> **` 不算。
    if (start > 0 && text[start - 1] !== '\n') {
      search = start + 1
      continue
    }
    const parsed = readBlockAt(text, start)
    if (parsed !== undefined) return parsed
    search = start + 1
  }
  return undefined
}

/** chip 标签里摘要的默认字符数。 */
export const PREVIEW_LIMIT = 18

/**
 * 把 Markdown 正文压成纯文本，供 chip 这类**不支持 Markdown** 的位置使用。
 *
 * 引用正文现在是 Markdown（保留行内代码、粗体等格式），但 chip 的标签是纯文本：
 * 直接拿 Markdown 当标签，用户会看到 `` `lib/client.js` `` 和 `**刷新页面**` 这种
 * 源码符号。摘要只需要「说的是什么」，所以把标记去掉、留下文字。
 *
 * 处理顺序有讲究：先去掉代码围栏（连同围栏行），再处理行内标记 —— 否则围栏里的
 * 反引号会被当成行内代码的开头。
 * @param text - Markdown 正文。
 * @returns 纯文本。
 */
export function stripMarkdown(text: string): string {
  return text
    // 代码围栏行整行去掉，保留里面的代码文字。
    .replace(/^[ \t]*`{3,}[^\n]*$/gmu, '')
    // 图片与链接：只留可读文字。
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    // 强调与行内代码：去标记留内容。
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/gu, '$1')
    .replace(/~~([^~]+)~~/gu, '$1')
    .replace(/`+([^`]+)`+/gu, '$1')
    // 行首的标题、列表与引用标记。
    .replace(/^[ \t]*#{1,6}[ \t]+/gmu, '')
    .replace(/^[ \t]*(?:[-*+]|\d+\.)[ \t]+/gmu, '')
    .replace(/^[ \t]*>[ \t]?/gmu, '')
}

/**
 * 把选中的正文压成一行摘要，用于输入框里 chip 的可见标签。
 *
 * 宿主的引用 chip 是**内联单行**元素（`max-width:240px`，超出省略），所以：
 *
 * - 必须把换行与连续空白压成单个空格，否则标签会被撑成多行；
 * - 必须自带省略号 —— chip 自身的 `text-overflow:ellipsis` 只在溢出时生效，
 *   短文本不会提示「这里还有更多」；
 * - 必须先剥掉 Markdown 标记 —— 标签是纯文本，露出源码符号很难看。
 *
 * 有了摘要，用户在草稿里能直接看出引用了哪段话，不必点开或回忆。
 * @param text - 选中的正文（Markdown）。
 * @param limit - 摘要字符上限；默认 {@link PREVIEW_LIMIT}。
 * @returns 单行摘要。
 */
export function buildQuotePreview(text: string, limit: number = PREVIEW_LIMIT): string {
  const flat = stripMarkdown(text).replace(/\s+/gu, ' ').trim()
  if (flat.length <= limit) return flat
  return `${flat.slice(0, limit)}…`
}

/**
 * chip 可见标签所用正文的最大字符数。
 *
 * 比 {@link PREVIEW_LIMIT} 宽松得多：chip 是单行元素，视觉截断交给 CSS
 * （`max-width` + `text-overflow:ellipsis`），这里只兜住极端长度，避免把整段引用
 * 塞进 DOM 属性里。
 */
export const LABEL_LIMIT = 200

/**
 * 生成 chip 的可见标签正文：单行、无 Markdown 标记。
 *
 * 标签是**纯文本**节点，宿主的引用 chip 会把它原样显示（超出部分由 CSS 省略号
 * 处理）。因此这里必须：
 *
 * 1. 剥掉 Markdown 标记 —— 否则 chip 上会看到 `## 修法：…` 这种源码符号；
 * 2. 把换行压平 —— chip 是内联单行元素，多行文本会把它撑开。
 *
 * 与 {@link buildQuotePreview} 的区别只是长度：预览给人「概要」、标签给 CSS 去截。
 * @param text - 选中的正文（Markdown）。
 * @param limit - 字符上限；默认 {@link LABEL_LIMIT}。
 * @returns 单行纯文本标签。
 */
export function buildQuoteLabel(text: string, limit: number = LABEL_LIMIT): string {
  const flat = stripMarkdown(text).replace(/\s+/gu, ' ').trim()
  if (limit > 0 && flat.length > limit) return `${flat.slice(0, limit)}…`
  return flat
}
