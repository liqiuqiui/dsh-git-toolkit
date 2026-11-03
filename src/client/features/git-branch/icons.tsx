/**
 * 浏览器侧 · 内联 SVG 图标。
 *
 * 不使用图标包：bundle 只能 `require('react')`，因此每个字形都是几个
 * `<path>`/`<circle>` 元素，以 `stroke: currentColor`（颜色由 CSS 通过主题
 * token 决定）绘制并带 `aria-hidden`，因为这里每个图标都伴随文本标签或其控件
 * 上的 `aria-label`。
 */
import * as React from 'react'
import type { ReactElement, ReactNode } from 'react'

/** 每个图标都接受的 props。 */
export interface IconProps {
  className?: string | undefined
  /** 渲染后的边长，单位为 CSS 像素；每个图标都有与 Host 匹配的默认值。 */
  size?: number | undefined
}

/** 16 单位 viewBox 的共享几何，渲染尺寸为 12–14 CSS 像素。 */
interface SvgProps {
  className?: string | undefined
  /** 渲染后的边长，单位为 CSS 像素。 */
  size?: number | undefined
  /** 图标所属控件的展开状态；已知时设置 `data-open`。 */
  open?: boolean | undefined
  children: ReactNode
}

/** 单个图标外壳：仅描边、正方形、对辅助技术隐藏。 */
function Svg({ className, size = 14, open, children }: SvgProps): ReactElement {
  const openAttribute = open === undefined ? {} : { 'data-open': open ? 'true' : 'false' }
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
      {...openAttribute}
    >
      {children}
    </svg>
  )
}

/**
 * 一个分支：基线上两个提交，侧线一个提交。
 * 默认 16px：这是 Host 自身 hero 行图标的大小（工作区 chip 中的文件夹、
 * agent 预设座位中的预设字形）。
 */
export function BranchIcon({ className, size = 16 }: IconProps): ReactElement {
  return (
    <Svg className={className} size={size}>
      <circle cx={4.5} cy={3.5} r={1.75} />
      <circle cx={4.5} cy={12.5} r={1.75} />
      <circle cx={11.5} cy={5} r={1.75} />
      <path d="M4.5 5.25v5.5" />
      <path d="M11.5 6.75c0 2.75-2.4 4.1-5.2 4.4" />
    </Svg>
  )
}

/** 分支搜索框的放大镜。 */
export function SearchIcon({ className }: IconProps): ReactElement {
  return (
    <Svg className={className} size={12}>
      <circle cx={6.75} cy={6.75} r={4} />
      <path d="M9.75 9.75L13 13" />
    </Svg>
  )
}

/** 「创建并检出」一行的加号。 */
export function PlusIcon({ className }: IconProps): ReactElement {
  return (
    <Svg className={className}>
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </Svg>
  )
}

/** 标记当前已检出分支的勾选符号。 */
export function CheckIcon({ className }: IconProps): ReactElement {
  return (
    <Svg className={className}>
      <path d="M3.25 8.5l3.1 3.1 6.4-7.2" />
    </Svg>
  )
}

/** {@link FolderIcon} 的 props：它选择展开或闭合字形。 */
export interface FolderIconProps extends IconProps {
  /** 它所标注的文件夹是否已展开；决定选用展开字形。 */
  open?: boolean | undefined
}

/**
 * 文件夹，绘制方式与 Host 自身的工作区文件夹完全一致。
 *
 * 这些几何与字重逐字取自 `@deepseek-ai/dsh-client-ui-primitives` 中的
 * `IconFolderCloseRegular` 与 `IconFolderOpenRegular`，Host 在侧边栏和
 * 文件夹选择列表中渲染工作区目录时就用的它：Regular 字重的 16 单位
 * viewBox（描边宽度 1）、带内折痕的 1px 轮廓闭合字形，以及翻盖带
 * 16% currentColor 填充的实心轮廓展开字形。没有任何手工重绘，因此在任何
 * 尺寸下该字形都与 Host 逐像素一致。
 *
 * 这里不复用共享的 {@link Svg} 外壳：它以 1.5 描边宽度和圆头线帽绘制，
 * 而这两个图标依赖精确的 1 与默认的平头线帽来保持转角锐利。
 */
export function FolderIcon({ className, size = 16, open = false }: FolderIconProps): ReactElement {
  const shell = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    strokeWidth: 1,
    'aria-hidden': 'true',
    focusable: 'false',
    className,
  } as const
  if (open) {
    return (
      <svg {...shell}>
        <path
          d="M2.55912 7.93683C2.67584 7.49906 3.0723 7.19446 3.52536 7.19446H13.6491C14.3061 7.19446 14.7846 7.81725 14.6153 8.45209L13.4411 12.856C13.3244 13.2938 12.9279 13.5984 12.4748 13.5984H2.35113C1.69411 13.5984 1.21562 12.9756 1.38489 12.3407L2.55912 7.93683Z"
          fill="currentColor"
          opacity={0.16}
        />
        <path
          d="M13.6491 6.69446C14.6346 6.69453 15.3522 7.62895 15.0983 8.58118L13.9245 12.9845C13.7494 13.6412 13.1539 14.0988 12.4743 14.0988H2.35126C1.36574 14.0988 0.648153 13.1643 0.902044 12.212L2.07587 7.80774C2.25102 7.15128 2.84567 6.69455 3.52509 6.69446H13.6491ZM3.52509 7.69446C3.29865 7.69455 3.10004 7.84674 3.04169 8.06555L1.86786 12.4698C1.78345 12.7872 2.02285 13.0988 2.35126 13.0988H12.4743C12.7007 13.0988 12.8992 12.9463 12.9577 12.7277L14.1325 8.32336C14.2171 8.00598 13.9776 7.69453 13.6491 7.69446H3.52509Z"
          fill="currentColor"
        />
        <path
          d="M4.7666 1.90137C5.13227 1.90144 5.48571 2.03525 5.75977 2.27734L7.27246 3.61328C7.36379 3.69382 7.48174 3.73828 7.60352 3.73828H12.3994C13.2276 3.73841 13.8993 4.41005 13.8994 5.23828V6.7168C13.8183 6.70327 13.735 6.69436 13.6494 6.69434H12.8994V5.23828C12.8993 4.96233 12.6754 4.73841 12.3994 4.73828H7.60352C7.23781 4.73828 6.88446 4.60438 6.61035 4.3623L5.09766 3.02637C5.00636 2.94576 4.88838 2.90144 4.7666 2.90137H2.0498C1.77366 2.90137 1.5498 3.12523 1.5498 3.40137V9.78223L0.902344 12.2119C0.648452 13.1642 1.36604 14.0986 2.35156 14.0986H2.0498C1.2214 14.0986 0.549838 13.427 0.549805 12.5986V3.40137C0.549805 2.57294 1.22138 1.90137 2.0498 1.90137H4.7666Z"
          fill="currentColor"
        />
      </svg>
    )
  }
  return (
    <svg {...shell}>
      <path
        d="M1.50439 3.11059C1.50439 2.55831 1.95211 2.1106 2.50439 2.1106H5.43389C5.67773 2.1106 5.91318 2.19969 6.09593 2.36113L7.71649 3.79265C7.89924 3.95409 8.1347 4.04319 8.3785 4.04319H13.4958C14.0481 4.04319 14.4958 4.4909 14.4958 5.04319V12.8894C14.4958 13.4417 14.0481 13.8894 13.4958 13.8894H2.50439C1.95211 13.8894 1.50439 13.4417 1.50439 12.8894V4.04319V3.11059Z"
        stroke="currentColor"
      />
      <path d="M3.63501 7.66614H12.3647" stroke="currentColor" />
    </svg>
  )
}

/** {@link ChevronDownIcon} 的 props：它同时映射面板的展开状态。 */
export interface ChevronDownIconProps extends IconProps {
  /** 它所控制的面板是否展开；为 true 时由 CSS 旋转。 */
  open?: boolean | undefined
}

/** 触发器上的展开箭头；面板展开时旋转 180°。 */
export function ChevronDownIcon({ className, open }: ChevronDownIconProps): ReactElement {
  return (
    <Svg className={className} size={12} open={open}>
      <path d="M4.25 6.25L8 10l3.75-3.75" />
    </Svg>
  )
}
