/**
 * 浏览器侧 · 进行中对话 composer 工具行中的分支徽标。
 *
 * 注册在 `conversation.input.left` 上，这是 Host 在 composer 工具行右端渲染的
 * 列表槽位（位于附件按钮、权限预设和计划预设之后）。New Session 的 Hero 行只在
 * 会话开始前存在，因此进行中的对话无法显示其工作区位于哪个分支；该指示器正是
 * 用来解决这个问题。
 *
 * 它**仍然不改动工作区**：切换分支属于新会话的决策，一个会在 agent 运行期间
 * 悄悄把工作区检出的控件会是个陷阱；完整的选择器留在 Hero 行的 pill 上。它唯一
 * 的动作是复制 —— 悬停时分支图标换成复制图标，点击把当前分支名写进剪贴板并短暂
 * 显示一个勾。这样它既不会被误读成「可以切换」，分支名也不再只能靠拖选或
 * 终端里的 `git branch --show-current` 取。
 */
import * as React from 'react'
import type { ReactElement } from 'react'

import { currentBranchName, fetchStatus } from './api.js'
import { branchCopyText, writeClipboard } from './clipboard.js'
import { BranchIcon, CheckIcon, CopyIcon } from './icons.js'
import type { RepoStatusPresent } from '../../../features/git-branch/shared.js'
import { BADGE_CSS } from './styles.js'

const { useEffect, useState } = React

/** 复制成功后勾号保留的时长（毫秒）。够看清，又不至于让徽标长期停在「已复制」。 */
const COPIED_RESET_MS = 1200

/** Host 传给 `conversation.input.left` 占用者的 props。 */
export interface BranchBadgeProps {
  /** composer 所属的会话。 */
  sessionId: string
  /** 绑定命名空间的翻译函数（`dsh-toolkit/git-branch`）。 */
  t: (key: string) => string
}

/** 徽标渲染的内容；`hidden` 涵盖「非仓库」和请求失败。 */
type BadgeState =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'ready'; readonly status: RepoStatusPresent }

/** 已检出分支的上游分支（如果存在）。 */
function upstreamOf(status: RepoStatusPresent): string | undefined {
  const name = status.current
  if (name === undefined || name === '') return undefined
  return status.branches.find((branch) => branch.name === name)?.upstream
}

/** 分支徽标。 */
export function BranchBadge({ sessionId, t }: BranchBadgeProps): ReactElement | null {
  const [state, setState] = useState<BadgeState>({ kind: 'hidden' })
  const [copied, setCopied] = useState(false)

  // 挂载时以及 composer 切换会话时拉取，并在窗口重新获得焦点时再检查一次：
  // 工作区可能在长时间对话期间发生变化（agent 本身也可能检出某个分支），
  // 而过期的标签比没有标签更糟。获得焦点是最省的纠正时机——用户正看着同一个
  // 窗口时无需轮询。
  useEffect(() => {
    if (typeof sessionId !== 'string' || sessionId === '') {
      setState({ kind: 'hidden' })
      return undefined
    }
    let live = true
    let controller: AbortController | null = null

    function refresh(): void {
      controller?.abort()
      const current = new AbortController()
      controller = current
      fetchStatus(sessionId, current.signal)
        .then((value) => {
          if (!live || current.signal.aborted) return
          setState(value.isRepo ? { kind: 'ready', status: value } : { kind: 'hidden' })
        })
        .catch(() => {
          // 徽标只是装饰：请求失败时隐藏它，而不是在 composer 内暴露错误。
          if (live && !current.signal.aborted) setState({ kind: 'hidden' })
        })
    }

    function onFocus(): void {
      refresh()
    }

    // `visibilitychange` 在标签页被隐藏时也会触发；只在回到前台时重新读取，
    // 可避免后台窗口发起请求。
    function onVisibility(): void {
      if (document.visibilityState === 'visible') refresh()
    }

    refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      live = false
      controller?.abort()
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [sessionId])

  // 勾号是**一次性**反馈：到点自己收回，不留下一个永远停在「已复制」的徽标，
  // 因此用户不必再点一次来复位。组件卸载时清掉定时器。
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), COPIED_RESET_MS)
    return () => clearTimeout(timer)
  }, [copied])

  if (state.kind === 'hidden') return null

  const { status } = state
  const label = currentBranchName(status)
  // 复制的是「分支身份」而不是可见标签：游离 HEAD 时标签是 `HEAD`（因为它是
  // 一个状态而不是名字），而用户真正想拿走的是那个提交。
  const copyText = branchCopyText(status)
  const upstream = upstreamOf(status)
  // 游离 HEAD 没有分支名，因此优先显示提交，而不是一个光秃秃的「HEAD」——
  // 后者看起来像是一个可以切回去的分支。
  const detail = status.detached ? status.head : undefined
  const title = upstream === undefined ? label : `${label} → ${upstream}`
  const description = detail === undefined ? title : `${title} (${t('detachedHead')} ${detail})`

  /**
   * 点击即复制。复制失败时不假装成功（不显示勾号），只在控制台留一条记录：
   * 徽标位于 composer 内部，不适合就地为一次剪贴板失败展开一条错误消息。
   */
  function onCopy(): void {
    void writeClipboard(copyText).then((ok) => {
      if (ok) {
        setCopied(true)
        return
      }
      console.error('[dsh-toolkit/git-branch] clipboard write failed')
    })
  }

  return (
    <>
      <style>{BADGE_CSS}</style>
      <button
        type="button"
        className="gtk-badge"
        data-copied={copied ? 'true' : 'false'}
        title={copied ? `${t('copied')}: ${label}` : `${description}\n${t('copyBranchHint')}`}
        aria-label={copied ? `${t('copied')}: ${description}` : `${t('copyBranch')}: ${description}`}
        onClick={onCopy}
      >
        <span className="gtk-badge-icon gtk-badge-branch">
          <BranchIcon size={14} />
        </span>
        <span className="gtk-badge-icon gtk-badge-copy">
          <CopyIcon />
        </span>
        <span className="gtk-badge-icon gtk-badge-check">
          <CheckIcon />
        </span>
        <span className="gtk-badge-label">{label}</span>
        {detail === undefined ? null : <span className="gtk-badge-detail">{detail}</span>}
        {/* 勾号只对看得见的人有效；读屏用户靠这条 live region 听到「已复制」。 */}
        <span className="gtk-badge-live" aria-live="polite">
          {copied ? t('copied') : ''}
        </span>
      </button>
    </>
  )
}
