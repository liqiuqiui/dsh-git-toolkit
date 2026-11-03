/**
 * 浏览器侧 · 按开关渲染的包装器。
 *
 * 每个功能在装配时就把自己的 slot 占用者注册好，但**渲染**时再判断开关，
 * 因此关闭一个功能不需要注销 slot 占用者（那会在开关切换时引起注册表抖动），
 * 也能保证下次打开时立刻恢复。关闭状态下组件返回 `null`，与「不满足条件的
 * 占用者完全不渲染」这一既有约定一致。
 */
import * as React from 'react'
import type { ComponentType } from 'react'

import type { FeatureConfigKey } from '../features.js'
import { useEnabled } from './use-toggles.js'

/**
 * 把一个组件包成「功能关闭时不渲染」。
 * @param key - 该功能对应的 Config 字段名。
 * @param Component - 原组件；props 原样透传。
 * @returns 受开关控制的组件。
 */
export function gated<P extends object>(
  key: FeatureConfigKey,
  Component: ComponentType<P>,
): ComponentType<P> {
  function Gated(props: P): React.ReactElement | null {
    const enabled = useEnabled(key)
    return enabled ? React.createElement(Component, props) : null
  }
  Gated.displayName = `Gated(${Component.displayName ?? Component.name ?? key})`
  return Gated
}
