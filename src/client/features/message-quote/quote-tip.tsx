/**
 * message-quote 功能 · 引用内容的悬停浮窗。
 *
 * ## 为什么不用原生 `title`
 *
 * 浏览器原生提示有三个硬伤，正好都踩在引用这个场景上：
 *
 * 1. **只显示一行**：换行被压平，多段引用读不出结构；
 * 2. **浏览器自己控制延时与时长**：出现慢（约 1 秒）、消失也慢，鼠标扫过一排
 *    chip 时会留下一串残影；
 * 3. **样式完全不可控**：字体、颜色、圆角都跟随系统，在深色主题下尤其突兀。
 *
 * 所以这里自己画一个浮窗：`position:fixed` 跟随 chip 的视口坐标、按主题 token
 * 配色、按需求**不画箭头**（箭头会暗示与 chip 的指向关系，而正文本身较长，
 * 只会增加视觉噪音）。
 *
 * ## 交互细节
 *
 * - **显示延时**：鼠标只是扫过时不弹，停留 {@link SHOW_DELAY_MS} 才弹，避免一排
 *   chip 被扫过时连续闪。
 * - **隐藏延时**：从 chip 移到浮窗本身要跨过一条 {@link GAP} 的缝，指针会先离开
 *   chip；因此隐藏也延后 {@link HIDE_DELAY_MS}，并在指针进入浮窗时撤销，这样长
 *   引用的正文才能用滚轮看完。
 * - **跟着滚动**：浮窗是 `fixed` 的，聊天区一滚就会错位，所以显示期间监听
 *   `scroll`（捕获阶段，覆盖内部滚动容器）与 `resize` 重新定位。
 *
 * 定位计算 {@link placeTip} 是纯函数，可以在 Node 里直接断言，不必搭 DOM。
 */
import * as React from 'react'
import type { ReactElement } from 'react'
import { createPortal } from 'react-dom'

import { HOST_PRIMITIVES } from '../../primitives.js'
import { QuoteIcon } from './icons.js'
import { QuoteMarkdown, useMarkdownLabels } from './markdown.js'
import { QUOTE_TIP_CSS } from './styles.js'

const { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } = React

/** 浮窗与 chip 之间的间距。 */
export const GAP = 8
/** 浮窗与视口边缘的最小距离。 */
export const EDGE = 8
/** 停留多久才弹出。 */
export const SHOW_DELAY_MS = 150
/** 离开后多久收起；留出指针跨过缝隙进入浮窗的时间。 */
export const HIDE_DELAY_MS = 140

/** 浮窗要显示的一条引用。 */
export interface QuoteTipTarget {
  /** 用来取屏幕坐标的 chip 元素。 */
  readonly anchor: HTMLElement
  /** 引用正文。 */
  readonly body: string
  /** 内容所在轮次；`> **引用内容**` 形态没有轮次。 */
  readonly turn?: number | undefined
  /** 是否发生过截断。 */
  readonly truncated: boolean
  /** 原文总长度；仅截断时存在。 */
  readonly total?: number | undefined
}

/** 浮窗定位所需的三方尺寸。 */
export interface TipPlacementInput {
  /** chip 的视口矩形。 */
  readonly anchor: { readonly top: number; readonly left: number; readonly width: number; readonly height: number }
  /** 视口尺寸。 */
  readonly viewport: { readonly width: number; readonly height: number }
  /** 浮窗自身尺寸。 */
  readonly size: { readonly width: number; readonly height: number }
}

/** 浮窗最终位置。 */
export interface TipPlacement {
  /** 距视口顶部的像素。 */
  readonly top: number
  /** 距视口左侧的像素。 */
  readonly left: number
  /** 是否显示在 chip 上方。 */
  readonly above: boolean
}

/**
 * 夹取到闭区间。
 * @param value - 原值。
 * @param min - 下界。
 * @param max - 上界。
 * @returns 夹取后的值；区间退化时返回 `min`。
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * 算出浮窗的固定定位坐标。
 *
 * 默认显示在 chip 上方（引用 chip 通常在消息中段，上方空间更富裕），上方放不下
 * 就翻到下方；横向以 chip 中心对齐后夹进视口，避免贴着屏幕边缘被截断。
 * @param input - chip 矩形、视口尺寸、浮窗尺寸。
 * @returns 定位结果。
 */
export function placeTip(input: TipPlacementInput): TipPlacement {
  const { anchor, viewport, size } = input
  const aboveTop = anchor.top - GAP - size.height
  const belowTop = anchor.top + anchor.height + GAP

  let top: number
  let above: boolean
  if (aboveTop >= EDGE) {
    top = aboveTop
    above = true
  } else if (belowTop + size.height <= viewport.height - EDGE) {
    top = belowTop
    above = false
  } else {
    // 两侧都放不下（chip 极高或视口极矮）：取可用空间更大的一侧，再夹进视口。
    above = aboveTop > viewport.height - belowTop - size.height
    top = above ? Math.max(EDGE, aboveTop) : belowTop
  }
  top = clamp(top, EDGE, Math.max(EDGE, viewport.height - size.height - EDGE))

  const centered = anchor.left + anchor.width / 2 - size.width / 2
  const left = clamp(centered, EDGE, Math.max(EDGE, viewport.width - size.width - EDGE))
  return { top: Math.round(top), left: Math.round(left), above }
}

/** 浮窗控制器：只负责显示/隐藏时序，**不含**当前目标。 */
export interface QuoteTipController {
  /** 立刻显示（指针已停在 chip 上）。 */
  show(target: QuoteTipTarget): void
  /** 延时显示（指针刚进入 chip）。 */
  scheduleShow(target: QuoteTipTarget): void
  /** 延时隐藏；指针进入浮窗时会被 {@link QuoteTipController.cancelHide} 撤销。 */
  scheduleHide(): void
  /** 撤销待执行的隐藏。 */
  cancelHide(): void
  /** 立刻隐藏。 */
  hideNow(): void
}

/**
 * 管理浮窗的显示/隐藏时序。
 *
 * 抽成 hook 是因为两个使用点（输入框里的 chip、已发送消息里的 chip）状态机完全
 * 一样，只有触发来源不同：前者由宿主的 DOM 事件驱动，后者由 React 事件驱动。
 *
 * 返回 `[target, controller]` 而不是一个对象：`target` 每次显隐都会变，而
 * `controller` 必须**保持稳定**——使用方把回调注册在 `[]` 或 `[controller]` 依赖的
 * effect 里，对象一旦每帧换新，那些监听器就会捕获到首帧的句柄，反复重注册。
 * @returns 当前目标与稳定的控制器。
 */
export function useQuoteTip(): readonly [QuoteTipTarget | null, QuoteTipController] {
  const [target, setTarget] = useState<QuoteTipTarget | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<QuoteTipTarget | null>(null)

  const clear = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const show = useCallback((next: QuoteTipTarget): void => {
    clear()
    pending.current = next
    setTarget(next)
  }, [clear])

  const scheduleShow = useCallback((next: QuoteTipTarget): void => {
    clear()
    pending.current = next
    timer.current = setTimeout(() => {
      timer.current = null
      setTarget(pending.current)
    }, SHOW_DELAY_MS)
  }, [clear])

  const scheduleHide = useCallback((): void => {
    clear()
    timer.current = setTimeout(() => {
      timer.current = null
      setTarget(null)
    }, HIDE_DELAY_MS)
  }, [clear])

  const cancelHide = useCallback((): void => {
    if (timer.current !== null) clear()
  }, [clear])

  const hideNow = useCallback((): void => {
    clear()
    setTarget(null)
  }, [clear])

  useEffect(() => clear, [clear])

  const controller = useMemo(
    () => ({ show, scheduleShow, scheduleHide, cancelHide, hideNow }),
    [show, scheduleShow, scheduleHide, cancelHide, hideNow],
  )
  return [target, controller] as const
}

/** 浮窗组件的 props。 */
export interface QuoteTipProps {
  /** 要显示的引用；`null` 时不渲染。 */
  readonly target: QuoteTipTarget | null
  /** 浮窗命名空间下的翻译函数。 */
  readonly t: (key: string, params?: Record<string, unknown>) => string
  /** 指针进入浮窗：撤销待执行的隐藏。 */
  readonly onPointerEnter: () => void
  /** 指针离开浮窗：安排隐藏。 */
  readonly onPointerLeave: () => void
}

/**
 * 渲染引用内容浮窗。
 *
 * 首次渲染先按 `visibility:hidden` 摆出来量尺寸，量到之后再定位，避免长引用第一
 * 帧出现在错误位置再跳一下。
 *
 * 内容用**宿主的 Markdown 渲染器**渲染，与助手回复排版一致；渲染器不可用时退回
 * 纯文本，浮窗本身仍然可用。
 * @param props - 目标引用、翻译函数与指针回调。
 * @returns 挂到 `document.body` 上的浮窗；没有目标时渲染 `null`。
 */
export function QuoteTip({ target, t, onPointerEnter, onPointerLeave }: QuoteTipProps): ReactElement | null {
  const ref = useRef<HTMLDivElement | null>(null)
  const [placement, setPlacement] = useState<TipPlacement | null>(null)
  const labels = useMarkdownLabels(t)

  const measure = useCallback((): void => {
    const el = ref.current
    if (el === null || target === null) return
    // chip 可能已经随滚动/重渲染消失；此时没有任何可靠坐标，直接收起。
    if (!target.anchor.isConnected) {
      setPlacement(null)
      return
    }
    const box = el.getBoundingClientRect()
    const anchor = target.anchor.getBoundingClientRect()
    setPlacement(
      placeTip({
        anchor,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        size: { width: box.width, height: box.height },
      }),
    )
  }, [target])

  // 内容变化后重新量：不同引用的高度差可能很大，沿用旧坐标会错位。
  useLayoutEffect(() => {
    setPlacement(null)
    measure()
  }, [measure])

  useEffect(() => {
    if (target === null) return undefined
    function onViewportChange(): void {
      measure()
    }
    window.addEventListener('scroll', onViewportChange, true)
    window.addEventListener('resize', onViewportChange)
    return () => {
      window.removeEventListener('scroll', onViewportChange, true)
      window.removeEventListener('resize', onViewportChange)
    }
  }, [target, measure])

  if (target === null) return null

  const head = target.turn === undefined
    ? t('tipHeadNoTurn')
    : t('tipHead', { turn: target.turn })
  // 两个分支都渲染同一个根节点，只在量到尺寸后才给坐标：这样第一帧就存在于文档里，
  // `getBoundingClientRect()` 才有值可量。
  const style = placement === null
    ? { top: 0, left: 0 }
    : { top: placement.top, left: placement.left }

  return createPortal(
    <>
      <style>{QUOTE_TIP_CSS}</style>
      {/*
        挂到 `document.body` 而不是就地渲染，有两个必须的理由：
        1. 已发送消息里的 chip 挂在宿主的 UserText 容器中，那是一个 `<span>`；
           Markdown 渲染器输出的是 `<div>`，嵌在 `<span>` 里是非法 HTML。
        2. 就地渲染会落进聊天区的层叠上下文，祖先的 `overflow`/`transform` 都可能
           裁剪或错位浮窗 —— 这是 `position:fixed` 唯一不可靠的场景。
      */}
      <div
        ref={ref}
        className="gtk-quote-tip"
        role="tooltip"
        data-measured={placement !== null}
        style={style}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <div className="gtk-quote-tip-head">
          <span className="gtk-quote-tip-head-icon">
            <QuoteIcon size={12} />
          </span>
          {head}
        </div>
        <div className="gtk-quote-tip-body">
          <QuoteMarkdown text={target.body} labels={labels} primitives={HOST_PRIMITIVES} />
        </div>
        {target.truncated && target.total !== undefined && (
          <div className="gtk-quote-tip-note">{t('quoteTruncated', { total: target.total })}</div>
        )}
      </div>
    </>,
    document.body,
  )
}
