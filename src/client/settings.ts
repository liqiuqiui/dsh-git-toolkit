/**
 * 浏览器侧 · 把本插件的开关接到 Host 设置文档。
 *
 * 设置文档的 namespace 是**插件条目 id**，由 profile 决定，编译期无法写死；
 * 而且设置服务在部分部署里可能根本不存在。因此这里分两步：
 *
 *   1. {@link resolveNamespace} 在设置文档镜像里定位本插件的 namespace：先认
 *      插件 id，再退化为「哪个 namespace 的值里带着本插件的全部开关字段」；
 *   2. {@link mountToggles} 用读到的 namespace 建表单控制器、把 store 绑上去，
 *      并把详情页的开关区块注册进 `plugins.bundle.config`。
 *
 * 两步都由镜像订阅驱动，因此镜像还没到、或稍后才到，都不影响正确性。
 */
import type { FeatureConfigKey } from '../features.js'
import { FEATURE_CONFIG_KEYS } from '../features.js'
import type {
  ClientPluginContext,
  ConfigFormController,
  ConfigFormsService,
  SettingsDocumentSnapshot,
} from './host-api.js'
import { bindToggleStore, createToggleStore, type FeatureToggleStore } from './toggles.js'
import { ToggleSection } from './ToggleSection.js'

/**
 * 判断一份 namespace 值是否就是本插件的配置。
 * @param value - namespace 的当前值。
 * @returns 是否带着本插件的全部开关字段。
 */
function hasToggleKeys(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return FEATURE_CONFIG_KEYS.every((key) => typeof record[key] === 'boolean')
}

/**
 * 在设置文档里定位本插件的 namespace。
 *
 * 先认插件 id（它同时是包名与 patch 行 id，正常情况下直接命中）；只有命中的
 * 那一行确实带着本插件的字段时才采信，否则退化为按字段匹配，并要求结果唯一 ——
 * 拿不准时宁可不显示开关，也不要改写别人的配置。
 * @param snapshot - 设置文档镜像快照。
 * @param pluginId - 插件 id。
 * @returns namespace；尚未读到文档或无法唯一确定时返回 undefined。
 */
export function resolveNamespace(
  snapshot: SettingsDocumentSnapshot,
  pluginId: string,
): string | undefined {
  const namespaces = snapshot.view?.namespaces
  if (namespaces === undefined) return undefined
  // 命中插件 id 即采信，不看值长什么样：namespace 就是 profile 条目 id，而条目
  // id 来自本包的包名，这是身份而不是猜测。否则用户一旦把值写坏（比如手工编辑
  // profile），详情页就再也打不开、也就再也没法从界面上改回来。
  if (namespaces.some((row) => row.ns === pluginId)) return pluginId
  const matches = namespaces.filter((row) => hasToggleKeys(row.value))
  return matches.length === 1 ? matches[0]?.ns : undefined
}

/** 一次挂载拿到的句柄。 */
export interface TogglesMount {
  /** 本插件的 namespace。 */
  readonly namespace: string
  /** 开关 store。 */
  readonly store: FeatureToggleStore
  /** 表单控制器。 */
  readonly form: ConfigFormController
  /** 释放：解绑 store 并停止订阅。 */
  dispose(): void
}

/**
 * 用已确定的 namespace 挂载开关。
 * @param configForms - 设置表单服务。
 * @param namespace - 本插件的设置 namespace。
 * @returns 挂载句柄。
 */
export function mountToggles(
  configForms: ConfigFormsService,
  namespace: string,
): TogglesMount {
  const form = configForms.get(namespace)

  /** 当前表单值；未就绪或 Host 未服务该 namespace 时为 undefined。 */
  const currentValue = (): unknown => {
    const snapshot = form.getSnapshot()
    return snapshot.status === 'ready' ? snapshot.value : undefined
  }

  /** 尚未就绪时的原因，交给 store 体现到界面说明上。 */
  const pendingStatus = (): 'loading' | 'unavailable' =>
    form.getSnapshot().status === 'loading' ? 'loading' : 'unavailable'

  const store = createToggleStore({
    read: currentValue,
    write: async (key: FeatureConfigKey, value: boolean) => await form.set(key, value),
    subscribe: (listener) => form.subscribe(listener),
  })

  // 初值：控制器可能已经在 derive 之后（比如页面重开），因此先同步一次再订阅。
  store.refresh(currentValue(), pendingStatus())
  const unsubscribeForm = form.subscribe(() => {
    store.refresh(currentValue(), pendingStatus())
  })
  const unbind = bindToggleStore(store)

  return {
    namespace,
    store,
    form,
    dispose(): void {
      unsubscribeForm()
      unbind()
    },
  }
}

/**
 * 在设置服务于可用期间装配开关 UI。
 *
 * 传入的 `scope` 是 `ctx.inject(['configForms'], …)` 交来的子上下文：设置服务
 * 不可用时这个回调根本不会运行，插件其余部分（各功能本身）照常按默认值工作。
 * @param ctx - 浏览器上下文（用于 `effect`/`slots`）。
 * @param scope - 带 `configForms` 的子上下文。
 * @param pluginId - 插件 id。
 */
export function installToggles(
  ctx: ClientPluginContext,
  scope: ClientPluginContext,
  pluginId: string,
): void {
  const configForms = scope.configForms
  const mirror = configForms.describe()

  /** 已挂载的句柄；namespace 一旦确定就不再重挂。 */
  let mounted: TogglesMount | undefined

  const sync = (): void => {
    if (mounted !== undefined) return
    const namespace = resolveNamespace(mirror.getSnapshot(), pluginId)
    if (namespace === undefined) return
    mounted = mountToggles(configForms, namespace)
    const active: TogglesMount = mounted
    ctx.effect(() => () => active.dispose(), `dsh-toolkit: toggles ${namespace}`)
    registerSection(ctx, pluginId)
  }

  ctx.effect(() => mirror.subscribe(sync), 'dsh-toolkit: settings mirror')
  sync()
}

/**
 * 把详情页开关区块注册进 `plugins.bundle.config`，以包名为键。
 *
 * 页面只在组合包页面上渲染这个 slot，并且只渲染账本里存在该键的区块，因此
 * 注册本身不需要再判断「当前是不是本插件的页面」。
 * @param ctx - 浏览器上下文。
 * @param pluginId - 组合包名（同时也是 key）。
 */
function registerSection(ctx: ClientPluginContext, pluginId: string): void {
  ctx.effect(
    () =>
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          { name: 'plugins.bundle.config', key: pluginId, locale: pluginId },
          ToggleSection,
        ),
      ),
    'dsh-toolkit: plugin detail toggles',
  )
}
