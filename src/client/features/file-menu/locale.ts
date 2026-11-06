/**
 * 浏览器侧 · file-menu 的文案。
 *
 * 命名空间是 `dsh-toolkit/file-menu`（由注册表按功能 id 拼出），因此这里的键名
 * 不会与其他功能碰撞，写法上也就保持最短：`open`、`reveal`、`copyPath`…
 *
 * 文案刻意沿用 macOS 访达/右键菜单的说法（「打开」「在 Finder 中显示」），因为
 * 这个菜单就是在模仿那个交互；Linux/Windows 上「文件管理器」是更准确的词，但
 * 菜单本身由宿主的 `fileManager` 能力决定是否出现，这里不另做平台分支。
 */

/** 文案表。键与值都由 {@link ZH} 约束。 */
export const ZH = {
  open: '打开文件',
  openWith: '在 {name} 中打开',
  openWithSubmenu: '打开方式',
  saveAs: '另存为…',
  copyPath: '复制路径',
  copyContents: '复制文件内容',
  reveal: '在 Finder 中显示',
  loading: '正在读取…',
  copiedPath: '路径已复制',
  copiedContents: '文件内容已复制',
  savedDialog: '已保存',
  savedDownload: '已开始下载',
  copyFailed: '复制失败',
  readFailed: '读取失败',
  openFailed: '打开失败',
  binaryFile: '这是二进制文件，无法作为文本复制',
  tooLarge: '文件太大（上限 {limit}）',
  tooLargeSave: '文件太大，无法另存为',
  unresolved: '无法确定这个文件的绝对路径',
  noSession: '当前会话不可用，无法读取文件',
} as const

/** 全部键。 */
export type MessageKey = keyof typeof ZH

/** 英文表。 */
export const EN: Readonly<Record<MessageKey, string>> = {
  open: 'Open File',
  openWith: 'Open in {name}',
  openWithSubmenu: 'Open With',
  saveAs: 'Save As…',
  copyPath: 'Copy Path',
  copyContents: 'Copy File Contents',
  reveal: 'Show in Finder',
  loading: 'Reading…',
  copiedPath: 'Path copied',
  copiedContents: 'File contents copied',
  savedDialog: 'Saved',
  savedDownload: 'Download started',
  copyFailed: 'Could not copy',
  readFailed: 'Could not read the file',
  openFailed: 'Could not open the file',
  binaryFile: 'This is a binary file, so it cannot be copied as text',
  tooLarge: 'File is too large (limit {limit})',
  tooLargeSave: 'File is too large to save',
  unresolved: 'Could not determine this file’s absolute path',
  noSession: 'No active session, so the file cannot be read',
}
