/**
 * 浏览器侧 · 把分支名写进系统剪贴板。
 *
 * 两个函数都是「纯逻辑 + 一层很薄的浏览器 API 封装」，组件只负责决定
 * **什么时候**调用它们，因此这里可以在 Node 里用结构化桩直接断言：
 *
 *   - {@link branchCopyText} 决定复制什么：可见的分支身份。徽标的 tooltip 里
 *     还有上游分支与游离 HEAD 的说明，但用户点「复制分支名」想要的只是分支名
 *     本身；游离 HEAD 没有分支名，复制提交短哈希才有用（复制一个 `HEAD` 没有
 *     任何去处）。
 *   - {@link writeClipboard} 决定怎么复制：优先异步 Clipboard API；它只在安全
 *     上下文可用，也可能被权限拒绝，因此失败时退回隐藏 textarea +
 *     `document.execCommand('copy')`。这样即使在 http 部署或权限受限的浏览器
 *     里，点下去也真的复制到了东西，而不是静默失败。
 */
import { currentBranchName } from './api.js'
import type { RepoStatusPresent } from '../../../features/git-branch/shared.js'

/** 游离 HEAD 且 Host 没有给出提交短名时的复制内容。 */
const DETACHED_FALLBACK = 'HEAD'

/**
 * 点击徽标时写进剪贴板的内容。
 * @param status - 徽标当前展示的仓库快照。
 * @returns 分支名；游离 HEAD 时为提交短名（取不到时退回 `HEAD`）。
 */
export function branchCopyText(status: RepoStatusPresent): string {
  if (!status.detached) return currentBranchName(status)
  const head = status.head
  return typeof head === 'string' && head !== '' ? head : DETACHED_FALLBACK
}

/**
 * 把文本写进系统剪贴板。
 *
 * 不抛错：复制失败是「这一次按下去没生效」，不应该让 composer 里出现异常，
 * 组件据此决定要不要显示成功反馈。
 * @param text - 要复制的文本。
 * @returns 是否成功写入剪贴板。
 */
export async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 页面没有焦点、用户拒绝权限、或浏览器只允许在用户手势里写入时都会走到
      // 这里：继续尝试下面的兜底通道，而不是直接报告失败。
    }
  }
  return writeClipboardFallback(text)
}

/**
 * 兜底通道：隐藏 textarea + `document.execCommand('copy')`。
 *
 * 会短暂抢走焦点与选区，因此结束时把它们还原 —— 用户可能正把光标放在输入框
 * 里打字，复制一个分支名不该打断这件事。
 * @param text - 要复制的文本。
 * @returns 是否成功复制。
 */
function writeClipboardFallback(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const active = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null
  const selection = document.getSelection()
  const previous = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0) : null
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '-9999px'
  area.style.opacity = '0'
  document.body.appendChild(area)
  try {
    area.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
    // 选区所在的节点可能在这段代码运行期间被卸载（例如 composer 正在切换会话），
    // 那时 `addRange` 会抛 `IndexSizeError`，因此先确认两端仍然挂载在文档里。
    if (
      selection !== null &&
      previous !== null &&
      previous.startContainer.isConnected &&
      previous.endContainer.isConnected
    ) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
    if (active !== null && active.isConnected) active.focus({ preventScroll: true })
  }
}
