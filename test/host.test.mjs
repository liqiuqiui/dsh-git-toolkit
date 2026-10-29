/**
 * Host 侧测试：git 操作与 JSON 路由信封，均针对真实临时仓库执行
 * （不启动 Harness，不启动浏览器）。
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
  buildRoutes,
  createBranch,
  readRepoStatus,
  switchBranch,
} from '../lib/index.js'

/** 身份参数，使测试提交永不依赖本机的 git 配置。 */
const IDENTITY = ['-c', 'user.name=test', '-c', 'user.email=test@example.com']

/** 在 `cwd` 中运行 git（仅用于测试准备；插件自身使用 execFile）。 */
function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' },
  })
}

/** 位于 `main` 分支、含一个提交的临时仓库。 */
async function makeRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'git-toolkit-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  git(dir, ['init', '-b', 'main'])
  execFileSync('git', [...IDENTITY, 'commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  return dir
}

/** 一个不是仓库的临时目录。 */
async function makePlainDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'git-toolkit-plain-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** 最小 host 上下文：一个指向 `cwd` 的活跃 session。 */
function mockContext(cwd) {
  return {
    get(name) {
      if (name === 'sessions') {
        return { get: (id) => (id === 's1' ? { header: { cwd } } : undefined) }
      }
      return undefined
    },
  }
}

/** 用一个 JSON 请求体驱动单个路由处理器并捕获响应。 */
async function callRoute(route, body, method = 'POST') {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = method
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

/** 从导出的路由表中取出名为 `action` 的路由。 */
function routeOf(ctx, action) {
  return buildRoutes(ctx).find((route) => route.path === `${API}/${action}`)
}

test('readRepoStatus reports a non-repository as isRepo:false', async (t) => {
  const dir = await makePlainDir(t)
  assert.deepEqual(await readRepoStatus(dir), { isRepo: false })
})

test('readRepoStatus lists local branches and marks the current one', async (t) => {
  const dir = await makeRepo(t)
  git(dir, ['checkout', '-b', 'feat/one'])
  git(dir, ['checkout', 'main'])
  const status = await readRepoStatus(dir)
  assert.equal(status.isRepo, true)
  assert.equal(status.current, 'main')
  assert.equal(status.detached, false)
  assert.deepEqual(
    status.branches.map((branch) => branch.name).sort(),
    ['feat/one', 'main'],
  )
  assert.equal(status.branches.find((branch) => branch.current)?.name, 'main')
})

test('switchBranch checks out an existing local branch', async (t) => {
  const dir = await makeRepo(t)
  git(dir, ['branch', 'fix/two'])
  const status = await switchBranch(dir, 'fix/two')
  assert.equal(status.current, 'fix/two')
  assert.equal(git(dir, ['branch', '--show-current']).trim(), 'fix/two')
})

test('switchBranch refuses a branch that does not exist locally', async (t) => {
  const dir = await makeRepo(t)
  await assert.rejects(
    () => switchBranch(dir, 'nope'),
    (error) => error.code === 'no-such-branch',
  )
})

test('switchBranch refuses to be steered at another revision', async (t) => {
  const dir = await makeRepo(t)
  // 一个 tag 与一个远端风格的 revision 都不是本地分支；二者都不会进入
  // checkout 的操作数，因为只接受 `refs/heads` 名称。
  git(dir, ['tag', 'v1'])
  await assert.rejects(
    () => switchBranch(dir, 'v1'),
    (error) => error.code === 'no-such-branch',
  )
})

test('createBranch creates and checks out the new branch', async (t) => {
  const dir = await makeRepo(t)
  const status = await createBranch(dir, 'feat/brand-new')
  assert.equal(status.current, 'feat/brand-new')
  assert.ok(status.branches.some((branch) => branch.name === 'feat/brand-new'))
})

test('createBranch rejects invalid and duplicate names', async (t) => {
  const dir = await makeRepo(t)
  for (const name of ['-x', 'a..b', 'bad name', '']) {
    await assert.rejects(() => createBranch(dir, name), (error) => error.code === 'invalid-branch-name')
  }
  await assert.rejects(() => createBranch(dir, 'main'), (error) => error.code === 'branch-exists')
})

test('status route answers the envelope for a git session', async (t) => {
  const dir = await makeRepo(t)
  const { status, json } = await callRoute(routeOf(mockContext(dir), 'status'), { sessionId: 's1' })
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.value.isRepo, true)
  assert.equal(json.value.current, 'main')
})

test('switch route answers the refreshed snapshot', async (t) => {
  const dir = await makeRepo(t)
  git(dir, ['branch', 'feat/route'])
  const { status, json } = await callRoute(
    routeOf(mockContext(dir), 'switch'),
    { sessionId: 's1', branch: 'feat/route' },
  )
  assert.equal(status, 200)
  assert.equal(json.ok, true)
  assert.equal(json.value.current, 'feat/route')
})

test('routes fail loudly on unknown sessions, methods, and bodies', async (t) => {
  const dir = await makeRepo(t)
  const ctx = mockContext(dir)
  const missing = await callRoute(routeOf(ctx, 'status'), { sessionId: 'unknown' })
  assert.equal(missing.status, 404)
  assert.equal(missing.json.error.code, 'unavailable')

  const wrongMethod = await callRoute(routeOf(ctx, 'status'), {}, 'GET')
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.json.error.code, 'method-not-allowed')

  const badBranch = await callRoute(routeOf(ctx, 'switch'), { sessionId: 's1' })
  assert.equal(badBranch.status, 400)
  assert.equal(badBranch.json.error.code, 'bad-request')
})

/** 一个裸远端加一个可推送的克隆，使跟踪分支是真实的。 */
async function makeTrackingRepo(t) {
  const remote = await mkdtemp(join(tmpdir(), 'git-toolkit-remote-'))
  t.after(() => rm(remote, { recursive: true, force: true }))
  git(remote, ['init', '--bare', '-b', 'main'])
  const dir = await mkdtemp(join(tmpdir(), 'git-toolkit-track-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  git(dir, ['init', '-b', 'main'])
  execFileSync('git', [...IDENTITY, 'commit', '--allow-empty', '-m', 'init'], { cwd: dir })
  git(dir, ['remote', 'add', 'origin', remote])
  return { dir, remote }
}

test('readRepoStatus reports each branch upstream and a deleted upstream', async (t) => {
  const { dir } = await makeTrackingRepo(t)
  git(dir, ['push', '-q', '-u', 'origin', 'main'])
  git(dir, ['branch', 'fix/released'])
  git(dir, ['push', '-q', '-u', 'origin', 'fix/released'])
  git(dir, ['branch', 'local-only'])

  const status = await readRepoStatus(dir)
  const byName = new Map(status.branches.map((branch) => [branch.name, branch]))

  assert.equal(byName.get('main')?.upstream, 'origin/main')
  assert.equal(byName.get('fix/released')?.upstream, 'origin/fix/released')
  // 未被跟踪的分支完全不带 upstream 字段，而不是空字符串。
  assert.equal(byName.get('local-only')?.upstream, undefined)
  assert.equal(byName.get('local-only')?.upstreamGone, undefined)
  assert.equal(byName.get('main')?.upstreamGone, undefined)
})

test('readRepoStatus flags an upstream that was deleted on the remote', async (t) => {
  const { dir } = await makeTrackingRepo(t)
  git(dir, ['push', '-q', '-u', 'origin', 'main'])
  git(dir, ['checkout', '-q', '-b', 'doomed'])
  git(dir, ['push', '-q', '-u', 'origin', 'doomed'])
  git(dir, ['push', '-q', 'origin', '--delete', 'doomed'])
  git(dir, ['checkout', '-q', 'main'])

  const status = await readRepoStatus(dir)
  const doomed = status.branches.find((branch) => branch.name === 'doomed')
  assert.equal(doomed?.upstream, 'origin/doomed')
  assert.equal(doomed?.upstreamGone, true)
})

test('upstream fields survive the status route envelope', async (t) => {
  const { dir } = await makeTrackingRepo(t)
  git(dir, ['push', '-q', '-u', 'origin', 'main'])
  const { status, json } = await callRoute(routeOf(mockContext(dir), 'status'), { sessionId: 's1' })
  assert.equal(status, 200)
  const main = json.value.branches.find((branch) => branch.name === 'main')
  assert.deepEqual(main, { name: 'main', current: true, upstream: 'origin/main' })
})
