/**
 * git-branch 功能 · 浏览器侧文案。
 *
 * 注册到本功能自己的命名空间（`dsh-toolkit/git-branch`），因此这里的键名不会与
 * 其他功能碰撞，也不需要前缀。`zh` 是参考表；`en` 必须覆盖完全相同的键，
 * 缺失的翻译会在 type-check 阶段失败。
 *
 * `upstreamGone` 是显示在已删除分支的上游名之后的短后缀（该行会用省略号截断，
 * 因此后缀保持紧凑）；`expandFolder`/`collapseFolder`/`branchFolder` 组合成
 * 目录行的无障碍名称。
 */
import type { MessageDict } from '../../../client/host-api.js'

/** 可见文案（中文）。 */
export const ZH = {
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

/** 该功能用到的全部翻译键。 */
export type MessageKey = keyof typeof ZH

/** 英文表：穷尽覆盖 `MessageKey` 正是 `satisfies` 所检查的内容。 */
export const EN = {
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
} as const satisfies Readonly<Record<MessageKey, string>>
