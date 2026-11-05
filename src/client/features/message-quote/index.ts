/**
 * message-quote 功能 · 浏览器侧装配。
 *
 * 两处占用者，分别对应引用的「写入」与「显示」：
 *
 *   1. `conversation.input.overlay` —— composer 的浮层锚点。选中会话正文里的文字后，
 *      菜单浮到选区旁边，点一下就把引用写进草稿。
 *   2. `conversation.user.text.node`（键化，键 {@link QUOTE_NODE_KEY}）—— 已发送消息
 *      里把引用块显示成与输入框一致的 chip。配合
 *      `uiConversation.userText.register` 的匹配规则，模型仍收到完整 Markdown，
 *      用户看到的是 chip：宿主的用户气泡**不解析 Markdown**，没有这层渲染，
 *      `> **引用自第 4 轮**` 就会作为源码原样显示。
 *
 * 两处都经 {@link gated} 包一层：功能关闭时不渲染，但注册关系仍在，重新打开会立刻
 * 恢复，不会经历「注销 → 等槽位出现」的空窗。
 *
 * 该功能**没有** Host 侧表面：选区到草稿的整条链路都在浏览器里，Host 无从参与
 * （`src/features/message-quote/host.ts` 因此是一个空实现，只用来满足注册表完整性）。
 */
import type { FeatureId } from '../../../features.js'
import type { ClientFeature, ClientFeatureContext } from '../../feature.js'
import type { SessionsClientService, UiConversationService } from '../../host-api.js'
import { gated } from '../../gate.js'
import { createQuotePopover, type QuotePopoverProps } from './quote-popover.js'
import { QUOTE_NODE_KEY, QuoteNodeView, quoteTextRule, type QuoteNodeViewProps } from './quote-node.js'
import { EN, ZH } from './locale.js'

/** message-quote 功能的浏览器实现。 */
export const messageQuoteClientFeature: ClientFeature = {
  id: 'message-quote' satisfies FeatureId,
  locale: { zh: ZH, en: EN },
  register(feature: ClientFeatureContext): void {
    /**
     * 会话服务，由 `whenService` 在就绪时填入。
     *
     * **不能直接写 `feature.ctx.sessions`**：本插件没有把 `sessions` 声明进插件级
     * `inject`（缺一个服务不该让整个浏览器侧都不加载），而 Cordis 的上下文代理对
     * 「未声明就读取」会**直接抛错**（`cannot get property "sessions" without
     * inject`），不是返回 `undefined`。`whenService` 走的是 `ctx.inject`，是官方
     * 认可的弱依赖通道，缺服务时回调不运行、只让本功能降级。
     */
    const services: { sessions?: SessionsClientService } = {}
    feature.whenService<SessionsClientService>('sessions', (sessions) => {
      services.sessions = sessions
    })

    // 闭包持有 ctx 与 services：每次点击都读当下的值，而不是注册时固化。
    const QuotePopover = createQuotePopover(feature.ctx, services)
    const GatedPopover = gated('messageQuote', QuotePopover)
    // order 20：同槽位已有 `slash-menu`(0) / `command-popup`(1) / `feedback-dialog`(2)
    // / `context-modal`(10)。靠后意味着菜单在 DOM 顺序上也更靠后，与更高的
    // z-index 一起保证它盖在上面。
    feature.occupy<QuotePopoverProps>(
      'conversation.input.overlay',
      { id: 'toolkit-message-quote', order: 20 },
      GatedPopover,
    )

    // 已发送消息里的引用块显示。两半必须成对注册：只有规则没有 renderer 时，
    // 引用块会走宿主的 fallback（`node.data.display ?? raw`，也就等于原文照旧）；
    // 只有 renderer 没有规则时，它永远不会被调用。因此两者写在同一次 whenService 里。
    feature.whenService<UiConversationService>('uiConversation', (uiConversation) => {
      feature.ctx.effect(
        () => uiConversation.userText.register(quoteTextRule),
        'dsh-toolkit: message-quote · userText rule',
      )
      const GatedQuoteNode = gated('messageQuote', QuoteNodeView)
      // order 100 与宿主的 `text`(100) 并列：键化 slot 里同一个键只会有一个
      // renderer，order 只影响同键冲突时的稳定性，因此沿用宿主的取值习惯。
      feature.occupyKeyed<QuoteNodeViewProps>(
        'conversation.user.text.node',
        { key: QUOTE_NODE_KEY, order: 100 },
        GatedQuoteNode,
      )
    })
  },
}
