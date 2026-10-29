/**
 * 浏览器侧 · Host 端提供的三个 POST 端点。
 *
 * 每次调用都同源，且相对于页面目录（绝不是 origin 根），因此 GUI
 * 本身挂在子路径下时插件仍能工作。响应通过共享的信封守卫收窄，
 * 每个端点都返回刷新后的仓库快照，调用方无需第二次往返即可存储。
 */
import {
  API_BASE,
  asApiFailure,
  asApiSuccess,
  type BranchEntry,
  type CreateRequest,
  type RepoStatus,
  type RepoStatusPresent,
  type StatusRequest,
  type SwitchRequest,
} from '../shared.js'

/** 去掉前导斜杠的路由前缀：`new URL` 随后按相对路径解析它。 */
const API_PATH = API_BASE.replace(/^\/+/, '')

/** 一个端点名。 */
type ApiAction = 'status' | 'switch' | 'create'

/** Host 端接受的任意请求体。 */
type RequestBody = StatusRequest | SwitchRequest | CreateRequest

/** 带 wire code 的请求级失败，抛出后由 UI 展示。 */
class ApiRequestError extends Error {
  /** 失败信封中的 code；没有时用 `HTTP_<status>`。 */
  readonly code: string

  constructor(message: string, code: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
  }
}

/**
 * 页面所在目录的绝对 URL。
 * API 路径据此解析，绝不相对 origin 根解析。
 */
function pageBaseUrl(): string {
  const fallback = typeof location === 'undefined' ? 'http://localhost/' : location.href
  const raw = (typeof document !== 'undefined' && document.baseURI) || fallback
  try {
    const url = new URL(raw)
    let path = url.pathname === '' ? '/' : url.pathname
    if (!path.endsWith('/')) {
      // 以文件名结尾的 baseURI 会相对其所在目录解析。
      path = /\.[a-z0-9]+$/i.test(path) ? path.slice(0, path.lastIndexOf('/') + 1) : `${path}/`
    }
    url.pathname = path
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return raw.endsWith('/') ? raw : `${raw}/`
  }
}

/** Host 端某个端点的绝对 URL。 */
function apiUrl(action: ApiAction): string {
  const relative = `${API_PATH}/${action}`
  try {
    return new URL(relative, pageBaseUrl()).toString()
  } catch {
    return relative
  }
}

/**
 * POST 一个 JSON 请求体并返回成功载荷。
 * @param action - 要调用的端点。
 * @param body - 请求体，已按共享请求类型构造好。
 * @param signal - 调用方持有的 abort signal。
 * @throws {ApiRequestError} 传输、HTTP 或信封失败时抛出；其 message
 * 即 UI 展示的内容（Host 转发时则为 git 自己的文本）。
 */
async function postJson(action: ApiAction, body: RequestBody, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(apiUrl(action), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    credentials: 'same-origin',
    signal,
  })
  let parsed: unknown = null
  try {
    parsed = await response.json()
  } catch {
    parsed = null
  }
  const failure = asApiFailure(parsed)
  const success = asApiSuccess<unknown>(parsed)
  if (!response.ok || success === undefined) {
    const code = failure === undefined ? `HTTP_${response.status}` : failure.error.code
    const detail = failure === undefined ? '' : failure.error.message
    throw new ApiRequestError(detail === '' ? `HTTP ${response.status}` : detail, code)
  }
  return success.value
}

/**
 * 收窄一个分支条目；没有 name 的条目会被丢弃。可选的 upstream 字段
 * 原样传递（它们驱动面板中右对齐的远程名），格式错误的字段直接略去。
 */
function asBranchEntry(value: unknown): BranchEntry | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as {
    name?: unknown
    current?: unknown
    upstream?: unknown
    upstreamGone?: unknown
  }
  if (typeof candidate.name !== 'string') return undefined
  const branch: BranchEntry = { name: candidate.name, current: candidate.current === true }
  if (typeof candidate.upstream === 'string' && candidate.upstream !== '') {
    branch.upstream = candidate.upstream
  }
  if (candidate.upstreamGone === true) branch.upstreamGone = true
  return branch
}

/**
 * 把端点载荷收窄为 UI 渲染的快照。
 * 格式错误的可选字段回落到渲染器使用的相同默认值：缺失 branches 表示
 * 空列表，缺失分支名表示 HEAD。
 * @param value - 成功信封中的 `value`。
 * @returns 快照；载荷根本不是对象时返回 undefined。
 */
export function asRepoStatus(value: unknown): RepoStatus | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Record<string, unknown>
  if (candidate['isRepo'] !== true) {
    return candidate['isRepo'] === false ? { isRepo: false } : undefined
  }
  const branches: BranchEntry[] = []
  const rawBranches: unknown = candidate['branches']
  if (Array.isArray(rawBranches)) {
    for (const raw of rawBranches) {
      const branch = asBranchEntry(raw)
      if (branch !== undefined) branches.push(branch)
    }
  }
  const root = typeof candidate['root'] === 'string' ? candidate['root'] : ''
  const status: RepoStatusPresent = {
    isRepo: true,
    root,
    detached: candidate['detached'] === true,
    branches,
  }
  const current = candidate['current']
  if (typeof current === 'string' && current !== '') status.current = current
  const head = candidate['head']
  if (typeof head === 'string' && head !== '') status.head = head
  return status
}

/** 获取一个会话的快照。 */
export async function fetchStatus(sessionId: string, signal: AbortSignal): Promise<RepoStatus> {
  const body: StatusRequest = { sessionId }
  return asRepoStatus(await postJson('status', body, signal)) ?? { isRepo: false }
}

/** 检出一个已存在的本地分支，并返回刷新后的快照。 */
export async function requestSwitch(
  sessionId: string,
  branch: string,
  signal: AbortSignal,
): Promise<RepoStatus> {
  const body: SwitchRequest = { sessionId, branch }
  return asRepoStatus(await postJson('switch', body, signal)) ?? { isRepo: false }
}

/** 从 HEAD 创建一个分支、将其检出，并返回刷新后的快照。 */
export async function requestCreate(
  sessionId: string,
  name: string,
  signal: AbortSignal,
): Promise<RepoStatus> {
  const body: CreateRequest = { sessionId, name }
  return asRepoStatus(await postJson('create', body, signal)) ?? { isRepo: false }
}

/** pill 上显示的分支；detached HEAD 与非仓库均视为 HEAD。 */
export function currentBranchName(status: RepoStatusPresent | null): string {
  if (status === null) return 'HEAD'
  if (status.detached) return 'HEAD'
  return status.current !== undefined && status.current !== '' ? status.current : 'HEAD'
}

/** 稳定的空列表，使无关的重渲染保持相同的数组引用。 */
const EMPTY_BRANCHES: readonly BranchEntry[] = []

/** 切换器列出的分支；格式错误时绝不返回 Host 的原始数组。 */
export function branchList(status: RepoStatusPresent | null): readonly BranchEntry[] {
  if (status === null || !Array.isArray(status.branches)) return EMPTY_BRANCHES
  return status.branches
}

/** API 辅助函数抛出任何错误时展示的消息。 */
export function formatError(error: unknown, fallback: string): string {
  if (error === null || error === undefined) return fallback
  if (typeof error === 'string') return error
  if (typeof error === 'object' && 'message' in error) {
    const message = error.message
    if (typeof message === 'string' && message !== '') return message
  }
  return fallback
}
