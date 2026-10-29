/**
 * git-toolkit · Host 侧。
 *
 * 浏览器侧在 New Session 行内渲染分支切换器（`conversation.hero.options`
 * 槽位，紧邻 agent-preset 控件右侧），并调用下面三个 JSON 端点。与 git 相关
 * 的一切都留在此处：浏览器永远看不到可自行选择的文件系统路径，每条命令都通过
 * 系统 `git` 二进制以参数数组执行（不经 shell），因此分支名永远不会变成命令
 * 操作数。
 *
 * 端点（均为 POST，来自 GUI 页面的同源请求）：
 *   POST /api/git-toolkit/status  { sessionId }
 *   POST /api/git-toolkit/switch  { sessionId, branch }
 *   POST /api/git-toolkit/create  { sessionId, name }
 *
 * 成功：`{ ok: true, value: RepoStatus }`；当会话工作目录不是 git work tree 时
 * 返回 `{ isRepo: false }`。失败：HTTP 4xx/5xx +
 * `{ ok: false, error: { code, message } }`；git 失败时 `message` 为 git 自身
 * 的文本，便于 UI 原样展示，`code` 则由 UI 本地化。
 *
 * 工作目录从实时会话解析（会话已迁移时用 `workingDirectory`，否则用不可变的
 * header cwd）；客户端始终只发送 session id，因此路由无法被导向任意路径。
 */
import { execFile } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'

import {
  API_BASE,
  type ApiFailure,
  type ApiSuccess,
  type BranchEntry,
  type RepoStatus,
} from './shared.js'
import {
  serviceOf,
  type HostContext,
  type RouteHandler,
  type SessionsService,
  type SessionLike,
  type WebRoute,
  type WorkingDirectoryService,
} from './host-api.js'

export { API_BASE as API } from './shared.js'

/** 单次 git 调用的时限；卡住的 index 锁不得让请求一直挂起。 */
const GIT_TIMEOUT_MS = 15_000

/** 捕获的 git 输出上限（git 日志与分支列表都很小）。 */
const GIT_MAX_OUTPUT = 4 * 1024 * 1024

/** 单个 JSON 请求体的上限。 */
const MAX_BODY_BYTES = 64 * 1024

/** 子进程的环境：不提示、稳定 locale、不取可选 index 锁。 */
const GIT_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  LC_ALL: 'C',
}

/** 每次调用都携带的参数，以保证输出保持机器可读。 */
const GIT_BASE_ARGS = ['--no-pager', '-c', 'color.ui=false', '-c', 'core.quotePath=false']

/** 一次请求级失败，带其传输 code 与 HTTP 状态码。 */
class ApiError extends Error {
  readonly code: string

  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** 一次 git 调用失败（UI 展示 git 自身的消息）。 */
class GitError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'GitError'
    this.code = code
  }
}

/** `execFile` 调用失败时在 `Error` 之外携带的字段。 */
interface ExecFailure extends Error {
  code?: string | number | undefined
  killed?: boolean | undefined
  stderr?: string | undefined
}

/**
 * 在 `cwd` 中运行一条 git 命令并收集 stdout。
 * @param cwd - 运行目录（仓库根或 worktree）。
 * @param args - 稳定参数之后的参数；绝不是 shell 字符串。
 * @returns stdout，保留末尾换行。
 * @throws {GitError} 二进制缺失时为 `git-missing`，超时时为 `git-timeout`，
 * 其余情况为 `git-error`（message 携带 git 的 stderr）。
 */
function runGit(cwd: string, args: readonly string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      'git',
      [...GIT_BASE_ARGS, ...args],
      {
        cwd,
        env: GIT_ENV,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_OUTPUT,
        windowsHide: true,
        encoding: 'utf8',
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve(String(stdout))
          return
        }
        const failure = error as ExecFailure
        if (failure.code === 'ENOENT') {
          reject(new GitError('git-missing', 'git executable not found on PATH'))
          return
        }
        if (failure.killed === true) {
          reject(new GitError('git-timeout', `git did not finish within ${GIT_TIMEOUT_MS} ms`))
          return
        }
        const own = typeof failure.stderr === 'string' ? failure.stderr : stderr
        const trimmed = typeof own === 'string' ? own.trim() : ''
        reject(new GitError('git-error', trimmed === '' ? failure.message : trimmed))
      },
    )
  })
}

/**
 * 包含 `cwd` 的仓库根；`cwd` 不在 git work tree 内时返回 undefined
 * （裸仓库不算 work tree）。
 * @param cwd - 会话工作目录的绝对路径。
 */
async function repoRoot(cwd: string): Promise<string | undefined> {
  try {
    const inside = (await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])).trim()
    if (inside !== 'true') return undefined
    const root = (await runGit(cwd, ['rev-parse', '--show-toplevel'])).trim()
    return root === '' ? undefined : root
  } catch {
    return undefined
  }
}

/** `cwd` 的仓库根；否则抛出 `not-repo` 失败。 */
async function requireRepo(cwd: string): Promise<string> {
  const root = await repoRoot(cwd)
  if (root === undefined) throw new ApiError('not-repo', 'not a git work tree', 409)
  return root
}

/** 从 `for-each-ref` 读出的一条本地分支，位于快照构建之前。 */
interface BranchRef {
  /** 不含 `refs/heads/` 的分支名。 */
  name: string
  /** 分支跟踪上游时，其配置上游的简写形式。 */
  upstream?: string
  /** 配置的上游在远端已不存在时为 true。 */
  upstreamGone?: boolean
}

/**
 * 本地分支及其上游关联，按最近提交时间排序 ——
 * 也正是切换器需要的顺序：进行中的分支排在顶部。
 *
 * 一次 `for-each-ref` 调用即可回答全部问题：`%09` 是安全的字段分隔符，
 * 因为 git 禁止 ref 名中出现控制字符（也就禁止了制表符），所以分支名永远不会
 * 让字段错位。`%(upstream:track)` 对远端已删除的上游报告 `[gone]`，这值得
 * 暴露出来，因为此时该分支已无处可推。
 * @param root - 仓库根。
 */
async function listBranchRefs(root: string): Promise<BranchRef[]> {
  const raw = await runGit(root, [
    'for-each-ref',
    '--sort=-committerdate',
    '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)',
    'refs/heads',
  ])
  const refs: BranchRef[] = []
  for (const line of raw.split('\n')) {
    if (line.trim() === '') continue
    const [name = '', upstream = '', track = ''] = line.split('\t')
    const trimmedName = name.trim()
    if (trimmedName === '') continue
    const trimmedUpstream = upstream.trim()
    refs.push({
      name: trimmedName,
      ...(trimmedUpstream === '' ? {} : { upstream: trimmedUpstream }),
      ...(track.includes('[gone]') ? { upstreamGone: true } : {}),
    })
  }
  return refs
}

/**
 * 本地分支名，按最近提交时间排序。
 * @param root - 仓库根。
 */
async function listBranchNames(root: string): Promise<string[]> {
  return (await listBranchRefs(root)).map((ref) => ref.name)
}

/** HEAD 描述：当前检出的分支，或 detached 状态下的 commit。 */
interface HeadState {
  /** 当前检出的分支名；detached HEAD 时缺省。 */
  current?: string
  /** HEAD 处于 detached 状态时为 true。 */
  detached: boolean
  /** 短 commit hash；仅在 detached HEAD 时存在。 */
  head?: string
}

/**
 * HEAD 描述：当前检出的分支，或 detached 状态下的 commit。
 * 尚未诞生的分支（还没有任何提交的新仓库）仍会报告其分支名，
 * 这正是切换器必须展示的内容。
 * @param root - 仓库根。
 */
async function readHead(root: string): Promise<HeadState> {
  try {
    const current = (await runGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim()
    if (current !== '') return { current, detached: false }
  } catch {
    // Detached HEAD：symbolic-ref 会故意以非零状态退出。
  }
  try {
    const head = (await runGit(root, ['rev-parse', '--short', 'HEAD'])).trim()
    return head === '' ? { detached: true } : { detached: true, head }
  } catch {
    return { detached: true }
  }
}

/**
 * 浏览器渲染所需的完整快照。
 * @param cwd - 会话工作目录的绝对路径。
 * @returns `{ isRepo: false }` 或仓库快照。
 */
export async function readRepoStatus(cwd: string): Promise<RepoStatus> {
  const root = await repoRoot(cwd)
  if (root === undefined) return { isRepo: false }
  const [refs, head] = await Promise.all([listBranchRefs(root), readHead(root)])
  const current = head.current
  const names = refs.map((ref) => ref.name)
  // 尚未诞生的分支（全新仓库，还没有提交）不在 refs/heads 中。
  const missing = current !== undefined && !names.includes(current)
  const allRefs: BranchRef[] = missing && current !== undefined ? [{ name: current }, ...refs] : refs
  const branches: BranchEntry[] = allRefs.map((ref) => ({
    name: ref.name,
    current: ref.name === current,
    ...(ref.upstream === undefined ? {} : { upstream: ref.upstream }),
    ...(ref.upstreamGone === undefined ? {} : { upstreamGone: ref.upstreamGone }),
  }))
  return {
    isRepo: true,
    root,
    detached: head.detached,
    branches,
    ...(current === undefined ? {} : { current }),
    ...(head.head === undefined ? {} : { head: head.head }),
  }
}

/**
 * 检出已存在的本地分支。
 * @param cwd - 会话工作目录的绝对路径。
 * @param branch - 客户端想要的分支名；必须是已存在的本地分支，
 * 因此 revision 表达式、tag 或远端 ref 都无法抵达。
 * @returns 刷新后的快照。
 */
export async function switchBranch(cwd: string, branch: string): Promise<RepoStatus> {
  const root = await requireRepo(cwd)
  const [names, head] = await Promise.all([listBranchNames(root), readHead(root)])
  if (!names.includes(branch)) {
    throw new ApiError('no-such-branch', `branch "${branch}" does not exist locally`, 404)
  }
  if (head.current === branch) return await readRepoStatus(root)
  // `--end-of-options` 保证形似 flag 的分支名不会被当作 flag 解析；
  // `--` 保证该分支不会落入 pathspec 位置。
  await runGit(root, ['checkout', '--end-of-options', branch, '--'])
  return await readRepoStatus(root)
}

/** git 禁止出现在分支名中的字符，在交给 git 之前先行检查。 */
// eslint-disable-next-line no-control-regex -- 控制字符正是这里要匹配的目标。
const INVALID_NAME_CHARS = /[\u0000-\u0020\u007f~^:?*[\\]/

/**
 * 判断用户输入的字符串能否作为分支名。`git check-ref-format` 仍是权威
 * （它还会拒绝 `@{`、结尾的点、`..`、`.lock` 结尾之类的情况）；这里只是
 * 廉价的前置过滤，同时也提前拒绝 git 自身参数解析器会在校验前就吞掉的
 * 那一种形态。
 * @param name - 已去除首尾空白的候选值。
 */
function plausibleBranchName(name: string): boolean {
  if (name === '' || name.length > 200) return false
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false
  if (name.endsWith('.') || name.includes('..') || name.includes('@{') || name.includes('//')) {
    return false
  }
  if (INVALID_NAME_CHARS.test(name)) return false
  return true
}

/**
 * 基于 HEAD 创建分支并检出。
 * @param cwd - 会话工作目录的绝对路径。
 * @param name - 新分支名（git 也会做校验）。
 * @returns 刷新后的快照，此时位于新分支上。
 */
export async function createBranch(cwd: string, name: string): Promise<RepoStatus> {
  const root = await requireRepo(cwd)
  if (!plausibleBranchName(name)) {
    throw new ApiError('invalid-branch-name', 'not a valid branch name', 400)
  }
  try {
    await runGit(root, ['check-ref-format', '--branch', name])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ApiError('invalid-branch-name', message, 400)
  }
  const names = await listBranchNames(root)
  if (names.includes(name)) {
    throw new ApiError('branch-exists', `branch "${name}" already exists`, 409)
  }
  // 此时已确认该名称是合法分支名，且不会以 '-' 开头。
  await runGit(root, ['checkout', '-b', name, '--'])
  return await readRepoStatus(root)
}

/**
 * 会话实际工作的目录：会话已迁移时为 host 中已提交的工作目录，
 * 否则为不可变的 header cwd。
 * @param ctx - Host 上下文。
 * @param sessionId - 请求携带的 session id。
 * @returns 绝对目录；未知时返回 undefined。
 */
function sessionCwd(ctx: HostContext, sessionId: string): string | undefined {
  const sessions = serviceOf<SessionsService>(ctx, 'sessions')
  const session: SessionLike | undefined = sessions?.get?.(sessionId)
  if (session === undefined || session === null) return undefined
  const workingDirectory = serviceOf<WorkingDirectoryService>(ctx, 'workingDirectory')
  const moved = workingDirectory?.get?.(session)
  const cwd = typeof moved === 'string' && moved !== '' ? moved : session.header?.cwd
  return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
}

/** 一个已解析的 JSON 请求体。 */
type JsonObject = Record<string, unknown>

/** 读取并解析有界长度的 JSON 请求体。 */
async function readBody(req: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new ApiError('bad-request', 'request body too large', 413)
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object')
    }
    return parsed as JsonObject
  } catch {
    throw new ApiError('bad-request', 'request body is not a JSON object', 400)
  }
}

/** 写出一个 JSON 响应，除非处理函数已提交响应头。 */
function sendJson(res: ServerResponse, status: number, body: ApiSuccess<RepoStatus> | ApiFailure): void {
  if (res.headersSent) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** 收窄一个必填字符串字段，否则抛出 `bad-request` 失败。 */
function requiredString(payload: JsonObject, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError('bad-request', `missing or invalid "${key}"`, 400)
  }
  return value.trim()
}

/** 本插件拥有的三个端点。 */
type Action = 'status' | 'switch' | 'create'

/**
 * 分发一个端点：解析会话目录、执行操作、以刷新后的快照应答。
 * @param ctx - Host 上下文。
 * @param action - 端点名。
 * @param payload - 已解析的请求体。
 */
async function runAction(ctx: HostContext, action: Action, payload: JsonObject): Promise<RepoStatus> {
  const sessionId = requiredString(payload, 'sessionId')
  const cwd = sessionCwd(ctx, sessionId)
  if (cwd === undefined) {
    throw new ApiError('unavailable', `session "${sessionId}" has no working directory`, 404)
  }
  if (action === 'switch') return await switchBranch(cwd, requiredString(payload, 'branch'))
  if (action === 'create') return await createBranch(cwd, requiredString(payload, 'name'))
  return await readRepoStatus(cwd)
}

/** 构建一个闭包持有 Host 上下文与端点名的路由处理函数。 */
function routeHandler(ctx: HostContext, action: Action): RouteHandler {
  return async (req, res) => {
    try {
      if (req.method !== 'POST') throw new ApiError('method-not-allowed', 'POST required', 405)
      const payload = await readBody(req)
      const value = await runAction(ctx, action, payload)
      sendJson(res, 200, { ok: true, value })
    } catch (error) {
      if (error instanceof ApiError) {
        sendJson(res, error.status, { ok: false, error: { code: error.code, message: error.message } })
        return
      }
      if (error instanceof GitError) {
        sendJson(res, 409, { ok: false, error: { code: error.code, message: error.message } })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      sendJson(res, 500, { ok: false, error: { code: 'internal', message } })
    }
  }
}

/**
 * 本插件拥有的完整路由表。导出以便测试在没有运行中的 Harness 时挂载
 * 这些处理函数。
 * @param ctx - Host 上下文。
 */
export function buildRoutes(ctx: HostContext): WebRoute[] {
  const actions: Action[] = ['status', 'switch', 'create']
  return actions.map((action) => ({
    kind: 'exact',
    path: `${API_BASE}/${action}`,
    handler: routeHandler(ctx, action),
  }))
}

/** 向 Host web server 注册全部路由，并随插件一起释放。 */
export function apply(ctx: HostContext): void {
  for (const route of buildRoutes(ctx)) {
    ctx.effect(() => ctx.webServer.register(route), `git-toolkit: route ${route.path}`)
  }
}

/** Host 侧只需要浏览器载体；会话是可选读取的。 */
export const inject: readonly string[] = ['webServer']
