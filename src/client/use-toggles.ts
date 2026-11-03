/**
 * 浏览器侧 · 订阅开关的 hook。
 *
 * 独立成文件是为了让 `toggles.ts`（纯状态机，无框架依赖，可单测）与 React 解耦。
 * 所有功能组件与详情页开关控件都经由这里订阅同一份 store，所以点一下开关，
 * 页面与控件会一起更新。
 */
import * as React from 'react'

import type { FeatureConfigKey } from '../features.js'
import { DEFAULT_TOGGLES, toggleStore, type TogglesSnapshot } from './toggles.js'

const { useSyncExternalStore } = React

/** 服务端渲染兜底：本插件只在浏览器运行，但 hook 契约要求提供。 */
const SERVER_SNAPSHOT: TogglesSnapshot = { status: 'loading', value: DEFAULT_TOGGLES }

/**
 * 订阅整份开关快照。
 * @returns 当前快照；store 变化时组件重渲染。
 */
export function useToggles(): TogglesSnapshot {
  const store = toggleStore()
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getSnapshot(),
    () => SERVER_SNAPSHOT,
  )
}

/**
 * 订阅单个功能的开关。
 * @param key - 功能的 Config 字段名。
 * @returns 该功能此刻是否开启。
 */
export function useEnabled(key: FeatureConfigKey): boolean {
  return useToggles().value[key]
}
