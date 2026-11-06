/**
 * 浏览器侧 · 内联 SVG 图标。
 *
 * bundle 只能 `require('react')`，因此没有图标包可用：每个字形都是几个
 * `<path>`/`<circle>` 元素，用 `stroke: currentColor` 绘制（颜色由 CSS 从主题
 * token 取），并带 `aria-hidden` —— 每个图标旁边都有文本标签。
 *
 * 应用图标（VS Code、Cursor…）不在这里：它们由宿主以 base64 PNG 的 data URI
 * 形式随「打开方式」列表一起给出，见 {@link AppIcon}。
 */
import * as React from 'react'
import type { ReactElement, ReactNode } from 'react'

/** 每个图标都接受的 props。 */
export interface IconProps {
  className?: string | undefined
  /** 渲染后的边长，单位为 CSS 像素。 */
  size?: number | undefined
}

/** 16 单位 viewBox 的共享外壳。 */
function Svg({
  className,
  size = 14,
  children,
}: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

/** 一个文档：折角纸张。用于「打开文件」。 */
export function FileIcon({ className, size }: IconProps): ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M9.25 1.75H4.5A1.75 1.75 0 0 0 2.75 3.5v9A1.75 1.75 0 0 0 4.5 14.25h7A1.75 1.75 0 0 0 13.25 12.5V5.75z" />
      <path d="M9.25 1.75v3.5a.5.5 0 0 0 .5.5h3.5" />
    </Svg>
  )
}

/** 向右的箭头：子菜单指示。 */
export function ChevronRightIcon({ className, size }: IconProps): ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M6.25 4.25L9.75 8l-3.5 3.75" />
    </Svg>
  )
}

/** 复制：两片叠放的单据。 */
export function CopyIcon({ className, size }: IconProps): ReactElement {
  return (
    <Svg className={className} size={size}>
      <rect x={5.75} y={5.75} width={7.5} height={7.5} rx={1.6} />
      <path d="M10.5 5.75V4.5A1.5 1.5 0 0 0 9 3H4.5A1.5 1.5 0 0 0 3 4.5V9a1.5 1.5 0 0 0 1.5 1.5h1.25" />
    </Svg>
  )
}

/** 另存为：向下的托盘箭头。 */
export function SaveIcon({ className, size }: IconProps): ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M8 2.25v7.5" />
      <path d="M5.25 7.25L8 10l2.75-2.75" />
      <path d="M2.75 11.25v1.5a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1v-1.5" />
    </Svg>
  )
}

/** 在文件管理器中显示：带放大镜的文件夹。 */
export function RevealIcon({ className, size }: IconProps): ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M1.75 4.5A1.25 1.25 0 0 1 3 3.25h2.6c.32 0 .63.12.86.34l1.04.96c.23.22.54.34.86.34H13A1.25 1.25 0 0 1 14.25 6.1v1.4" />
      <path d="M1.75 4.5v6.75A1.25 1.25 0 0 0 3 12.5h4" />
      <circle cx={11.25} cy={11.25} r={2.5} />
      <path d="M13.1 13.1l1.15 1.15" />
    </Svg>
  )
}

/** 成功反馈的勾选符号。 */
export function CheckIcon({ className, size }: IconProps): ReactElement {
  return (
    <Svg className={className} size={size}>
      <path d="M3.25 8.5l3.1 3.1 6.4-7.2" />
    </Svg>
  )
}

/**
 * 宿主给出的应用图标（base64 PNG data URI）。
 *
 * 图标是 32px 左右的位图，因此固定渲染为 16 CSS 像素；没有图标时退回
 * {@link AppFallbackIcon}，保持每一行的图标列等宽，文本才能对齐成一条直线。
 * @param props - 图标 data URI 与类名。
 */
export function AppIcon({
  icon,
  className,
}: {
  icon: string | null
  className?: string | undefined
}): ReactElement {
  if (icon === null || icon === '') return <AppFallbackIcon className={className} />
  return <img className={className} src={icon} alt="" aria-hidden="true" draggable={false} />
}

/** 应用没有可显示图标时的兜底字形（一个通用程序窗口）。 */
export function AppFallbackIcon({ className, size }: IconProps): ReactElement {
  return (
    <Svg className={className} size={size}>
      <rect x={2.25} y={3.25} width={11.5} height={9.5} rx={1.5} />
      <path d="M2.25 6.25h11.5" />
    </Svg>
  )
}
