/**
 * message-quote 功能 · 把选中的 DOM 序列化成 Markdown。
 *
 * ## 为什么必须这么做
 *
 * `selection.toString()` 只返回**纯文本**。助手回复里那些 `lib/client.js` 的行内
 * 代码、代码块的语言与围栏、`**粗体**`、列表符号，在 `toString()` 之后全部消失。
 * 于是引用正文变成一坨没有结构的文字：交给模型的是它，浮窗里渲染的也是它 ——
 * 即使浮窗用的是宿主同一个 Markdown 渲染器，也没有任何 Markdown 可渲染。
 *
 * 所以格式化必须**在捕获的那一刻**保留下来：遍历选区的 DOM 副本，按语义还原成
 * Markdown。这样引用块既更接近原文（对模型也更有用），浮窗也终于有东西可渲染。
 *
 * ## 只还原「能稳定识别」的部分
 *
 * 这里不做完整的 HTML→Markdown 转换：只处理宿主 Markdown 渲染器实际会产出的
 * 节点（段落、标题、列表、引用、代码、强调、链接、表格、分隔线）。认不出的元素
 * 一律**递归取其内容**而不是丢弃 —— 丢掉内容比丢格式糟糕得多。
 *
 * 纯函数、不读全局：DOM 节点通过参数传入，因此可以在 Node 里用最小假节点测试。
 */

/**
 * 序列化时整棵跳过的子树：代码块工具栏、图标、样式表。
 *
 * **不能把 `button` 整体跳掉**：宿主把本地文件链接渲染成
 * `<button class="fileMention fileLink">`，跳过它等于把整段文件引用丢掉 ——
 * 正是「引用里文件路径消失」的原因。工具栏里的按钮本来就在
 * `[data-code-block-banner]` 之内，那里已经整棵跳过，不会漏出「复制」之类文案。
 */
const SKIP_SELECTOR = '[data-code-block-banner], svg, style, script'

/** 宿主文件引用的类名：链接与行内代码都会渲染成它。 */
const FILE_MENTION_CLASS = 'fileMention'

/** 其中「来自 Markdown 链接」的那一类。 */
const FILE_LINK_CLASS = 'fileLink'

/** 宿主代码块根节点的类名（`md-code-block`）。 */
const CODE_BLOCK_CLASS = 'md-code-block'

/** 宿主代码块语言标签的类名（`infostring`）。 */
const CODE_LANG_CLASS = 'infostring'

/** 这些标签自成一个块：前后要有空行。 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'FIELDSET', 'FIGCAPTION',
  'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR',
  'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'UL',
])

/**
 * 判断节点是不是元素。
 * @param node - 任意 DOM 节点。
 * @returns 是元素时为 `true`。
 */
function isElement(node: Node): node is Element {
  return node.nodeType === 1
}

/**
 * 判断节点是不是文本。
 * @param node - 任意 DOM 节点。
 * @returns 是文本时为 `true`。
 */
function isText(node: Node): node is Text {
  return node.nodeType === 3
}

/**
 * 取子节点数组；兼容没有 `childNodes` 的桩节点。
 * @param node - 父节点。
 * @returns 子节点数组。
 */
function childrenOf(node: Node): Node[] {
  const list = node.childNodes
  if (list === undefined || list === null) return []
  return Array.from(list)
}

/**
 * 这个元素是否整棵跳过。
 * @param element - 待判断元素。
 * @returns 跳过时为 `true`。
 */
function isSkipped(element: Element): boolean {
  const matches = element.matches
  if (typeof matches !== 'function') return false
  return element.matches(SKIP_SELECTOR)
}

/**
 * 深度优先找第一个满足条件的后代元素（含自身）。
 * @param node - 起点。
 * @param test - 判定函数。
 * @returns 命中的元素；没有则为 `undefined`。
 */
function findElement(node: Node, test: (element: Element) => boolean): Element | undefined {
  if (isElement(node) && test(node)) return node
  for (const child of childrenOf(node)) {
    const hit = findElement(child, test)
    if (hit !== undefined) return hit
  }
  return undefined
}

/**
 * 深度优先收集所有满足条件的后代元素。
 * @param node - 起点。
 * @param test - 判定函数。
 * @returns 命中的元素数组。
 */
function findAll(node: Node, test: (element: Element) => boolean): Element[] {
  const hits: Element[] = []
  const visit = (current: Node): void => {
    if (isElement(current) && test(current)) {
      hits.push(current)
      return
    }
    for (const child of childrenOf(current)) visit(child)
  }
  visit(node)
  return hits
}

/**
 * 元素的纯文本内容。
 * @param node - 起点。
 * @returns 拼接后的文本。
 */
function textOf(node: Node): string {
  if (isText(node)) return node.data
  let out = ''
  for (const child of childrenOf(node)) out += textOf(child)
  return out
}

/**
 * 判断是否为宿主代码块根节点。
 * @param element - 待判断元素。
 * @returns 是代码块时为 `true`。
 */
function isCodeBlock(element: Element): boolean {
  const list = element.classList
  if (list === undefined || list === null) return false
  return list.contains(CODE_BLOCK_CLASS)
}

/**
 * 读代码块的语言标识。
 *
 * 宿主把语言放在工具栏的 `infostring` 里（`bash`、`ts`…）；高亮版本还会给 `code`
 * 挂 `language-xxx`。两个都认，能取到就用。
 * @param element - 代码块根节点。
 * @returns 语言；取不到时为 `undefined`。
 */
function codeLanguage(element: Element): string | undefined {
  const label = findElement(element, (candidate) => {
    const list = candidate.classList
    return list !== undefined && list !== null && list.contains(CODE_LANG_CLASS)
  })
  const fromLabel = label === undefined ? '' : textOf(label).trim()
  if (fromLabel !== '') return fromLabel

  const code = findElement(element, (candidate) => candidate.tagName.toUpperCase() === 'CODE')
  const className = code?.className ?? ''
  const match = /language-([\w-]+)/u.exec(className)
  return match?.[1]
}

/**
 * 读代码块的源码文本。
 *
 * 优先取 `pre`：高亮过的代码块在 `pre` 里塞了 `span.line` 与行号，`textContent`
 * 会把它们拼回原文；没有 `pre` 时退回整块文本。
 * @param element - 代码块根节点。
 * @returns 源码文本。
 */
function codeText(element: Element): string {
  const pre = findElement(element, (candidate) => candidate.tagName.toUpperCase() === 'PRE')
  const raw = textOf(pre ?? element)
  // 代码块里的换行有意义，只去掉首尾多余的空行。
  return raw.replace(/^\n+/u, '').replace(/\n+$/u, '')
}

/**
 * 求一段文本里最长的连续反引号串长度。
 * @param text - 待检查文本。
 * @returns 最长连续反引号个数；没有则为 0。
 */
function longestBacktickRun(text: string): number {
  let longest = 0
  let run = 0
  for (const char of text) {
    if (char === '`') {
      run += 1
      if (run > longest) longest = run
    } else {
      run = 0
    }
  }
  return longest
}

/**
 * 生成不短于代码内容所需的代码块围栏（至少三个反引号）。
 *
 * 代码里若本身含 ```，用三个反引号会把围栏提前闭合，所以按最长反引号串取
 * `max(3, 长度 + 1)`。
 * @param code - 代码文本。
 * @returns 围栏字符串。
 */
function fenceFor(code: string): string {
  return '`'.repeat(Math.max(3, longestBacktickRun(code) + 1))
}

/**
 * 生成包裹行内代码所需的定界符（最少一个反引号）。
 *
 * 内容本身含反引号时用一个反引号会提前闭合，所以要取比最长串多一个，并按
 * CommonMark 的规则在首尾留空格：内容以反引号开头或结尾时，不留空格会解析错。
 * @param value - 行内代码文本。
 * @returns 可直接拼进 Markdown 的行内代码片段。
 */
function inlineCodeOf(value: string): string {
  const ticks = '`'.repeat(Math.max(1, longestBacktickRun(value) + 1))
  const needsPad = value.startsWith('`') || value.endsWith('`')
  return needsPad ? `${ticks} ${value} ${ticks}` : `${ticks}${value}${ticks}`
}

/**
 * 判断元素是否带某个类名。
 * @param element - 待判断元素。
 * @param name - 类名。
 * @returns 带该类名时为 `true`。
 */
function hasClass(element: Element, name: string): boolean {
  const list = element.classList
  if (list === undefined || list === null) return false
  return list.contains(name)
}

/**
 * 判断一段文字像不像文件路径。
 *
 * 用作「这个属性值是不是完整路径」的宽松判定。宿主给文件引用准备的属性里，
 * `title` 是路径（`producedFileMentions` 里就是 `title: path`），`aria-label`
 * 却是界面文案（`t("presented.previewButton", {name})` → 「打开 xxx」），所以
 * 需要过滤掉后者：
 *
 * - 含中文句子特征的直接否决（文案是本地化的，路径不会）；
 * - URL 留给链接分支处理，不当路径；
 * - 必须出现目录分隔符 —— 只给出文件名时，可见文字本身就够了，不必替换。
 * @param value - 待判断的字符串。
 * @returns 像路径时为 `true`。
 */
function looksLikePath(value: string): boolean {
  if (value === '') return false
  if (/[\u4e00-\u9fff]/u.test(value)) return false
  if (/^[a-z][a-z\d+.-]*:\/\//iu.test(value)) return false
  return value.includes('/') || value.includes('\\')
}

/**
 * 取路径的最后一段（同时兼容 `/` 与 `\`）。
 * @param value - 路径。
 * @returns 文件名。
 */
function basenameOf(value: string): string {
  const parts = value.split(/[\\/]/u)
  return parts[parts.length - 1] ?? ''
}

/**
 * 从元素上找出完整路径。
 *
 * 宿主把本地文件引用渲染成 `<button class="fileMention fileLink" title="src/…">`
 * （链接形态的 `title` 就是 `e.path`），行内代码形态的引用也可能带 `title` /
 * `aria-label`；`href` 是最后的选择。取第一个像路径的值。
 * @param element - 文件引用元素。
 * @returns 完整路径；找不到时为 `undefined`。
 */
function filePath(element: Element): string | undefined {
  const candidates = [
    element.getAttribute('title') ?? '',
    element.getAttribute('aria-label') ?? '',
    element.getAttribute('href') ?? '',
  ]
  for (const candidate of candidates) {
    const value = candidate.trim()
    if (looksLikePath(value)) return value
  }
  return undefined
}

/**
 * 把宿主渲染的文件引用还原成 Markdown。
 *
 * 宿主给文件引用只显示**短名字**（用户写 `[serialize.ts](src/…)` 时，气泡里看到
 * 的就是 `serialize.ts`），完整路径藏在 `title` 里。引用若只抄可见文字，拿到引用
 * 的模型与用户就都不知道那是哪个文件 —— 所以这里把路径补回来。
 *
 * 补回来的形式是**含完整路径的行内代码**而不是 `[短名](路径)`：后者在气泡与浮窗里
 * 又会变回只显示短名字的文件 chip，路径依然看不见。行内代码则把路径直接摆出来，
 * 模型复制即用。
 *
 * 只在「路径的文件名与可见文字一致」时替换，避免把 `打开文件` 之类的提示文案
 * 误当路径。
 * @param element - 文件引用元素。
 * @returns 行内 Markdown。
 */
function fileMentionOf(element: Element): string {
  const label = inlineChildren(element).trim()
  const path = filePath(element)
  // 链接形态（`fileLink`）与行内代码形态的兜底不同：前者本来就是链接，输出链接；
  // 后者原本就是行内代码，丢了反引号会连格式一起丢。
  const asLink = hasClass(element, FILE_LINK_CLASS)
  const fallback = label === '' ? '' : asLink ? label : inlineCodeOf(label)

  if (path === undefined) return fallback
  if (label === '') return inlineCodeOf(path)
  // 可见文字已经带目录了，说明它本身就是路径，不必再动。
  if (label.includes('/')) return inlineCodeOf(label)
  if (basenameOf(path) === label) return inlineCodeOf(path)
  // 链接文字与文件名不一致（例如 `[文档](src/x.ts)`）：两个信息都保留。
  return asLink ? `[${label}](${path})` : fallback
}

/**
 * 在子树里找文件引用。
 *
 * 宿主把**行内代码**形态的文件引用渲染成 `<code><button class="fileMention">` ——
 * 按钮被一层 `<code>` 包着。若只看节点自身是不是文件引用，就会漏掉这种最常见的
 * 情况（`<code>` 分支直接取纯文本，根本不会递归进去），路径因此丢失。
 * @param node - 起点。
 * @returns 命中的文件引用元素；没有则为 `undefined`。
 */
function findFileMention(node: Node): Element | undefined {
  return findElement(node, (candidate) => hasClass(candidate, FILE_MENTION_CLASS))
}

/**
 * 把一段行内内容渲染成 Markdown。
 * @param node - 起点。
 * @returns 行内 Markdown。
 */
function inlineOf(node: Node): string {
  if (isText(node)) {
    // 浏览器本来就把普通空白折叠成一个空格，跟着折叠才能让输出与看到的一致。
    return node.data.replace(/\s+/gu, ' ')
  }
  if (!isElement(node)) return ''

  const tag = node.tagName.toUpperCase()
  if (isSkipped(node)) return ''
  if (tag === 'BR') return '\n'

  // 文件引用要在通用规则之前拦下：它既不是普通链接（`href` 往往不是 URL），
  // 也不能只留可见文字（会丢路径）。
  if (hasClass(node, FILE_MENTION_CLASS)) return fileMentionOf(node)

  const block = (): string => inlineChildren(node)

  switch (tag) {
    case 'CODE': {
      // 行内代码里可能包着文件引用：宿主把 `[x](路径)` 与能解析成本地文件的
      // 行内代码都渲染成 `<code><button class="fileMention">`。此时必须走文件
      // 引用分支把完整路径补回来，而不是把可见的短名字当普通代码抄走。
      const mention = findFileMention(node)
      if (mention !== undefined) return fileMentionOf(mention)
      // 普通行内代码：反引号包裹。内容里若含反引号，用更长的围栏。
      const value = textOf(node).replace(/\r?\n|\r/gu, ' ')
      return inlineCodeOf(value)
    }
    case 'STRONG':
    case 'B': {
      const value = block().trim()
      return value === '' ? '' : `**${value}**`
    }
    case 'EM':
    case 'I': {
      const value = block().trim()
      return value === '' ? '' : `*${value}*`
    }
    case 'DEL':
    case 'S': {
      const value = block().trim()
      return value === '' ? '' : `~~${value}~~`
    }
    case 'A': {
      const label = block().trim()
      const href = node.getAttribute('href') ?? ''
      if (label === '') return ''
      return href === '' ? label : `[${label}](${href})`
    }
    case 'IMG': {
      const alt = node.getAttribute('alt') ?? ''
      const src = node.getAttribute('src') ?? ''
      return src === '' ? '' : `![${alt}](${src})`
    }
    case 'PRE': {
      // 裸 `pre`（没有 `md-code-block` 外壳）：按无语言代码块处理。
      const code = codeText(node)
      const fence = fenceFor(code)
      return `${fence}\n${code}\n${fence}`
    }
    default:
      return block()
  }
}

/**
 * 把子节点按行内方式拼接。
 * @param node - 父节点。
 * @returns 行内 Markdown。
 */
function inlineChildren(node: Node): string {
  let out = ''
  for (const child of childrenOf(node)) out += inlineOf(child)
  return out
}

/**
 * 把一个元素渲染成若干行 Markdown（块级）。
 * @param element - 待渲染元素。
 * @returns 行数组；不产生内容时为空数组。
 */
function blockOf(element: Element): string[] {
  if (isSkipped(element)) return []
  if (isCodeBlock(element)) {
    const code = codeText(element)
    const lang = codeLanguage(element) ?? ''
    const fence = fenceFor(code)
    return [`${fence}${lang}`, ...code.split('\n'), fence]
  }

  const tag = element.tagName.toUpperCase()
  switch (tag) {
    case 'PRE': {
      const code = codeText(element)
      const fence = fenceFor(code)
      return [`${fence}`, ...code.split('\n'), fence]
    }
    case 'HR':
      return ['---']
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
      const level = Number(tag.slice(1))
      const text = inlineChildren(element).trim()
      return text === '' ? [] : [`${'#'.repeat(level)} ${text}`]
    }
    case 'UL':
    case 'OL':
      return listOf(element)
    case 'BLOCKQUOTE': {
      const inner = childrenBlocks(element)
      return inner.map((line) => (line === '' ? '>' : `> ${line}`))
    }
    case 'TABLE':
      return tableOf(element)
    default:
      return childrenBlocks(element)
  }
}

/**
 * 渲染列表。
 * @param element - `ul` 或 `ol`。
 * @returns 行数组。
 */
function listOf(element: Element): string[] {
  const ordered = element.tagName.toUpperCase() === 'OL'
  const items = childrenOf(element).filter(
    (child): child is Element => isElement(child) && child.tagName.toUpperCase() === 'LI',
  )
  const lines: string[] = []
  items.forEach((item, index) => {
    const marker = ordered ? `${index + 1}. ` : '- '
    const indent = ' '.repeat(marker.length)
    const inner = childrenBlocks(item)
    if (inner.length === 0) {
      lines.push(marker.trimEnd())
      return
    }
    inner.forEach((line, lineIndex) => {
      lines.push(lineIndex === 0 ? `${marker}${line}` : `${indent}${line}`)
    })
  })
  return lines
}

/**
 * 渲染表格。
 *
 * 分隔行放在第一行之后：Markdown 需要它来定表头，而浏览器里第一行本来也是表头。
 * @param element - `table`。
 * @returns 行数组。
 */
function tableOf(element: Element): string[] {
  const rows = findAll(element, (candidate) => candidate.tagName.toUpperCase() === 'TR')
  if (rows.length === 0) return []
  const cellsOf = (row: Element): string[] => childrenOf(row)
    .filter((child): child is Element => {
      if (!isElement(child)) return false
      const tag = child.tagName.toUpperCase()
      return tag === 'TD' || tag === 'TH'
    })
    .map((cell) => inlineChildren(cell).trim())
  const lines: string[] = []
  rows.forEach((row, index) => {
    const cells = cellsOf(row)
    lines.push(`| ${cells.join(' | ')} |`)
    if (index === 0) lines.push(`| ${cells.map(() => '---').join(' | ')} |`)
  })
  return lines
}

/**
 * 把一个容器的子节点渲染成行数组：块级元素各自成段，行内内容拼成一行。
 * @param parent - 父节点。
 * @returns 行数组，空行表示段间隔。
 */
function childrenBlocks(parent: Node): string[] {
  const lines: string[] = []
  let pending = ''

  const flushPending = (): void => {
    const trimmed = pending.trim()
    if (trimmed !== '') lines.push(...trimmed.split('\n').map((line) => line.trimEnd()))
    pending = ''
  }

  for (const child of childrenOf(parent)) {
    // 空白文本在块之间没有意义（HTML 会折叠掉），但它出现在行内内容中间时要保留。
    if (isText(child) && child.data.trim() === '') {
      if (pending !== '') pending += ' '
      continue
    }
    const isBlock = isElement(child) && BLOCK_TAGS.has(child.tagName.toUpperCase()) && !isSkipped(child)
    if (isBlock) {
      flushPending()
      lines.push(...blockOf(child as Element), '')
    } else {
      pending += inlineOf(child)
    }
  }
  flushPending()

  // 合并连续空行：段间隔只需要一个空行。
  const compact: string[] = []
  for (const line of lines) {
    if (line === '' && (compact.length === 0 || compact[compact.length - 1] === '')) continue
    compact.push(line)
  }
  while (compact.length > 0 && compact[compact.length - 1] === '') compact.pop()
  return compact
}

/**
 * 把选区的 DOM 副本序列化成 Markdown。
 *
 * 用 `cloneContents()` 而不是直接遍历原树：它会把被选中的部分裁好，边界节点里的
 * 未选中文字不会被带进来。
 * @param range - 用户选区。
 * @returns Markdown 文本。
 */
export function serializeRange(range: Range): string {
  const fragment = range.cloneContents()
  const document = range.startContainer.ownerDocument ?? globalThis.document
  const container = document.createElement('div')
  container.appendChild(fragment)
  return serializeElement(container)
}

/**
 * 把一个元素序列化成 Markdown。
 * @param element - 起点（通常是包装用的容器）。
 * @returns Markdown 文本。
 */
export function serializeElement(element: Element): string {
  return childrenBlocks(element).join('\n').trim()
}

/**
 * 把任意节点序列化成 Markdown，便于测试与诊断。
 * @param node - 起点。
 * @returns Markdown 文本。
 */
export function serializeNode(node: Node): string {
  if (isElement(node)) return serializeElement(node)
  if (isText(node)) return node.data
  return ''
}
