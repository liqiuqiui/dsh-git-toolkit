/**
 * file-menu 纯逻辑测试：在 Node 里加载**真实产物** `lib/client.js`，调用它再导出的
 * 那几个决策函数。
 *
 * 这里不构造 React 树、不碰 DOM，只验证三件在重构中最容易静默坏掉的事：
 *
 *   1. **路径识别**：什么样的文本才算是「文件引用」，行号后缀要还原掉，正文词句
 *      不能误判。判定错一次，菜单就会出现在不该出现的地方，或者干脆不出现。
 *   2. **优先编辑器**：宿主给的是这台机器真实登记的程序列表，把它提到一级的那一
 *      行必须挑得稳定（同时装了 Cursor 与 VS Code 时选谁），干净系统上则不该有
 *      这一行。
 *   3. **读文件与错误文案**：二进制/非 UTF-8 要被识别成「不能当文本复制」，
 *      Remote 的失败信封要变成能读的消息而不是 `[object Object]`。
 *
 * React 用最小桩：再导出的这些函数不在模块顶层触碰 React，但 bundle 的顶层要求
 * 能拿到 `react`。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 存根 React：bundle 顶层只需要能解析出 `react`。 */
const React = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (subscribe, getSnapshot) => {
    subscribe(() => {})
    return getSnapshot()
  },
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (factory) => factory(),
  useRef: (initial) => ({ current: initial }),
}

// 用 fileURLToPath 而不是 URL.pathname：后者在 Windows 上会留下前导斜杠
// （`/C:/...`），readFileSync 会把它当成当前盘符下的相对路径。
const BUNDLE = fileURLToPath(new URL('../lib/client.js', import.meta.url))

/**
 * 在 Node 里执行产物，返回它的 `module.exports`。
 *
 * 产物把 `window` 当作作用域变量读取，因此这里传入的桩对象就是「页面里的
 * window」——测试要伪造浏览器 API（例如保存对话框）时，往这个对象上加属性即可。
 * @param path - 产物路径。
 * @returns loader 收到的 id、factory 产物与那个 `window` 桩。
 */
function loadBundle(path) {
  const source = readFileSync(path, 'utf8')
  let captured
  const windowStub = {
    __ModuleLoader__: {
      load({ id, factory }) {
        captured = { id, factory }
      },
    },
  }
  // 产物只 require loader 提供的模块：message-quote 引入了 react-dom 与宿主的
  // markdown 渲染器，这里给它们最小桩 —— file-menu 的逻辑不碰这两个，但 bundle
  // 求值时会解析模块名。
  const require = (name) => {
    if (name === 'react') return React
    if (name === 'react-dom') return { createPortal: (children) => children }
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null }
    throw new Error(`unexpected require at runtime: ${name}`)
  }
  new Function('window', 'require', source)(windowStub, require)
  assert.ok(captured !== undefined, 'the bundle called __ModuleLoader__.load')
  return { exports: captured.factory(require), window: windowStub }
}

const loaded = loadBundle(BUNDLE)
const exports = loaded.exports
const window = loaded.window

// ---- 路径识别 ----

test('looksLikePath accepts paths and rejects prose', () => {
  const { looksLikePath } = exports
  // 绝对路径、显式相对路径、Windows 盘符路径都是路径。
  assert.equal(looksLikePath('/Users/me/src/a.ts'), true)
  assert.equal(looksLikePath('./src/a.ts'), true)
  assert.equal(looksLikePath('../lib/a.ts'), true)
  assert.equal(looksLikePath('C:\\work\\a.ts'), true)
  // 裸文件名带扩展名也算。
  assert.equal(looksLikePath('README.md'), true)
  // 正文词句不算：含空格的一律拒绝。
  assert.equal(looksLikePath('点这里'), false)
  assert.equal(looksLikePath('see the file'), false)
  assert.equal(looksLikePath('README'), false, 'a bare word has no path feature')
  assert.equal(looksLikePath(''), false)
  assert.equal(looksLikePath('   '), false)
})

test('stripLocationSuffix removes the trailing line and column numbers', () => {
  const { stripLocationSuffix } = exports
  assert.equal(stripLocationSuffix('src/a.ts:12'), 'src/a.ts')
  assert.equal(stripLocationSuffix('src/a.ts:12:3'), 'src/a.ts')
  assert.equal(stripLocationSuffix('src/a.ts#L12'), 'src/a.ts')
  assert.equal(stripLocationSuffix('src/a.ts#L12-L18'), 'src/a.ts')
  // 没有行号时原样返回；路径里的数字不能被动到。
  assert.equal(stripLocationSuffix('src/a.ts'), 'src/a.ts')
  assert.equal(stripLocationSuffix('src/v2/refs9.ts'), 'src/v2/refs9.ts', 'digits inside segments survive')
  assert.equal(stripLocationSuffix('2024/notes.txt'), '2024/notes.txt')
})

// ---- 命中判定（DOM 形态） ----

/**
 * 最小的 Element 替身，只实现 `findMention` 用到的那几个成员。
 *
 * 这里刻意照着渲染器**真实**产出的结构搭：文件提及是
 * `<code><button class="_fileMention_<hash>" title="<绝对路径>">…</button></code>`，
 * 类名带构建期哈希，因此判定只能靠 `fileMention` 这个 localName 子串。
 */
class FakeElement {
  constructor(tag, options = {}) {
    this.tagName = tag.toUpperCase()
    this.className = options.className ?? ''
    this.title = options.title ?? null
    this.text = options.text ?? ''
    this.parent = options.parent ?? null
    this.children = []
    if (this.parent !== null) this.parent.children.push(this)
  }

  getAttribute(name) {
    if (name === 'class') return this.className
    if (name === 'title') return this.title
    return null
  }

  get textContent() {
    return this.children.length === 0 ? this.text : this.children.map((c) => c.textContent).join('')
  }

  closest(selector) {
    const want = selector.toUpperCase()
    let node = this
    while (node !== null) {
      if (node.tagName === want) return node
      node = node.parent
    }
    return null
  }

  querySelectorAll(selector) {
    const want = selector.toUpperCase()
    const found = []
    const walk = (node) => {
      for (const child of node.children) {
        if (child.tagName === want) found.push(child)
        walk(child)
      }
    }
    walk(this)
    return found
  }
}

/** 装一个 Element 全局，让 bundle 内的 `instanceof Element` 成立。 */
function withElements(run) {
  const had = Object.hasOwn(globalThis, 'Element')
  const previous = globalThis.Element
  globalThis.Element = FakeElement
  try {
    return run()
  } finally {
    if (had) globalThis.Element = previous
    else delete globalThis.Element
  }
}

/** 造出「行内代码里的文件提及」这一真实结构。 */
function mentionDom({ path = '/w/src/a.ts', title = path, text = 'src/a.ts' } = {}) {
  const code = new FakeElement('code')
  const button = new FakeElement('button', {
    className: '_fileMention_1ypvv_85',
    title,
    parent: code,
  })
  new FakeElement('span', { text, parent: button })
  return { code, button }
}

test('findMention resolves a file mention to its path', () => {
  const { findMention } = exports
  withElements(() => {
    const { button } = mentionDom()
    const hit = findMention(button)
    assert.equal(hit?.path, '/w/src/a.ts')
    assert.equal(hit?.anchorEl, button)
  })
})

test('findMention treats a click on the mention glyph as the same mention', () => {
  const { findMention } = exports
  withElements(() => {
    const { button } = mentionDom()
    const glyph = button.children[0]
    assert.equal(findMention(glyph)?.path, '/w/src/a.ts')
  })
})

test('findMention ignores ordinary prose and plain inline code', () => {
  const { findMention } = exports
  withElements(() => {
    // 普通行内代码：没有文件提及按钮。
    const code = new FakeElement('code')
    new FakeElement('span', { text: 'const a = 1', parent: code })
    assert.equal(findMention(code), null)
    // 普通链接按钮：类名里没有 fileMention。
    const link = new FakeElement('button', { className: '_link_abc_1', parent: code })
    assert.equal(findMention(link), null)
    // 正文段落。
    assert.equal(findMention(new FakeElement('p', { text: 'see src/a.ts' })), null)
    assert.equal(findMention(null), null)
  })
})

test('findMention refuses to take over while text is selected', () => {
  const { findMention } = exports
  withElements(() => {
    const { button } = mentionDom()
    // 用户已经选中一段文字时，右键意图更可能是复制，交还给原生菜单。
    assert.equal(findMention(button, 'already selected'), null)
    assert.equal(findMention(button, '')?.path, '/w/src/a.ts')
  })
})

test('findMention falls back to the link text when the button carries no title', () => {
  const { findMention } = exports
  withElements(() => {
    // 带图片预览的链接会丢掉 `title`，只剩文本。
    const { button } = mentionDom({ title: null, text: 'src/a.ts:12' })
    assert.equal(findMention(button)?.path, 'src/a.ts', 'the line suffix is part of the text, not the path')
    // 文本是散文时宁可不命中，也不能把句子当路径。
    const prose = mentionDom({ title: null, text: '点这里' })
    assert.equal(findMention(prose.button), null)
  })
})

// ---- 优先编辑器 ----

/** 造一个打开方式条目。 */
function application(name, options = {}) {
  return {
    id: `/Applications/${name}.app`,
    name,
    default: options.default ?? false,
    icon: options.icon ?? null,
  }
}

test('pickEditor prefers VS Code over other editors when both are installed', () => {
  const { pickEditor } = exports
  const picked = pickEditor([
    application('Cursor'),
    application('Visual Studio Code'),
    application('Terminal'),
  ])
  assert.equal(picked?.name, 'Visual Studio Code')
})

test('pickEditor keeps the ranked family order even when a later family is the default', () => {
  const { pickEditor } = exports
  // Cursor 是默认程序，但 VS Code 排在偏好表前面，因此仍选 VS Code：
  // 「默认程序」只在同一家族内部用来打破平手。
  const picked = pickEditor([
    application('Cursor', { default: true }),
    application('Visual Studio Code'),
  ])
  assert.equal(picked?.name, 'Visual Studio Code')
})

test('pickEditor falls back to the only known editor available', () => {
  const { pickEditor } = exports
  const picked = pickEditor([application('Preview'), application('Xcode'), application('Safari')])
  assert.equal(picked?.name, 'Xcode')
})

test('pickEditor returns null when no known editor is installed', () => {
  const { pickEditor } = exports
  assert.equal(pickEditor([application('Preview'), application('Safari')]), null)
  assert.equal(pickEditor([]), null)
})

// ---- 文件名与解码 ----

test('baseNameOf takes the last segment of POSIX and Windows paths', () => {
  const { baseNameOf } = exports
  assert.equal(baseNameOf('/Users/me/src/a.ts'), 'a.ts')
  assert.equal(baseNameOf('C:\\work\\src\\a.ts'), 'a.ts')
  assert.equal(baseNameOf('a.ts'), 'a.ts')
  // 目录尾斜杠不该让文件名变成空串。
  assert.equal(baseNameOf('/Users/me/src/'), 'src')
  assert.equal(baseNameOf('/'), 'download')
})

test('decodeText accepts UTF-8 and refuses binary or non-UTF-8 bytes', () => {
  const { decodeText } = exports
  const encoder = new TextEncoder()
  assert.equal(decodeText(encoder.encode('const a = 1\n')), 'const a = 1\n')
  assert.equal(decodeText(encoder.encode('多字节 中文 ✓')), '多字节 中文 ✓')
  assert.equal(decodeText(new Uint8Array()), '')
  // NUL 字节是二进制的判据：合法的 UTF-8 文本里不会出现它。
  assert.throws(() => decodeText(new Uint8Array([0x61, 0x00, 0x62])), /not text/u)
  // 非法 UTF-8 序列要报错，而不是静默替换成 U+FFFD。
  assert.throws(() => decodeText(new Uint8Array([0xff, 0xfe, 0xfd])), /not UTF-8/u)
})

// ---- Remote 读取 ----

/** 造一个只实现被用到的两个方法的 workspaceFiles 替身。 */
function filesRemote(answer) {
  return {
    readBytes: async (...args) => answer(...args),
    stat: async () => ({ ok: false, error: { code: 'workspace-file/not-found', message: 'missing' } }),
  }
}

test('readFileText joins the byte window into text', async () => {
  const { readFileText } = exports
  const data = new TextEncoder().encode('hello\n')
  const remote = {
    workspaceFiles: filesRemote(async () => ({
      ok: true,
      value: { offset: 0, data, eof: true, absolutePath: '/w/a.txt', version: 'v1' },
    })),
  }
  assert.equal(await readFileText(remote, 's1', '/w/a.txt', new AbortController().signal), 'hello\n')
})

test('readFileText reads exactly one window of the copy limit', async () => {
  const { readFileText, COPY_LIMIT_BYTES } = exports
  let requested
  const remote = {
    workspaceFiles: filesRemote(async (_session, _path, options) => {
      requested = options
      return { ok: false, error: { code: 'workspace-file/too-large', message: 'nope' } }
    }),
  }
  await assert.rejects(() => readFileText(remote, 's1', '/w/a.txt', new AbortController().signal))
  // 不能读 `limit + 1`：宿主对带 range 的读取有 `maxBytes` 上限，正好是 2 MiB，
  // 多读一个字节会被它先拒掉，错误信息就变成在说我们的窗口而不是用户的文件。
  assert.deepEqual(requested, { range: { offset: 0, length: COPY_LIMIT_BYTES } })
})

test('readFileText turns a host size refusal into its own limit message', async () => {
  const { readFileText, messageKeyOf, COPY_LIMIT_BYTES } = exports
  // 部署把窗口上限配得比本功能更小时，宿主先拒；用户看到的应是「文件太大」，
  // 而不是我们的窗口字节数。
  const remote = {
    workspaceFiles: filesRemote(async () => ({
      ok: false,
      error: { code: 'workspace-file/too-large', message: 'nope' },
    })),
  }
  const rejected = await readFileText(remote, 's1', '/w/a.txt', new AbortController().signal).catch(
    (error) => error,
  )
  assert.deepEqual(messageKeyOf(rejected), {
    key: 'tooLarge',
    params: { limit: `${Math.round(COPY_LIMIT_BYTES / (1024 * 1024))} MB` },
  })
})

test('readFileText reports an unavailable read capability instead of opening the menu', async () => {
  const { readFileText, isUnavailable } = exports
  const rejected = await readFileText({}, 's1', '/w/a.txt', new AbortController().signal).catch(
    (error) => error,
  )
  assert.equal(isUnavailable(rejected), true, 'no workspaceFiles means the menu degrades')
})

test('readFileText refuses a file that is larger than the limit', async () => {
  const { readFileText, isUnavailable, COPY_LIMIT_BYTES } = exports
  // 窗口读到「上限 + 1」字节且 `eof` 仍为 false：文件比允许的上限更大。
  const data = new Uint8Array(COPY_LIMIT_BYTES + 1)
  const remote = {
    workspaceFiles: filesRemote(async () => ({
      ok: true,
      value: { offset: 0, data, eof: false, absolutePath: '/w/big.bin', version: 'v1' },
    })),
  }
  const rejected = await readFileText(remote, 's1', '/w/big.bin', new AbortController().signal).catch(
    (error) => error,
  )
  assert.match(rejected.message, /larger than/u)
  assert.equal(isUnavailable(rejected), false, 'this is a real failure, not a missing capability')
})

// ---- 保存通道 ----

test('beginSave falls back to the download channel when no native picker exists', async () => {
  const { beginSave } = exports
  // Node 里没有 `window.showSaveFilePicker`，也没有 `document`：必须先拿到一个
  // 可用的通道（而不是在这里就抛错），真正的 DOM 触碰留到 `write` 之后。
  const saver = await beginSave('a.txt')
  assert.equal(typeof saver.write, 'function')
})

test('beginSave reports a cancelled picker as cancelled rather than failed', async () => {
  const { beginSave, isCancelled } = exports
  const abort = Object.assign(new Error('user aborted'), { name: 'AbortError' })
  window.showSaveFilePicker = async () => Promise.reject(abort)
  try {
    const rejected = await beginSave('a.txt').catch((error) => error)
    assert.equal(isCancelled(rejected), true)
  } finally {
    delete window.showSaveFilePicker
  }
})

test('beginSave writes through the native picker and only commits on close', async () => {
  const { beginSave } = exports
  const steps = []
  window.showSaveFilePicker = async (options) => {
    steps.push(['pick', options.suggestedName])
    return {
      createWritable: async () => ({
        write: async (blob) => {
          steps.push(['write', blob.size])
        },
        close: async () => {
          steps.push(['close'])
        },
      }),
    }
  }
  try {
    const saver = await beginSave('a.txt')
    assert.deepEqual(steps, [['pick', 'a.txt']], 'the dialog comes before any bytes are read')
    assert.equal(await saver.write(new Uint8Array([1, 2, 3])), 'dialog')
    assert.deepEqual(steps, [['pick', 'a.txt'], ['write', 3], ['close']])
  } finally {
    delete window.showSaveFilePicker
  }
})

test('beginSave degrades to the download channel when the picker is refused', async () => {
  const { beginSave } = exports
  window.showSaveFilePicker = async () => {
    throw new Error('cross-origin frame')
  }
  try {
    const saver = await beginSave('a.txt')
    assert.equal(typeof saver.write, 'function', 'a refused picker must not break 另存为')
  } finally {
    delete window.showSaveFilePicker
  }
})

// ---- 错误文案 ----

test('messageOf reads the host message out of a Remote failure', () => {
  const { messageOf } = exports
  assert.equal(messageOf(new Error('disk on fire'), 'fallback'), 'disk on fire')
  assert.equal(messageOf('plain string', 'fallback'), 'plain string')
  assert.equal(messageOf(undefined, 'fallback'), 'fallback')
  assert.equal(messageOf(new Error(''), 'fallback'), 'fallback')
  // 空消息的 Remote 失败应由调用方换成 fallback，而不是显示空白。
  assert.equal(messageOf({ ok: false, error: { code: 'x', message: '' } }, 'fallback'), 'fallback')
})
