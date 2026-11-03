/**
 * dsh-toolkit · 两半共用的类型与常量。
 *
 * 本模块会被编译进 Host bundle，也会被打包进浏览器产物，因此必须保持零依赖：
 * 不得有 `node:` 导入，不得依赖 Harness 各包，只能包含类型声明与普通常量。
 *
 * 这里只放**跨功能**的东西。某个功能自己的线上类型（请求体、快照）留在该功能的
 * 目录里，例如 `src/features/git-branch/shared.ts`。
 */

/** 插件 id：Loader 行 id、浏览器工厂 id、locale 命名空间，以及详情页配置的键。 */
export const PLUGIN_ID = 'dsh-toolkit'

/**
 * 本插件所有端点共享的 base。
 *
 * 每个功能在其 base 之下再占一段（例如 git-branch 用 `${API_BASE}/git`），
 * 因此功能之间不会抢路径。
 */
export const API_BASE = '/api/dsh-toolkit'

/** 成功信封。 */
export interface ApiSuccess<T> {
  ok: true
  value: T
}

/** 失败信封：`code` 由 UI 本地化，`message` 可能是底层工具自身的文本。 */
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
