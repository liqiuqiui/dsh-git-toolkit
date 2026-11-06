/**
 * 浏览器侧 · 插件级文案（工具包自身的 UI，不属于任何单个功能）。
 *
 * 每个功能带有自己的 locale 命名空间（`<插件 id>/<功能 id>`），因此功能内部
 * 的文案各管各的、键名不会互相碰撞；这里只放跨功能的、属于工具包本身的文案：
 * 详情页开关区块的标题与说明、以及每个功能的标题/描述（供开关列表展示）。
 */
/** 一条文案表。 */
export type Dict = Readonly<Record<string, string>>

/** 中文表（参考表；英文表必须覆盖完全相同的键）。 */
const ZH = {
  'toolkit.sectionTitle': '功能开关',
  'toolkit.sectionDescription': '各功能互相独立，可分别关闭；关闭后其界面与后端接口同时停用。',
  'toolkit.status.loading': '正在读取设置…',
  'toolkit.status.unavailable': '当前部署未提供设置服务，功能按默认状态运行。',
  'toolkit.status.readonly': '设置文档只读，无法在此修改。',
  'toolkit.status.failed': '保存失败，已恢复为 Host 的当前值。',
  'gitBranch.title': 'Git 分支',
  'gitBranch.description': '在会话中显示当前分支，并支持切换与新建分支。',
  'messageQuote.title': '引用消息',
  'messageQuote.description': '选中会话里的文字后浮出引用菜单，把选中片段作为参考材料加入输入框。',
  'fileMenu.title': '文件右键菜单',
  'fileMenu.description': '在会话里的文件链接上右键，用系统程序打开、另存为或复制文件内容。',
} as const satisfies Dict

/** 全部键。 */
export type ToolkitKey = keyof typeof ZH

/** 英文表。 */
const EN: Readonly<Record<ToolkitKey, string>> = {
  'toolkit.sectionTitle': 'Features',
  'toolkit.sectionDescription':
    'Each feature is independent and can be turned off; turning one off disables both its UI and its endpoints.',
  'toolkit.status.loading': 'Reading settings…',
  'toolkit.status.unavailable':
    'This deployment provides no settings service; features run with their defaults.',
  'toolkit.status.readonly': 'The settings document is read-only, so it cannot be changed here.',
  'toolkit.status.failed': 'Could not save; reverted to the value the Host reports.',
  'gitBranch.title': 'Git branch',
  'gitBranch.description': 'Shows the session branch and lets you switch to or create one.',
  'messageQuote.title': 'Quote message',
  'messageQuote.description':
    'Selecting text in the conversation floats a quote menu that adds the selection to the composer as reference material.',
  'fileMenu.title': 'File context menu',
  'fileMenu.description':
    'Right-click a file link in a session to open it in a system app, save a copy, or copy its contents.',
}

/** 交给 locale 服务的两个字典，以插件 id 为命名空间。 */
export const TOOLKIT_DICTS = { zh: ZH, en: EN } as const
