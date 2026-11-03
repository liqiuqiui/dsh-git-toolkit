/**
 * Host 侧 · 功能注册表。
 *
 * 把 `features.ts` 声明的每个 id 映射到它的 Host 实现。声明为
 * `Record<FeatureId, HostFeature>`，因此**新增功能却忘了写 Host 实现**是一个
 * 类型错误，而不是一个上线后才发现永远不工作的开关。
 *
 * 新增功能时唯一需要改动的就是这里加一行 import + 一行表项。
 */
import type { FeatureId } from '../features.js'
import type { HostFeature } from '../host/feature.js'
import { gitBranchFeature } from '../features/git-branch/host.js'

/** 每个功能 id 对应的 Host 实现。 */
export const HOST_FEATURES: Readonly<Record<FeatureId, HostFeature>> = {
  'git-branch': gitBranchFeature,
}
