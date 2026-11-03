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

const BUNDLE = new URL('../lib/client.js', import.meta.url).pathname

test('the bundle registers itself with the toolkit id and exports apply', () => {
  const { id, exports, requires } = loadBundle(BUNDLE)
  assert.equal(id, 'dsh-toolkit')
  assert.equal(exports.name, 'dsh-toolkit')
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(requires, ['react'], 'React is the only runtime import')
  assert.deepEqual(exports.inject, ['slots', 'locale'])
})

test('without a settings service the features still mount, the toggle section does not', () => {
  const { exports } = loadBundle(BUNDLE)
  const { ctx, registrations, locales } = mockContext()
  exports.apply(ctx)

  const slots = registrations.map((entry) => entry.options.name).sort()
  assert.deepEqual(slots, [
    'conversation.hero.options',
    'conversation.input.left',
    'shell.overlay',
  ])
  assert.ok(
    !registrations.some((entry) => entry.options.name === 'plugins.bundle.config'),
    'no settings service means no toggle section',
  )
  const namespaces = locales.map((entry) => entry.namespace).sort()
  assert.deepEqual(namespaces, ['dsh-toolkit', 'dsh-toolkit/git-branch'])
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
  const configForms = mockConfigForms({ value: { gitBranch: false } })
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
  assert.equal(registrations.length, 4, 'no re-registration happened')
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
  assert.equal(registrations.length, 4, 'the slot registry did not churn')
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
