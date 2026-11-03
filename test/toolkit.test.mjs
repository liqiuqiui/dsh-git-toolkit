/**
 * 工具包骨架测试：功能声明与开关的联动。
 *
 * 这里不启动 Harness，只验证两件容易在重构中静默坏掉的事：
 *   1. 每个功能的 Config 开关都能从 `features.ts` 派生出来，默认值与声明一致；
 *   2. 开关是**运行时**读取的 —— 同一个已注册的路由，在开关翻转后会立刻改变
 *      行为（不重新注册、不重挂载），这正是 volatile commit 的语义。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import {
  API,
  Config,
  FEATURE_DEFAULTS,
  FEATURE_LIST,
  apply,
  applyHostFeatures,
} from '../lib/index.js'

/** 身份参数，使测试提交永不依赖本机的 git 配置。 */
const IDENTITY = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

/** 位于 `main` 分支、含一个提交的临时仓库。 */
async function makeRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-toolkit-unit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir })
  execFileSync('git', [...IDENTITY, 'commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}

/** 收集 `apply` 注册的路由，并给出一个可用的最小 Host 上下文。 */
function mockContext(cwd) {
  const routes = []
  return {
    routes,
    effect(fn) {
      const disposer = fn()
      if (typeof disposer === 'function') disposer()
      return disposer
    },
    get(name) {
      if (name === 'sessions') {
        return { get: (id) => (id === 's1' ? { header: { cwd } } : undefined) }
      }
      return undefined
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
  }
}

/** 驱动一条路由并解析其 JSON 响应。 */
async function call(route, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  const res = {
    headersSent: false,
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
      this.headersSent = true
    },
    end(text) {
      this.body = text
    },
  }
  await route.handler(req, res)
  return { status: res.status, json: JSON.parse(res.body) }
}

/** 读到开关的当前值：volatile 字段在解析后是 `{ get() }` 引用。 */
function readToggle(parsed, key) {
  const value = parsed[key]
  return typeof value === 'boolean' ? value : value.get()
}

test('every declared feature contributes one volatile Config toggle with its default', () => {
  const parsed = Config({})
  assert.deepEqual(
    Object.keys(parsed).sort(),
    FEATURE_LIST.map((feature) => feature.configKey).sort(),
    'the schema covers exactly the declared features',
  )
  for (const feature of FEATURE_LIST) {
    // volatile 字段解析后是引用对象而非裸布尔：这正是详情页能即时改写、且
    // 插件不被重挂载的前提。若哪天去掉 `.volatile()`，这里会先失败。
    assert.equal(
      typeof parsed[feature.configKey].get,
      'function',
      `${feature.id} toggle must stay volatile`,
    )
    assert.equal(
      readToggle(parsed, feature.configKey),
      feature.defaultEnabled,
      `${feature.id} default should come from the declaration`,
    )
  }
  assert.deepEqual(
    Object.fromEntries(FEATURE_LIST.map((feature) => [feature.configKey, feature.defaultEnabled])),
    FEATURE_DEFAULTS,
  )
})

test('Config rejects a non-boolean toggle', () => {
  assert.throws(() => Config({ gitBranch: 'yes' }))
})

test('a flip of the toggle changes an already-registered route', async (t) => {
  const dir = await makeRepo(t)
  // volatile 字段在运行时的读取面：一个可变的 `get()`，正是 Loader 交给插件的形态。
  let enabled = true
  const config = { gitBranch: { get: () => enabled } }
  const ctx = mockContext(dir)
  apply(ctx, config)

  const statusRoute = ctx.routes.find((route) => route.path === `${API}/status`)
  assert.ok(statusRoute !== undefined, 'the git-branch feature registered its status route')

  const hot = await call(statusRoute, { sessionId: 's1' })
  assert.equal(hot.status, 200)
  assert.equal(hot.json.value.current, 'main')

  enabled = false
  const cold = await call(statusRoute, { sessionId: 's1' })
  assert.equal(cold.status, 404)
  assert.equal(cold.json.error.code, 'feature-disabled')

  enabled = true
  const again = await call(statusRoute, { sessionId: 's1' })
  assert.equal(again.status, 200, 'turning the feature back on needs no re-registration')
})

test('a plain boolean config (no loader refs) is honoured too', async (t) => {
  const dir = await makeRepo(t)
  const ctx = mockContext(dir)
  apply(ctx, { gitBranch: false })
  const statusRoute = ctx.routes.find((route) => route.path === `${API}/status`)
  const response = await call(statusRoute, { sessionId: 's1' })
  assert.equal(response.status, 404)
  assert.equal(response.json.error.code, 'feature-disabled')
})

test('apply declares the settings-page policy with auto:false and disposes it', () => {
  const disposers = []
  const calls = []
  const ctx = {
    fiber: { name: 'dsh-toolkit' },
    effect(fn, label) {
      disposers.push({ label, dispose: fn() })
      return fn
    },
    get: () => undefined,
    inject(keys, callback) {
      assert.deepEqual(keys, ['settings'])
      callback({
        effect: ctx.effect,
        get: (name) =>
          name === 'settings'
            ? {
                configure(policy, fiber) {
                  calls.push({ policy, fiber })
                  return () => calls.push({ policy: 'disposed' })
                },
              }
            : undefined,
      })
    },
    webServer: { register: () => () => {} },
  }
  apply(ctx, { gitBranch: true })

  assert.deepEqual(calls, [{ policy: { auto: false }, fiber: ctx.fiber }])
  assert.ok(
    disposers.some((entry) => entry.label === 'dsh-toolkit: settings page policy'),
    'the policy is owned by an effect so it is released with the plugin',
  )
})

test('apply survives a deployment without a settings service', () => {
  const ctx = {
    fiber: { name: 'dsh-toolkit' },
    effect(fn) {
      return fn()
    },
    get: () => undefined,
    inject(keys, callback) {
      callback({ effect: ctx.effect, get: () => undefined })
    },
    webServer: { register: () => () => {} },
  }
  assert.doesNotThrow(() => apply(ctx, { gitBranch: true }))
})

/** 收集 `console.error`，返回恢复函数。 */
function captureConsoleError() {
  const messages = []
  const original = console.error
  console.error = (...args) => messages.push(args.map(String).join(' '))
  return {
    messages,
    restore: () => {
      console.error = original
    },
  }
}

/** 一个只声明、不装配任何东西的功能声明。 */
function fakeFeature(id) {
  return { id, configKey: id, defaultEnabled: true, titleKey: `${id}.title`, descriptionKey: `${id}.description` }
}

test('a host feature that throws does not stop the others', () => {
  const mounted = []
  const ctx = {
    fiber: { name: 'dsh-toolkit' },
    effect(fn) {
      return fn()
    },
    get: () => undefined,
    webServer: { register: () => () => {} },
  }

  const capture = captureConsoleError()
  try {
    applyHostFeatures(ctx, { gitBranch: true }, [
      {
        feature: fakeFeature('broken'),
        implementation: {
          id: 'broken',
          register() {
            throw new Error('boom')
          },
        },
      },
      {
        feature: fakeFeature('healthy'),
        implementation: {
          id: 'healthy',
          register(feature) {
            feature.jsonRoute('/api/fake/healthy', async () => 'ok')
            mounted.push('healthy')
          },
        },
      },
      {
        feature: fakeFeature('also-broken'),
        implementation: {
          id: 'also-broken',
          register() {
            throw new Error('bang')
          },
        },
      },
    ])
  } finally {
    capture.restore()
  }

  assert.deepEqual(mounted, ['healthy'], 'the healthy feature still registered its surfaces')
  assert.ok(capture.messages.some((line) => line.includes('broken') && line.includes('boom')))
  assert.ok(capture.messages.some((line) => line.includes('also-broken')), 'every failure is reported')
})

test('a failure in the settings-page step does not stop the features', () => {
  const mounted = []
  const ctx = {
    fiber: { name: 'dsh-toolkit' },
    effect(fn) {
      return fn()
    },
    get: () => undefined,
    inject(keys, callback) {
      callback({
        effect: ctx.effect,
        get: () => {
          throw new Error('settings exploded')
        },
      })
    },
    webServer: { register: () => () => {} },
  }

  const capture = captureConsoleError()
  try {
    assert.doesNotThrow(() => apply(ctx, { gitBranch: true }))
  } finally {
    capture.restore()
  }
  assert.ok(capture.messages.some((line) => line.includes('settings page policy')))
})
