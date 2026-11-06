/**
 * 浏览器侧 · 把「当前是哪个会话」转达给菜单。
 *
 * 菜单监听器挂在 `document` 上，它只有一个 `MouseEvent`，不知道自己是哪个会话
 * 里的对话；而把相对路径解析成宿主绝对路径（`workspaceFiles.stat`）必须以会话
 * 工作区为基准。composer 工具行（`conversation.input.left`）的 props 里带着
 * `sessionId`，因此在那里放一个**不渲染任何东西**的座位，把会话 id 记进
 * `runtime.ts`。
 *
 * 为什么不用 `sessions` 服务的选中态：会话切换的写入与 slot 的重新渲染时机并不
 * 保证一致，而这个座位拿到的 `sessionId` 是宿主要渲染的那个会话本身，不存在
 * 竞争。
 */
import type { ReactElement } from 'react'

import { setCurrentSession } from './runtime.js'

/** 座位 props。 */
export interface SessionSeatProps {
  /** composer 所属的会话。 */
  sessionId: string
}

/** 无渲染占位：只把会话 id 写进运行期上下文。 */
export function SessionSeat({ sessionId }: SessionSeatProps): ReactElement | null {
  // 渲染期写入是安全的：这是一个幂等的模块级赋值，不触发任何 React 状态更新，
  // 因此不会在渲染期间引起重渲染警告。放在渲染体里而不是 effect 里，是为了让
  // 「用户在会话切换动画期间立刻右键」也能拿到新会话。
  setCurrentSession(typeof sessionId === 'string' && sessionId !== '' ? sessionId : null)
  return null
}
