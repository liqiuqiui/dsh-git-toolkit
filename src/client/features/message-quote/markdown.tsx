/**
 * message-quote 功能 · 借用宿主的 Markdown 渲染器。
 *
 * ## 为什么要借用而不是自己渲染
 *
 * 引用正文往往就是助手回复里的一段 Markdown：代码块、列表、行内代码。浮窗里若按
 * 纯文本显示，`bash` 这种代码围栏的语言标识会单独占一行、缩进丢失、行内代码退化
 * 成反引号 —— 与它引用的那段原文看起来完全是两种东西。
 *
 * 宿主把渲染器作为 `@deepseek-ai/dsh-client-ui-primitives` 暴露在 loader 的静态
 * 模块白名单里，宿主自己的 `ui-reference` 插件就是这样取的。借用它就能保证浮窗
 * 与助手回复**排版一致**：同一套 markdown 样式类、同一套代码块、同一套脚注。
 *
 * ## 为什么必须自己提供 labels
 *
 * 渲染器的代码块分支直接读 `labels.code.copyLabel`，没有判空。`labels` 传
 * `undefined` 时，**只要正文里有代码块就会抛 TypeError**，整块浮窗白屏。所以这里
 * 总是构造一份完整的 {@link MarkdownLabels}。
 *
 * ## 取不到时怎么办
 *
 * 换到更旧的宿主、或该模块被移出白名单时，{@link HOST_PRIMITIVES} 为 `null`。
 * 这种情况退回纯文本（保留换行），功能不失效 —— 只是不如 Markdown 好看。
 */
import * as React from 'react'
import type { ReactElement } from 'react'

import type { MarkdownLabels, MarkdownTextProps, UiPrimitives } from '../../host-api.js'

const { createElement, useMemo } = React

/**
 * 构造 Markdown 渲染器需要的 chrome 文案。
 *
 * key 与宿主 chat namespace 下的一致，取值由本插件自己的词典提供，因此跟随
 * 界面语言，且与消息里同名按钮的说法保持一致。
 * @param t - message-quote 命名空间下的翻译函数。
 * @returns 完整的 {@link MarkdownLabels}。
 */
export function markdownLabels(t: (key: string) => string): MarkdownLabels {
  return {
    code: {
      copyLabel: t('markdownCopy'),
      copiedLabel: t('markdownCopied'),
      toolbarLabels: {
        codeLabel: t('markdownCodeLabel'),
        wrapLabel: t('markdownWrap'),
        unwrapLabel: t('markdownUnwrap'),
      },
    },
    footnotes: t('markdownFootnotes'),
  }
}

/**
 * 把 `t` 变成稳定的 chrome 文案。
 *
 * 独立成 hook 是因为渲染器把 `labels` 作为 memo 依赖：对象身份不稳会让它每次
 * 悬停都重新解析一遍整段 Markdown。
 * @param t - message-quote 命名空间下的翻译函数。
 * @returns 在该 `t` 下稳定的 {@link MarkdownLabels}。
 */
export function useMarkdownLabels(t: (key: string) => string): MarkdownLabels {
  return useMemo(() => markdownLabels(t), [t])
}

/** 借用宿主 Markdown 渲染器所需的 props。 */
export interface QuoteMarkdownProps {
  /** 引用正文（Markdown 源文本）。 */
  readonly text: string
  /** chrome 文案。 */
  readonly labels: MarkdownLabels
  /** 宿主 UI 原语；`null` 时退回纯文本。 */
  readonly primitives: UiPrimitives | null
}

/**
 * 按 Markdown 渲染一段引用正文，渲染器不可用时退回纯文本。
 *
 * 退回分支保留 `pre-wrap`：引用正文里的换行本身有意义（可能是多段），压平会比
 * 不渲染 Markdown 更糟。
 * @param props - 正文、文案与宿主原语。
 * @returns 渲染结果。
 */
export function QuoteMarkdown({ text, labels, primitives }: QuoteMarkdownProps): ReactElement {
  if (primitives === null) {
    return createElement('span', { className: 'gtk-quote-tip-plain' }, text)
  }
  return createElement(primitives.MarkdownText as React.ComponentType<MarkdownTextProps>, {
    text,
    // 引用是**快照**，内容不会继续追加，让渲染器走静态路径（不必增量解析）。
    streaming: false,
    labels,
    // 浮窗是次要区域，用紧凑排版：字号小一档，长引用能少滚一点。
    variant: 'compact',
  })
}
