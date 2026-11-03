/**
 * git-branch 功能 · 浏览器侧装配。
 *
 * 三个占用者分别是：New Session 行里的分支 pill、`shell.overlay` 上的分支面板、
 * 以及进行中对话 composer 工具行里的分支徽标。前两者靠模块级 store 通信，
 * 因为它们在 React 树里没有共同父级。
 *
 * 三者都经 {@link gated} 包一层：功能关闭时不渲染，但注册关系仍在，因此重新
 * 打开会立刻恢复，不会经历「注销 → 重新等着 slot 出现」的空窗。
 */
import type { FeatureId } from '../../../features.js'
import type { ClientFeature, ClientFeatureContext } from '../../feature.js'
import { gated } from '../../gate.js'
import { BranchBadge } from './BranchBadge.js'
import { BranchMenu } from './BranchMenu.js'
import { BranchSeat } from './BranchSeat.js'
import { EN, ZH } from './locale.js'

/** 登录在 hero 行中的分支 pill 的 props。 */
interface HeroProps {
  sessionId: string
  t: (key: string) => string
}

/** `shell.overlay` 面板的 props。 */
interface OverlayProps {
  t: (key: string) => string
}

/** composer 工具行徽标的 props。 */
interface InputLeftProps {
  sessionId: string
  t: (key: string) => string
}

const GatedSeat = gated('gitBranch', BranchSeat)
const GatedMenu = gated('gitBranch', BranchMenu)
const GatedBadge = gated('gitBranch', BranchBadge)

/** git-branch 功能的浏览器实现。 */
export const gitBranchClientFeature: ClientFeature = {
  id: 'git-branch' satisfies FeatureId,
  locale: { zh: ZH, en: EN },
  register(feature: ClientFeatureContext): void {
    feature.occupy<HeroProps>('conversation.hero.options', { id: 'toolkit-git-branch', order: 10 }, GatedSeat)
    feature.occupy<OverlayProps>(
      'shell.overlay',
      { id: 'toolkit-git-branch-popover', order: 1000 },
      GatedMenu,
    )
    // 进行中对话的 composer 工具行。上方的 Hero 行只在会话开始前存在，因此这里
    // 是进行中的对话可以报告其工作区所在分支的位置。
    feature.occupy<InputLeftProps>(
      'conversation.input.left',
      { id: 'toolkit-git-branch-badge', order: 10 },
      GatedBadge,
    )
  },
}
