/**
 * message-quote 功能 · 选中文字后浮出的引用菜单。
 *
 * 挂在 `conversation.input.overlay` 上（renderRisk none、list 槽位、session scope，
 * 渲染在 composer 的 `data-composer-overlay` 锚点内）。选这个槽位的理由是它可以
 * 拿到 `inputActions`（草稿写入面）与 `sessionId`，而这正是插入所必需的两样东西；
 * 同时它只是一个空锚点容器，用 `position:fixed` 就能把菜单放到选区旁边。
 *
 * 交互链路：
 *
 *   pointerup / selectionchange → 读选区 → 判定 → 定位 → 点「引用」→ 插入 → 收起
 *
 * **为什么不用消息尾部的按钮**：需求是「选中文字就自动浮出菜单」，用户不必先把
 * 视线移到消息末尾再找入口。因此这里自己监听选区，而不是占一个消息级 slot。
 *
 * **为什么 `pointerup` 要延后一帧读选区**：部分浏览器在 `pointerup` 触发的同一
 * 任务里选区尚未最终确定，立即读会拿到上一轮的值。用 `setTimeout(0)` 把读取推到
 * 下一个任务，代价不可感知，却能避免「第一次选择不弹、第二次才弹」。
 */
import * as React from 'react'
import type { ComponentType, ReactElement } from 'react'

import type {
  ClientPluginContext,
  InputActions,
  InputState,
  SnapshotSelectorHook,
  SessionsClientService,
} from '../../host-api.js'
import { QuoteIcon } from './icons.js'
import { insertQuote } from './insert.js'
import { buildQuoteLabel, buildQuotePreview, parseQuoteBlock } from './quote-text.js'
import { QuoteTip, useQuoteTip } from './quote-tip.js'
import { isQuotedMessageOccurrence, quoteRemovalSpan } from './remove.js'
import { COMPOSER_SELECTOR, readSelection, type SelectionSnapshot } from './selection.js'
import { QUOTE_MENU_CSS } from './styles.js'

const { useEffect, useRef, useState } = React

/** 菜单与选区之间的间距。 */
const GAP = 8
/** 菜单与视口边缘的最小距离。 */
const EDGE = 8
/** 估算的菜单高度；只在决定「朝上还是朝下」时使用。 */
const MENU_HEIGHT = 32
/** 失败提示的停留时间。 */
const NOTICE_MS = 2500

/**
 * 当前认领选区的浮层实例。
 *
 * `conversation.input.overlay` 是 session scope 的 list 槽位：多会话并排时会有
 * 多个本组件实例，每个都会监听同一批 DOM 事件。模块级单例保证同一时刻只有
 * 一个实例渲染菜单，否则同一段选区会弹出多个重叠的菜单。
 */
let claimedBy: symbol | null = null

/**
 * 浮层跨注册期持有的服务。
 *
 * `sessions` 可能在注册时还没就绪（`whenService` 回调晚到），因此这里持有一个
 * **可变容器**：每次点击都读当下值，而不是在注册那一刻固化。
 */
export interface QuoteServices {
  /** 会话服务；未就绪时为 `undefined`。 */
  sessions?: SessionsClientService | undefined
}

/** 该槽位传给占用者的 props（此处用到的部分）。 */
export interface QuotePopoverProps {
  /** 绑定 `dsh-toolkit/message-quote` 命名空间的翻译函数。 */
  t: (key: string, params?: Record<string, unknown>) => string
  /** 草稿写入面。 */
  inputActions: InputActions
  /** 订阅该 composer 的草稿投影。 */
  useInput: SnapshotSelectorHook<InputState>
  /** 该 composer 所属会话。 */
  sessionId: string
}

/**
 * 把一个数值夹在区间内。
 * @param value - 待夹取的值。
 * @param min - 下界。
 * @param max - 上界。
 * @returns 夹取后的值；区间退化时返回 `min`。
 */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/** 菜单的定位结果。 */
interface Placement {
  readonly top: number
  readonly left: number
  /** 朝上时以自身底边对齐锚点，需要 `translate(-50%, -100%)`。 */
  readonly above: boolean
}

/**
 * 由选区矩形算出菜单位置。
 *
 * 优先放在选区上方（不遮住刚读完的文字）；上方空间不足时翻到下方。
 * @param rect - 选区在视口坐标系里的矩形。
 * @param viewport - 视口宽高。
 * @returns 定位结果。
 */
export function placeMenu(
  rect: { top: number; bottom: number; left: number; width: number },
  viewport: { width: number; height: number },
): Placement {
  const above = rect.top >= MENU_HEIGHT + GAP + EDGE
  const top = above ? rect.top - GAP : rect.bottom + GAP
  const left = clamp(rect.left + rect.width / 2, EDGE, viewport.width - EDGE)
  return { top, left, above }
}

/**
 * 生成一个浮层组件。
 *
 * 用工厂而不是直接导出组件，是因为它需要 `ctx` 与 `services` 才能写草稿；把二者
 * 关在闭包里，组件的 props 就能保持与槽位契约一致（只有 `t` / `inputActions` /
 * `sessionId`）。
 * @param ctx - 浏览器上下文。
 * @param services - 跨注册期解析的服务；`sessions` 由 `whenService` 填入。
 * @returns 浮层组件。
 */
export function createQuotePopover(
  ctx: ClientPluginContext,
  services: QuoteServices,
): ComponentType<QuotePopoverProps> {
  /** 选中文字后浮出的引用菜单。 */
  function QuotePopover({ t, inputActions, useInput, sessionId }: QuotePopoverProps): ReactElement | null {
    const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null)
    const [failed, setFailed] = useState(false)
    const [removeFailed, setRemoveFailed] = useState(false)
    const inputState = useInput((state) => state)
    const inputStateRef = useRef(inputState)
    inputStateRef.current = inputState
    const removeButtonRef = useRef<HTMLButtonElement | null>(null)
    const [hoveredQuote, setHoveredQuote] = useState<{
      chip: HTMLElement
      top: number
      left: number
      span: { start: number; end: number; draftRev: number }
    } | null>(null)
    const hoveredQuoteRef = useRef(hoveredQuote)
    hoveredQuoteRef.current = hoveredQuote
    // 引用内容浮窗：与悬停删除按钮共用同一次悬停，但有自己的显示/隐藏时序。
    const [tipTarget, tip] = useQuoteTip()
    const menuRef = useRef<HTMLDivElement | null>(null)
    // 每个实例一个身份，用来争用模块级单例。
    const identity = useRef<symbol | null>(null)
    if (identity.current === null) identity.current = Symbol('quote-popover')

    // 选区与当前快照都要能被事件回调读到最新值，因此用 ref 同步一份。
    const snapshotRef = useRef<SelectionSnapshot | null>(null)
    snapshotRef.current = snapshot

    useEffect(() => {
      const self = identity.current
      if (self === null) return undefined
      let timer: ReturnType<typeof setTimeout> | null = null
      /**
       * 鼠标是否正处于按下状态。
       *
       * **这是必需的**：拖动选择的过程中 `selectionchange` 会持续触发，而
       * `setTimeout(0)` 比两次 mousemove 之间的间隔短，菜单会在拖到一半时就弹出来
       * 并跟着手指跑。按下期间只记录候选、不渲染，抬起后才正式弹出。
       */
      let dragging = false

      /** 放弃当前认领并收起菜单。 */
      function release(): void {
        if (claimedBy === self) claimedBy = null
        setSnapshot(null)
        setFailed(false)
      }

      /**
       * 读取选区并决定是否认领。
       * @param claim - 是否允许从「无人认领」状态抢到认领权。
       */
      function refresh(claim: boolean): void {
        const next = readSelection()
        if (next === null) {
          if (snapshotRef.current !== null) release()
          return
        }
        // 已有实例认领时它自己才是合法渲染者；`claim` 只用于首次认领。
        if (claimedBy === null && claim) claimedBy = self
        if (claimedBy !== self) return
        // 菜单已经显示着（同类选区在扩展/收缩）：只更新位置，不加过渡。
        setSnapshot(next)
        setFailed(false)
      }

      /**
       * 把一次读取推到下一轮任务，等选区定稿。
       * @param claim - 是否允许认领。
       */
      function schedule(claim: boolean): void {
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(() => {
          timer = null
          refresh(claim)
        }, 0)
      }

      function onPointerDown(): void {
        // 任何按下都先当作一次拖动的开始；菜单在下面的 onPointerDown 分支里收起。
        dragging = true
      }

      function onPointerUp(): void {
        if (!dragging) {
          // 不是拖动结束（例如程序化触发），也要保证松手后能弹出。
          schedule(true)
          return
        }
        dragging = false
        // 松手后再读：此时选区已经定稿，读到的就是最终选区。
        schedule(true)
      }

      // 键盘选择（Shift+方向键）不产生 pointerup，但要跟着更新位置。
      // 拖动期间不响应，否则菜单会边拖边弹。
      function onSelectionChange(): void {
        if (dragging) return
        schedule(true)
      }

      // 滚轮/窗口尺寸变化后选区矩形会变，跟着重算；仍然是由本人认领才更新。
      function onViewportChange(): void {
        if (claimedBy !== self) return
        refresh(false)
      }

      function onOutsidePointerDown(event: PointerEvent): void {
        if (claimedBy !== self) return
        const target = event.target
        if (target instanceof Node && menuRef.current?.contains(target)) return
        // 点菜单以外的地方：收起菜单，但不主动清除选区（用户可能是在别处继续操作）。
        release()
      }

      function onKeyDown(event: KeyboardEvent): void {
        if (event.key !== 'Escape') return
        if (claimedBy !== self) return
        release()
      }

      // 指针事件一律挂在 **window 的捕获阶段**：它比 document 更外层，因此
      // 任何按下/抬起都先经过这里（拖动途中越过子元素也不会漏），并且早于宿主
      // 自己的处理 —— 这样拖动全程 `dragging` 都准确。
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('pointerup', onPointerUp, true)
      window.addEventListener('pointercancel', onPointerUp, true)
      document.addEventListener('selectionchange', onSelectionChange)
      document.addEventListener('pointerdown', onOutsidePointerDown, true)
      document.addEventListener('keydown', onKeyDown)
      window.addEventListener('scroll', onViewportChange, true)
      window.addEventListener('resize', onViewportChange)
      return () => {
        if (timer !== null) clearTimeout(timer)
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('pointerup', onPointerUp, true)
        window.removeEventListener('pointercancel', onPointerUp, true)
        document.removeEventListener('selectionchange', onSelectionChange)
        document.removeEventListener('pointerdown', onOutsidePointerDown, true)
        document.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('scroll', onViewportChange, true)
        window.removeEventListener('resize', onViewportChange)
        if (claimedBy === self) claimedBy = null
      }
    }, [])

    // 失败提示自行消失，不把菜单留在屏幕上。
    useEffect(() => {
      if (!failed) return undefined
      const timer = setTimeout(() => {
        setFailed(false)
        setSnapshot(null)
      }, NOTICE_MS)
      return () => clearTimeout(timer)
    }, [failed])

    // 悬停引用时记录目标 DOM 与它在所有原子 chip 中的序号。
    useEffect(() => {
      if (useInput === undefined) return undefined

      function onPointerOver(event: PointerEvent): void {
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest('.gtk-quote-remove') !== null) return
        const chip = target.closest<HTMLElement>('[data-composer-chip="reference"]')
        if (chip === null || chip.closest(COMPOSER_SELECTOR) === null) return
        const chips = Array.from(
          chip.closest(COMPOSER_SELECTOR)?.querySelectorAll<HTMLElement>(
            '[data-composer-chip], [data-composer-command]',
          ) ?? [],
        )
        const index = chips.indexOf(chip)
        if (index < 0) return

        const state = inputStateRef.current
        if (state === undefined) return
        const occurrences = state.occurrences ?? []
        const referenceIndex = chips
          .slice(0, index + 1)
          .filter((item) => item.matches('[data-composer-chip="reference"]')).length - 1
        if (!isQuotedMessageOccurrence(occurrences[referenceIndex])) return

        const commandLengths = chips
          .slice(0, index)
          .filter((item) => item.hasAttribute('data-composer-command'))
          .map((item) => (item.textContent ?? '').length)
        const span = quoteRemovalSpan(state, index, referenceIndex, commandLengths)
        if (span === undefined) return
        const rect = chip.getBoundingClientRect()
        setHoveredQuote({ chip, top: rect.top + rect.height / 2, left: rect.right - 20, span })

        // chip 的 `label` 会被宿主用作原生 `title`（在 portal 渲染的**子元素**上，
        // 不是 `data-composer-chip` 本身）。我们自己有内容浮窗，两个提示会叠在一
        // 起，所以把子树里的 title 都摘掉，只留我们的浮窗。
        chip.removeAttribute('title')
        for (const node of chip.querySelectorAll('[title]')) node.removeAttribute('title')

        // 正文要从 occurrence 的 `ref` 里取：输入框里的 chip 只显示摘要，完整内容
        // 在 ref 上（`insert.ts` 的 `chipRef` 给块加了首尾换行，解析时会一并吸收）。
        const block = parseQuoteBlock(occurrences[referenceIndex]?.ref ?? '')
        if (block === undefined) return
        tip.scheduleShow({
          anchor: chip,
          body: block.body,
          truncated: block.truncated,
          ...(block.turn === undefined ? {} : { turn: block.turn }),
          ...(block.total === undefined ? {} : { total: block.total }),
        })
      }

      function onPointerOut(event: PointerEvent): void {
        const target = event.target
        if (!(target instanceof Element)) return
        const chip = target.closest('[data-composer-chip="reference"]')
        const removeButton = target.closest('.gtk-quote-remove')
        const related = event.relatedTarget
        if (related instanceof Element) {
          const current = hoveredQuoteRef.current
          if (current?.chip.contains(related) || related.closest('.gtk-quote-remove') !== null) return
          // 指针正移向浮窗本身：浮窗会在自己离开时安排隐藏，这里不能先收掉。
          if (related.closest('.gtk-quote-tip') !== null) return
        }
        if (chip !== null || removeButton !== null) {
          setHoveredQuote(null)
          tip.scheduleHide()
        }
      }

      document.addEventListener('pointerover', onPointerOver, true)
      document.addEventListener('pointerout', onPointerOut, true)
      return () => {
        document.removeEventListener('pointerover', onPointerOver, true)
        document.removeEventListener('pointerout', onPointerOut, true)
      }
    }, [])

    const placement = snapshot === null
      ? { top: 0, left: 0, above: false }
      : placeMenu(snapshot.rect, {
          width: window.innerWidth,
          height: window.innerHeight,
        })
    const hoveredChipOrdinal = hoveredQuote === null
      ? -1
      : Array.from(
          hoveredQuote.chip.closest(COMPOSER_SELECTOR)?.querySelectorAll<HTMLElement>(
            '[data-composer-chip], [data-composer-command]',
          ) ?? [],
        ).indexOf(hoveredQuote.chip)
    const currentInput = inputStateRef.current
    const hoveredChipList = hoveredQuote === null
      ? []
      : Array.from(
          hoveredQuote.chip.closest(COMPOSER_SELECTOR)?.querySelectorAll<HTMLElement>(
            '[data-composer-chip], [data-composer-command]',
          ) ?? [],
        )
    const hoveredReferenceOrdinal = hoveredQuote === null || hoveredChipOrdinal < 0
      ? -1
      : hoveredChipList
          .slice(0, hoveredChipOrdinal + 1)
          .filter((item) => item.matches('[data-composer-chip="reference"]')).length - 1
    const currentCommandLengths = hoveredChipList
      .slice(0, hoveredChipOrdinal)
      .filter((item) => item.hasAttribute('data-composer-command'))
      .map((item) => (item.textContent ?? '').length)
    const removePosition = hoveredQuote === null || hoveredChipOrdinal < 0 || currentInput === undefined
      ? null
      : quoteRemovalSpan(currentInput, hoveredChipOrdinal, hoveredReferenceOrdinal, currentCommandLengths)
    const turn = snapshot?.turn
    // 宿主的引用 chip 把 label 当**纯文本**显示（CSS 截成一行）：所以标签必须是
    // 去标记的单行文本，否则 chip 上会露出 `##`、反引号这类 Markdown 源码。
    // 完整的带格式正文走 `ref`（模型看到的就是它），悬停浮窗也解析 `ref`。
    // 剪贴板用更短的摘要，避免复制出整段引用。
    const preview = snapshot === null ? '' : buildQuotePreview(snapshot.text)
    const prefix =
      turn === undefined
        ? t('chipPrefixNoTurn')
        : t('chipPrefix', { turn })
    const chipLabel = snapshot === null ? '' : `${prefix}${buildQuoteLabel(snapshot.text)}`
    const chipClipboard = `${prefix}${preview}`
    const translate = placement.above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)'

    function onQuote(): void {
      if (snapshot === null) return
      const outcome = insertQuote(
        {
          ctx,
          sessions: services.sessions,
          inputActions,
          sessionId,
          chipLabel,
          chipClipboard,
        },
        snapshot.text,
        snapshot.turn,
      )
      if (outcome === 'failed') {
        // 保持菜单可见并就地报错：多数失败是 composer 正在提交，立刻重试可能成功。
        setFailed(true)
        return
      }
      // 成功：清掉选区，交给 selectionchange 收起菜单。
      window.getSelection()?.removeAllRanges()
      setSnapshot(null)
      setFailed(false)
      if (claimedBy === identity.current) claimedBy = null
    }

    function onRemoveQuote(): void {
      const hovered = hoveredQuote
      const current = inputStateRef.current
      if (hovered === null || current === undefined) return
      const chips = Array.from(
        hovered.chip.closest(COMPOSER_SELECTOR)?.querySelectorAll<HTMLElement>(
          '[data-composer-chip], [data-composer-command]',
        ) ?? [],
      )
      const index = chips.indexOf(hovered.chip)
      if (index < 0) {
        setHoveredQuote(null)
        return
      }
      const occurrences = current.occurrences ?? []
      const referenceIndex = chips
        .slice(0, index + 1)
        .filter((item) => item.matches('[data-composer-chip="reference"]')).length - 1
      if (!isQuotedMessageOccurrence(occurrences[referenceIndex])) {
        setHoveredQuote(null)
        return
      }
      const chipLengths = chips.map((item) => (item.textContent ?? '').length)
      const span = quoteRemovalSpan(current, index, referenceIndex, chipLengths)
      if (span === undefined || span.draftRev !== hovered.span.draftRev) {
        setHoveredQuote(null)
        return
      }
      const applied = inputActions.insertText('', span)
      if (!applied) {
        setRemoveFailed(true)
        window.setTimeout(() => setRemoveFailed(false), NOTICE_MS)
      } else {
        setHoveredQuote(null)
      }
    }

    return (
      <>
        <style>{QUOTE_MENU_CSS}</style>
        {removeFailed && <span className="gtk-quote-remove-error" role="status">{t('removeFailed')}</span>}
        {hoveredQuote !== null && hoveredQuote.chip.isConnected && removePosition !== null && (
          <button
            ref={removeButtonRef}
            type="button"
            className="gtk-quote-remove"
            title={t('removeQuote')}
            aria-label={t('removeQuote')}
            style={{ top: hoveredQuote.top, left: hoveredQuote.left }}
            onPointerDown={(event) => event.preventDefault()}
            onClick={onRemoveQuote}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
        <QuoteTip
          target={tipTarget}
          t={t}
          onPointerEnter={tip.cancelHide}
          onPointerLeave={tip.scheduleHide}
        />
        {snapshot !== null && <div
          ref={menuRef}
          className="gtk-quote-menu"
          style={{ top: placement.top, left: placement.left, transform: translate }}
          role="menu"
        >          <button
            type="button"
            className="gtk-quote-item"
            role="menuitem"
            title={t('menuQuoteHint')}
            // 关键：按下按钮会默认清除选区，那样点击时就拿不到选中的文字了。
            onMouseDown={(event) => event.preventDefault()}
            onClick={onQuote}
          >
            <span className="gtk-quote-item-icon">
              <QuoteIcon />
            </span>
            {failed ? t('insertFailed') : t('menuQuote')}
          </button>
        </div>}
      </>
    )
  }
  QuotePopover.displayName = 'QuotePopover'
  return QuotePopover
}
