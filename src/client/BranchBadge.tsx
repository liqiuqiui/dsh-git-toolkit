/**
 * 浏览器侧 · 进行中对话下方的分支指示器。
 *
 * 注册在 `conversation.input.left` 上，这是 Host 在 composer 工具行右端渲染的
 * 列表槽位（位于附件按钮、权限预设和计划预设之后）。New Session 的 Hero 行只在
 * 会话开始前存在，因此进行中的对话无法显示其工作区位于哪个分支；该指示器正是
 * 用来解决这个问题。
 *
 * 它有意保持**只读**：切换分支属于新会话的决策，一个会在 agent 运行期间悄悄把
 * 工作区检出的控件会是个陷阱。完整的选择器仍留在 Hero 行；此元素只做展示，其
 * tooltip 携带所跟踪的远程分支。
 */
import * as React from 'react'
import type { ReactElement } from 'react'

import { currentBranchName, fetchStatus } from './api.js'
import { BranchIcon } from './icons.js'
import type { RepoStatusPresent } from '../shared.js'
import { BADGE_CSS } from './styles.js'

const { useEffect, useState } = React

/** Host 传给 `conversation.input.left` 占用者的 props。 */
export interface BranchBadgeProps {
  /** composer 所属的会话。 */
  sessionId: string
  /** 绑定命名空间的翻译函数（`dsh-git-toolkit`）。 */
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

/** 只读的分支徽标。 */
export function BranchBadge({ sessionId, t }: BranchBadgeProps): ReactElement | null {
  const [state, setState] = useState<BadgeState>({ kind: 'hidden' })

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

  if (state.kind === 'hidden') return null

  const { status } = state
  const label = currentBranchName(status)
  const upstream = upstreamOf(status)
  // 游离 HEAD 没有分支名，因此优先显示提交，而不是一个光秃秃的「HEAD」——
  // 后者看起来像是一个可以切回去的分支。
  const detail = status.detached ? status.head : undefined
  const title =
    upstream === undefined ? label : `${label} → ${upstream}`
  const description =
    detail === undefined ? title : `${title} (${t('detachedHead')} ${detail})`

  return (
    <>
      <style>{BADGE_CSS}</style>
      <span className="gtk-badge" title={description} aria-label={`${t('currentBranch')}: ${description}`}>
        <BranchIcon className="gtk-badge-icon" size={14} />
        <span className="gtk-badge-label">{label}</span>
        {detail === undefined ? null : <span className="gtk-badge-detail">{detail}</span>}
      </span>
    </>
  )
}
