/**
 * 浏览器侧 · 菜单动作对宿主能力的封装。
 *
 * 每个动作都是一个普通 async 函数，输入是「会话 + 路径 + Remote 面」，输出是
 * 要么完成、要么抛 {@link MenuError}；组件只负责把结果变成菜单上的一行反馈。
 * 这样这些规则可以在 Node 里用结构化桩直接断言，不必渲染 React 或真的碰桌面。
 *
 * 用到的都是宿主**已有**的能力，本功能不新增任何 Host 端点：
 *
 * - 打开 / 在指定程序中打开 / 在文件管理器中定位 → `remote.session.openWorkspacePath`；
 * - 打开方式列表 → `remote.session.workspacePathApplications`；
 * - 读文件内容（复制内容、另存为）→ `remote.workspaceFiles.readBytes`。
 *
 * 另存为完全在浏览器侧落地：优先 File System Access API 的原生保存对话框，
 * 失败时退回 `<a download>` 的下载通道。宿主没有保存对话框能力，也不需要。
 */
import { isAbsolutePath } from './target.js'
import type {
  RemoteApplication,
  RemoteFace,
  RemoteFailure,
  RemoteResult,
  WorkspaceFileBytes,
  WorkspaceFilesRemote,
} from './types.js'

/**
 * 复制文件内容的上限。超过它的文件不适合塞进剪贴板。
 *
 * 这个值同时是「单次窗口读取」的上限：宿主的 `workspaceFiles.readBytes` 用
 * `maxBytes`（默认 2 MiB）限制**带 range 的**读取，超过就拒绝而不是截断。因此
 * 这里必须与那个默认值对齐 —— 更大的文件由「整文件读取 + 另存为」负责。
 */
export const COPY_LIMIT_BYTES = 2 * 1024 * 1024

/** 菜单动作的可展示失败。 */
export class MenuError extends Error {
  /**
   * 稳定的结果类别：
   *
   * - `unavailable` —— 这个部署没有该能力，对应的菜单项不应显示；
   * - `failed` —— 有这项能力，但这次操作失败了，值得告诉用户；
   * - `cancelled` —— 用户自己取消（例如关掉了保存对话框），不该报成错误。
   */
  readonly kind: 'unavailable' | 'failed' | 'cancelled'

  /**
   * 本功能自己的文案键。宿主给的错误只有英文消息，凡是我们**知道**原因的都带一个
   * 键，让界面用用户的语言说话；{@link messageOf} 之外的翻译由组件完成。
   */
  readonly key: string | null

  /** 文案键的参数（例如上限大小）。 */
  readonly params: Record<string, string> | null

  /** 宿主错误的稳定错误码，用于识别可以换成自家文案的失败。 */
  readonly code: string | null

  constructor(
    kind: 'unavailable' | 'failed' | 'cancelled',
    message: string,
    options: { key?: string; params?: Record<string, string>; code?: string } = {},
  ) {
    super(message)
    this.name = 'MenuError'
    this.kind = kind
    this.key = options.key ?? null
    this.params = options.params ?? null
    this.code = options.code ?? null
  }
}

/**
 * 把 Remote 失败信封转成一个可展示的错误。
 * @param failure - 失败信息。
 * @returns 带宿主消息与错误码的错误。
 */
function remoteError(failure: RemoteFailure): MenuError {
  return new MenuError('failed', failure.message === '' ? failure.code : failure.message, {
    code: failure.code,
  })
}

/**
 * 展开一个 Remote 结果，失败时抛错。
 * @param result - Remote 调用的结果信封。
 * @returns 成功时的值。
 */
function unwrap<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw remoteError(result.error)
  return result.value
}

/**
 * 取 `remote.workspaceFiles`，缺失时抛「能力缺失」。
 * @param remote - Remote 面。
 * @returns 可用的 workspaceFiles 命名空间。
 */
function requireFiles(remote: RemoteFace): WorkspaceFilesRemote {
  const files = remote.workspaceFiles
  if (files === undefined) {
    throw new MenuError('unavailable', 'This deployment cannot read workspace files')
  }
  return files
}

/**
 * 取 `remote.session`，缺失时抛「能力缺失」。
 * @param remote - Remote 面。
 * @returns 可用的 session 命名空间。
 */
function requireSession(remote: RemoteFace) {
  const session = remote.session
  if (session === undefined) {
    throw new MenuError('unavailable', 'This deployment cannot open files on the desktop')
  }
  return session
}

/** 判断一个错误是否「能力缺失」（即菜单项应当隐藏）。 */
export function isUnavailable(error: unknown): boolean {
  return error instanceof MenuError && error.kind === 'unavailable'
}

/** 判断一个错误是否只是「用户取消」：收起菜单，不展示失败。 */
export function isCancelled(error: unknown): boolean {
  return error instanceof MenuError && error.kind === 'cancelled'
}

/** 把任意抛出物转成可展示文案。 */
export function messageOf(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message !== '') return error.message
  if (typeof error === 'string' && error !== '') return error
  return fallback
}

/**
 * 取一个错误的本地化文案键。
 * @param error - 任意抛出物。
 * @returns 文案键与参数；没有对应键时为 null（调用方退回 {@link messageOf}）。
 */
export function messageKeyOf(
  error: unknown,
): { key: string; params?: Record<string, string> } | null {
  if (!(error instanceof MenuError) || error.key === null) return null
  return error.params === null ? { key: error.key } : { key: error.key, params: error.params }
}

/**
 * 把可能相对的路径解析成宿主可用的绝对路径。
 *
 * `openWorkspacePath` 与 `workspacePathApplications` 都要求绝对路径：宿主用
 * `resolve()` 之后再校验它在组合文件系统里有映射，因此相对路径会以「相对宿主
 * 进程的 cwd」而不是「相对会话工作区」被解析。文件提及里的相对路径是相对**会话
 * 工作区**的，所以必须先经 `workspaceFiles.stat`（它按会话工作区解析）翻译一次。
 * @param remote - Remote 面。
 * @param sessionId - 会话 id。
 * @param path - 从 DOM 读到的路径。
 * @param signal - 取消信号。
 * @returns 绝对路径。
 */
export async function resolveAbsolutePath(
  remote: RemoteFace,
  sessionId: string,
  path: string,
  signal: AbortSignal,
): Promise<string> {
  if (isAbsolutePath(path)) return path
  const files = requireFiles(remote)
  const stat = unwrap(await files.stat(sessionId, path, signal))
  return stat.absolutePath
}

/**
 * 该部署是否支持把路径交给原生桌面。
 * @param remote - Remote 面。
 * @returns 是否可用；任何失败都按不可用处理。
 */
export async function canOpenOnDesktop(remote: RemoteFace): Promise<boolean> {
  const session = remote.session
  if (session === undefined) return false
  try {
    return unwrap(await session.canOpenWorkspacePath())
  } catch {
    return false
  }
}

/**
 * 取该路径当前的打开方式。
 *
 * 返回 `null` 与返回空数组是两件事：空数组是「宿主确实没有登记的处理器」（例如
 * 一个没有扩展名的文件），`null` 是「这次查询失败了」。后者通常意味着同一个
 * `verifyDesktopPath` 也会让「打开文件」失败 —— 因此调用方据此把打开类菜单项整块
 * 收起来，而不是留几个点了必报错的行。
 * @param remote - Remote 面。
 * @param absolutePath - 绝对路径。
 * @param signal - 取消信号。
 * @returns 应用列表；查询失败（或没有该能力）时为 null。
 */
export async function listApplications(
  remote: RemoteFace,
  absolutePath: string,
  signal: AbortSignal,
): Promise<readonly RemoteApplication[] | null> {
  const session = remote.session
  if (session === undefined) return null
  try {
    return unwrap(await session.workspacePathApplications({ path: absolutePath }, signal))
  } catch {
    return null
  }
}

/**
 * 在系统默认程序中打开文件。
 * @param remote - Remote 面。
 * @param absolutePath - 绝对路径。
 * @param signal - 取消信号。
 */
export async function openFile(
  remote: RemoteFace,
  absolutePath: string,
  signal: AbortSignal,
): Promise<void> {
  unwrap(await requireSession(remote).openWorkspacePath({ path: absolutePath }, signal))
}

/**
 * 用指定程序打开文件。
 * @param remote - Remote 面。
 * @param absolutePath - 绝对路径。
 * @param application - 应用注册标识。
 * @param signal - 取消信号。
 */
export async function openWithApplication(
  remote: RemoteFace,
  absolutePath: string,
  application: string,
  signal: AbortSignal,
): Promise<void> {
  unwrap(
    await requireSession(remote).openWorkspacePath(
      { path: absolutePath, application },
      signal,
    ),
  )
}

/**
 * 在文件管理器中定位文件。
 * @param remote - Remote 面。
 * @param absolutePath - 绝对路径。
 * @param signal - 取消信号。
 */
export async function revealFile(
  remote: RemoteFace,
  absolutePath: string,
  signal: AbortSignal,
): Promise<void> {
  unwrap(
    await requireSession(remote).openWorkspacePath({ path: absolutePath, action: 'reveal' }, signal),
  )
}

/** 一次文件读取的结果。 */
export interface ReadResult {
  /** 原生字节。 */
  readonly data: Uint8Array
  /** 绝对路径（符号链接已解析），可直接交给原生打开。 */
  readonly absolutePath: string
}

/**
 * 按上限读取文件字节，超出上限则报一个可读的失败。
 *
 * 读的是**恰好 `limit` 字节**的窗口，再用宿主给的 `eof` 判断文件是否更大：
 * `eof` 为 false 就说明窗口没有覆盖到文件末尾，即文件超过上限。这样一次往返就能
 * 同时拿到内容与「是否太大」，也不会在两次调用之间被文件变化夹住。
 *
 * 不能读 `limit + 1` 字节：宿主对带 range 的读取有 `maxBytes` 上限（默认正好
 * 2 MiB），超出会被直接拒绝 —— 那时错误信息描述的是我们的窗口而不是用户的文件。
 * @param remote - Remote 面。
 * @param sessionId - 会话 id。
 * @param path - 路径（绝对或相对会话工作区）。
 * @param limit - 允许的最大字节数。
 * @param signal - 取消信号。
 * @returns 字节与绝对路径。
 */
export async function readFileBytes(
  remote: RemoteFace,
  sessionId: string,
  path: string,
  limit: number,
  signal: AbortSignal,
): Promise<ReadResult> {
  let bytes: WorkspaceFileBytes
  try {
    bytes = unwrap(
      await requireFiles(remote).readBytes(
        sessionId,
        path,
        { range: { offset: 0, length: limit } },
        signal,
      ),
    )
  } catch (error: unknown) {
    // 部署把窗口上限配得比本功能的上限更小时，宿主会先拒掉 —— 用户的体验是
    // 「这个文件太大」，因此换成本功能的文案，而不是暴露我们的窗口大小。
    if (error instanceof MenuError && error.code === 'workspace-file/too-large') {
      throw tooLarge(limit)
    }
    throw error
  }
  if (!bytes.eof || bytes.data.byteLength > limit) throw tooLarge(limit)
  return { data: bytes.data, absolutePath: bytes.absolutePath }
}

/**
 * 读取整个文件的字节，交给宿主的总量上限（`maxFileBytes`，默认 32 MiB）。
 *
 * 「另存为」要的是一份完整副本，因此不设自己的窗口：带 range 的读取受 2 MiB
 * 的窗口上限约束，而整文件读取的上限恰好是为这种用途准备的。
 * @param remote - Remote 面。
 * @param sessionId - 会话 id。
 * @param path - 路径（绝对或相对会话工作区）。
 * @param signal - 取消信号。
 * @returns 字节与绝对路径。
 */
export async function readWholeFile(
  remote: RemoteFace,
  sessionId: string,
  path: string,
  signal: AbortSignal,
): Promise<ReadResult> {
  try {
    const result = unwrap(await requireFiles(remote).readBytes(sessionId, path, {}, signal))
    return { data: result.data, absolutePath: result.absolutePath }
  } catch (error: unknown) {
    // 宿主的整文件上限（默认 32 MiB）挡下来时给出本功能的文案。
    if (error instanceof MenuError && error.code === 'workspace-file/too-large') {
      throw new MenuError('failed', 'File is larger than the save limit', { key: 'tooLargeSave' })
    }
    throw error
  }
}

/**
 * 构造一个「文件太大」的失败。
 * @param limit - 触发这次拒绝的上限字节数。
 * @returns 带文案键与格式化上限的错误。
 */
function tooLarge(limit: number): MenuError {
  const readable = formatBytes(limit)
  return new MenuError('failed', `File is larger than ${readable}`, {
    key: 'tooLarge',
    params: { limit: readable },
  })
}

/** 把字节数格式化成人类可读形式。 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * 把文件字节解码成文本。
 * @param data - 原生字节。
 * @returns 文本内容。
 */
export function decodeText(data: Uint8Array): string {
  // 含 NUL 的一定是二进制：UTF-8 的合法编码里不会出现 0x00。
  if (data.includes(0)) {
    throw new MenuError('failed', 'This file is not text', { key: 'binaryFile' })
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    throw new MenuError('failed', 'This file is not UTF-8 text', { key: 'binaryFile' })
  }
}

/**
 * 读取文件内容作为文本（供「复制文件内容」使用）。
 * @param remote - Remote 面。
 * @param sessionId - 会话 id。
 * @param path - 路径。
 * @param signal - 取消信号。
 * @returns 文本内容。
 */
export async function readFileText(
  remote: RemoteFace,
  sessionId: string,
  path: string,
  signal: AbortSignal,
): Promise<string> {
  const result = await readFileBytes(remote, sessionId, path, COPY_LIMIT_BYTES, signal)
  return decodeText(result.data)
}

/** 浏览器侧保存对话框的最小结构声明（避免依赖 DOM lib 的版本）。 */
interface WritableFileStream {
  write(data: Blob): Promise<void>
  close(): Promise<void>
}

/** 保存文件句柄的最小结构声明。 */
interface SaveFileHandle {
  createWritable(): Promise<WritableFileStream>
}

/** 带 File System Access API 的 window。 */
interface SavePickerWindow {
  showSaveFilePicker?(options?: { suggestedName?: string }): Promise<SaveFileHandle>
}

/**
 * 取路径的最后一段，用作另存为时的建议文件名。
 * @param path - 任意路径。
 * @returns 文件名。
 */
export function baseNameOf(path: string): string {
  const segments = path.split(/[\\/]/u).filter((segment) => segment !== '')
  return segments.length === 0 ? 'download' : (segments[segments.length - 1] as string)
}

/** 已经选好去向的保存通道：拿到字节之后再写。 */
export interface Saver {
  /**
   * 写入字节并提交。
   * @param data - 原生字节。
   * @returns 实际使用的通道，供反馈文案区分。
   */
  write(data: Uint8Array): Promise<'dialog' | 'download'>
}

/**
 * 先向用户要一个保存位置，再等字节。
 *
 * 顺序是刻意的：**先弹对话框，再读文件**。两个原因 ——
 *
 *   1. 系统保存对话框需要「用户手势」，而读文件是一次异步往返；先弹框就不必依赖
 *      手势在这段时间内仍然有效。
 *   2. 另存大文件时对话框立刻出现，而不是等几十兆字节传输完才出现。
 *
 * 通道 1 是 File System Access API 的原生保存对话框；它在非安全上下文、跨域 iframe
 * 或用户拒绝时不可用，这时用通道 2（`<a download>` 交给浏览器下载流程）兜底，而
 * 不是让「另存为」彻底失效。
 *
 * 用户取消对话框时抛 {@link MenuError} 的 `cancelled`：那不是错误，组件会静默收
 * 起菜单。拿到 {@link Saver} 之后不调用 `write` 也不会留下任何痕迹 —— 可写流只在
 * `close()` 时提交。
 * @param fileName - 建议文件名。
 * @returns 保存通道。
 */
export async function beginSave(fileName: string): Promise<Saver> {
  const picker = (window as unknown as SavePickerWindow).showSaveFilePicker
  if (typeof picker === 'function') {
    let writable: WritableFileStream
    try {
      const handle = await picker.call(window, { suggestedName: fileName })
      writable = await handle.createWritable()
    } catch (error: unknown) {
      if (isAbort(error)) throw new MenuError('cancelled', 'Save cancelled')
      // 其余失败（权限、跨域、浏览器策略）退回下载通道。
      return downloadSaver(fileName)
    }
    return {
      async write(data: Uint8Array): Promise<'dialog'> {
        await writable.write(octetBlob(data))
        await writable.close()
        return 'dialog'
      },
    }
  }
  return downloadSaver(fileName)
}

/**
 * 判断一个抛出物是否是用户取消。
 * @param error - 抛出物。
 * @returns 是否为 `AbortError`。
 */
function isAbort(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}

/**
 * 把字节包成 Blob。
 * @param data - 原生字节。
 * @returns 二进制 Blob。
 */
function octetBlob(data: Uint8Array): Blob {
  // `Uint8Array` 在运行时就是合法的 `BlobPart`；这里的断言只为绕开不同 TS lib
  // 版本对 `ArrayBufferLike` 与 `ArrayBuffer` 的差异。
  return new Blob([data as unknown as BlobPart], { type: 'application/octet-stream' })
}

/**
 * 走浏览器下载流程的保存通道。
 * @param fileName - 建议文件名。
 * @returns 保存通道。
 */
function downloadSaver(fileName: string): Saver {
  return {
    async write(data: Uint8Array): Promise<'download'> {
      downloadBlob(octetBlob(data), fileName)
      return 'download'
    },
  }
}

/**
 * 用一次隐式下载把 Blob 交给浏览器。
 * @param blob - 内容。
 * @param fileName - 建议文件名。
 */
function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
    // 下载已经排进队列，可以立刻释放引用。
    setTimeout(() => {
      URL.revokeObjectURL(url)
    }, 0)
  }
}
