/**
 * `react-dom` 的最小类型声明。
 *
 * 本仓库不把 `react-dom` 列为依赖：浏览器侧产物由 DSH 的 loader 在运行时提供
 * （见 `tsdown.config.ts` 的 `neverBundle`），和 `react` 一样。`@types/react-dom`
 * 会把整套 DOM 渲染器类型拉进来，而我们只用一个 `createPortal`，所以这里只声明
 * 它 —— 够用且不会掩盖「其实没装这个包」的事实。
 *
 * 运行时若 loader 没有提供 `react-dom`（不可能：宿主自己就用它渲染整个界面），
 * `quote-tip.tsx` 的 import 会在插件加载阶段失败，而不是静默降级。
 */
declare module 'react-dom' {
  import type { ReactElement, ReactNode } from 'react'

  /**
   * 把一个 React 子树渲染到文档中的另一个容器里。
   * @param children - 要渲染的子树。
   * @param container - 目标容器；必须是文档中已存在的元素。
   * @param key - 可选的 portal 键。
   * @returns 可挂进 React 树的 portal 节点。
   */
  export function createPortal(
    children: ReactNode,
    container: Element,
    key?: string | null,
  ): ReactElement
}
