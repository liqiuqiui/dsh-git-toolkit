/**
 * 浏览器侧 · 功能契约与注册上下文。
 *
 * 与 Host 侧对称：每个功能实现一个 {@link ClientFeature}，只在自己的 `register`
 * 里装配自己的 UI（slot 占用者、详情页区块…），不引用其他功能。
 *
 * 两条约定：
 *
 * - `isEnabled()` 是**实时**读取。开关是 volatile 写入，插件不会重挂载，因此功能
 *   不能在自己注册的那一刻把开关读成常量；组件必须在渲染时判断（配合
 *   `gate.tsx` 的 `gated()`），关闭后立刻不渲染。
 * - 每个功能带自己的 locale 命名空间（{@link featureNamespace}）与文案表，功能
 *   内部文案的键名因此不会与其他功能碰撞。
 * - 功能需要的 Harness 服务经 {@link ClientFeatureContext.whenService} 取，**不要**
 *   加进插件级 `inject`。`inject` 是整包级的：缺一个服务整个浏览器侧都不加载，
 *   其他功能跟着一起消失；`whenService` 缺服务时只让本功能降级。
 */
import type { ComponentType } from 'react'

import { isolateFeature } from '../diagnostics.js'
import type { FeatureConfigKey, FeatureId } from '../features.js'
import type { ClientPluginContext, LocaleDictionaries, LocaleService, SlotsService } from './host-api.js'

/**
 * 一个功能的 locale 命名空间。
 * @param pluginId - 插件 id（locale 根命名空间）。
 * @param id - 功能 id。
 * @returns `<插件 id>/<功能 id>`。
 */
export function featureNamespace(pluginId: string, id: FeatureId): string {
  return `${pluginId}/${id}`
}

/** 功能注册时拿到的上下文。 */
export interface ClientFeatureContext {
  /** 原始浏览器上下文；功能需要 `sessions` 之类的服务时用它取。 */
  readonly ctx: ClientPluginContext
  /** 本功能的 locale 命名空间。 */
  readonly namespace: string
  /** 绑定到 {@link namespace} 的翻译函数；`params` 用于 `{name}` 占位插值。 */
  t(key: string, params?: Record<string, unknown>): string
  /** 该功能此刻是否开启。 */
  isEnabled(): boolean
  /**
   * 注册一个 slot 占用者，并随插件一起释放。
   * @param slotName - 目标 slot。
   * @param options - 占用者 id 与排序。
   * @param component - 占用者组件（通常经 `gated()` 包一层）。
   */
  occupy<P extends object>(
    slotName: string,
    options: { id: string; order?: number },
    component: ComponentType<P>,
  ): void
  /**
   * 注册一个**键化** slot（`kind: "keyed"`）的占用者，并随插件一起释放。
   *
   * 与 {@link occupy} 的区别只在寻址方式：list slot 用 `id` 排成一列，keyed slot
   * 用 `key` 按名字查一项——宿主是按名字取它的，例如
   * `conversation.user.text.node` 用 `entryKey: node.id` 来选 renderer。把两者
   * 合成一个方法会让「传错字段」变成静默不渲染，所以刻意分开。
   * @param slotName - 目标 slot。
   * @param options - 键与排序；键必须与匹配规则声明的 `id` 一致。
   * @param component - 占用者组件。
   */
  occupyKeyed<P extends object>(
    slotName: string,
    options: { key: string; order?: number },
    component: ComponentType<P>,
  ): void
  /**
   * 本功能需要某个 Harness 服务时使用。
   *
   * 服务就绪后回调运行一次，拿到服务本体（例如 `'sessions'`）；服务不存在时回调
   * 根本不运行，因此依赖它的 UI 自然不会出现，其余功能不受影响。
   *
   * 为什么不用插件级 `inject`：那是**整包**依赖，缺服务会让整个浏览器侧都不加载。
   * @param name - 服务名，可带点路径（如 `'remote.workspaceFiles'`）。
   * @param callback - 拿到服务后要做的事；抛错只影响本功能。
   */
  whenService<S>(name: string, callback: (service: S) => void): void
}

/**
 * 从子上下文里按名字取服务，支持 `a.b` 这样的点路径。
 *
 * 先按**整个键名**取一次：`inject` 交来的子上下文把每个被注入的键挂成同名属性，
 * 因此注入 `remote.session` 时属性名就是 `'remote.session'`。取不到再按点号逐段
 * 下钻，这样 `remote` 与 `remote.session` 两种注入方式都能读到同一个命名空间
 * （把整个键当属性名是 Cordis 的行为，逐段下钻则是「只注入了根服务」时的形态）。
 * @param scope - `inject` 交来的子上下文。
 * @param name - 服务名。
 * @returns 服务；两条路径都取不到时返回 undefined。
 */
function readService(scope: unknown, name: string): unknown {
  if (scope === null || typeof scope !== 'object') return undefined
  const direct = (scope as Record<string, unknown>)[name]
  if (direct !== undefined && direct !== null) return direct
  let node: unknown = scope
  for (const segment of name.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[segment]
  }
  return node ?? undefined
}

/** 一个功能的浏览器实现。 */
export interface ClientFeature {
  /** 功能 id，必须与 `features.ts` 的声明一致。 */
  readonly id: FeatureId
  /** 该功能的文案，注册到 {@link featureNamespace} 命名空间。 */
  readonly locale: { readonly zh: LocaleDictionaries['zh']; readonly en: LocaleDictionaries['en'] }
  /** 装配该功能的全部 UI。 */
  register(feature: ClientFeatureContext): void
}

/** 一个功能的注册表项：把 id、Config 字段名与实现绑在一起。 */
export interface ClientFeatureEntry {
  readonly id: FeatureId
  readonly configKey: FeatureConfigKey
  readonly feature: ClientFeature
}

/** 注册一个功能所需的外部设施。 */
export interface FeatureRegistrationOptions {
  /** 插件 id：locale 根命名空间，也是详情页区块的命名空间。 */
  pluginId: string
  /** locale 服务。 */
  locale: LocaleService
  /** 某个功能的开关读取函数。 */
  isEnabled(entry: ClientFeatureEntry): boolean
}

/**
 * 为一次 `register` 构建功能上下文。
 * @param ctx - 浏览器上下文。
 * @param entry - 该功能的注册表项。
 * @param options - 插件 id、locale 服务与开关读取。
 * @returns 功能上下文。
 */
export function clientFeatureContext(
  ctx: ClientPluginContext,
  entry: ClientFeatureEntry,
  options: FeatureRegistrationOptions,
): ClientFeatureContext {
  const slots: SlotsService = ctx.slots
  const namespace = featureNamespace(options.pluginId, entry.id)
  return {
    ctx,
    namespace,
    t: options.locale.bind(namespace),
    isEnabled: () => options.isEnabled(entry),
    whenService<S>(name: string, callback: (service: S) => void): void {
      const inject = ctx.inject
      // 没有 `inject` 的宿主（例如只用 slots/locale 的最小装配）里，本功能需要的
      // 服务取不到，于是它对应的界面不注册 —— 只影响它自己。
      if (typeof inject !== 'function') return
      inject.call(ctx, [name], (scope) => {
        const service = readService(scope, name)
        if (service === undefined) return
        isolateFeature('client', `${entry.id} · ${name}`, () => {
          callback(service as S)
        })
      })
    },
    occupy<P extends object>(
      slotName: string,
      registration: { id: string; order?: number },
      component: ComponentType<P>,
    ): void {
      ctx.effect(
        () =>
          slots.inject(slotName, () =>
            slots.register(
              {
                name: slotName,
                id: registration.id,
                order: registration.order ?? 10,
                locale: namespace,
              },
              component,
            ),
          ),
        `dsh-toolkit: ${entry.id} · ${slotName}`,
      )
    },
    occupyKeyed<P extends object>(
      slotName: string,
      registration: { key: string; order?: number },
      component: ComponentType<P>,
    ): void {
      ctx.effect(
        () =>
          slots.inject(slotName, () =>
            slots.register(
              {
                name: slotName,
                key: registration.key,
                order: registration.order ?? 10,
                locale: namespace,
              },
              component,
            ),
          ),
        `dsh-toolkit: ${entry.id} · ${slotName} · ${registration.key}`,
      )
    },
  }
}
