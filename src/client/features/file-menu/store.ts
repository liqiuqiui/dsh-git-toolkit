/**
 * 浏览器侧 · 文件右键菜单的模块级 store。
 *
 * 触发源是挂在文档上的 `contextmenu` 监听器，菜单本体渲染在 `shell.overlay` 上：
 * 两者在 React 树里没有共同父级，因此用 `useSyncExternalStore` 订阅同一份状态。
 * 更新做浅合并并用 `Object.is` 比较，值没变就不通知 —— 右键前后会连发多次
 * 鼠标事件，无变化的写入不该引起重渲染。
 */
import * as React from 'react'

import type { RemoteApplication } from './types.js'

const { useSyncExternalStore } = React

/** 菜单所处的阶段。 */
export type MenuPhase =
  /** 正在解析路径/枚举应用。 */
  | 'loading'
  /** 可交互。 */
  | 'ready'
  /** 某个动作执行中；菜单保持展开但不可点。 */
  | 'busy'
  /** 动作成功，正在显示结果反馈。 */
  | 'done'
  /** 动作失败或能力缺失。 */
  | 'failed'

/** 菜单渲染所依赖的全部状态。 */
export interface MenuState {
  /** 菜单是否已挂载。 */
  open: boolean
  /** 右键时所在的会话；动作都以它作为工作区上下文。 */
  sessionId: string | null
  /** 从 DOM 读到的路径（可能是相对路径）。 */
  path: string
  /** 解析后的绝对路径；解析完成前为 null。 */
  absolutePath: string | null
  /** 打开菜单时的光标位置（`clientX/clientY`）。 */
  x: number
  y: number
  /** 被右键的元素，用于关闭后恢复焦点与判定外部点击。 */
  anchorEl: HTMLElement | null
  /** 当前阶段。 */
  phase: MenuPhase
  /** 该路径的打开方式；空数组表示「没有可枚举的应用」或尚未取到。 */
  applications: readonly RemoteApplication[]
  /** 该部署能否把路径交给原生桌面。 */
  desktop: boolean
  /** 顶部的一行反馈（成功或失败）。 */
  message: string | null
  /** 「打开方式」子菜单是否展开。 */
  submenuOpen: boolean
  /** 键盘高亮项在**当前可见项列表**中的索引。 */
  active: number
}

/** 打开菜单的输入。 */
export interface OpenMenuInput {
  sessionId: string
  path: string
  x: number
  y: number
  anchorEl: HTMLElement | null
}

/** 局部更新；仅合并存在的键。 */
export type MenuStatePatch = Partial<MenuState>

/** 一个 store 订阅者。 */
type StateListener = () => void

const INITIAL_STATE: MenuState = {
  open: false,
  sessionId: null,
  path: '',
  absolutePath: null,
  x: 0,
  y: 0,
  anchorEl: null,
  phase: 'loading',
  applications: [],
  desktop: false,
  message: null,
  submenuOpen: false,
  active: 0,
}

let state: MenuState = INITIAL_STATE

const listeners = new Set<StateListener>()

/** 当前快照；在两次通知之间保持稳定。 */
export function getState(): MenuState {
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
export function setState(
  patch: MenuStatePatch | ((current: MenuState) => MenuStatePatch),
): void {
  const next = typeof patch === 'function' ? patch(state) : patch
  let changed = false
  for (const key of Object.keys(next) as (keyof MenuState)[]) {
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
export function useStore(): MenuState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/**
 * 打开菜单。每次都从「加载中」开始，因此上一次会话的应用列表不会闪现。
 * @param input - 会话、路径与光标位置。
 */
export function openMenu(input: OpenMenuInput): void {
  setState({
    open: true,
    sessionId: input.sessionId,
    path: input.path,
    absolutePath: null,
    x: input.x,
    y: input.y,
    anchorEl: input.anchorEl,
    phase: 'loading',
    applications: [],
    desktop: false,
    message: null,
    submenuOpen: false,
    active: 0,
  })
}

/**
 * 关闭菜单并清空临时状态。
 *
 * 焦点**不**在这里恢复：右键点击本身已经把焦点留在原处，强行 focus 被右键的
 * 按钮会打断用户正在做的事（例如随后想按 Escape 收起 IME）。
 */
export function closeMenu(): void {
  if (!state.open) return
  setState({
    open: false,
    sessionId: null,
    path: '',
    absolutePath: null,
    anchorEl: null,
    phase: 'loading',
    applications: [],
    message: null,
    submenuOpen: false,
    active: 0,
  })
}
