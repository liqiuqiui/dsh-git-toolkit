/**
 * 浏览器侧 · 从被右键的 DOM 节点回溯出「它指向哪个文件」。
 *
 * 会话里的文件引用有三种渲染形态，全部由 Host 的 Markdown 渲染器产生：
 *
 *   1. 行内代码里的文件提及 —— `<code><button class="_fileMention_hash">…</button></code>`，
 *      按钮的 `title` 是解析出的完整路径，`aria-label` 是一句「预览 …」的描述。
 *   2. 指向文件的 Markdown 链接 —— 按钮额外带 `_fileLink_hash`；有图片预览时用
 *      popover 包住，此时按钮**没有** `title`，只能退回链接文本。
 *   3. 产物芯片（`data-ref-chip`）—— 同样带 `_fileMention_hash`，`title` 是路径。
 *
 * 因此识别靠的是 CSS module 的 **localName**（`fileMention`），而不是完整类名：
 * 哈希后缀随每次构建变化，`_fileMention_` 前缀才是稳定的。
 *
 * 路径来源按可靠性排序：`title` → 文本内容（仅当它看起来像路径）。
 * `aria-label` 不参与：它是一句给读屏器的描述，不是路径。
 */

/** CSS module 生成的类名形如 `_fileMention_1ypvv_85`。 */
const MENTION_CLASS = /(?:^|\s)_?fileMention_/u

/** 结尾的行号/列号后缀：`src/a.ts:12`、`src/a.ts:12:3`、`src/a.ts#L12`。 */
const LOCATION_SUFFIX = /(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/u

/** Windows 盘符路径。 */
const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/u

/** 一次成功的命中。 */
export interface MentionHit {
  /** 从 DOM 中读到的路径文本；可能是相对路径，也可能是绝对路径。 */
  readonly path: string
  /** 被右键的按钮，用于关闭菜单后恢复焦点。 */
  readonly anchorEl: HTMLElement
}

/**
 * 判断一段文本是否像一个文件路径。
 *
 * 这是「链接文本」兜底通道的守门人：`[点这里](src/a.ts)` 的文本是「点这里」，
 * 不能当路径用。只接受有明确路径特征的值，宁可漏掉也不能把正常词句当路径。
 * @param text - 候选文本。
 * @returns 是否可当作路径。
 */
export function looksLikePath(text: string): boolean {
  const value = text.trim()
  if (value === '' || /\s/u.test(value)) return false
  if (value.startsWith('/') || value.startsWith('./') || value.startsWith('../')) return true
  if (WINDOWS_ABSOLUTE.test(value)) return true
  // 相对路径至少要有一个目录分隔符或一个扩展名点号，否则「README」这类正文
  // 也会被当成路径。
  return value.includes('/') || /^[^/]+\.[A-Za-z0-9]+$/u.test(value)
}

/**
 * 去掉路径可能携带的行号后缀。
 * @param value - 原始路径文本。
 * @returns 去掉后端定位的路径。
 */
export function stripLocationSuffix(value: string): string {
  return value.replace(LOCATION_SUFFIX, '')
}

/**
 * 判断一个文本是否是绝对路径（POSIX 或 Windows 形式）。
 * @param value - 候选路径。
 * @returns 是否为绝对路径。
 */
export function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || WINDOWS_ABSOLUTE.test(value) || value.startsWith('\\\\')
}

/**
 * 从一个元素读出它指向的路径。
 * @param button - 命中 `fileMention` 类名的按钮。
 * @returns 路径文本，取不到时为 null。
 */
export function pathOfMention(button: HTMLElement): string | null {
  const title = button.getAttribute('title')
  if (title !== null) {
    const cleaned = stripLocationSuffix(title.trim())
    if (cleaned !== '') return cleaned
  }
  const text = button.textContent === null ? '' : button.textContent.trim()
  if (text !== '' && looksLikePath(text)) return stripLocationSuffix(text)
  return null
}

/** 判断一个元素是不是文件提及按钮。 */
function isMentionButton(element: Element): element is HTMLElement {
  return MENTION_CLASS.test(element.getAttribute('class') ?? '')
}

/**
 * 从右键事件的目标回溯到最近的、带文件提及类名的按钮。
 *
 * 先找最近的按钮；目标落在 `<code>` 的内边距上时（按钮没铺满整个代码片段）再
 * 往一层找：`<code>` 若恰好只含一个文件提及按钮，就把这次右键算在它头上。
 * 一般行内代码里没有按钮，因此这条兜底不会把普通代码片段变成菜单入口。
 * @param target - 右键事件的原始目标。
 * @returns 文件提及按钮，或 null。
 */
function mentionButtonOf(target: Element): HTMLElement | null {
  const nearest = target.closest('button')
  if (nearest !== null) return isMentionButton(nearest) ? nearest : null
  const code = target.closest('code')
  if (code === null) return null
  const nested = code.querySelectorAll('button')
  if (nested.length !== 1) return null
  const only = nested[0]
  return only !== undefined && isMentionButton(only) ? only : null
}

/**
 * 从右键事件的目标回溯到一个文件引用。
 *
 * 有文本选区时不接管：那时用户的意图更可能是「复制这段文字」，应当把右键交还
 * 给浏览器原生菜单（渲染器自己的点击处理也用同一条规则判断）。
 * @param target - `contextmenu` 事件的 `target`。
 * @param selection - 当前选区文本；省略时从文档读取。
 * @returns 命中信息；不在文件引用上时为 null。
 */
export function findMention(
  target: EventTarget | null,
  selection?: string | null,
): MentionHit | null {
  if (typeof Element === 'undefined' || !(target instanceof Element)) return null
  const selected = selection ?? currentSelectionText()
  if (selected !== null && selected !== '') return null
  const button = mentionButtonOf(target)
  if (button === null) return null
  const path = pathOfMention(button)
  if (path === null) return null
  return { path, anchorEl: button }
}

/**
 * 读取当前选区文本。
 * @returns 选区文本；没有选区（或环境不提供该 API）时为 null。
 */
function currentSelectionText(): string | null {
  if (typeof window === 'undefined') return null
  if (typeof window.getSelection !== 'function') return null
  const selection = window.getSelection()
  return selection === null ? null : selection.toString()
}
