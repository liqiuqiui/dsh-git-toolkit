/**
 * Host 侧 · JSON 路由的传输层。
 *
 * 每个功能只写「解析出的请求体 → 结果」这一段，信封、内容长度上限、错误码到
 * HTTP 状态码的映射都留在这里，因此各功能之间不会各自发明一套响应格式，
 * 浏览器侧也只需要一套收窄守卫。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ApiFailure, ApiSuccess, ApiResult } from '../shared.js'
import type { RouteHandler, WebRoute } from '../host-api.js'

/** 单个 JSON 请求体的上限。 */
const MAX_BODY_BYTES = 64 * 1024

/** 已解析的请求体。 */
export type JsonObject = Record<string, unknown>

/**
 * 一次请求级失败，携带传输 code 与 HTTP 状态码。
 *
 * 功能直接 `throw new ApiError(code, message, status)`；路由层把它翻译成失败
 * 信封，因此各功能不必接触 `res`。
 */
export class ApiError extends Error {
  readonly code: string

  readonly status: number

  constructor(code: string, message: string, status = 400) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

/** 读取并解析有界长度的 JSON 请求体；空请求体解析为 `{}`。 */
export async function readJsonBody(req: IncomingMessage): Promise<JsonObject> {
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
export function sendJson(res: ServerResponse, status: number, body: ApiResult<unknown>): void {
  if (res.headersSent) return
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** 收窄一个必填字符串字段，否则抛出 `bad-request` 失败。 */
export function requiredString(payload: JsonObject, key: string): string {
  const value = payload[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ApiError('bad-request', `missing or invalid "${key}"`, 400)
  }
  return value.trim()
}

/**
 * 把一次业务失败翻译成失败信封。
 * @param error - 处理函数抛出的值。
 * @returns HTTP 状态码与响应体。
 */
export function toFailure(error: unknown): { status: number; body: ApiFailure } {
  if (error instanceof ApiError) {
    return {
      status: error.status,
      body: { ok: false, error: { code: error.code, message: error.message } },
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { status: 500, body: { ok: false, error: { code: 'internal', message } } }
}

/** 一个端点的业务处理函数：拿到已解析的请求体，返回该端点的 `value`。 */
export type JsonAction<T> = (payload: JsonObject) => Promise<T>

/**
 * 把一个业务处理函数包成 Harness 可挂载的路由。
 * @param path - 绝对路径。
 * @param action - 业务处理函数。
 * @param options - `guard` 在解析请求体之前运行，用于整体关闭某个功能。
 * @returns 一条 `exact` 路由。
 */
export function jsonRoute<T>(
  path: string,
  action: JsonAction<T>,
  options: { guard?: () => void } = {},
): WebRoute {
  const handler: RouteHandler = async (req, res) => {
    try {
      if (req.method !== 'POST') throw new ApiError('method-not-allowed', 'POST required', 405)
      options.guard?.()
      const payload = await readJsonBody(req)
      const value = await action(payload)
      sendJson(res, 200, { ok: true, value } satisfies ApiSuccess<T>)
    } catch (error) {
      const { status, body } = toFailure(error)
      sendJson(res, status, body)
    }
  }
  return { kind: 'exact', path, handler }
}
