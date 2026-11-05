/**
 * 浏览器侧 · 功能注册表。
 *
 * 与 `src/features/registry.ts` 对称：`Record<FeatureId, …>` 保证新增功能时
 * 两侧都不会漏实现。每一项把功能 id、它的 Config 字段名与实现绑在一起，
 * 于是「开关 → 功能」的对应关系只有这一处定义。
 */
import { FEATURES, FEATURE_LIST, type FeatureId } from '../../features.js'
import type { ClientFeatureEntry } from '../feature.js'
import { gitBranchClientFeature } from './git-branch/index.js'
import { messageQuoteClientFeature } from './message-quote/index.js'

/** 每个功能 id 对应的浏览器实现。 */
const IMPLEMENTATIONS: Readonly<Record<FeatureId, ClientFeatureEntry>> = {
  'git-branch': {
    id: 'git-branch',
    configKey: FEATURES['git-branch'].configKey,
    feature: gitBranchClientFeature,
  },
  'message-quote': {
    id: 'message-quote',
    configKey: FEATURES['message-quote'].configKey,
    feature: messageQuoteClientFeature,
  },
}

/** 按声明顺序排列的功能表，装配时直接遍历。 */
export const CLIENT_FEATURES: readonly ClientFeatureEntry[] = FEATURE_LIST.map(
  (declaration) => IMPLEMENTATIONS[declaration.id],
)
