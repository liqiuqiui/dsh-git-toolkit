/**
 * message-quote 功能 · 浏览器侧文案。
 *
 * 注册到本功能自己的命名空间（`dsh-toolkit/message-quote`），键名因此不会与其他
 * 功能碰撞。`zh` 是参考表；`en` 必须穷尽覆盖同一组键，缺失会在 type-check 阶段
 * 失败。
 *
 * 前缀与正文分开成两组键，因为 chip 的两个字段用途不同：
 *
 * - **可见标签 `label`** 同时被宿主用作 `title`（悬停提示），所以它的正文部分是
 *   **完整引用内容**；视觉上由 CSS 的 `max-width:240px` + `text-overflow` 截断。
 * - **剪贴板投影 `clipboardText`** 只在把 chip 复制到别处时使用，正文部分是
 *   一行短摘要，避免粘贴出一大段。
 *
 * 因此这里只提供前缀，正文由调用方拼接（见 `insert.ts`）。
 */
import type { MessageDict } from '../../host-api.js'

/** 可见文案（中文）。 */
export const ZH = {
  menuQuote: '引用',
  menuQuoteHint: '把选中的内容作为参考材料加入输入框',
  chipPrefix: '引用 第{turn}轮：',
  chipPrefixNoTurn: '引用：',
  insertFailed: '无法写入输入框',
  removeQuote: '删除这段引用',
  removeFailed: '无法删除这段引用',
  quoteTruncated: '……（原文共 {total} 字，引用已截断）',
  tipHead: '引用自第 {turn} 轮',
  tipHeadNoTurn: '引用内容',
  // 宿主 Markdown 渲染器（代码块工具栏 / 脚注）要用到的 chrome 文案。取值与
  // 宿主 chat namespace 下的同名 key 一致，保证浮窗里的按钮与消息里的同名按钮
  // 说的是同一句话。
  markdownCopy: '复制',
  markdownCopied: '复制成功',
  markdownCodeLabel: '代码块',
  markdownWrap: '自动换行',
  markdownUnwrap: '取消自动换行',
  markdownFootnotes: '脚注',
} as const satisfies MessageDict

/** 该功能用到的全部翻译键。 */
export type MessageKey = keyof typeof ZH

/** 英文表：穷尽覆盖 `MessageKey` 正是 `satisfies` 所检查的内容。 */
export const EN = {
  menuQuote: 'Quote',
  menuQuoteHint: 'Add the selected text to the composer as reference material',
  chipPrefix: 'Quote turn {turn}: ',
  chipPrefixNoTurn: 'Quote: ',
  insertFailed: 'Cannot write to composer',
  removeQuote: 'Remove this quote',
  removeFailed: 'Cannot remove this quote',
  quoteTruncated: '…(original was {total} characters; this quote is truncated)',
  tipHead: 'Quoted from turn {turn}',
  tipHeadNoTurn: 'Quoted content',
  // Chrome copy for the host's Markdown renderer (code-block toolbar and footnotes).
  markdownCopy: 'Copy',
  markdownCopied: 'Copied',
  markdownCodeLabel: 'Code block',
  markdownWrap: 'Wrap lines',
  markdownUnwrap: 'Do not wrap lines',
  markdownFootnotes: 'Footnotes',
} as const satisfies Readonly<Record<MessageKey, string>>
