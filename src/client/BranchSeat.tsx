/**
 * 浏览器侧 · New Session 行中的分支 pill。
 *
 * 注册在 `conversation.hero.options` 上。它为所属会话拉取仓库状态，在状态表明
 * 该会话工作在 git 工作树中之前不渲染任何内容（不满足时也完全不渲染），因此
 * 非仓库会话永远不会多出一个控件。点击它通过共享 store 打开注册在
 * `shell.overlay` 上的面板。
 */
import * as React from 'react'
import type { ReactElement } from 'react'

import { currentBranchName, fetchStatus, formatError } from './api.js'
import { BranchIcon, ChevronDownIcon } from './icons.js'
import { closePopover, getState, openPopover, setState, useStore } from './store.js'
import { TRIGGER_CSS } from './styles.js'

const { useEffect, useRef, useState } = React

/** Host 传给 `conversation.hero.options` 占用者的 props。 */
export interface BranchSeatProps {
  /** Hero 行所属的会话。 */
  sessionId: string
  /** 绑定命名空间的翻译函数（`git-toolkit`）。 */
  t: (key: string) => string
}

/** 状态请求的生命周期；只有 `ready` 会渲染 pill。 */
type Phase = 'idle' | 'loading' | 'ready' | 'hidden'

/** 触发 pill。 */
export function BranchSeat({ sessionId, t }: BranchSeatProps): ReactElement | null {
  const state = useStore()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')

  // 会话变化（或挂载）：拉取其状态。请求进行期间不渲染任何内容，避免 pill
  // 闪一下然后消失。
  useEffect(() => {
    if (getState().open && getState().sessionId !== sessionId) closePopover()
    // 同时守卫真实的运行时契约：Host 可能会在 session id 存在之前挂载占用者。
    if (typeof sessionId !== 'string' || sessionId === '') {
      setPhase('hidden')
      return undefined
    }
    const controller = new AbortController()
    setPhase('loading')
    fetchStatus(sessionId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        const isRepo = value.isRepo
        setState({ sessionId, status: isRepo ? value : null })
        setPhase(isRepo ? 'ready' : 'hidden')
        if (!isRepo && getState().open) closePopover()
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error('[git-toolkit] status failed:', formatError(error, 'request failed'))
        setPhase('hidden')
      })
    return () => {
      controller.abort()
    }
  }, [sessionId])

  // 兜底：如果面板打开时 pill 消失，则关闭面板。
  useEffect(() => {
    return () => {
      if (getState().open) closePopover()
    }
  }, [])

  const status = state.sessionId === sessionId ? state.status : null
  const isOpen = state.open && state.sessionId === sessionId
  if (phase !== 'ready' || status === null || !status.isRepo) return null

  const current = currentBranchName(status)

  function onClick(): void {
    if (isOpen) {
      closePopover()
      return
    }
    const element = buttonRef.current
    if (element === null) return
    openPopover({
      sessionId,
      status,
      anchorEl: element,
      anchorRect: element.getBoundingClientRect(),
    })
  }

  return (
    <>
      <style>{TRIGGER_CSS}</style>
      <button
        ref={buttonRef}
        type="button"
        className="gtk-seat"
        aria-haspopup="dialog"
        aria-expanded={isOpen ? 'true' : 'false'}
        aria-label={`${t('switchBranch')}: ${current}`}
        title={current}
        onClick={onClick}
      >
        <BranchIcon className="gtk-seat-icon" size={16} />
        <span className="gtk-seat-label">{current}</span>
        <ChevronDownIcon className="gtk-seat-chevron" open={isOpen} />
      </button>
    </>
  )
}
