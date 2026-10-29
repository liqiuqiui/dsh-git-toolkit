/**
 * 本插件所消费 Host API 的最小结构化类型。
 *
 * 真正的声明位于 Harness 各包中，而这些包并非本仓库的依赖（插件以普通文件
 * 形式面向运行中的 Host 交付）。这些接口精确描述 `apply` 触及的部分，因此
 * Host 侧无需导入 `@deepseek-ai/*` 也能保持类型检查。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

/** 由已注册路由处理的一次 HTTP 请求。 */
export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** Host web server 应暴露的一条路由。 */
export interface WebRoute {
  /** `exact` 匹配单一路径；`prefix` 匹配其下所有内容。 */
  kind: 'exact' | 'prefix'
  /** 以 `/` 开头的绝对路径。 */
  path: string
  /** 请求处理函数。 */
  handler: RouteHandler
}

/** 此处用到的 Host web server 子集。 */
export interface WebServerService {
  /** 注册一条路由；返回的函数用于注销该路由。 */
  register(route: WebRoute): () => void
}

/** 用于解析工作目录的实时会话子集。 */
export interface SessionLike {
  header?: { cwd?: string } | undefined
}

/** 此处用到的 Host 会话注册表子集。 */
export interface SessionsService {
  get?(sessionId: string): SessionLike | undefined
}

/** 此处用到的 Host 工作目录服务子集。 */
export interface WorkingDirectoryService {
  get?(session: SessionLike): string | undefined
}

/** 传给 `apply` 的 Host 上下文。 */
export interface HostContext {
  /** 运行一个可释放的副作用；回调的返回值即释放函数。 */
  effect(fn: () => unknown, label?: string): unknown
  /** 按 key 查找一个 Host 服务；未知服务返回 `undefined`。 */
  get(key: string): unknown
  /** Host web server（在 `inject` 中声明）。 */
  webServer: WebServerService
}

/**
 * 按本插件期望的结构读取一个 Host 服务。
 * @param ctx - Host 上下文。
 * @param key - 服务 key。
 * @returns 该服务；缺失或结构不同则返回 undefined。
 */
export function serviceOf<T>(ctx: HostContext, key: string): T | undefined {
  const value: unknown = ctx.get(key)
  if (value === null || typeof value !== 'object') return undefined
  return value as T
}
