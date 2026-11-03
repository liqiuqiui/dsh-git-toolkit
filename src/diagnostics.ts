/**
 * dsh-toolkit · 功能注册的故障隔离。
 *
 * 两半入口都是「遍历功能清单，逐个 register」。如果某个功能在自己的 `register`
 * 里抛错，裸循环会让**它后面的功能全部不再挂载** —— 一个功能的 bug 变成整个
 * 工具箱不可用，这与「功能之间互相独立」直接矛盾。
 *
 * 所以每个功能的注册都走这里：失败被记录并吞掉，其余功能照常装配。宿主侧其它
 * 插件看到的仍然是「这个包整体挂上了」，只是少了出错的那一个功能；用户在详情页
 * 把那个功能关掉，一切就恢复。
 *
 * 本模块同时编进 Host 与浏览器产物，因此零依赖。
 */

/** 出错的是哪一半（只用于日志前缀）。 */
export type Half = 'host' | 'client'

/**
 * 记录一次注册失败。
 *
 * 记录本身也包在 try 里：没有 `console` 的宿主不该让隔离机制自己抛错。
 * @param half - 出错的一半。
 * @param label - 功能 id，或插件级阶段的名称。
 * @param error - 抛出的值。
 */
function report(half: Half, label: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  try {
    console.error(`[dsh-toolkit] ${half} · ${label} failed to register: ${message}`, error)
  } catch {
    // 记录失败就到此为止：隔离的意义正是不让一个功能的故障外溢。
  }
}

/**
 * 在隔离中运行一段注册逻辑。
 * @param half - 运行在哪一半。
 * @param label - 功能 id，或插件级阶段的名称。
 * @param run - 要运行的注册逻辑。
 * @returns 是否成功。
 */
export function isolateFeature(half: Half, label: string, run: () => void): boolean {
  try {
    run()
    return true
  } catch (error) {
    report(half, label, error)
    return false
  }
}
