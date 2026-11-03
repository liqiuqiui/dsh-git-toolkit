/**
 * dsh-toolkit · 功能注册表。
 *
 * 这是整个插件唯一的「功能清单」：Host 半侧据此构建 Config 开关、浏览器半侧据此
 * 构建详情页开关列表，两侧各自的功能实现再按 {@link FeatureId} 挂到自己的注册表上
 * （`src/features/registry.ts` 与 `src/client/features/registry.ts`）。那些映射用
 * `Record<FeatureId, …>` 声明，因此**新增功能却漏了任何一侧都是类型错误**，而不是
 * 一个静默失效的开关。
 *
 * 新增一个功能需要动的地方：
 *   1. 这里加一条 {@link FEATURES}（id + Config 字段名 + 标题/说明文案 key）；
 *   2. `src/features/<id>/host.ts` —— Host 表面（路由、后台任务……）；
 *   3. `src/client/features/<id>/index.tsx` —— 浏览器表面（槽位占用、文案）。
 *
 * 本模块同时被编译进 Host bundle 与浏览器产物，因此必须保持零依赖：不得有
 * `node:` 导入，不得依赖 Harness 各包，模块作用域内不得有副作用。
 */

/** 单个功能的声明。 */
export interface FeatureDescriptor {
  /**
   * 该功能在 Config 中的开关字段名。
   *
   * 必须是标识符形态的小驼峰（`gitBranch`），因为它同时是 schemastery 的字段名、
   * settings 表单里的路径段，以及详情页 `form.set()` 的第一个参数。
   */
  readonly configKey: string
  /** 用户从未配置过时的默认状态。 */
  readonly defaultEnabled: boolean
  /** 功能标题的 locale key。 */
  readonly titleKey: string
  /** 功能说明的 locale key。 */
  readonly descriptionKey: string
}

/**
 * 全部功能，按详情页展示顺序声明。
 *
 * 键是功能 id（同时是功能目录名，使用 kebab-case）；值是它的声明。
 */
export const FEATURES = {
  'git-branch': {
    configKey: 'gitBranch',
    defaultEnabled: true,
    titleKey: 'gitBranch.title',
    descriptionKey: 'gitBranch.description',
  },
} as const satisfies Record<string, FeatureDescriptor>

/** 功能 id：{@link FEATURES} 的键。 */
export type FeatureId = keyof typeof FEATURES

/** Config 中的开关字段名。 */
export type FeatureConfigKey = (typeof FEATURES)[FeatureId]['configKey']

/** 单个功能声明的具体类型（保留字面量，便于派生精确的键类型）。 */
export type FeatureDeclaration = (typeof FEATURES)[FeatureId]

/** 一个带 id 的完整声明，供各方按声明顺序遍历。 */
export type FeatureEntry = (typeof FEATURES)[FeatureId] & { readonly id: FeatureId }

/** 全部功能，按声明顺序展开。 */
export const FEATURE_LIST: readonly FeatureEntry[] = (Object.keys(FEATURES) as FeatureId[]).map(
  (id) => ({ id, ...FEATURES[id] }) as FeatureEntry,
)

/**
 * 每个开关的默认值表。
 *
 * Host 侧的 Config schema 由它派生默认值，浏览器侧的 store 在设置尚未到达（或
 * 部署里根本没有 settings 页面）时用同一张表兜底 —— 两侧因此不可能对「未配置
 * 时功能是开着还是关着」产生分歧。
 */
export const FEATURE_DEFAULTS: Readonly<Record<FeatureConfigKey, boolean>> = Object.fromEntries(
  FEATURE_LIST.map((feature) => [feature.configKey, feature.defaultEnabled]),
) as Record<FeatureConfigKey, boolean>

/** 全部 Config 开关字段名，按声明顺序。 */
export const FEATURE_CONFIG_KEYS: readonly FeatureConfigKey[] = FEATURE_LIST.map(
  (feature) => feature.configKey,
)
