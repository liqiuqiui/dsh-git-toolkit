/**
 * message-quote 功能 · 把引用块写进草稿。
 *
 * 两条通道，按「显示效果更好者优先、可靠性更高者兜底」排列：
 *
 *   1. **chip**（首选）—— 往草稿里插一个引用 chip，输入框只显示短标签，完整
 *      正文留在 chip 的 `ref` 里，提交时由官方 `reference` 源原样交给模型。
 *      长回复因此不会把输入框撑爆，多行正文也完全不经过编辑器。
 *   2. **纯文本**（兜底）—— 直接插入引用块文本。只在 chip 不可用时使用。
 *
 * 为什么必须留兜底：`insertReference` 不在插件的公开 API 清单里（它是
 * `conversation.input.for(actx)` 返回的 facade 上的同名方法），版本升级可能变更；
 * 而 `insertText` 属文档化 API。把 chip 放在前面、纯文本放在后面，能在「体验更好」
 * 与「不会彻底失效」之间取得平衡。
 *
 * 插入位点用 {@link InputActions.captureInsertion}：用户选中会话正文时 composer
 * 并无选区，该方法的兜底语义正好是「草稿末尾的折叠 span」，因此不需要自己折算
 * 草稿坐标（chip 的 offset 与剪贴板投影坐标并不一致，自己算很容易差一位）。
 */
import type {
  ClientPluginContext,
  ConversationService,
  InputActions,
  SessionsClientService,
} from '../../host-api.js'
import { buildQuoteBlock } from './quote-text.js'

/**
 * 官方引用源名。
 *
 * 该源由 `@deepseek-ai/dsh-client-ui-reference` 注册（属基础 bundle 的直接依赖），
 * 其 codec 为 `serialize: (ref) => ref` —— 也就是说 chip 的 `ref` 会被**原样**
 * 当作模型可见内容，输入框只显示 `label`。这正是「短标签 + 完整正文」得以成立的
 * 机制。
 */
export const REFERENCE_SOURCE = 'reference'

/** 插入结果。 */
export type InsertOutcome =
  /** 已插入引用 chip。 */
  | 'chip'
  /** chip 不可用，已退化为纯文本插入。 */
  | 'text'
  /** 两条通道都失败（输入框正在裁决/提交，或缺少所需服务）。 */
  | 'failed'

/** 插入所需的环境。 */
export interface InsertTarget {
  /** 浏览器上下文；用它取 `conversation`。 */
  readonly ctx: ClientPluginContext
  /**
   * 会话服务（注册期由 `whenService` 拿到）。
   *
   * 注意**不要**在用到时读 `ctx.sessions`：本插件没有把 `sessions` 声明进插件级
   * `inject`，Cordis 的上下文代理对「未声明就读取」是**抛错**而不是返回
   * `undefined`，读一下就会把整条 chip 通道带走。
   */
  readonly sessions: SessionsClientService | undefined
  /** 该槽位提供的草稿写入面；缺失时只能判定失败。 */
  readonly inputActions: InputActions | undefined
  /** 该 composer 所属会话。 */
  readonly sessionId: string | undefined
  /** 完整 chip 标签；宿主同时将它用作原生悬浮提示文本。 */
  readonly chipLabel: string
  /** 复制 chip 时使用的短标签，不携带完整引用正文。 */
  readonly chipClipboard: string
}

/**
 * 取 `conversation` 服务。
 *
 * `conversation` 不是服务目录里的标准名，也没有出现在任何 `inject` 声明中，
 * 但它提供了 `input.for(actx)` 这个唯一的草稿 facade 入口。Cordis 的
 * `ctx.get(name)` 正是为此设计的：**不建立 inject 依赖**，直接从服务仓库读
 * （见其文档注释「Read a service from the store without the inject
 * requirement」）。名字不存在时可能抛错，因此这里兜住并当作「不可用」。
 * @param ctx - 浏览器上下文。
 * @returns 会话服务；该部署未提供时为 `undefined`。
 */
function conversationOf(ctx: ClientPluginContext): ConversationService | undefined {
  try {
    return ctx.get?.<ConversationService>('conversation')
  } catch {
    return undefined
  }
}

/**
 * 取当前会话的编辑器插入位点。
 *
 * 抽象成独立函数，是为了让 chip 与纯文本两条通道共用同一次捕获：两条通道若各自
 * 捕获一次，第二次拿到的 `draftRev` 可能已经过期。
 * @param inputActions - 草稿写入面。
 * @returns 插入位点；写入面缺失时为 `undefined`。
 */
function insertionSpan(
  inputActions: InputActions | undefined,
): { start: number; end: number; draftRev: number } | undefined {
  if (inputActions === undefined) return undefined
  try {
    return inputActions.captureInsertion()
  } catch {
    return undefined
  }
}

/**
 * 给引用块包上边界换行，得到 chip 的 `ref`。
 *
 * `ref` 会**原样**成为已发送正文的一部分（官方 `reference` 源的
 * `codec.serialize = (ref) => ref`），而引用块的最后一行是 `> 正文`。用户紧接着
 * chip 输入的文字会被插进同一行，变成 `> 正文用户的话` —— 模型会把它当成引用内容，
 * 显示层更是会把它并进引用 chip 里，用户自己写的字看起来像被吞掉了。
 *
 * 所以在块的**尾部**补一个换行，让后续输入落在引用块之外。块首同理，但只在前面
 * 确实有非换行字符时才补，否则草稿为空时会凭空多出一个空行。
 * @param block - 引用块。
 * @param draft - 插入前的草稿全文。
 * @param start - 插入位点（草稿坐标）。
 * @returns 带边界换行的 chip ref。
 */
function chipRef(block: string, draft: string | undefined, start: number): string {
  const before = typeof draft === 'string' ? draft.slice(0, start) : ''
  const needsLeading = before.length > 0 && !before.endsWith('\n')
  return `${needsLeading ? '\n' : ''}${block}\n`
}

/**
 * 尝试插入引用 chip。
 * @param target - 插入环境。
 * @param block - 引用块（chip 的 `ref` 由它加边界换行得到）。
 * @param span - 已捕获的插入位点。
 * @returns 是否成功插入。
 */
function insertChip(
  target: InsertTarget,
  block: string,
  span: { start: number; end: number; draftRev: number },
): boolean {
  const { ctx, sessionId, sessions } = target
  if (sessionId === undefined || sessionId === '') return false

  if (sessions === undefined || typeof sessions.scope !== 'function') return false
  const actx = sessions.scope(sessionId)
  if (actx === undefined) return false

  const conversation = conversationOf(ctx)
  if (conversation === undefined || typeof conversation.input?.for !== 'function') return false
  const input = conversation.input.for(actx)
  if (input === undefined) return false

  // `insertReference` 是可选成员：不在公开 API 清单里，因此必须逐个探测。
  const insertReference = input.insertReference
  if (typeof insertReference !== 'function') return false
  if (input.state === undefined || typeof input.state.getSnapshot !== 'function') return false

  const state = input.state.getSnapshot()
  // 没有版本号就无法做乐观并发校验；此时插入会被宿主拒绝，不如直接降级。
  if (state.draftRev === undefined) return false
  // chip 通道的守卫比纯文本更严：裁决中与提交中都不接受写入。
  if (state.phase !== 'plain' && state.phase !== 'claimed') return false
  // 捕获位点之后草稿又被改过，这次 span 已经过期。
  if (span.draftRev !== state.draftRev) return false

  return insertReference.call(
    input,
    {
      source: REFERENCE_SOURCE,
      ref: chipRef(block, state.draft, span.start),
      label: target.chipLabel,
      clipboardText: target.chipClipboard,
      // 刻意不设 `appearance`：宿主只接受 session/file/folder 三值，而我们的引用
      // 三者都不是。设成 `file` 会让点击 chip 时按文件路径打开（会报错），设成
      // `session` 语义上又指向了会话。留空时 chip 显示 `@` 前缀，虽然朴素但不骗人。
    },
    { draftRev: span.draftRev, start: span.start, end: span.end },
  )
}

/**
 * 退化为纯文本插入。
 *
 * 同样补一个尾部换行：纯文本路径写进草稿的就是引用块本身，少了这个换行，用户接着
 * 输入的字会并进最后一行的 `>` 里，和 chip 路径是同一个坑。
 * @param target - 插入环境。
 * @param block - 引用块文本（末尾已带换行）。
 * @param span - 已捕获的插入位点。
 * @returns 是否成功插入。
 */
function insertPlain(
  target: InsertTarget,
  block: string,
  span: { start: number; end: number; draftRev: number },
): boolean {
  const { inputActions } = target
  if (inputActions === undefined) return false
  return inputActions.insertText(block, span)
}

/**
 * 把一段选中的正文作为引用写进草稿：先试 chip，失败则纯文本。
 * @param target - 插入环境。
 * @param text - 选中的正文。
 * @param turn - 内容所在轮次；未知时不写该属性。
 * @returns 实际走通的通道。
 */
export function insertQuote(target: InsertTarget, text: string, turn?: number): InsertOutcome {
  const block = buildQuoteBlock(text, { turn })

  // chip 通道用自己捕获的位点：它比纯文本更严，位点过期就该直接降级。
  const chipSpan = insertionSpan(target.inputActions)
  if (chipSpan !== undefined) {
    // facade 上的方法来自宿主内部实现，宁可降级也不要把错误抛到 React 事件
    // 处理器外面。
    try {
      if (insertChip(target, block, chipSpan)) return 'chip'
    } catch (error) {
      // 静默降级会让「本该是 chip 却成了裸文本」这类问题无从查起，所以留痕。
      console.warn('[dsh-toolkit] message-quote：引用 chip 通道失败，改用纯文本', error)
    }
  }

  // 纯文本通道重新捕获：上面那次失败可能已经让 `draftRev` 前进了。
  const textSpan = insertionSpan(target.inputActions)
  if (textSpan !== undefined) {
    try {
      if (insertPlain(target, `${block}\n`, textSpan)) {
        // 走到这里说明 chip 通道没成 —— 记下是哪一步放弃的，便于定位版本差异。
        console.warn('[dsh-toolkit] message-quote：已退化为纯文本插入', {
          hasSessions: target.sessions !== undefined,
          hasSessionId: target.sessionId !== undefined,
          hasInputActions: target.inputActions !== undefined,
        })
        return 'text'
      }
    } catch (error) {
      console.warn('[dsh-toolkit] message-quote：纯文本插入也失败了', error)
    }
  }

  return 'failed'
}
