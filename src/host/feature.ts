/**
 * Host 侧 · 功能契约与注册上下文。
 *
 * 每个功能实现一个 {@link HostFeature}，只在自己的 `register` 里装配自己的
 * 表面（路由、后台任务…），并通过 {@link HostFeatureContext} 拿到两样共享设施：
 *
 * - `isEnabled()`：该功能的开关实时值。设置写入是 volatile commit，**不会**让
 *   插件重挂载，因此 `apply` 只跑一次；开关必须在每次用到时重新读取，而不是在
 *   注册时求值一次。
 * - `jsonRoute()`：注册一条 JSON 端点，并自动获得「功能关闭时统一 404」的
 *   前置守卫，功能内部无需重复判断开关。
 *
 * 功能之间不互相引用：Host 入口只认这份契约，注册表（`features/registry.ts`）
 * 负责把 id 映射到实现。
 */
import type { FeatureId } from '../features.js'
import type { HostContext, WebRoute } from '../host-api.js'
import { ApiError, jsonRoute, type JsonAction } from './http.js'

/** 功能注册时拿到的上下文。 */
export interface HostFeatureContext {
  /** 原始 Host 上下文；功能需要 `sessions` 之类的服务时用它取。 */
  readonly ctx: HostContext
  /** 该功能此刻是否开启；每次调用都重新读取设置。 */
  isEnabled(): boolean
  /**
   * 注册一条 JSON 端点（`POST`，同源）。
   *
   * 功能被关闭后该端点仍然挂着，但一律以 `404 feature-disabled` 应答 —— 这比在
   * 开关变化时反复注册/注销路由更稳，也不会与 Host 的路由表生命周期打交到。
   * @param path - 绝对路径。
   * @param action - 业务处理函数。
   */
  jsonRoute<T>(path: string, action: JsonAction<T>): void
  /**
   * 注册一条完整路由（需要非 JSON 响应时使用）。
   * @param route - 路由定义。
   */
  route(route: WebRoute): void
}

/** 一个功能的 Host 实现。 */
export interface HostFeature {
  /** 功能 id，必须与 `features.ts` 的声明一致。 */
  readonly id: FeatureId
  /** 装配该功能的全部 Host 表面。 */
  register(feature: HostFeatureContext): void
}

/**
 * 为一次 `register` 构建功能上下文。
 * @param ctx - Host 上下文。
 * @param isEnabled - 读取该功能开关的实时函数。
 * @returns 功能注册上下文。
 */
export function featureContext(ctx: HostContext, isEnabled: () => boolean): HostFeatureContext {
  const mount = (route: WebRoute): void => {
    void ctx.effect(() => ctx.webServer.register(route), `dsh-toolkit: route ${route.path}`)
  }
  return {
    ctx,
    isEnabled,
    jsonRoute<T>(path: string, action: JsonAction<T>): void {
      mount(
        jsonRoute(path, action, {
          guard: () => {
            if (!isEnabled()) {
              throw new ApiError('feature-disabled', 'this feature is turned off', 404)
            }
          },
        }),
      )
    },
    route(route: WebRoute): void {
      mount(route)
    },
  }
}
