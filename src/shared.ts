/**
 * dsh-git-toolkit 两半共用的类型与常量。
 *
 * 本模块会被编译进 Host bundle，也会被打包进浏览器产物，因此必须保持零依赖：
 * 不得有 `node:` 导入，不得依赖 Harness 各包，只能包含类型声明与普通常量。
 */

/** 插件 id：Loader 行 id、浏览器工厂 id，以及 locale 命名空间。 */
export const PLUGIN_ID = 'dsh-git-toolkit'

/** Host 侧面向浏览器的 API base。 */
export const API_BASE = '/api/git-toolkit'

/** 切换器所列出的一条本地分支。 */
export interface BranchEntry {
  /** 不含 `refs/heads/` 的分支名。 */
  name: string
  /** 是否为当前检出的分支。 */
  current: boolean
  /**
   * 配置的上游，采用 `<remote>/<branch>` 简写形式（例如
   * `origin/fix/released`）；分支未跟踪任何上游时缺省。
   */
  upstream?: string
  /** 配置了上游但该上游在远端已不存在时为 true。 */
  upstreamGone?: boolean
}

/** 会话工作目录位于 git work tree 内。 */
export interface RepoStatusPresent {
  isRepo: true
  /** 仓库根的绝对路径。 */
  root: string
  /** 当前检出的分支；detached HEAD 时缺省。 */
  current?: string
  /** HEAD 处于 detached 状态时为 true（此时 `current` 缺省而 `head` 有值）。 */
  detached: boolean
  /** 短 commit hash，仅在 detached HEAD 时存在。 */
  head?: string
  /** 全部本地分支，按最近提交时间排序。 */
  branches: BranchEntry[]
}

/** 会话工作目录不在 git work tree 内。 */
export interface RepoStatusAbsent {
  isRepo: false
}

/** 每个端点在成功时返回的内容。 */
export type RepoStatus = RepoStatusPresent | RepoStatusAbsent

/** 每个端点的请求体。 */
export interface StatusRequest {
  sessionId: string
}

/** `POST /switch` 的请求体。 */
export interface SwitchRequest extends StatusRequest {
  /** 一个已存在的本地分支名。 */
  branch: string
}

/** `POST /create` 的请求体。 */
export interface CreateRequest extends StatusRequest {
  /** 新的分支名，基于 HEAD 创建并检出。 */
  name: string
}

/** 成功信封。 */
export interface ApiSuccess<T> {
  ok: true
  value: T
}

/** 失败信封：`code` 由 UI 本地化，`message` 可能是 git 自身的文本。 */
export interface ApiFailure {
  ok: false
  error: {
    code: string
    message: string
  }
}

/** 每个端点的响应。 */
export type ApiResult<T> = ApiSuccess<T> | ApiFailure

/**
 * 将未知的已解析响应收窄为成功信封。
 * @param value - 已解析的 JSON，或调用方持有的任意值。
 * @returns 结构合法时返回该信封，否则返回 undefined。
 */
export function asApiSuccess<T>(value: unknown): ApiSuccess<T> | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as { ok?: unknown; value?: unknown }
  if (candidate.ok !== true) return undefined
  return { ok: true, value: candidate.value as T }
}

/**
 * 将未知的已解析响应收窄为失败信封。
 * @param value - 已解析的 JSON，或调用方持有的任意值。
 * @returns 结构合法时返回该信封，否则返回 undefined。
 */
export function asApiFailure(value: unknown): ApiFailure | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as { ok?: unknown; error?: unknown }
  if (candidate.ok !== false) return undefined
  const error = candidate.error
  if (error === null || typeof error !== 'object') return undefined
  const { code, message } = error as { code?: unknown; message?: unknown }
  return {
    ok: false,
    error: {
      code: typeof code === 'string' && code !== '' ? code : 'unknown',
      message: typeof message === 'string' ? message : '',
    },
  }
}
