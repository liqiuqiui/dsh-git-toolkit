/**
 * 浏览器侧测试：在 Node 里用最小 loader 壳加载**真实产物** `lib/client.js`。
 *
 * 这里不模拟 DOM，也不做完整渲染 —— 只验证三件在重构中最容易静默坏掉的事：
 *
 *   1. 产物外壳正确：`window.__ModuleLoader__.load({ id, factory })`，id 是
 *      `dsh-toolkit`，且真的导出了 `apply`；
 *   2. `apply` 只依赖注入的服务：没有 `configForms` 时它照样跑完并注册各功能的
 *      槽位，但**不**注册详情页开关区块；有 `configForms` 时才解析 namespace
 *      并注册以包名为键的区块；
 *   3. 开关是运行时读取的：同一个已注册的槽位组件，在关掉功能后渲染为空。
 *
 * React 用一个只实现被用到 API 的桩代替（`createElement` / `Fragment` /
 * `useState` / `useSyncExternalStore`），因此无需安装 React。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** 记录创建的虚拟节点，方便断言渲染结果。 */
function createElement(type, props, ...children) {
  return { type, props: props ?? {}, children }
}

/** 存根 React：hook 以「单次调用」语义实现，足够渲染函数组件。 */
const React = {
  Fragment: Symbol('Fragment'),
  createElement,
  // 每个组件实例只渲染一次，因此 hook 状态用一次性的槽位即可。
  useState: (initial) => {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, () => {}]
  },
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

/**
 * 在 Node 里执行产物，返回它的 `module.exports`。
 * @param path - 产物路径。
 * @returns loader 收到的 id、factory 产物，以及 `require` 收到的模块名。
 */
function loadBundle(path) {
  const source = readFileSync(path, 'utf8')
  const requires = []
  let captured
  const window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        captured = { id, factory }
      },
    },
  }
  const require = (name) => {
    requires.push(name)
    if (name === 'react') return React
    if (name === 'react-dom') return { createPortal: (children) => children }
    throw new Error(`unexpected require at runtime: ${name}`)
  }
  // 产物是 classic script：用 vm 语义执行，作用域里提供 window 与 require。
  new Function('window', 'require', source)(window, require)
  assert.ok(captured !== undefined, 'the bundle called __ModuleLoader__.load')
  return { id: captured.id, exports: captured.factory(require), requires }
}

/**
 * 装配一份最小浏览器上下文，记录每一次注册。
 * @param options.services - 本「部署」实际提供的服务；缺某个服务时它就不在子上下文里。
 */
function mockContext({ configForms, services } = {}) {
  const registrations = []
  const locales = []
  const effects = []
  const injectCalls = []
  const table = { ...(services ?? {}) }
  if (configForms !== undefined) table.configForms = configForms
  const ctx = {
    slots: {
      inject(name, callback) {
        return callback({ getVersion: () => 0, entries: () => [], subscribe: () => () => {} })
      },
      register(options, component) {
        registrations.push({ options, component })
        return () => {}
      },
    },
    locale: {
      register(namespace, dictionaries) {
        locales.push({ namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        return (key) => `${namespace}:${key}`
      },
    },
    effect(fn, label) {
      effects.push(label)
      return fn()
    },
  }
  if (Object.keys(table).length > 0) {
    // 真实宿主把服务挂成同名属性；这里只交出被请求且确实存在的那些。
    ctx.inject = (keys, callback) => {
      injectCalls.push([...keys])
      const picked = {}
      for (const key of keys) if (key in table) picked[key] = table[key]
      callback({ ...ctx, ...picked })
    }
  }
  return { ctx, registrations, locales, effects, injectCalls }
}

/** 一份只读的设置服务桩：镜像立即给出本插件的 namespace。 */
function mockConfigForms({ namespace = 'dsh-toolkit', value = { gitBranch: true } } = {}) {
  const mirrorListeners = new Set()
  const formListeners = new Set()
  const writes = []
  const form = {
    getSnapshot: () => ({ status: 'ready', value, writable: true, revision: 0 }),
    subscribe(listener) {
      formListeners.add(listener)
      return () => formListeners.delete(listener)
    },
    async set(key, next) {
      writes.push([key, next])
      value = { ...value, [key]: next }
      for (const listener of formListeners) listener()
      return true
    },
  }
  return {
    writes,
    form,
    mirrorListeners,
    get: (ns) => {
      assert.equal(ns, namespace)
      return form
    },
    describe: () => ({
      getSnapshot: () => ({ view: { namespaces: [{ ns: namespace, value }] } }),
      subscribe(listener) {
        mirrorListeners.add(listener)
        return () => mirrorListeners.delete(listener)
      },
    }),
    whileServed: (_names, register) => register(),
  }
}

// 用 fileURLToPath 而不是 URL.pathname：后者在 Windows 上会留下前导斜杠
// （`/C:/...`），readFileSync 会把它当成当前盘符下的相对路径。
const BUNDLE = fileURLToPath(new URL('../lib/client.js', import.meta.url))

/**
 * `apply` 在**带设置服务**时注册的总数：各功能的槽位占用者 + 那个开关区块。
 *
 * 每个功能注册自己的若干占用者，因此这个数字随功能数增长：断言它等于一个常量
 * 而不是「当下这几次注册」，才能真正抓到「开关变化引起了注册表抖动」。
 * 无设置服务时的占用者清单由下面那条测试逐项列出，不依赖这个数字。
 */
const EXPECTED_REGISTRATIONS = 7

test('the bundle registers itself with the toolkit id and exports apply', () => {
  const { id, exports, requires } = loadBundle(BUNDLE)
  assert.equal(id, 'dsh-toolkit')
  assert.equal(exports.name, 'dsh-toolkit')
  assert.equal(typeof exports.apply, 'function')
  // 三个 import 全部来自 loader 的静态模块白名单，一个都不能打进产物：
  // `react` / `react-dom` 打进来会产生第二份实例，primitives 会拖进整棵宿主 UI。
  assert.deepEqual(
    requires,
    ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
    'only loader-provided modules are required at runtime',
  )
  assert.deepEqual(exports.inject, ['slots', 'locale'])
})

test('the bundle never inlines the host markdown renderer', () => {
  const source = readFileSync(BUNDLE, 'utf8')
  // primitives 是宿主提供的整棵 UI 依赖树；被打进产物会让 bundle 膨胀几 MB，
  // 并且出现第二份 markdown 实现（class 名与宿主不一致，浮窗排版就会跑偏）。
  assert.equal(
    /function MarkdownText\b/.test(source),
    false,
    'the markdown renderer must stay in the host bundle',
  )
  // 只保留一次字面量引用（模块名），而不是它的实现。
  const mentions = source.match(/@deepseek-ai\/dsh-client-ui-primitives/g) ?? []
  assert.ok(mentions.length <= 3, `only the module id is mentioned, found ${mentions.length}`)
})

test('without a settings service the features still mount, the toggle section does not', () => {
  const { exports } = loadBundle(BUNDLE)
  const { ctx, registrations, locales } = mockContext()
  exports.apply(ctx)

  // 断言 id 而不是只断言 slot 名：多个功能会共享同一个 slot
  // （`conversation.input.left` 与 `shell.overlay` 各被两个功能占用），只比名字
  // 会让「谁占了哪个」这层信息丢掉。
  const occupied = registrations
    .map((entry) => `${entry.options.name} · ${entry.options.id}`)
    .sort()
  assert.deepEqual(occupied, [
    'conversation.hero.options · toolkit-git-branch',
    'conversation.input.left · toolkit-file-menu-session',
    'conversation.input.left · toolkit-git-branch-badge',
    'conversation.input.overlay · toolkit-message-quote',
    'shell.overlay · toolkit-file-menu',
    'shell.overlay · toolkit-git-branch-popover',
  ])
  assert.ok(
    !registrations.some((entry) => entry.options.name === 'plugins.bundle.config'),
    'no settings service means no toggle section',
  )
  const namespaces = locales.map((entry) => entry.namespace).sort()
  assert.deepEqual(namespaces, [
    'dsh-toolkit',
    'dsh-toolkit/file-menu',
    'dsh-toolkit/git-branch',
    'dsh-toolkit/message-quote',
  ])
})

test('with a settings service the toggle section is keyed by the package name', () => {
  const { exports } = loadBundle(BUNDLE)
  const configForms = mockConfigForms()
  const { ctx, registrations, locales } = mockContext({ configForms })
  exports.apply(ctx)

  const section = registrations.find((entry) => entry.options.name === 'plugins.bundle.config')
  assert.ok(section !== undefined, 'the detail-page section is registered')
  assert.equal(section.options.key, 'dsh-toolkit')
  assert.equal(section.options.locale, 'dsh-toolkit')
  assert.ok(
    !('id' in section.options) || section.options.id === undefined,
    'keyed slots use key, not id',
  )
  // 区块的 `t` 必须绑定到本插件的命名空间，而不是某个功能的命名空间。
  assert.ok(locales.some((entry) => entry.namespace === 'dsh-toolkit'))
})

test('a disabled feature renders nothing through its occupied slot', () => {
  const { exports } = loadBundle(BUNDLE)
  // 关掉**每一个**功能：这条断言要覆盖所有占用者，任何一个漏关都会在这里暴露。
  const configForms = mockConfigForms({ value: { gitBranch: false, messageQuote: false, fileMenu: false } })
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)

  for (const { options, component } of registrations) {
    if (options.name === 'plugins.bundle.config') continue
    const tree = component({ t: (key) => key, useXxx: () => undefined })
    assert.equal(tree, null, `${options.id} renders nothing while its feature is off`)
  }
})

test('turning a feature back on renders it again without re-registering', async () => {
  const { exports } = loadBundle(BUNDLE)
  let value = { gitBranch: false }
  const formListeners = new Set()
  const form = {
    getSnapshot: () => ({ status: 'ready', value, writable: true, revision: 0 }),
    subscribe(listener) {
      formListeners.add(listener)
      return () => formListeners.delete(listener)
    },
    set: async () => true,
  }
  const configForms = {
    get: () => form,
    describe: () => ({
      getSnapshot: () => ({ view: { namespaces: [{ ns: 'dsh-toolkit', value }] } }),
      subscribe: () => () => {},
    }),
  }
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)

  const badge = registrations.find((entry) => entry.options.name === 'conversation.input.left')
  assert.ok(badge !== undefined)
  assert.equal(badge.component({ t: (key) => key }), null, 'starts hidden')

  // 开关翻转：卷展（volatile）写入只更新 store，不重跑 apply，槽位注册保持不变。
  value = { gitBranch: true }
  for (const listener of formListeners) listener()
  assert.equal(registrations.length, EXPECTED_REGISTRATIONS, 'no re-registration happened')
  assert.notEqual(badge.component({ t: (key) => key }), null, 'the badge is back')
})

/** 把虚拟节点树摊平成节点列表（函数组件就地求值）。 */
function flatten(node, out = []) {
  if (node === null || node === undefined || node === false) return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node === 'string' || typeof node === 'number') return out
  if (typeof node.type === 'function') {
    flatten(node.type(node.props), out)
    return out
  }
  out.push(node)
  for (const child of node.children) flatten(child, out)
  return out
}

test('the toggle section lists every declared feature and writes through the form', async () => {
  const { exports } = loadBundle(BUNDLE)
  const configForms = mockConfigForms({ value: { gitBranch: true } })
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)

  const section = registrations.find((entry) => entry.options.name === 'plugins.bundle.config')
  const t = (key) => key
  const nodes = flatten(section.component({ t }))

  const text = nodes.filter((node) => typeof node.type === 'string').map((node) => node.children[0])
  assert.ok(text.includes('toolkit.sectionTitle'), 'the section has a heading')
  assert.ok(text.includes('gitBranch.title'), 'the row shows the declared title key')
  assert.ok(text.includes('gitBranch.description'), 'the row shows the declared description key')

  const input = nodes.find((node) => node.type === 'input')
  assert.ok(input !== undefined, 'the row has a checkbox')
  assert.equal(input.props.type, 'checkbox')
  assert.equal(input.props.checked, true)
  assert.equal(input.props.disabled, false)

  input.props.onChange({ currentTarget: { checked: false } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(configForms.writes, [['gitBranch', false]], 'the click is written to the form')
})

test('the toggle section disables its controls while the form is not writable', () => {
  const { exports } = loadBundle(BUNDLE)
  const form = {
    getSnapshot: () => ({ status: 'loading', writable: false, revision: 0 }),
    subscribe: () => () => {},
    set: async () => false,
  }
  const configForms = {
    get: () => form,
    describe: () => ({
      getSnapshot: () => ({ view: { namespaces: [{ ns: 'dsh-toolkit', value: { gitBranch: true } }] } }),
      subscribe: () => () => {},
    }),
  }
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)

  const section = registrations.find((entry) => entry.options.name === 'plugins.bundle.config')
  const nodes = flatten(section.component({ t: (key) => key }))
  const input = nodes.find((node) => node.type === 'input')
  assert.equal(input.props.disabled, true)
  const text = nodes.filter((node) => typeof node.type === 'string').map((node) => node.children[0])
  assert.ok(text.includes('toolkit.status.loading'), 'the loading note is shown')
})

test('a namespace that is not this plugin is never claimed', () => {
  const { exports } = loadBundle(BUNDLE)
  const configForms = {
    get: () => {
      throw new Error('must not mount a foreign namespace')
    },
    describe: () => ({
      getSnapshot: () => ({ view: { namespaces: [{ ns: 'someone-else', value: { other: true } }] } }),
      subscribe: () => () => {},
    }),
  }
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)
  assert.ok(
    !registrations.some((entry) => entry.options.name === 'plugins.bundle.config'),
    'no section for a foreign namespace',
  )
})

test('toggling a feature off in the section hides its controls immediately', async () => {
  const { exports } = loadBundle(BUNDLE)
  const configForms = mockConfigForms({ value: { gitBranch: true } })
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)

  const section = registrations.find((entry) => entry.options.name === 'plugins.bundle.config')
  const badge = registrations.find((entry) => entry.options.name === 'conversation.input.left')
  const t = (key) => key

  assert.notEqual(badge.component({ t }), null, 'visible while the feature is on')

  const nodes = flatten(section.component({ t }))
  const input = nodes.find((node) => node.type === 'input')
  input.props.onChange({ currentTarget: { checked: false } })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.deepEqual(configForms.writes, [['gitBranch', false]])
  assert.equal(badge.component({ t }), null, 'the badge is gone without re-registering')
  assert.equal(registrations.length, EXPECTED_REGISTRATIONS, 'the slot registry did not churn')
})

test('a rejected write rolls the switch back to the host value', async () => {
  const { exports } = loadBundle(BUNDLE)
  const configForms = mockConfigForms({ value: { gitBranch: true } })
  // 让设置文档拒绝这次写入（例如只读部署），store 应当回退而不是停在乐观值上。
  configForms.form.set = async () => false
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)

  const section = registrations.find((entry) => entry.options.name === 'plugins.bundle.config')
  const input = () => flatten(section.component({ t: (key) => key })).find((node) => node.type === 'input')

  input().props.onChange({ currentTarget: { checked: false } })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(input().props.checked, true, 'the switch shows the host value again')
})

test('a malformed settings value falls back to the declared defaults', () => {
  const { exports } = loadBundle(BUNDLE)
  const configForms = mockConfigForms({ value: { gitBranch: 'definitely-not-a-boolean' } })
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)

  const section = registrations.find((entry) => entry.options.name === 'plugins.bundle.config')
  const input = flatten(section.component({ t: (key) => key })).find((node) => node.type === 'input')
  assert.equal(input.props.checked, true, 'the default is used instead of the junk value')
})

/** 收集 `console.error`，返回恢复函数。 */
function captureConsoleError() {
  const messages = []
  const original = console.error
  console.error = (...args) => messages.push(args.map(String).join(' '))
  return { messages, restore: () => { console.error = original } }
}

/** 一个只声明、不做事的注册表项。 */
function fakeEntry(id, register) {
  return {
    id,
    configKey: id,
    feature: { id, locale: { zh: {}, en: {} }, register },
  }
}

test('a feature that throws does not stop the others', () => {
  const { exports } = loadBundle(BUNDLE)
  const { ctx, registrations } = mockContext({ services: { configForms: mockConfigForms() } })
  const capture = captureConsoleError()
  try {
    exports.applyClientFeatures(ctx, [
      fakeEntry('broken', () => {
        throw new Error('boom')
      }),
      fakeEntry('healthy', (feature) => {
        feature.occupy('test.slot', { id: 'healthy-slot' }, () => null)
      }),
      fakeEntry('also-broken', () => {
        throw new Error('bang')
      }),
    ])
  } finally {
    capture.restore()
  }

  assert.ok(
    registrations.some((entry) => entry.options.id === 'healthy-slot'),
    'the healthy feature still mounted',
  )
  assert.ok(
    capture.messages.some((line) => line.includes('broken') && line.includes('boom')),
    'the failure was reported',
  )
  assert.ok(
    capture.messages.some((line) => line.includes('also-broken')),
    'every broken feature is reported, not just the first',
  )
})

test('whenService runs only for the feature that asked, and only if the service exists', () => {
  const { exports } = loadBundle(BUNDLE)
  const sessions = { get: () => undefined }
  const seen = []

  // 服务存在：回调拿到服务本体。
  {
    const { ctx } = mockContext({ services: { sessions } })
    exports.applyClientFeatures(ctx, [
      fakeEntry('needs-sessions', (feature) => {
        feature.whenService('sessions', (service) => seen.push(['ok', service]))
      }),
    ])
  }

  // 服务缺失（子上下文里没有这一项）：回调不运行，也不抛错。
  {
    const { ctx } = mockContext({ services: { somethingElse: {} } })
    exports.applyClientFeatures(ctx, [
      fakeEntry('needs-sessions', (feature) => {
        feature.whenService('sessions', () => seen.push(['unexpected']))
      }),
    ])
  }

  // 宿主根本没有 inject：同样静默跳过。
  {
    const { ctx } = mockContext()
    exports.applyClientFeatures(ctx, [
      fakeEntry('needs-sessions', (feature) => {
        feature.whenService('sessions', () => seen.push(['unexpected']))
      }),
    ])
  }

  assert.deepEqual(seen, [['ok', sessions]])
})

test('a throwing whenService callback is contained to its own feature', () => {
  const { exports } = loadBundle(BUNDLE)
  const { ctx, registrations } = mockContext({ services: { sessions: {} } })
  const capture = captureConsoleError()
  try {
    exports.applyClientFeatures(ctx, [
      fakeEntry('explodes', (feature) => {
        feature.whenService('sessions', () => {
          throw new Error('service blew up')
        })
      }),
      fakeEntry('survivor', (feature) => {
        feature.occupy('test.slot', { id: 'survivor-slot' }, () => null)
      }),
    ])
  } finally {
    capture.restore()
  }
  assert.ok(registrations.some((entry) => entry.options.id === 'survivor-slot'))
  assert.ok(capture.messages.some((line) => line.includes('service blew up')))
})

// ---------------------------------------------------------------------------
// message-quote：引用块格式、选区判定、两条插入通道的降级顺序。
//
// 这些都是纯函数或只依赖结构化桩，因此不需要 DOM，也不需要渲染组件：
// 产物把 `buildQuoteBlock` / `shouldOffer` / `insertQuote` / `placeMenu` 一并导出
// 正是为了能这样测。
// ---------------------------------------------------------------------------

/**
 * 造一个只实现 `serialize.ts` 所需成员的假元素。
 *
 * 序列化器刻意只依赖 `nodeType` / `childNodes` / `tagName` / `classList` /
 * `matches` / `getAttribute`，因此不必为了测它引入一整套 DOM。
 * @param tag - 标签名。
 * @param attrs - 属性、类名与 `data-*` 标记。
 * @param children - 子节点。
 * @returns 假元素节点。
 */
function fakeElement(tag, attrs = {}, ...children) {
  const className = attrs.class ?? ''
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    childNodes: children,
    className,
    getAttribute: (name) => attrs[name] ?? null,
    classList: { contains: (name) => className.split(/\s+/).includes(name) },
    matches: (selector) => selector.split(',').map((part) => part.trim()).some((part) =>
      part.startsWith('[')
        ? attrs[part.slice(1, -1)] !== undefined
        : tag.toUpperCase() === part.toUpperCase()),
  }
}

/**
 * 造一个假文本节点。
 * @param data - 文本内容。
 * @returns 假文本节点。
 */
function fakeText(data) {
  return { nodeType: 3, data }
}

/**
 * 造一个宿主代码块：`md-code-block` 外壳，语言在工具栏的 `infostring` 里。
 * @param lang - 语言标识。
 * @param code - 源码。
 * @returns 假代码块元素。
 */
function fakeCodeBlock(lang, code) {
  return fakeElement('div', { class: 'md-code-block' },
    fakeElement('div', { 'data-code-block-banner': '' },
      fakeElement('span', { class: 'infostring' }, fakeText(lang))),
    fakeElement('div', { 'data-code-block-content': '' },
      fakeElement('pre', {}, fakeElement('code', {}, fakeText(code)))))
}

test('the serializer keeps inline code and emphasis that toString() would drop', () => {
  const { exports } = loadBundle(BUNDLE)
  // 这正是截图里的那句：`lib/client.js` 是行内代码，纯文本会把反引号丢掉。
  const dom = fakeElement('div', {},
    fakeElement('p', {},
      fakeText('刷新页面即可。重点看 '),
      fakeElement('code', {}, fakeText('lib/client.js')),
      fakeText(' 已更新，'),
      fakeElement('strong', {}, fakeText('刷新页面')),
      fakeText('即可。')))
  assert.equal(
    exports.serializeElement(dom),
    '刷新页面即可。重点看 `lib/client.js` 已更新，**刷新页面**即可。',
  )
})

test('the serializer turns a host code block back into a fenced block', () => {
  const { exports } = loadBundle(BUNDLE)
  const dom = fakeElement('div', {}, fakeCodeBlock('bash', 'pnpm run build\nnode --test'))
  assert.equal(exports.serializeElement(dom), '```bash\npnpm run build\nnode --test\n```')
})

test('the serializer skips the code block toolbar but keeps its language', () => {
  const { exports } = loadBundle(BUNDLE)
  // 复制的按钮文案绝不能混进引用正文；语言标识要从工具栏里读出来。
  const dom = fakeElement('div', {},
    fakeElement('div', { class: 'md-code-block' },
      fakeElement('div', { 'data-code-block-banner': '' }, fakeElement('button', {}, fakeText('复制'))),
      fakeElement('div', { 'data-code-block-content': '' },
        fakeElement('pre', {}, fakeElement('code', {}, fakeText('echo hi'))))))
  assert.equal(exports.serializeElement(dom), '```\necho hi\n```')
})

test('the serializer widens the fence when the code itself contains backticks', () => {
  const { exports } = loadBundle(BUNDLE)
  // 用三个反引号会把围栏提前闭合，必须按内容里的最长反引号串加宽。
  const dom = fakeElement('div', {}, fakeCodeBlock('md', '```js\ncode\n```'))
  assert.equal(exports.serializeElement(dom), '````md\n```js\ncode\n```\n````')
})

test('the serializer renders lists, headings, links and quotes', () => {
  const { exports } = loadBundle(BUNDLE)
  assert.equal(
    exports.serializeElement(fakeElement('div', {},
      fakeElement('h2', {}, fakeText('做法')),
      fakeElement('ul', {}, fakeElement('li', {}, fakeText('第一项')), fakeElement('li', {}, fakeText('第二项'))),
      fakeElement('p', {}, fakeText('见 '), fakeElement('a', { href: 'https://x.dev' }, fakeText('文档'))))),
    '## 做法\n\n- 第一项\n- 第二项\n\n见 [文档](https://x.dev)',
  )
  assert.equal(
    exports.serializeElement(fakeElement('div', {}, fakeElement('ol', {},
      fakeElement('li', {}, fakeText('甲')), fakeElement('li', {}, fakeText('乙'))))),
    '1. 甲\n2. 乙',
  )
})

test('the serializer restores the full path of a file reference', () => {
  const { exports } = loadBundle(BUNDLE)
  // 宿主把本地文件链接渲染成 `<button class="fileMention fileLink" title="完整路径">`
  // 而只显示短名字。引用若只抄可见文字，路径就丢了 —— 这正是实测发现的问题。
  const mention = fakeElement('button',
    { class: 'fileMention fileLink', title: 'src/client/features/message-quote/serialize.ts' },
    fakeText('serialize.ts'))
  assert.equal(
    exports.serializeElement(fakeElement('div', {},
      fakeElement('p', {}, fakeText('新增 '), mention, fakeText('，在捕获时遍历。')))),
    '新增 `src/client/features/message-quote/serialize.ts`，在捕获时遍历。',
  )
})

test('the serializer prefers the visible text when it already is a path', () => {
  const { exports } = loadBundle(BUNDLE)
  // 行内代码形态的引用：可见文字本身就是路径时不要用 title 覆盖它。
  const mention = fakeElement('button',
    { class: 'fileMention', title: 'C:/other/place/file.ts' },
    fakeText('src/client/features/message-quote/serialize.ts'))
  assert.equal(
    exports.serializeElement(fakeElement('div', {}, mention)),
    '`src/client/features/message-quote/serialize.ts`',
  )
})

test('the serializer never turns UI prose into a file path', () => {
  const { exports } = loadBundle(BUNDLE)
  // title 里也可能是「打开该文件」这类提示文案，不能被当成路径。这时要保持
  // 原有的格式：行内代码形态仍是行内代码。
  const inlineMention = fakeElement('button',
    { class: 'fileMention', title: '打开该文件' },
    fakeText('serialize.ts'))
  assert.equal(exports.serializeElement(fakeElement('div', {}, inlineMention)), '`serialize.ts`')

  const linkMention = fakeElement('button',
    { class: 'fileMention fileLink', title: '打开该文件' },
    fakeText('serialize.ts'))
  assert.equal(exports.serializeElement(fakeElement('div', {}, linkMention)), 'serialize.ts')
})

test('the serializer finds a file reference nested inside inline code', () => {
  const { exports } = loadBundle(BUNDLE)
  // 这是用户实测到的那一种：宿主的行内代码形态是
  // `<code><button class="fileMention" title="完整路径">短名</button></code>`。
  // 若 `<code>` 分支直接取纯文本，按钮里的 title 永远读不到，路径就丢了 ——
  // 表现正是引用里出现一个没有反引号的裸短名。
  const mention = fakeElement('button',
    { class: 'fileMention', title: 'src/client/features/message-quote/serialize.ts', 'aria-label': '打开 serialize.ts' },
    fakeElement('svg', {}),
    fakeText('serialize.ts'))
  assert.equal(
    exports.serializeElement(fakeElement('div', {},
      fakeElement('p', {}, fakeText('新增 '), fakeElement('code', {}, mention), fakeText('，在捕获时')))),
    '新增 `src/client/features/message-quote/serialize.ts`，在捕获时',
  )
})

test('the serializer ignores the prose aria-label in favour of the path title', () => {
  const { exports } = loadBundle(BUNDLE)
  // 宿主给行内代码引用准备的 `title` 是路径、`aria-label` 是界面文案
  // （`t("presented.previewButton", {name})`）。必须选中前者。
  const mention = fakeElement('button',
    { class: 'fileMention', title: 'src/a.ts', 'aria-label': '打开 a.ts' },
    fakeText('a.ts'))
  assert.equal(exports.serializeElement(fakeElement('div', {}, mention)), '`src/a.ts`')
})

test('the serializer does not mistake a plain code span for a file reference', () => {
  const { exports } = loadBundle(BUNDLE)
  // 没有 fileMention 标记的普通行内代码不能被当成文件引用。
  assert.equal(
    exports.serializeElement(fakeElement('div', {}, fakeElement('code', {},
      fakeText('range.cloneContents()')))),
    '`range.cloneContents()`',
  )
})

test('the serializer keeps both label and path when they disagree', () => {
  const { exports } = loadBundle(BUNDLE)
  // 链接文字不是文件名时（`[文档](src/x.ts)`），两个信息都不能丢。
  const mention = fakeElement('button',
    { class: 'fileMention fileLink', title: 'src/client/x.ts' },
    fakeText('文档'))
  assert.equal(exports.serializeElement(fakeElement('div', {}, mention)), '[文档](src/client/x.ts)')
})

test('the serializer keeps code block toolbars out of the quote', () => {
  const { exports } = loadBundle(BUNDLE)
  // 工具栏按钮不再整体跳过（文件引用也是 button），但工具栏容器仍然整棵跳过，
  // 所以「复制」这类文案不会混进引用正文。
  const dom = fakeElement('div', {},
    fakeElement('div', { class: 'md-code-block' },
      fakeElement('div', { 'data-code-block-banner': '' },
        fakeElement('span', { class: 'infostring' }, fakeText('bash')),
        fakeElement('button', {}, fakeText('复制'))),
      fakeElement('div', { 'data-code-block-content': '' },
        fakeElement('pre', {}, fakeElement('code', {}, fakeText('pnpm run build'))))))
  assert.equal(exports.serializeElement(dom), '```bash\npnpm run build\n```')
})

test('the serializer keeps the content of elements it does not recognise', () => {
  const { exports } = loadBundle(BUNDLE)
  // 丢掉格式可以接受，丢掉内容不行。
  assert.equal(
    exports.serializeElement(fakeElement('div', {}, fakeElement('figure', {},
      fakeElement('p', {}, fakeText('图注内容'))))),
    '图注内容',
  )
})

test('a quote built from Markdown survives the round trip into the sent message', () => {
  const { exports } = loadBundle(BUNDLE)
  // 序列化 → 引用块 → 解析回显示层。中间任何一步把格式吃掉，chips 与浮窗就退回纯文本。
  const markdown = exports.serializeElement(fakeElement('div', {},
    fakeElement('p', {}, fakeText('先看 '), fakeElement('code', {}, fakeText('lib/client.js'))),
    fakeCodeBlock('bash', 'pnpm run build')))
  const block = exports.buildQuoteBlock(markdown, { turn: 6 })
  const parsed = exports.parseQuoteBlock(block)
  assert.notEqual(parsed, undefined)
  assert.equal(parsed.turn, 6)
  assert.equal(parsed.truncated, false)
  assert.equal(parsed.body, markdown, 'the body comes back byte for byte')
})

test('truncating inside a code block closes the fence instead of swallowing the rest', () => {
  const { exports } = loadBundle(BUNDLE)
  // 未闭合的围栏会让渲染器把截断提示一起吞进代码块，浮窗显示就完全错了。
  const block = exports.buildQuoteBlock(`\`\`\`bash\n${'echo line\n'.repeat(400)}`, { turn: 7, limit: 200 })
  const fences = (block.match(/^> ```/gm) ?? []).length
  assert.equal(fences % 2, 0, 'fences must stay paired')
  assert.ok(block.includes('引用已截断'), 'the truncation note survives the extra fence')
})

test('buildQuoteBlock emits a readable Markdown quote with an optional turn', () => {
  const { exports } = loadBundle(BUNDLE)
  const withTurn = exports.buildQuoteBlock('并发写入冲突', { turn: 3 })
  assert.equal(withTurn, '> **引用自第 3 轮**\n>\n> 并发写入冲突')

  const noTurn = exports.buildQuoteBlock('并发写入冲突')
  assert.equal(noTurn, '> **引用内容**\n>\n> 并发写入冲突')
  assert.ok(!noTurn.includes('quoted-message'), 'no transport XML leaks into rendered chat text')
})

test('buildQuoteBlock trims the selection but keeps inner whitespace', () => {
  const { exports } = loadBundle(BUNDLE)
  const block = exports.buildQuoteBlock('  第一行\n\n  第二行  ', {})
  assert.ok(block.includes('> 第一行\n> \n>   第二行'), 'ends trimmed, inner text untouched')
})

test('buildQuoteBlock truncates and says so instead of silently cutting', () => {
  const { exports } = loadBundle(BUNDLE)
  const long = 'x'.repeat(50)
  const block = exports.buildQuoteBlock(long, { limit: 10 })
  assert.ok(block.includes('原文共 50 字，引用已截断'), 'the quote is marked incomplete')
  assert.ok(block.includes('> xxxxxxxxxx'), 'only the first `limit` characters remain')
  assert.ok(!block.includes('x'.repeat(11)))
})

test('parseQuoteBlock recovers the block a sent message carries, turn and all', () => {
  const { exports } = loadBundle(BUNDLE)
  const block = exports.buildQuoteBlock('第一行\n第二行', { turn: 7 })
  const parsed = exports.parseQuoteBlock(block)
  assert.ok(parsed !== undefined, 'a fresh quote block must parse back')
  assert.equal(parsed.turn, 7)
  assert.equal(parsed.body, '第一行\n第二行', 'the `> ` prefixes are stripped again')
  assert.equal(parsed.truncated, false)
  assert.equal(parsed.start, 0)
  assert.equal(parsed.end, block.length, 'the block spans the whole text when it is alone')
})

test('parseQuoteBlock keeps the turn optional for the no-turn header', () => {
  const { exports } = loadBundle(BUNDLE)
  const parsed = exports.parseQuoteBlock(exports.buildQuoteBlock('无轮次'))
  assert.ok(parsed !== undefined)
  assert.equal(parsed.turn, undefined)
  assert.equal(parsed.body, '无轮次')
})

test('parseQuoteBlock reports truncation with the original length', () => {
  const { exports } = loadBundle(BUNDLE)
  const block = exports.buildQuoteBlock('x'.repeat(50), { limit: 10 })
  const parsed = exports.parseQuoteBlock(block)
  assert.ok(parsed !== undefined)
  assert.equal(parsed.truncated, true)
  assert.equal(parsed.total, 50)
  assert.equal(parsed.body, 'x'.repeat(10), 'the truncation note is not part of the body')
})

test('parseQuoteBlock finds a block that sits among ordinary paragraphs', () => {
  const { exports } = loadBundle(BUNDLE)
  const quote = exports.buildQuoteBlock('被引用的句子', { turn: 2 })
  const message = `请参考这段：\n${quote}\n然后继续。`
  const parsed = exports.parseQuoteBlock(message)
  assert.ok(parsed !== undefined)
  assert.equal(parsed.turn, 2)
  assert.equal(parsed.body, '被引用的句子')
  assert.equal(message.slice(parsed.start, parsed.end), `${quote}\n`,
    'the span is the block plus the boundary newline it owns')
})

test('parseQuoteBlock tolerates several blocks and honours the `from` cursor', () => {
  const { exports } = loadBundle(BUNDLE)
  const first = exports.buildQuoteBlock('甲', { turn: 1 })
  const second = exports.buildQuoteBlock('乙', { turn: 2 })
  const message = `${first}\n中间\n${second}`

  const one = exports.parseQuoteBlock(message)
  assert.ok(one !== undefined)
  assert.equal(one.body, '甲')

  const two = exports.parseQuoteBlock(message, one.end)
  assert.ok(two !== undefined, 'a second quote must be discoverable after the first')
  assert.equal(two.body, '乙')
  assert.equal(two.turn, 2)
})

test('parseQuoteBlock ignores `> **` that is not at the start of a line', () => {
  const { exports } = loadBundle(BUNDLE)
  assert.equal(exports.parseQuoteBlock('普通文字 > **引用自第 1 轮**'), undefined)
  assert.equal(exports.parseQuoteBlock('> **不是我们写的标题**'), undefined)
  assert.equal(exports.parseQuoteBlock(''), undefined)
  assert.equal(exports.parseQuoteBlock('没有任何引用'), undefined)
})

test('quoteMatch declares a candidate the host can validate', () => {
  const { exports } = loadBundle(BUNDLE)
  const text = `开头\n${exports.buildQuoteBlock('正文', { turn: 5 })}`
  const match = exports.quoteMatch(text, 0)
  assert.ok(match !== undefined)
  assert.equal(match.id, exports.QUOTE_NODE_KEY, 'the node id must equal the registered rule id')
  assert.equal(match.id, 'toolkit-quote')
  assert.ok(Number.isInteger(match.start) && Number.isInteger(match.end))
  assert.ok(match.start >= 0 && match.end > match.start && match.end <= text.length)
  assert.equal(match.data.turn, 5)
  assert.equal(match.data.body, '正文')
  assert.equal(exports.QUOTE_RULE_ORDER < 1000, true, 'must run before the whitespace rules')
})

test('quoteMatch omits absent keys so re-parses compare equal', () => {
  const { exports } = loadBundle(BUNDLE)
  const match = exports.quoteMatch(exports.buildQuoteBlock('无轮次'), 0)
  assert.ok(match !== undefined)
  assert.equal('turn' in match.data, false, 'a missing turn must not appear as an explicit key')
  assert.equal('total' in match.data, false, 'a non-truncated quote has no total')
})

test('the rule satisfies the host reconcile loop, which consumes candidates in original order', () => {
  const { exports } = loadBundle(BUNDLE)
  // 复刻宿主 `UserTextDocument.reconcile` 的骨架：每轮按 cursor 取下一个候选，
  // 候选之间的空隙补原文节点。这条测试保证的是「与宿主算法兼容」，而不只是
  // 「单次调用返回好看」。
  const quote = exports.buildQuoteBlock('被引用的长句', { turn: 9 })
  const text = `前面的话\n${quote}\n后面的话`
  const nodes = []
  let cursor = 0
  while (cursor < text.length) {
    const node = exports.quoteMatch(text, cursor)
    if (node === undefined) {
      nodes.push({ id: 'text', text: text.slice(cursor) })
      cursor = text.length
      break
    }
    if (cursor < node.start) nodes.push({ id: 'text', text: text.slice(cursor, node.start) })
    nodes.push(node)
    cursor = node.end
  }

  assert.deepEqual(
    nodes.map((node) => node.id),
    ['text', 'toolkit-quote', 'text'],
    'one quote sits between two plain-text runs',
  )
  assert.equal(nodes[0].text, '前面的话\n')
  assert.equal(nodes[1].data.body, '被引用的长句')
  assert.equal(nodes[1].data.turn, 9)
  assert.equal(nodes[2].text, '后面的话', 'the paragraph after the quote is preserved')
  assert.equal(nodes.map((node) => node.text ?? text.slice(node.start, node.end)).join(''), text,
    'concatenating the nodes reproduces the message verbatim')
})

test('consecutive quotes parse back to back without swallowing the gap', () => {
  const { exports } = loadBundle(BUNDLE)
  const a = exports.buildQuoteBlock('甲', { turn: 1 })
  const b = exports.buildQuoteBlock('乙', { turn: 2 })
  const text = `${a}\n${b}`
  const first = exports.quoteMatch(text, 0)
  assert.ok(first !== undefined)
  const second = exports.quoteMatch(text, first.end)
  assert.ok(second !== undefined)
  assert.equal(first.data.body, '甲')
  assert.equal(second.data.body, '乙')
  assert.equal(first.end, second.start, 'the first chip owns the newline, so the two chips are adjacent')
})

test('shouldOffer filters collapsed, too-short, composer, and off-transcript selections', () => {
  const { exports } = loadBundle(BUNDLE)
  const ok = { collapsed: false, textLength: 5, inComposer: false, inTranscript: true, inAssistant: true }
  assert.equal(exports.shouldOffer(ok), true)
  assert.equal(exports.shouldOffer({ ...ok, collapsed: true }), false, 'a caret is not a selection')
  assert.equal(exports.shouldOffer({ ...ok, textLength: 1 }), false, 'one character is a misclick')
  assert.equal(exports.shouldOffer({ ...ok, inComposer: true }), false, 'never inside the composer')
  assert.equal(exports.shouldOffer({ ...ok, inTranscript: false }), false, 'only in the transcript')
  assert.equal(exports.shouldOffer({ ...ok, inAssistant: false }), false, 'only assistant replies are quotable')
  assert.equal(exports.MIN_LENGTH, 2)
})

test('the assistant-only rule is keyed to the host flow-kind marker', () => {
  const { exports } = loadBundle(BUNDLE)
  // 宿主的 data-chat-flow-kind 取值：user / steering / assistant-step /
  // turn-process / turn-trigger。只有 assistant-step 允许引用。
  assert.equal(exports.ASSISTANT_SELECTOR, '[data-chat-flow-kind="assistant-step"]')
  assert.equal(exports.TURN_SELECTOR, '[data-chat-turn]')
  assert.equal(exports.TRANSCRIPT_SELECTOR, '[data-chat-flow]')
})

test('placeMenu sits above the selection and flips below near the viewport top', () => {
  const { exports } = loadBundle(BUNDLE)
  const viewport = { width: 1000, height: 800 }

  const above = exports.placeMenu({ top: 400, bottom: 420, left: 500, width: 100 }, viewport)
  assert.equal(above.above, true)
  assert.equal(above.top, 392, 'one gap above the selection')
  assert.equal(above.left, 550, 'centred on the selection')

  // 贴着视口顶端：上方放不下，翻到下方。
  const below = exports.placeMenu({ top: 4, bottom: 24, left: 500, width: 100 }, viewport)
  assert.equal(below.above, false)
  assert.equal(below.top, 32, 'below the selection instead')
})

test('placeMenu keeps the menu inside the viewport edges', () => {
  const { exports } = loadBundle(BUNDLE)
  const viewport = { width: 1000, height: 800 }
  // 选区中心已经出界时才夹到边上；仍在界内则按中心对齐。
  assert.equal(
    exports.placeMenu({ top: 400, bottom: 420, left: -50, width: 20 }, viewport).left,
    8,
    'clamped at the left edge',
  )
  assert.equal(
    exports.placeMenu({ top: 400, bottom: 420, left: 990, width: 20 }, viewport).left,
    992,
    'clamped at width - edge',
  )
  assert.equal(
    exports.placeMenu({ top: 400, bottom: 420, left: 0, width: 20 }, viewport).left,
    10,
    'a centred selection inside the viewport is not snapped',
  )
})

test('placeTip floats the quote body above the chip and flips below near the top', () => {
  const { exports } = loadBundle(BUNDLE)
  const viewport = { width: 1000, height: 800 }
  const size = { width: 300, height: 120 }

  const above = exports.placeTip({
    anchor: { top: 400, left: 500, width: 100, height: 20 },
    viewport,
    size,
  })
  assert.equal(above.above, true, 'a chip in the middle of the viewport opens upward')
  assert.equal(above.top, 400 - exports.TIP_GAP - 120, 'one gap above the chip')
  assert.equal(above.left, 500 + 50 - 150, 'centred on the chip')

  // 贴着视口顶端：上方放不下，翻到下方。
  const below = exports.placeTip({
    anchor: { top: 4, left: 500, width: 100, height: 20 },
    viewport,
    size,
  })
  assert.equal(below.above, false)
  assert.equal(below.top, 24 + exports.TIP_GAP, 'placed below the chip instead')
})

test('placeTip keeps the quote body inside the viewport edges', () => {
  const { exports } = loadBundle(BUNDLE)
  const viewport = { width: 1000, height: 800 }
  const size = { width: 300, height: 120 }
  const edge = exports.TIP_EDGE

  // chip 在视口最左侧：浮窗中心会跑到屏幕外，夹到左边距。
  assert.equal(
    exports.placeTip({ anchor: { top: 400, left: 0, width: 20, height: 20 }, viewport, size }).left,
    edge,
    'clamped at the left edge',
  )
  // chip 在视口最右侧：夹到 right - width - edge。
  assert.equal(
    exports.placeTip({ anchor: { top: 400, left: 995, width: 5, height: 20 }, viewport, size }).left,
    viewport.width - size.width - edge,
    'clamped at the right edge',
  )
  // 两侧都放不下（chip 极高）：仍然不越界。
  const tall = exports.placeTip({ anchor: { top: 400, left: 500, width: 100, height: 700 }, viewport, size })
  assert.ok(tall.top >= edge, 'never above the top edge')
  assert.ok(tall.top + size.height <= viewport.height - edge, 'never past the bottom edge')
})

test('QuoteNodeView renders a chip plus the hover popover, never a native title', () => {
  const { exports } = loadBundle(BUNDLE)
  const t = (key, params) => (params === undefined ? key : `${key}${JSON.stringify(params)}`)

  // 三种数据形态都要能渲染：带轮次、不带轮次、截断。
  const cases = [
    { label: 'with a turn', data: { body: '问题已经修复并验证完成。', truncated: false, turn: 2 } },
    { label: 'without a turn', data: { body: '某段引用内容', truncated: false } },
    { label: 'truncated', data: { body: '很长'.repeat(80), truncated: true, total: 5000, turn: 4 } },
  ]
  for (const item of cases) {
    const tree = exports.QuoteNodeView({
      node: { id: exports.QUOTE_NODE_KEY, data: item.data },
      t,
    })
    const kids = tree.children
    assert.equal(kids[0].type, 'style', `${item.label}: the chip carries its own stylesheet`)
    const chip = kids.find((kid) => kid !== null && kid.props?.className === 'gtk-quote-node')
    assert.ok(chip !== undefined, `${item.label}: the chip is rendered`)
    // 需求明确要求浮窗而不是 HTML title：chip 上不能出现 title 属性。
    assert.equal(chip.props.title, undefined, `${item.label}: no native title on the chip`)
    // 浮窗组件要一起渲染出来，悬停才有东西可显示。
    const tip = kids.find((kid) => kid !== null && kid.props?.className === undefined && typeof kid.type === 'function')
    assert.ok(tip !== undefined, `${item.label}: the popover component is mounted alongside the chip`)
  }
})

test('the hover popover replaces the native title instead of adding to it', () => {
  const source = readFileSync(new URL('../src/client/features/message-quote/quote-node.tsx', import.meta.url), 'utf8')
  // 需求明确要求用浮窗而非 HTML title；源码里出现 title= 就说明退回了原生提示。
  assert.equal(/\stitle=\{/.test(source), false, 'the chip must not carry a native title')
  assert.ok(source.includes('QuoteTip'), 'the chip renders the popover component')
  assert.ok(source.includes('useQuoteTip'), 'the chip drives the popover through the shared controller')
})

test('the quote popover renders its body through the host markdown renderer', () => {
  const { exports: e } = loadBundle(BUNDLE)
  const t = (key) => key

  // 一个有代码块的引用：这正是纯文本渲染最难看的情况。
  const source = '## 附带要点\n\n```bash\ngit worktree lock\n```'
  const MarkdownText = function MarkdownText() {}
  const tree = e.QuoteMarkdown({ text: source, labels: e.markdownLabels(t), primitives: { MarkdownText } })

  assert.equal(tree.type, MarkdownText, 'delegates to the host renderer instead of drawing text')
  assert.equal(tree.props.text, source, 'passes the quote body through untouched')
  assert.equal(tree.props.streaming, false, 'a quote is a snapshot, so it renders on the static path')
  assert.equal(tree.props.variant, 'compact', 'the popover is secondary chrome')
})

test('the host markdown renderer always receives complete labels', () => {
  const { exports: e } = loadBundle(BUNDLE)
  // 宿主的代码块分支直接解引用 labels.code.copyLabel，缺字段会让含代码块的引用
  // 在渲染时抛 TypeError。这里逐字段断言结构完整。
  const labels = e.markdownLabels((key) => key)
  assert.equal(typeof labels.code.copyLabel, 'string')
  assert.equal(typeof labels.code.copiedLabel, 'string')
  assert.equal(typeof labels.code.toolbarLabels.codeLabel, 'string')
  assert.equal(typeof labels.code.toolbarLabels.wrapLabel, 'string')
  assert.equal(typeof labels.code.toolbarLabels.unwrapLabel, 'string')
  assert.equal(typeof labels.footnotes, 'string')

  // 落到中文时必须是真文案，不是没绑定的 key。
  const zh = {
    markdownCopy: '复制',
    markdownCopied: '复制成功',
    markdownCodeLabel: '代码块',
    markdownWrap: '自动换行',
    markdownUnwrap: '取消自动换行',
    markdownFootnotes: '脚注',
  }
  const localized = e.markdownLabels((key) => zh[key] ?? key)
  assert.equal(localized.code.copyLabel, '复制')
  assert.equal(localized.code.toolbarLabels.codeLabel, '代码块')
  assert.equal(localized.footnotes, '脚注')
})

test('the quote body falls back to plain text when the host renderer is missing', () => {
  const { exports: e } = loadBundle(BUNDLE)
  const tree = e.QuoteMarkdown({ text: '第一行\n第二行', labels: e.markdownLabels((key) => key), primitives: null })
  // 退回纯文本时仍要保留换行：引用正文的换行本身有意义。
  assert.equal(tree.props.className, 'gtk-quote-tip-plain')
  assert.equal(tree.children[0], '第一行\n第二行')
})

test('resolving host primitives never throws, whatever the loader does', () => {
  const { exports: e } = loadBundle(BUNDLE)
  assert.equal(e.resolvePrimitives(undefined), null, 'no loader require')
  assert.equal(
    e.resolvePrimitives(() => {
      throw new Error('module is not whitelisted')
    }),
    null,
    'an unlisted module degrades instead of crashing the plugin',
  )
  assert.equal(e.resolvePrimitives(() => null), null, 'a null module')
  assert.equal(e.resolvePrimitives(() => ({ somethingElse: true })), null, 'an export without MarkdownText')
  const MarkdownText = function MarkdownText() {}
  const ok = e.resolvePrimitives(() => ({ MarkdownText }))
  assert.notEqual(ok, null)
  assert.equal(ok.MarkdownText, MarkdownText)
})

test('the composer chip drops the host title before showing its own popover', () => {
  const source = readFileSync(
    new URL('../src/client/features/message-quote/quote-popover.tsx', import.meta.url),
    'utf8',
  )
  // 宿主的 title 在 portal 渲染的子元素上，必须连子树一起清掉，否则会叠出两个提示。
  assert.ok(
    source.includes("chip.querySelectorAll('[title]')"),
    'descendant title attributes are cleared too',
  )
})

/** 一个记录调用的插入环境桩。 */
function insertTarget(overrides = {}) {
  const calls = []
  const target = {
    ctx: { get: () => undefined },
    // sessions 由注册期的 whenService 提供；默认没有，即 chip 通道不可用。
    sessions: undefined,
    inputActions: {
      captureInsertion: () => ({ start: 7, end: 7, draftRev: 4 }),
      insertText(text, span) {
        calls.push(['text', text, span])
        return true
      },
    },
    sessionId: 's1',
    chipLabel: '引用 第3轮：选中的完整片段正文',
    chipClipboard: '引用 第3轮：选中的片段…',
    ...overrides,
  }
  return { target, calls }
}

test('insertQuote writes plain text when no chip channel is available', () => {
  const { exports } = loadBundle(BUNDLE)
  const { target, calls } = insertTarget()

  const outcome = exports.insertQuote(target, '选中的片段', 3)
  assert.equal(outcome, 'text', 'no conversation service means text fallback')
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], 'text')
  assert.ok(calls[0][1].includes('> **引用自第 3 轮**'))
  assert.deepEqual(calls[0][2], { start: 7, end: 7, draftRev: 4 })
})

test('insertQuote prefers the chip channel and passes the block as ref', () => {
  const { exports } = loadBundle(BUNDLE)
  const chips = []
  const input = {
    state: { getSnapshot: () => ({ draft: '', draftRev: 4, phase: 'plain' }) },
    insertReference(chip, span) {
      chips.push([chip, span])
      return true
    },
  }
  const ctx = {
    get: (name) => (name === 'conversation' ? { input: { for: () => input } } : undefined),
  }
  // sessions 走注册期注入，不经过 ctx —— 未声明 inject 时读 ctx.sessions 会抛错。
  const sessions = { scope: (id) => (id === 's1' ? { id: 's1' } : undefined) }
  const { target, calls } = insertTarget({ ctx, sessions })

  const outcome = exports.insertQuote(target, '选中的片段', 3)
  assert.equal(outcome, 'chip')
  assert.equal(calls.length, 0, 'the text channel was not used')

  const [chip, span] = chips[0]
  assert.equal(chip.source, 'reference')
  assert.ok(chip.ref.includes('> **引用自第 3 轮**'), 'the model sees the full block')
  assert.equal(chip.label, '引用 第3轮：选中的完整片段正文', 'the host title carries the full quote')
  assert.equal(chip.clipboardText, '引用 第3轮：选中的片段…', 'copy remains a compact preview')
  assert.ok(!('appearance' in chip), 'no appearance: none of the three host domains applies')
  assert.deepEqual(span, { draftRev: 4, start: 7, end: 7 })
  assert.equal(chip.ref.endsWith('\n'), true, 'the ref ends with a newline so typing cannot join the quote')
  assert.equal(chip.ref.startsWith('\n'), false, 'an empty draft must not gain a leading blank line')
})

test('the chip ref keeps text typed after it outside the quote', () => {
  const { exports } = loadBundle(BUNDLE)
  const chips = []
  // 草稿里已经有一句用户的话，插入位点在第 3 个字符之后。
  const input = {
    state: { getSnapshot: () => ({ draft: '请参考', draftRev: 4, phase: 'plain' }) },
    insertReference(chip) {
      chips.push(chip)
      return true
    },
  }
  const ctx = { get: (name) => (name === 'conversation' ? { input: { for: () => input } } : undefined) }
  const sessions = { scope: () => ({}) }
  const { target } = insertTarget({ ctx, sessions })

  exports.insertQuote(target, '被引用的正文', 2)
  const ref = chips[0].ref
  assert.equal(ref.startsWith('\n'), true, 'a preceding paragraph needs its own line')
  assert.equal(ref.endsWith('\n'), true)

  // 复刻宿主的序列化：把 chip 的 ref 原样拼进草稿，用户在 chip 后面接着输入。
  const sent = `请参考${ref}这句是我打的`
  const parsed = exports.parseQuoteBlock(sent)
  assert.ok(parsed !== undefined)
  assert.equal(parsed.body, '被引用的正文', 'the quote body is exactly what was quoted')
  assert.equal(sent.slice(parsed.end), '这句是我打的', 'the typed sentence stays outside the quote')
})

test('text typed right after a chip is never swallowed into the quote', () => {
  const { exports } = loadBundle(BUNDLE)
  // 这就是用户实际遇到的那条消息：引用块的最后一行被接上了用户自己打的问题。
  const block = exports.buildQuoteBlock('问题已经修复并验证完成。', { turn: 2 })
  const good = `${block}\n全部都修好了吗`
  const parsed = exports.parseQuoteBlock(good)
  assert.ok(parsed !== undefined)
  assert.equal(parsed.body, '问题已经修复并验证完成。')
  assert.equal(good.slice(parsed.end), '全部都修好了吗', 'the question is no longer part of the quote')

  // 反例：没有边界换行时，用户的话会被并进最后一行 `>`——正是这次 bug 的形态。
  const broken = `${block}全部都修好了吗`
  const legacy = exports.parseQuoteBlock(broken)
  assert.ok(legacy !== undefined)
  assert.ok(legacy.body.includes('全部都修好了吗'), 'without the newline the text really is ambiguous')
})

test('insertQuote degrades when the composer is adjudicating or submitting', () => {
  const { exports } = loadBundle(BUNDLE)
  for (const phase of ['adjudicating', 'submitting']) {
    const input = {
      state: { getSnapshot: () => ({ draft: '', draftRev: 4, phase }) },
      insertReference: () => assert.fail('the chip channel must not run while frozen'),
    }
    const ctx = { get: () => ({ input: { for: () => input } }) }
    const sessions = { scope: () => ({}) }
    const { target, calls } = insertTarget({ ctx, sessions })
    assert.equal(exports.insertQuote(target, 'x', 1), 'text', `${phase} falls back to text`)
    assert.equal(calls.length, 1)
  }
})

test('insertQuote degrades when the captured span is already stale', () => {
  const { exports } = loadBundle(BUNDLE)
  const input = {
    state: { getSnapshot: () => ({ draft: '', draftRev: 9, phase: 'plain' }) },
    insertReference: () => assert.fail('a stale revision must not be inserted'),
  }
  const ctx = { get: () => ({ input: { for: () => input } }) }
  const { target } = insertTarget({ ctx, sessions: { scope: () => ({}) } })
  // 捕获返回 draftRev=4，快照说 9：这次 span 已过期。
  assert.equal(exports.insertQuote(target, 'x', 1), 'text')
})

test('insertQuote reports failure when neither channel is writable', () => {
  const { exports } = loadBundle(BUNDLE)
  const { target } = insertTarget({ inputActions: undefined })
  assert.equal(exports.insertQuote(target, 'x', 1), 'failed')
})

test('insertQuote contains an exception thrown by the chip channel', () => {
  const { exports } = loadBundle(BUNDLE)
  const input = {
    state: { getSnapshot: () => ({ draft: '', draftRev: 4, phase: 'plain' }) },
    insertReference() {
      throw new Error('facade blew up')
    },
  }
  const ctx = { get: () => ({ input: { for: () => input } }) }
  const sessions = { scope: () => ({}) }
  const { target, calls } = insertTarget({ ctx, sessions })
  // 不抛出 —— 点击处理器外面不该看到这个异常；降级到纯文本。
  assert.equal(exports.insertQuote(target, 'x', 1), 'text')
  assert.equal(calls.length, 1)
})

test('quoteRemovalSpan maps expanded chip clipboard offsets to atomic detect positions', () => {
  const { exports } = loadBundle(BUNDLE)
  const state = {
    draft: 'abfirst and token target',
    draftRev: 7,
    phase: 'plain',
    occurrences: [
      { source: 'reference', ref: 'first', offset: 2, length: 7 },
      { source: 'reference', ref: 'target', offset: 14, length: 3 },
    ],
  }
  const commandLengths = [5]
  assert.deepEqual(exports.quoteRemovalSpan(state, 2, 1, commandLengths), {
    start: 4,
    end: 5,
    draftRev: 7,
  })
  assert.equal(exports.quoteRemovalSpan({ ...state, phase: 'submitting' }, 2, 1, commandLengths), undefined)
  assert.equal(exports.quoteRemovalSpan({ ...state, draftRev: undefined }, 2, 1, commandLengths), undefined)
  assert.equal(exports.isQuotedMessageOccurrence({ source: 'reference', ref: '<quoted-message turn="1">x' }), true)
  assert.equal(exports.isQuotedMessageOccurrence({ source: 'reference', ref: '> **引用自第 1 轮**\n>\n> x' }), true)
  assert.equal(exports.isQuotedMessageOccurrence({ source: 'reference', ref: 'https://example.com' }), false)
  // chip 插在已有文字之后时 ref 会带前导换行（insert.ts 的 chipRef），仍须认得出。
  assert.equal(
    exports.isQuotedMessageOccurrence({ source: 'reference', ref: '\n> **引用自第 1 轮**\n>\n> x\n' }),
    true,
    'a leading newline must not hide the quote from hover-to-delete',
  )
  assert.equal(exports.isQuotedMessageOccurrence(undefined), false)
})

test('the quote menu occupies the composer overlay slot and is gated by its toggle', () => {
  const { exports } = loadBundle(BUNDLE)
  const configForms = mockConfigForms({ value: { gitBranch: true, messageQuote: false } })
  const { ctx, registrations } = mockContext({ configForms })
  exports.apply(ctx)

  const entry = registrations.find((row) => row.options.id === 'toolkit-message-quote')
  assert.ok(entry !== undefined, 'the popover is registered')
  assert.equal(entry.options.name, 'conversation.input.overlay')
  assert.equal(entry.options.order, 20, 'after context-modal (10)')
  assert.equal(entry.options.locale, 'dsh-toolkit/message-quote')

  // 关闭时渲染为空 —— 与其余功能一致的 gated 语义。
  assert.equal(
    entry.component({ t: (key) => key, inputActions: {}, sessionId: 's1' }),
    null,
    'a disabled message-quote renders nothing',
  )
})

test('a missing sessions service degrades instead of reading ctx.sessions', () => {
  const { exports } = loadBundle(BUNDLE)
  // 模拟 Cordis 上下文：未声明 inject 的属性**一读就抛**（这正是线上那个 bug）。
  const ctx = {
    get() {
      throw new Error('cannot get property "sessions" without inject')
    },
  }
  const { target, calls } = insertTarget({ ctx, sessions: undefined })
  // 不抛到外面，也不去读 ctx.sessions —— 干净地降级为纯文本。
  assert.equal(exports.insertQuote(target, 'x', 1), 'text')
  assert.equal(calls.length, 1)
})

test('a throwing ctx.get is contained, not propagated to the click handler', () => {
  const { exports } = loadBundle(BUNDLE)
  const ctx = {
    get() {
      throw new Error('unknown service')
    },
  }
  const { target, calls } = insertTarget({ ctx, sessions: { scope: () => ({}) } })
  assert.equal(exports.insertQuote(target, 'x', 1), 'text')
  assert.equal(calls.length, 1)
})

test('buildQuotePreview flattens whitespace into one inline line', () => {
  const { exports } = loadBundle(BUNDLE)
  assert.equal(exports.buildQuotePreview('第一行\n\n  第二行\t第三行'), '第一行 第二行 第三行')
})

test('buildQuotePreview strips Markdown syntax from the chip label', () => {
  const { exports } = loadBundle(BUNDLE)
  // chip 的标签是纯文本：露出反引号与星号会很难看，所以摘要前先剥掉标记。
  assert.equal(
    exports.buildQuotePreview('先看 `lib/client.js` 已更新，**刷新页面**即可。', 40),
    '先看 lib/client.js 已更新，刷新页面即可。',
  )
  // 代码围栏行要整行去掉，不能把 ```bash 显示出来。
  assert.equal(exports.buildQuotePreview('```bash\npnpm run build\n```', 40), 'pnpm run build')
  // 链接只留可读文字。
  assert.equal(exports.buildQuotePreview('见 [文档](https://x.dev) 说明', 40), '见 文档 说明')
})

test('buildQuotePreview adds an ellipsis only when it actually cuts', () => {
  const { exports } = loadBundle(BUNDLE)
  assert.equal(exports.buildQuotePreview('短文本'), '短文本')
  const long = exports.buildQuotePreview('一二三四五六七八九十一二三四五六七八九十', 5)
  assert.equal(long, '一二三四五…', 'the ellipsis tells the user more text exists')
  assert.equal(exports.PREVIEW_LIMIT, 18)
})

test('buildQuoteLabel gives the chip a single line with no Markdown syntax', () => {
  const { exports } = loadBundle(BUNDLE)
  // chip 的标签是纯文本节点：留着 `##` 与反引号会直接显示在 chip 上。
  assert.equal(
    exports.buildQuoteLabel('## 修法：把选区 DOM 还原成 Markdown'),
    '修法：把选区 DOM 还原成 Markdown',
  )
  assert.equal(
    exports.buildQuoteLabel('第一行\n\n第二行 `code`'),
    '第一行 第二行 code',
    'newlines are flattened because the chip is a single inline label',
  )
  assert.equal(exports.buildQuoteLabel('abcdef', 4), 'abcd…')
  assert.equal(exports.buildQuoteLabel('abcdef', 0), 'abcdef')
  assert.equal(exports.LABEL_LIMIT > exports.PREVIEW_LIMIT, true)
})

// ---------------------------------------------------------------------------
// git-branch：徽标的「点击复制分支名」。
//
// 复制什么由 `branchCopyText` 决定，怎么写由 `writeClipboard` 决定；两者都从
// 产物导出，因此用一个结构化的 navigator/document 桩就能断言真实行为 ——
// 不需要渲染组件，也不会真的碰系统剪贴板。
// ---------------------------------------------------------------------------

/** 安装临时全局；返回还原函数（Node 里 `navigator` 是 configurable 的 accessor）。 */
function installGlobals(values) {
  const saved = new Map()
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  }
  return () => {
    for (const [key, descriptor] of saved) {
      if (descriptor === undefined) delete globalThis[key]
      else Object.defineProperty(globalThis, key, descriptor)
    }
  }
}

/** 一份可以按需改字段的仓库快照。 */
function repoStatus(overrides = {}) {
  return {
    isRepo: true,
    root: '/repo',
    detached: false,
    current: 'fix/released',
    branches: [{ name: 'fix/released', current: true, upstream: 'origin/fix/released' }],
    ...overrides,
  }
}

test('branchCopyText copies the branch name, not the upstream or the tooltip text', () => {
  const { exports } = loadBundle(BUNDLE)
  assert.equal(exports.branchCopyText(repoStatus()), 'fix/released')
  assert.equal(exports.branchCopyText(repoStatus({ current: 'main', branches: [] })), 'main')
})

test('branchCopyText copies the commit, not a bare HEAD, while detached', () => {
  const { exports } = loadBundle(BUNDLE)
  const detached = repoStatus({ detached: true, current: undefined, head: 'a1b2c3d' })
  assert.equal(exports.branchCopyText(detached), 'a1b2c3d', 'the commit is what a user can paste')
  assert.equal(exports.branchCopyText(repoStatus({ detached: true, current: undefined })), 'HEAD')
})

test('branchCopyText falls back to HEAD when the branch name is empty', () => {
  const { exports } = loadBundle(BUNDLE)
  assert.equal(exports.branchCopyText(repoStatus({ current: '' })), 'HEAD')
})

test('writeClipboard uses the async Clipboard API when it is available', async () => {
  const { exports } = loadBundle(BUNDLE)
  const written = []
  const restore = installGlobals({
    navigator: { clipboard: { writeText: async (text) => { written.push(text) } } },
  })
  try {
    assert.equal(await exports.writeClipboard('fix/released'), true)
    assert.deepEqual(written, ['fix/released'])
  } finally {
    restore()
  }
})

test('writeClipboard falls back to execCommand when the Clipboard API rejects', async () => {
  const { exports } = loadBundle(BUNDLE)
  const calls = []
  const area = {
    value: '',
    style: {},
    setAttribute() {},
    select() { calls.push('select') },
    remove() { calls.push('remove') },
  }
  const restore = installGlobals({
    navigator: { clipboard: { writeText: async () => { throw new Error('denied') } } },
    document: {
      activeElement: null,
      body: { appendChild() { calls.push('append') } },
      createElement: (tag) => {
        assert.equal(tag, 'textarea', 'the fallback uses a hidden textarea')
        return area
      },
      getSelection: () => null,
      execCommand: (command) => {
        calls.push(command)
        return true
      },
    },
  })
  try {
    assert.equal(await exports.writeClipboard('fix/released'), true, 'the fallback reports success')
    assert.equal(area.value, 'fix/released', 'the text went through the textarea')
    assert.deepEqual(calls, ['append', 'select', 'copy', 'remove'], 'cleaned up after itself')
  } finally {
    restore()
  }
})

test('writeClipboard reports failure instead of throwing when nothing works', async () => {
  const { exports } = loadBundle(BUNDLE)
  // 没有 Clipboard API，execCommand 也拒绝。
  const restore = installGlobals({
    navigator: {},
    document: {
      body: { appendChild() {} },
      createElement: () => ({ value: '', style: {}, setAttribute() {}, select() {}, remove() {} }),
      getSelection: () => null,
      execCommand: () => false,
    },
  })
  try {
    assert.equal(await exports.writeClipboard('main'), false, 'a click on a locked-down browser reports failure')
  } finally {
    restore()
  }
})

test('writeClipboard contains an exception thrown by execCommand', async () => {
  const { exports } = loadBundle(BUNDLE)
  const restore = installGlobals({
    navigator: {},
    document: {
      body: { appendChild() {} },
      createElement: () => ({ value: '', style: {}, setAttribute() {}, select() {}, remove() {} }),
      getSelection: () => null,
      execCommand() {
        throw new Error('blocked by permissions policy')
      },
    },
  })
  try {
    // 不抛到点击处理器外面：复制失败只是「这次没生效」。
    assert.equal(await exports.writeClipboard('main'), false)
  } finally {
    restore()
  }
})

test('writeClipboard reports failure without a document', async () => {
  const { exports } = loadBundle(BUNDLE)
  const restore = installGlobals({ navigator: {} })
  try {
    assert.equal(await exports.writeClipboard('main'), false)
  } finally {
    restore()
  }
})
