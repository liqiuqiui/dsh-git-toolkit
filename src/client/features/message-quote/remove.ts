/**
 * message-quote 功能 · 将公开 occurrence 的 clipboard 坐标映射到 detect 坐标。
 *
 * InputState.occurrences 按文档顺序记录引用 chip 的 clipboard offset/length；
 * 编辑器 detect 投影中每个 reference/command chip 均占一个 U+FFFC。通过当前 DOM
 * chip 顺序和每个 chip 的 clipboard 长度，可把目标引用的位置折回 detect 坐标。
 */
import type { InputState } from '../../host-api.js'

/** 一个可安全删除的引用范围。 */
export interface QuoteRemovalSpan {
  readonly start: number
  readonly end: number
  readonly draftRev: number
}

/**
 * 解析一个引用 occurrence 对应的 detect span。
 *
 * @param state - 当前 `useInput` 快照。
 * @param allChipIndex - 目标 chip 在 reference/command chip 总 DOM 列表中的序号。
 * @param commandClipboardLengths - 命令 chip 按 DOM 顺序排列的 clipboard 展开长度。
 * @returns 当前版本下的单字符范围；事实不完整时返回 `undefined`。
 */
export function quoteRemovalSpan(
  state: InputState,
  allChipIndex: number,
  referenceIndex: number,
  commandClipboardLengths: readonly number[],
): QuoteRemovalSpan | undefined {
  if (!Number.isInteger(allChipIndex) || allChipIndex < 0) return undefined
  if (!Number.isInteger(referenceIndex) || referenceIndex < 0) return undefined
  if (state.draftRev === undefined) return undefined
  if (state.phase !== 'plain' && state.phase !== 'claimed') return undefined
  const occurrences = state.occurrences ?? []
  const target = occurrences[referenceIndex]
  if (target === undefined || target.length < 1) return undefined

  const referenceChipsBeforeTarget = allChipIndex - referenceIndex
  if (commandClipboardLengths.length < referenceChipsBeforeTarget) return undefined
  const commandLengths = commandClipboardLengths.slice(0, referenceChipsBeforeTarget)
  if (commandLengths.some((length) => !Number.isInteger(length) || length < 1)) return undefined
  const priorReferenceLengths = occurrences.slice(0, referenceIndex).map((item) => item.length)
  if (priorReferenceLengths.some((length) => !Number.isInteger(length) || length < 1)) return undefined

  const expandedPrefixLength = [...priorReferenceLengths, ...commandLengths]
    .reduce((total, length) => total + length - 1, 0)
  const start = target.offset - expandedPrefixLength

  if (!Number.isInteger(start) || start < 0) return undefined
  return { start, end: start + 1, draftRev: state.draftRev }
}

/**
 * 检查一个 occurrence 是本功能创建的消息引用，而不是其他 reference source。
 *
 * chip 的 `ref` 可能以换行开头（见 `insert.ts` 的 `chipRef`：插入位点前面已有正文时，
 * 会先补一个换行把引用块隔到下一行），因此判断前要先跳过前导空白，否则那种位置插入
 * 的引用就认不出来、悬停删除会失效。
 * @param occurrence - 当前 occurrence。
 * @returns 是否为本功能的引用块。
 */
export function isQuotedMessageOccurrence(
  occurrence: { readonly source: string; readonly ref: string } | undefined,
): boolean {
  if (occurrence?.source !== 'reference') return false
  const head = occurrence.ref.replace(/^\s+/u, '')
  return (
    head.startsWith('<quoted-message') ||
    head.startsWith('> **引用自第 ') ||
    head.startsWith('> **引用内容**')
  )
}
