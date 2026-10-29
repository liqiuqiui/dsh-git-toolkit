/**
 * 浏览器侧 · 两个 slot 占用者共享的模块级 store。
 *
 * 触发器位于 `conversation.hero.options`，面板位于 `shell.overlay`，
 * 因此二者无法通过共同父级共享 React state。两者改为用
 * `useSyncExternalStore` 订阅本 store。更新做浅合并并用 `Object.is`
 * 比较，因此设置未变化的值不会通知（否则每次 mousemove 都会重渲染）。
 */
import * as React from 'react'

import type { RepoStatus, RepoStatusPresent } from '../shared.js'

const { useSyncExternalStore } = React

/** 以 spinner 展示的进行中操作：切换某个分支，或创建分支。 */
export type BusyState = { readonly kind: 'switch'; readonly name: string } | { readonly kind: 'create' }

/** 触发器与面板渲染所依赖的全部状态。 */
export interface ClientState {
  /** 面板是否已挂载。 */
  open: boolean
  /** 面板打开时对应的会话；切换时忽略过期快照。 */
  sessionId: string | null
  /** 最近已知的仓库快照；会话不是仓库时为 null。 */
  status: RepoStatusPresent | null
  /** 触发元素，用于恢复焦点与判定外部点击。 */
  anchorEl: HTMLElement | null
  /** 面板打开时捕获的触发元素位置（面板为 fixed 定位）。 */
  anchorRect: DOMRect | null
  /** 分支搜索文本。 */
  query: string
  /** 显示在面板顶部的错误消息。 */
  error: string | null
  /** 进行中的操作；空闲时为 null。 */
  busy: BusyState | null
  /** 过滤后分支列表中高亮行的索引。 */
  active: number
  /** 面板是否展示创建分支表单而非列表。 */
  creating: boolean
}

/** {@link openPopover} 的输入；触发器会记录自身的几何信息。 */
export interface OpenPopoverInput {
  sessionId: string
  status: RepoStatus | null
  anchorEl: HTMLElement | null
  anchorRect: DOMRect | null
}

/** 局部更新；仅合并存在的键。 */
export type ClientStatePatch = Partial<ClientState>

/** 一个 store 订阅者。 */
type StateListener = () => void

const INITIAL_STATE: ClientState = {
  open: false,
  sessionId: null,
  status: null,
  anchorEl: null,
  anchorRect: null,
  query: '',
  error: null,
  busy: null,
  active: 0,
  creating: false,
}

let state: ClientState = INITIAL_STATE

const listeners = new Set<StateListener>()

/** 当前快照；在两次通知之间保持稳定。 */
export function getState(): ClientState {
  return state
}

/** 订阅 store 变化；返回的函数用于取消订阅。 */
export function subscribe(listener: StateListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * 把一个 patch 浅合并进 store，仅在值确实变化时通知。
 * @param patch - 新值，或基于当前 state 产生新值的函数。
 */
export function setState(patch: ClientStatePatch | ((current: ClientState) => ClientStatePatch)): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  let changed = false
  for (const key of Object.keys(next) as (keyof ClientState)[]) {
    if (!Object.is(state[key], next[key])) {
      changed = true
      break
    }
  }
  if (!changed) return
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

/** 让一个组件订阅 store 快照。 */
export function useStore(): ClientState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/**
 * 为一个会话打开面板，重置全部临时 UI 状态。
 * 仅当 status 是仓库快照时才接受它。
 * @param input - 触发器捕获的会话、快照与触发元素几何信息。
 */
export function openPopover(input: OpenPopoverInput): void {
  const current = state
  setState({
    open: true,
    sessionId: input.sessionId,
    status: input.status !== null && input.status.isRepo ? input.status : current.status,
    anchorEl: input.anchorEl,
    anchorRect: input.anchorRect,
    query: '',
    error: null,
    busy: null,
    active: 0,
    creating: false,
  })
}

/** 关闭面板，重置其临时状态，并把焦点交还给触发器。 */
export function closePopover(): void {
  const anchorEl = state.anchorEl
  setState({
    open: false,
    query: '',
    error: null,
    busy: null,
    active: 0,
    creating: false,
    anchorEl: null,
  })
  // 尽力而为：会话切换后触发器可能已经不存在。
  if (anchorEl !== null) {
    try {
      anchorEl.focus()
    } catch {
      // 元素已脱离文档，没有可恢复焦点的对象。
    }
  }
}
