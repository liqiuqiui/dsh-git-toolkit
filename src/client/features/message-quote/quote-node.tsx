/**
 * message-quote 功能 · 已发送消息里的引用块显示。
 *
 * ## 为什么需要这一层
 *
 * 引用块进入模型时是 Markdown（{@link buildQuoteBlock}），但聊天气泡**不解析
 * Markdown**：宿主 `ui-chat` 的用户消息体是 `white-space:pre-wrap` 的纯文本容器，
 * 文本节点的默认渲染器 `PlainUserText` 直接输出原文。如果什么都不做，`> **引用自第
 * 4 轮**` 就会作为源码原样显示出来。
 *
 * 宿主的 UserText 机制正是为此准备的：它把「**模型看到的原文**」与「**用户看到的
 * 节点**」拆成两层 —— 规则只负责在原文里定位一个范围，渲染交给本功能自己的
 * renderer。`ui-reference` 用同一套机制把 `@path` 显示成文件 chip，因此这里也把
 * 引用块显示成与**输入框里一致的引用 chip**：
 *
 * | 位置 | 显示 | 模型收到 |
 * | --- | --- | --- |
 * | 输入框 | `@ 引用 第4轮：摘要…`（chip 的 `label`） | chip 的 `ref`（完整块） |
 * | 已发送消息 | `引用 第4轮：摘要…`（本文件的 renderer） | 原文，原样 |
 *
 * 两处摘要规则共用 {@link buildQuotePreview}，所以观感一致；完整正文由
 * {@link QuoteTip} 以浮窗形式展示（悬停 chip 即可读全，不用原生 `title`）。
 */
import * as React from 'react'
import type { ReactElement } from 'react'

import type { UserTextMatch, UserTextRule } from '../../host-api.js'
import { QuoteIcon } from './icons.js'
import { buildQuotePreview, parseQuoteBlock } from './quote-text.js'
import { QuoteTip, useQuoteTip, type QuoteTipTarget } from './quote-tip.js'
import { QUOTE_NODE_CSS } from './styles.js'

/**
 * 引用块在 UserText 里的规则 id。
 *
 * 同一个字符串有两个身份：规则向计算器声明自己时用它，renderer 注册到
 * `conversation.user.text.node` 时用它作**键**（该 slot 是 keyed slot，宿主按
 * `node.id` 找 renderer）。
 */
export const QUOTE_NODE_KEY = 'toolkit-quote'

/**
 * 规则排在宿主内建规则之前。
 *
 * `trim`(1000) / `collapse-whitespace`(1010) 要晚于本规则，否则引用块内部的行分隔
 * 会被先当成普通空白折叠掉，我们就再也看不到块边界了。`session`(10) 更早，但两者
 * 起点不同（它从 `@` 开始），不冲突。
 */
export const QUOTE_RULE_ORDER = 20

/** 规则交给 renderer 的节点数据。 */
export interface QuoteNodeData {
  /** 内容所在轮次；`> **引用内容**` 形态没有轮次。 */
  readonly turn?: number
  /** 引用正文（已剥掉 `> ` 前缀）。 */
  readonly body: string
  /** 是否发生过截断。 */
  readonly truncated: boolean
  /** 原文总长度；仅截断时存在。 */
  readonly total?: number
}

/**
 * 在消息原文里定位下一个引用块。
 *
 * 只做「找范围」——解析与校验都在纯函数 {@link parseQuoteBlock} 里，因此这条规则
 * 本身几乎没有出错空间：宿主对规则抛错的处理是**放弃整段文本的结构化显示**，
 * 退回纯文本，代价很高。
 * @param text - 消息原文。
 * @param from - 计算器要求的起点下界。
 * @returns 候选节点；没有引用块时为 `undefined`。
 */
export function quoteMatch(text: string, from: number): UserTextMatch<QuoteNodeData> | undefined {
  const block = parseQuoteBlock(text, from)
  if (block === undefined) return undefined
  // 逐字段转发而不是展开对象：`turn` / `total` 缺失时必须**不出现这个键**，
  // 宿主的节点相等比较按 `Object.keys` 的集合做，键的增删会被判成新节点，
  // 每次渲染都重挂载。
  const data: QuoteNodeData = block.truncated && block.total !== undefined
    ? { body: block.body, truncated: true, total: block.total, ...(block.turn === undefined ? {} : { turn: block.turn }) }
    : { body: block.body, truncated: false, ...(block.turn === undefined ? {} : { turn: block.turn }) }
  return { id: QUOTE_NODE_KEY, start: block.start, end: block.end, data }
}

/** 注册进 `uiConversation.userText` 的规则对象。 */
export const quoteTextRule: UserTextRule<QuoteNodeData> = {
  id: QUOTE_NODE_KEY,
  order: QUOTE_RULE_ORDER,
  match: (text, from) => quoteMatch(text, from),
}

/** renderer 从宿主拿到的 props。 */
export interface QuoteNodeViewProps {
  /** 命中本规则的节点。 */
  node: { id: string; data: QuoteNodeData }
  /** 该 slot 的 locale 注入。 */
  t: (key: string, params?: Record<string, unknown>) => string
}

/**
 * 把引用块显示成与输入框一致的引用 chip。
 *
 * 摘要由 {@link buildQuotePreview} 压成单行；完整正文由 {@link QuoteTip} 在悬停时
 * 以浮窗展示。不用原生 `title`，因为它只能显示单行、延时不可控、样式无法跟随主题。
 * @param props - 节点数据与该功能命名空间下的 `t`。
 * @returns 内联引用 chip（悬停时附带内容浮窗）。
 */
export function QuoteNodeView({ node, t }: QuoteNodeViewProps): ReactElement {
  const { turn, body, truncated, total } = node.data
  const prefix = turn === undefined ? t('chipPrefixNoTurn') : t('chipPrefix', { turn })
  const preview = buildQuotePreview(body)
  const [tipTarget, tip] = useQuoteTip()
  const chipRef = React.useRef<HTMLSpanElement | null>(null)

  /**
   * 在事件发生的那一刻组装目标。
   *
   * 不能在渲染期用 `chipRef.current` 生成：首次渲染时它还是 `null`，那样 handler
   * 会永远闭包住一个空目标，浮窗再也弹不出来。
   * @returns 当前 chip 对应的浮窗目标；尚未挂载时为 `null`。
   */
  function targetOf(): QuoteTipTarget | null {
    const anchor = chipRef.current
    if (anchor === null) return null
    // 逐字段转发而不是展开对象：`turn` / `total` 缺失时必须**不出现这个键**，
    // 内容的键集合一变，宿主就会把它当成新节点。
    return turn === undefined
      ? { anchor, body, truncated, ...(total === undefined ? {} : { total }) }
      : { anchor, body, truncated, turn, ...(total === undefined ? {} : { total }) }
  }

  return (
    <>
      <style>{QUOTE_NODE_CSS}</style>
      <span
        ref={chipRef}
        className="gtk-quote-node"
        onPointerEnter={() => {
          const target = targetOf()
          if (target !== null) tip.scheduleShow(target)
        }}
        onPointerLeave={tip.scheduleHide}
      >
        <span className="gtk-quote-node-icon">
          <QuoteIcon size={14} />
        </span>
        <span className="gtk-quote-node-label">
          {prefix}
          {preview}
        </span>
      </span>
      <QuoteTip
        target={tipTarget}
        t={t}
        onPointerEnter={tip.cancelHide}
        onPointerLeave={tip.scheduleHide}
      />
    </>
  )
}
