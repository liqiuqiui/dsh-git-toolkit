/**
 * 浏览器侧 · 从「打开方式」列表里挑出适合当快捷键的那个编辑器。
 *
 * macOS 的右键菜单里通常直接把「在 VS Code 中打开」提到一级，剩下的才收进
 * 「打开方式 ▸」。宿主给的是**这台机器**上真实登记的处理器列表，没有「编辑器」
 * 这个概念，因此这里按已知编辑器家族的优先级挑一个：命中就把它提到一级，
 * 一个都没命中（例如干净系统上只有预览和浏览器）就不显示这一行。
 *
 * 匹配的是小写名称的子串，因为不同系统/安装方式给出的名称并不一致
 * （`Visual Studio Code`、`Code`、`Visual Studio Code - Insiders`）。
 */
import type { RemoteApplication } from './types.js'

/**
 * 已知编辑器，按「把它提到一级」的优先顺序排列。
 *
 * 顺序即偏好：同时装了 VS Code 与 Cursor 时先提 VS Code，这是最常见的默认。
 */
const EDITOR_PREFERENCES: readonly string[] = [
  'visual studio code',
  'vscode',
  'cursor',
  'xcode',
  'windsurf',
  'zed',
  'sublime text',
  'textmate',
  'nova',
  'webstorm',
  'intellij idea',
  'pycharm',
  'goland',
  'android studio',
  // 兜底：某些安装方式只把程序登记成 `Code`。放在最后，因为它是 `Xcode` 的子串
  // ——匹配取的是**本表里第一个命中的项**，所以 `Xcode` 会先命中上面的 `xcode`。
  'code',
]

/**
 * 从应用列表里挑出优先编辑器的名称（用于「在 … 中打开」）。
 *
 * 先按 {@link EDITOR_PREFERENCES} 的家族优先序选，家族内部再让系统默认程序胜出
 * （`rank - 0.5` 只影响同 rank 的比较，不会让排在后面的家族反超前面的家族）。
 * 这样「同时装了 VS Code 与 Cursor」时稳定选 VS Code，而「只装了一个编辑器且它
 * 是默认程序」时也自然选中它。
 * @param applications - 宿主枚举出的打开方式。
 * @returns 应用条目；没有已知编辑器时为 null。
 */
export function pickEditor(
  applications: readonly RemoteApplication[],
): RemoteApplication | null {
  const score = (application: RemoteApplication): number => {
    const name = application.name.toLowerCase()
    const rank = EDITOR_PREFERENCES.findIndex((editor) => name.includes(editor))
    if (rank < 0) return Number.POSITIVE_INFINITY
    // 默认程序在同家族内优先：rank 相同的情况下 default 排前面。
    return application.default ? rank - 0.5 : rank
  }
  let best: RemoteApplication | null = null
  let bestScore = Number.POSITIVE_INFINITY
  for (const application of applications) {
    const value = score(application)
    if (value < bestScore) {
      best = application
      bestScore = value
    }
  }
  return best
}
