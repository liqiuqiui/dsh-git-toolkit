/**
 * 浏览器侧 · 功能开关的共享状态。
 *
 * 只有一个数据源：本插件在 Host 设置文档里的 namespace（即插件 entry id）。
 * 插件详情页的开关和各个功能的组件都订阅这里，因此点一下开关，UI 立刻跟着变，
 * 不需要等 Host 回声，也不需要各功能自己去读设置。
 *
 * 三条设计约束：
 *
 * 1. **入口 id 是运行时才知道的**。设置文档按 profile 条目 id 索引（用户装了
 *    什么、条目叫什么由 profile 决定），因此 id 由调用方在 `apply` 里解析后传进来。
 * 2. **设置服务可能根本不存在**（没有挂载 settings 的部署）。此时状态停在
 *    `unavailable`，所有功能按各自默认值工作 —— 开关页面不注册，插件其余部分
 *    照常可用。
 * 3. **写入失败要能回退**。控件是乐观更新的（点了立刻变），失败后靠一次
 *    `resync` 把界面拉回 Host 的真实状态，而不是自己猜测。
 */
import {
  FEATURE_CONFIG_KEYS,
  FEATURE_DEFAULTS,
  type FeatureConfigKey,
} from '../features.js'

/** 开关集合：功能 Config 字段名 → 是否开启。 */
export type FeatureToggles = Readonly<Record<FeatureConfigKey, boolean>>

/** 一份开关状态快照。 */
export interface TogglesSnapshot {
  /** `loading` 表示还没读到 Host 的设置文档；`ready` 之后 `value` 可信。 */
  status: 'loading' | 'ready' | 'unavailable'
  /** 当前生效的开关；`loading`/`unavailable` 时等于默认值表。 */
  value: FeatureToggles
}

/** 默认开关：与 Host 的 Config 默认值同源。 */
export const DEFAULT_TOGGLES: FeatureToggles = { ...FEATURE_DEFAULTS }

/**
 * 一个功能的开关状态来源。
 *
 * 功能组件通过 `useFeatureEnabled(ctx, id)` 订阅；开关页面通过
 * {@link FeatureToggleStore.set} 写入。两者共用同一份状态。
 */
export interface FeatureToggleStore {
  /** 当前快照；引用稳定，直到状态真的变化。 */
  getSnapshot(): TogglesSnapshot
  /** 订阅快照变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
  /** 该功能此刻是否开启。 */
  isEnabled(key: FeatureConfigKey): boolean
  /**
   * 写入一个开关。
   * @param key - 功能 Config 字段名。
   * @param enabled - 目标状态。
   * @returns 写入是否被 Host 接受；失败时状态已回退。
   */
  set(key: FeatureConfigKey, enabled: boolean): Promise<boolean>
}

/**
 * 从一份设置表单的 `value` 里读出开关。
 * @param value - 表单值（Host 的 namespace 视图 `value`）。
 * @returns 每个声明过的开关；缺失或类型不符的字段回落到默认值。
 */
export function readToggles(value: unknown): FeatureToggles {
  const source =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const toggles = {} as Record<FeatureConfigKey, boolean>
  for (const key of FEATURE_CONFIG_KEYS) {
    const raw = source[key]
    toggles[key] = typeof raw === 'boolean' ? raw : FEATURE_DEFAULTS[key]
  }
  return toggles
}

/**
 * 创建开关 store。
 *
 * 本模块不 import 任何 Harness 包：调用方把「读」和「写」两件能力以函数形式
 * 注入（它们来自 `ctx.configForms.get(entryId)` 得到的
 * `ConfigFormController`），于是本模块可以在任何测试环境里单独驱动。
 * @param host - 对 Host 设置表单的最小适配。
 * @returns store 与一个内部使用的刷新函数。
 */
export function createToggleStore(host: {
  /** 读取当前表单值；不可用时返回 undefined。 */
  read(): unknown
  /** 写入一个字段；返回 Host 是否接受。 */
  write(key: FeatureConfigKey, value: boolean): Promise<boolean>
  /** 订阅表单变化；返回取消订阅函数。 */
  subscribe(listener: () => void): () => void
}): FeatureToggleStore & { refresh(value: unknown, pending?: 'loading' | 'unavailable'): void } {
  let snapshot: TogglesSnapshot = { status: 'loading', value: DEFAULT_TOGGLES }
  const listeners = new Set<() => void>()

  const publish = (next: TogglesSnapshot): void => {
    if (next.status === snapshot.status && equalToggles(next.value, snapshot.value)) return
    snapshot = next
    for (const listener of listeners) listener()
  }

  const store = {
    getSnapshot: (): TogglesSnapshot => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    isEnabled(key: FeatureConfigKey): boolean {
      return snapshot.value[key]
    },
    async set(key: FeatureConfigKey, enabled: boolean): Promise<boolean> {
      // 乐观更新：控件与功能必须同时对这次点击作出反应，否则会看到「开关已开但
      // 界面没动」的中间态。失败时下方 refresh 用 Host 的真实值覆盖回去。
      const optimistic = { ...snapshot.value, [key]: enabled }
      publish({ status: snapshot.status, value: optimistic })
      const accepted = await host.write(key, enabled)
      if (!accepted) store.refresh(host.read())
      return accepted
    },
    refresh(value: unknown, pending: 'loading' | 'unavailable' = 'unavailable'): void {
      // 还没有值可读时保留更精确的原因：设置文档仍在加载，和 Host 根本不服务
      // 这个 namespace，是两种不同处境，界面上的说明也不同。
      if (value === undefined) {
        publish({ status: pending, value: DEFAULT_TOGGLES })
        return
      }
      publish({ status: 'ready', value: readToggles(value) })
    },
  }
  return store
}

/**
 * 两份开关表是否等价。
 * @param left - 一份开关。
 * @param right - 另一份开关。
 */
function equalToggles(left: FeatureToggles, right: FeatureToggles): boolean {
  return FEATURE_CONFIG_KEYS.every((key) => left[key] === right[key])
}

/**
 * 模块级的稳定发布点（hub）。
 *
 * 插件装配完成前、以及设置服务不可用时，组件订阅的是这个 hub 而不是某个具体
 * store。这样 {@link bindToggleStore} 之后换上的真实 store 不需要让组件重新
 * 订阅 —— `useSyncExternalStore` 的 `getSnapshot` 身份保持稳定，只是内容变了。
 */
let hubSnapshot: TogglesSnapshot = { status: 'loading', value: DEFAULT_TOGGLES }
const hubListeners = new Set<() => void>()

/** 已绑定的真实 store；未绑定时 hub 停在 `loading`。 */
let bound: FeatureToggleStore | null = null

/** 已绑定的 store 的取消订阅函数。 */
let detach: (() => void) | null = null

/**
 * 发布一份新快照；内容未变时不通知。
 * @param next - 新快照。
 */
function publish(next: TogglesSnapshot): void {
  if (next.status === hubSnapshot.status && equalToggles(next.value, hubSnapshot.value)) return
  hubSnapshot = next
  for (const listener of hubListeners) listener()
}

/** 组件与功能读到的稳定 store。 */
const HUB: FeatureToggleStore = {
  getSnapshot: () => hubSnapshot,
  subscribe(listener: () => void): () => void {
    hubListeners.add(listener)
    return () => {
      hubListeners.delete(listener)
    }
  },
  isEnabled(key: FeatureConfigKey): boolean {
    return hubSnapshot.value[key]
  },
  async set(key: FeatureConfigKey, enabled: boolean): Promise<boolean> {
    return bound === null ? false : await bound.set(key, enabled)
  },
}

/**
 * 绑定本插件的开关 store。
 *
 * 之后 hub 的每次变化都来自这个 store；功能与详情页控件因此始终读到同一份状态，
 * 且换绑不会打断已有订阅。
 * @param store - 刚装配好的 store。
 * @returns 解绑函数（hub 回到 `loading`）。
 */
export function bindToggleStore(store: FeatureToggleStore): () => void {
  detach?.()
  bound = store
  publish(store.getSnapshot())
  detach = store.subscribe(() => {
    publish(store.getSnapshot())
  })
  return () => {
    if (bound !== store) return
    detach?.()
    detach = null
    bound = null
    publish({ status: 'loading', value: DEFAULT_TOGGLES })
  }
}

/** 读取稳定的 hub store；组件与功能都经由它取状态。 */
export function toggleStore(): FeatureToggleStore {
  return HUB
}
