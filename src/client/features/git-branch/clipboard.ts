/**
 * 浏览器侧 · 把分支名写进系统剪贴板。
 *
 * 「复制什么」留在这里，因为它是分支语义：{@link branchCopyText} 决定复制的是
 * 可见的分支身份。徽标的 tooltip 里还有上游分支与游离 HEAD 的说明，但用户点
 * 「复制分支名」想要的只是分支名本身；游离 HEAD 没有分支名，复制提交短哈希才有
 * 用（复制一个 `HEAD` 没有任何去处）。
 *
 * 「怎么复制」是跨功能的（文件右键菜单同样要复制路径与内容），因此那个函数住在
 * `src/client/clipboard.ts`；这里按原有名字转发出去，功能内部的调用点与对外的
 * 导出都不必改变。
 */
import { currentBranchName } from './api.js'
import type { RepoStatusPresent } from '../../../features/git-branch/shared.js'

export { writeClipboard } from '../../clipboard.js'

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
