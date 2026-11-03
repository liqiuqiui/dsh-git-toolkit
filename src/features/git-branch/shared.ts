/**
 * git-branch 功能 · 两半共用的线上类型与端点路径。
 *
 * 这些类型只属于本功能：信封（`ApiResult`）是跨功能的，留在 `src/shared.ts`。
 * 浏览器侧据此收窄响应，Host 侧据此构造响应，两边因此不会各自漂移。
 */
import { API_BASE } from '../../shared.js'

/** 本功能的端点前缀：`/api/dsh-toolkit/git`。 */
export const GIT_API = `${API_BASE}/git`

/** 切换器列出的一条本地分支。 */
export interface BranchEntry {
  /** 不含 `refs/heads/` 的分支名。 */
  name: string
  /** HEAD 是否指向该分支。 */
  current: boolean
  /** 该分支跟踪的上游，简写形式（例如 `origin/main`）。 */
  upstream?: string
  /** 配置的上游在远端已不存在。 */
  upstreamGone?: boolean
}

/** 会话工作目录位于 git work tree 内。 */
export interface RepoStatusPresent {
  isRepo: true
  /** 仓库根（worktree 的顶层）绝对路径。 */
  root: string
  /** HEAD 是否处于游离状态。 */
  detached: boolean
  /** HEAD 所指向的分支名；游离时为 undefined。 */
  current?: string
  /** 游离 HEAD 时的提交短名。 */
  head?: string
  /** 本地分支，最近的在前。 */
  branches: BranchEntry[]
}

/** 会话工作目录不是 git work tree（或 git 不可用）。 */
export interface RepoStatusAbsent {
  isRepo: false
}

/** 一次快照：`isRepo` 让 UI 决定是否渲染任何东西。 */
export type RepoStatus = RepoStatusPresent | RepoStatusAbsent

/** `/git/status` 的请求体。 */
export interface StatusRequest {
  sessionId: string
}

/** `/git/switch` 的请求体。 */
export interface SwitchRequest extends StatusRequest {
  branch: string
}

/** `/git/create` 的请求体。 */
export interface CreateRequest extends StatusRequest {
  name: string
}
