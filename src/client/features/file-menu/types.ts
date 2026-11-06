/**
 * 浏览器侧 · 本功能用到的 Harness Remote 结构类型。
 *
 * 这里刻意只声明**用到的那几个方法**，而不是 `import type` 任何
 * `@deepseek-ai/*` 包：浏览器产物只能 `require('react')`，任何对 Harness 包的
 * 值导入都会在运行时失败；而类型导入虽被擦除，却会把插件的编译绑到某个
 * Harness 版本的具体模块路径上。结构化声明让本功能在服务形态微调时自然降级
 * （调用不存在的方法会被这里的类型挡住），也不会因为宿主升级而编译不过。
 *
 * 字段语义对齐 `@deepseek-ai/dsh-api-workspace-files` 与
 * `@deepseek-ai/dsh-api-session-controller` 的 Typert schema。
 */

/** Remote 调用的失败信息。 */
export interface RemoteFailure {
  readonly code: string
  readonly message: string
  readonly details?: unknown
}

/** 所有 Remote 调用共用的结果信封。 */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RemoteFailure }

/**
 * 一个「可以用它打开某文件」的应用程序。
 *
 * 来自宿主桌面探测：`id` 是注册标识（macOS 上是 .app 的绝对路径），`icon` 是
 * 内联的 base64 PNG data URI（没有图标时为 null），因此渲染图标不需要任何
 * 额外的路由或静态资源。
 */
export interface RemoteApplication {
  /** 注册标识；`openWorkspacePath` 的 `application` 参数用它。 */
  readonly id: string
  /** 面向用户的名称，如 `Visual Studio Code`。 */
  readonly name: string
  /** 是否是该系统上登记用该类型文件的默认程序。 */
  readonly default: boolean
  /** `data:image/png;base64,…`，或 null。 */
  readonly icon: string | null
  /** 应用的 bundle 标识（Windows/Linux 上可能与 `id` 不同）。 */
  readonly bundle?: string
  /** 应用版本。 */
  readonly version?: string
}

/** `remote.session` 命名空间里本功能使用的方法。 */
export interface SessionRemote {
  /** 该部署能否把工作区路径交给原生桌面打开。 */
  canOpenWorkspacePath(): Promise<RemoteResult<boolean>>
  /**
   * 在宿主桌面上打开一个**绝对**路径。
   * @param request - 路径；`action: 'reveal'` 改为在文件管理器中定位，
   * `application` 指定用哪个程序打开（对 reveal 无效）。
   */
  openWorkspacePath(
    request: { path: string; action?: 'reveal'; application?: string },
    signal?: AbortSignal,
  ): Promise<RemoteResult<{ opened: true }>>
  /** 该路径当前登记的全部打开方式。 */
  workspacePathApplications(
    request: { path: string },
    signal?: AbortSignal,
  ): Promise<RemoteResult<readonly RemoteApplication[]>>
}

/** 一次 `stat` 的结果。 */
export interface WorkspaceFileStat {
  /** 绝对路径（符号链接已解析）。 */
  readonly absolutePath: string
  /** 不透明的版本令牌。 */
  readonly version: string
  /** 完整文件的字节数（后端能给出时）。 */
  readonly bytes?: number
}

/** 一次字节窗口读取的结果。 */
export interface WorkspaceFileBytes {
  /** 窗口起始字节。 */
  readonly offset: number
  /** 原生字节。 */
  readonly data: Uint8Array
  /** 窗口是否覆盖了文件最后一字节。 */
  readonly eof: boolean
  /** 绝对路径（符号链接已解析）。 */
  readonly absolutePath: string
  /** 不透明的版本令牌。 */
  readonly version: string
  /** 完整文件的字节数（后端能给出时）。 */
  readonly bytes?: number
}

/** `remote.workspaceFiles` 命名空间里本功能使用的方法。 */
export interface WorkspaceFilesRemote {
  /** 解析路径并读取身份信息；相对路径按会话工作区解析。 */
  stat(
    sessionId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileStat>>
  /**
   * 读取一段字节窗口。
   * @param options - `range` 指定窗口（省略则读完整文件，受宿主的总量上限约束）。
   */
  readBytes(
    sessionId: string,
    path: string,
    options?: { range?: { offset?: number; length?: number } },
    signal?: AbortSignal,
  ): Promise<RemoteResult<WorkspaceFileBytes>>
}

/**
 * `remote` 服务面上本功能用到的部分。
 *
 * 两个命名空间都可能缺席：`remote.session` 由会话控制器提供，`remote.workspaceFiles`
 * 由独立的可选插件提供。缺任何一个都只让对应的菜单项消失，其余照常工作。
 */
export interface RemoteFace {
  readonly session?: SessionRemote
  readonly workspaceFiles?: WorkspaceFilesRemote
}
