/**
 * git-toolkit · 浏览器侧。
 *
 * 导出 Loader 挂载的插件对象：命名空间/locale id、它所需的 services，以及
 * `apply`——后者注册 locale 字典和两个槽位占用者：`conversation.hero.options`
 * 上的 pill 和 `shell.overlay` 上的面板。
 *
 * `tsdown.config.ts` 把该模块打包成 CommonJS，并包装为
 * `window.__ModuleLoader__.load({ id, factory })`；此处不直接与 loader 交互，
 * 不 import 任何 `@deepseek-ai/*` 包，模块作用域内也没有 DOM 副作用（样式是由
 * 组件持有的 `<style>` 元素）。
 */
import { PLUGIN_ID } from '../shared.js'
import { BranchBadge } from './BranchBadge.js'
import { BranchMenu } from './BranchMenu.js'
import { BranchSeat } from './BranchSeat.js'
import type { ClientPluginContext, LocaleDictionaries, MessageDict } from './host-api.js'

/** 插件 id：loader 行 id、浏览器 factory id，以及 locale 命名空间。 */
export const name: string = PLUGIN_ID

/** 该侧需要的 Host services：slot 注册表和 locale 注册表。 */
export const inject: readonly string[] = ['slots', 'locale']

/**
 * 可见文案。`zh` 是参考表；`en` 必须覆盖完全相同的键，因此缺失的翻译会在
 * type-check 阶段失败，而不是被发布出去。`upstreamGone` 是显示在已删除分支的
 * 上游分支之后的短后缀（该行会用省略号截断，因此后缀保持紧凑）；
 * `expandFolder`/`collapseFolder`/`branchFolder` 组合成目录行的无障碍名称。
 */
const ZH = {
  switchBranch: '切换 Git 分支',
  searchPlaceholder: '搜索分支',
  branchesLabel: '分支',
  noMatch: '未找到匹配的分支',
  loading: '加载中…',
  createNew: '创建并检出新分支...',
  createTitle: '新建分支',
  newBranchName: '新分支名称',
  cancel: '取消',
  createAndCheckout: '创建并检出',
  creating: '正在创建…',
  switching: '正在切换…',
  emptyName: '请输入分支名称',
  requestFailed: '请求失败',
  upstreamGone: '已删除',
  expandFolder: '展开',
  collapseFolder: '折叠',
  branchFolder: '分支文件夹',
  currentBranch: '当前分支',
  detachedHead: '游离 HEAD',
} as const satisfies MessageDict

/** UI 可能请求的全部翻译键。 */
type MessageKey = keyof typeof ZH

/** 英文表：穷尽覆盖 `MessageKey` 正是 `satisfies` 所检查的内容。 */
const EN: Readonly<Record<MessageKey, string>> = {
  switchBranch: 'Switch Git branch',
  searchPlaceholder: 'Search branches',
  branchesLabel: 'Branches',
  noMatch: 'No matching branches',
  loading: 'Loading…',
  createNew: 'Create and check out a new branch...',
  createTitle: 'New branch',
  newBranchName: 'New branch name',
  cancel: 'Cancel',
  createAndCheckout: 'Create and check out',
  creating: 'Creating…',
  switching: 'Switching…',
  emptyName: 'Please enter a branch name',
  requestFailed: 'Request failed',
  upstreamGone: 'deleted',
  expandFolder: 'Expand',
  collapseFolder: 'Collapse',
  branchFolder: 'Branch folder',
  currentBranch: 'Current branch',
  detachedHead: 'detached HEAD',
}

/** 两个字典，以 {@link PLUGIN_ID} 为键交给 locale service。 */
const DICTS: LocaleDictionaries = { zh: ZH, en: EN }

/**
 * 注册 locale 字典和两个槽位占用者。
 * 每次注册都是一个可销毁的 effect，因此禁用插件会移除 pill、面板及其样式元素。
 * @param ctx - 带有 `slots` 和 `locale` services 的浏览器上下文。
 */
export function apply(ctx: ClientPluginContext): void {
  ctx.effect(() => ctx.locale.register(PLUGIN_ID, DICTS), 'git-toolkit: locale')

  ctx.slots.inject('conversation.hero.options', () =>
    ctx.slots.register(
      {
        name: 'conversation.hero.options',
        id: 'git-toolkit-branch',
        order: 10,
        locale: PLUGIN_ID,
      },
      BranchSeat,
    ),
  )

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: 'git-toolkit-branch-popover',
        order: 1000,
        locale: PLUGIN_ID,
      },
      BranchMenu,
    ),
  )

  // 进行中对话的 composer 工具行。上方的 Hero 行只在会话开始前存在，因此这里
  // 是进行中的对话可以报告其工作区所在分支的位置。
  ctx.slots.inject('conversation.input.left', () =>
    ctx.slots.register(
      {
        name: 'conversation.input.left',
        id: 'git-toolkit-branch-badge',
        order: 10,
        locale: PLUGIN_ID,
      },
      BranchBadge,
    ),
  )
}
