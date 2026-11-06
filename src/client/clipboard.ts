/**
 * 浏览器侧 · 把一段文本写进系统剪贴板。
 *
 * 「怎么复制」是跨功能的，因此它住在工具包这一层，而不是某个功能目录里。功能只
 * 决定**复制什么**（分支名、文件路径、文件内容），再调用这里：
 *
 *   - 优先用异步 Clipboard API；它只在安全上下文可用，也可能被权限拒绝，因此失败
 *     时退回隐藏 textarea + `document.execCommand('copy')`。这样即使在 http 部署
 *     或权限受限的浏览器里，点下去也真的复制到了东西，而不是静默失败。
 *
 * 本模块只依赖标准 DOM 全局对象，不 import 任何 Harness 包，因此可以在 Node 里用
 * 结构化桩直接断言两条通道的取舍。
 */

/**
 * 把文本写进系统剪贴板。
 *
 * 不抛错：复制失败是「这一次按下去没生效」，不应该让点击处理器里冒出异常；组件
 * 据此决定要不要显示成功反馈。
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
 * 里打字，复制一段文本不该打断这件事。
 * @param text - 要复制的文本。
 * @returns 是否成功复制。
 */
function writeClipboardFallback(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false
  const active =
    typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
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
