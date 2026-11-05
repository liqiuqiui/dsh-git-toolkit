/**
 * message-quote 功能 · Host 侧实现。
 *
 * 该功能只有浏览器表面：选中会话里的文字后浮出菜单，把选中的片段以引用块的
 * 形式送进输入框草稿。整条链路都发生在浏览器里（选区 → 草稿），Host 没有可
 * 参与的部分，因此这里**不注册任何路由**。
 *
 * 保留这个空实现是为了满足 `features/registry.ts` 里 `Record<FeatureId, HostFeature>`
 * 的完整性约束：那张表是「新增功能却漏了某侧实现」的编译期防线，因此哪怕功能
 * 没有 Host 表面也必须有一项。这也让将来若要加 Host 侧能力（例如服务端解析
 * 引用、把引用落库）时，落点是现成的。
 */
import type { FeatureId } from '../../features.js'
import type { HostFeature, HostFeatureContext } from '../../host/feature.js'

/** message-quote 功能的 Host 实现。 */
export const messageQuoteFeature: HostFeature = {
  id: 'message-quote' satisfies FeatureId,
  register(_feature: HostFeatureContext): void {
    // 纯浏览器功能：没有路由、没有后台任务。
  },
}
