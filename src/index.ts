/**
 * dsh-toolkit · Host 侧入口。
 *
 * 本文件只做四件事，任何具体功能都不得写在这里：
 *   1. 从 `features.ts` 声明生成 Config —— 每个功能一个 `volatile` 布尔开关，
 *      于是它们出现在 Host 的设置文档里，并能被插件详情页即时改写；
 *   2. 声明设置页策略（`auto: false`）：本插件自带详情页开关，不需要 Host 再
 *      按 schema 生成一个设置页；
 *   3. 遍历 `features/registry.ts`，为每个功能建立注册上下文并交给它自装配；
 *   4. 按 Host 既有的公开面（`API`、`buildRoutes`、git 操作）再导出一次，
 *      供测试与需要直接调用的场景使用。
 *
 * 开关之所以是 `volatile` 而不是普通字段：普通字段变化会让 Loader 重新挂载整个
 * 插件（当前会话里的 UI 状态会随之丢失），而 volatile 写入只把新值提交进正在
 * 运行的那个 fiber 的配置引用，不重挂载。代价是 `apply` 只跑一次，所以任何
 * 「开关是否开启」的判断都必须在**用到时**读取，见 `host/feature.ts`。
 */
import z from '@deepseek-ai/schemastery'

import { isolateFeature } from './diagnostics.js'
import {
  FEATURE_CONFIG_KEYS,
  FEATURE_DEFAULTS,
  FEATURE_LIST,
  type FeatureConfigKey,
  type FeatureEntry,
} from './features.js'
import { HOST_FEATURES } from './features/registry.js'
import { featureContext, type HostFeature } from './host/feature.js'
import { serviceOf, type HostContext, type SettingsService } from './host-api.js'

export { API_BASE } from './shared.js'
export { GIT_API as API } from './features/git-branch/shared.js'
export { buildRoutes, createBranch, readRepoStatus, switchBranch } from './features/git-branch/host.js'

/**
 * 一个 volatile 开关在运行时的读取面。
 *
 * schemastery 把 `volatile()` 字段解析成 `Volatile<boolean>`（`get()` 取值）；
 * 直接调用方（测试、未加载 Loader 的嵌入方）拿到的可能是普通布尔值，因此两者
 * 都要接受。
 */
type ToggleValue = boolean | { get(): boolean } | undefined

/** 一个功能开关的实时读取函数。 */
export type FeatureToggle = () => boolean

/**
 * 生成 Config：每个功能一个默认为其 `defaultEnabled` 的 volatile 布尔。
 *
 * 字段集合直接来自 {@link FEATURE_LIST}，因此功能声明与 schema 不可能不同步。
 */
export const Config = z.object(
  Object.fromEntries(
    FEATURE_LIST.map((feature) => [
      feature.configKey,
      z.boolean().default(feature.defaultEnabled).volatile(),
    ]),
  ),
)

/** 由 {@link Config} 解析出的运行时配置。 */
export type ToolkitConfig = Record<FeatureConfigKey, ToggleValue>

/**
 * 读取一个开关的当前值。
 * @param config - Loader 交来的配置。
 * @param key - 功能的 Config 字段名。
 * @returns 开关状态；缺失或类型不符时回落到该功能的默认值。
 */
function readToggle(config: ToolkitConfig | undefined, key: FeatureConfigKey): boolean {
  const value = config?.[key]
  if (typeof value === 'boolean') return value
  if (value !== undefined && value !== null && typeof value === 'object') {
    const read = value.get()
    if (typeof read === 'boolean') return read
  }
  return FEATURE_DEFAULTS[key]
}

/**
 * 声明设置页策略：本插件自带配置页，因此不生成 auto 设置页。
 * @param ctx - Host 上下文。
 */
function declareSettingsPolicy(ctx: HostContext): void {
  const fiber = ctx.fiber
  const inject = ctx.inject
  if (fiber === undefined || typeof inject !== 'function') return
  inject.call(ctx, ['settings'], (child) => {
    const settings = serviceOf<SettingsService>(child, 'settings')
    if (settings === undefined) return
    void child.effect(
      () => settings.configure({ auto: false }, fiber),
      'dsh-toolkit: settings page policy',
    )
  })
}

/** 一个功能的声明与它的 Host 实现。 */
export interface HostFeatureBinding {
  /** `features.ts` 里的声明。 */
  readonly feature: FeatureEntry
  /** 该功能的 Host 实现。 */
  readonly implementation: HostFeature
}

/**
 * 逐个装配功能，每个都在故障隔离中运行。
 *
 * 抽成独立函数（而不是直接写在 `apply` 里）是为了让「一个功能抛错不影响其他
 * 功能」这件事可被测试直接驱动。
 * @param ctx - Host 上下文。
 * @param config - 已解析的配置。
 * @param bindings - 要装配的功能；默认为注册表里的全部功能。
 */
export function applyHostFeatures(
  ctx: HostContext,
  config: ToolkitConfig | undefined,
  bindings: readonly HostFeatureBinding[] = FEATURE_LIST.map((feature) => ({
    feature,
    implementation: HOST_FEATURES[feature.id],
  })),
): void {
  for (const { feature, implementation } of bindings) {
    const isEnabled: FeatureToggle = () => readToggle(config, feature.configKey)
    isolateFeature('host', feature.id, () => {
      implementation.register(featureContext(ctx, isEnabled))
    })
  }
}

/**
 * 装配本插件的全部 Host 表面。
 * @param ctx - Loader 交来的 Host 上下文（`webServer` 已在 `inject` 中声明）。
 * @param config - 已解析的配置；每个功能一个 volatile 开关。
 */
export function apply(ctx: HostContext, config?: ToolkitConfig): void {
  // 设置页策略是插件级的一步：它失败不该连累各功能，各功能照常按默认开关工作。
  isolateFeature('host', 'settings page policy', () => {
    declareSettingsPolicy(ctx)
  })
  applyHostFeatures(ctx, config)
}

/** Host 侧只强制要求浏览器载体；sessions / settings 都是可选读取的。 */
export const inject: readonly string[] = ['webServer']

/** 全部开关字段名、默认值与声明，供测试与诊断使用。 */
export { FEATURE_CONFIG_KEYS, FEATURE_DEFAULTS, FEATURE_LIST }
