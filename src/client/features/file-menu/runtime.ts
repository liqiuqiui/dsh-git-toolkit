/**
 * 浏览器侧 · 本功能在运行期拿到的两样外部上下文。
 *
 * 它们是**两个 slot 占用者之外**的共享状态，但与 UI 状态无关，因此不放进
 * `store.ts`（那里只放会触发重渲染的数据）：
 *
 * - {@link setRemote} —— 已就绪的 Remote 命名空间。两个命名空间由不同插件提供、
 *   到达时间各不相同（`remote.session` 随会话控制器，`remote.workspaceFiles` 随
 *   文件插件），因此装配侧在**每个**命名空间到位时重新发布一次「当前已就绪的
 *   那部分」。组件不在渲染时快照它，而是在**动作发生的那一刻**通过
 *   {@link getRemote} 读取 —— 服务晚于组件挂载是很正常的情况。
 * - {@link setCurrentSession} —— 当前会话 id。菜单监听器挂在文档上（不知道自
 *   己在哪个会话里），会话由 composer 工具行上的占用者转达；`workspaceFiles`
 *   读取与相对路径解析需要它。绝对路径的打开动作不需要它，因此它缺席时功能
 *   降级而不是失效。
 */
import type { RemoteFace } from './types.js'

/** 服务尚未就绪时的空面：所有命名空间都读成 undefined，各菜单项自然降级。 */
const EMPTY: RemoteFace = {}

let remoteFace: RemoteFace = EMPTY
let currentSessionId: string | null = null

/**
 * 记下当前已就绪的 Remote 命名空间（整体替换，不做逐键合并）。
 * @param face - 已经到位的命名空间集合。
 */
export function setRemote(face: RemoteFace): void {
  remoteFace = face
}

/** 当前已就绪的 Remote 命名空间；两个都没到时是一个空面。 */
export function getRemote(): RemoteFace {
  return remoteFace
}

/**
 * 记下当前会话。
 * @param sessionId - 会话 id；不在对话中时传 null。
 */
export function setCurrentSession(sessionId: string | null): void {
  currentSessionId = sessionId
}

/** 当前会话 id；未知时为 null。 */
export function getCurrentSession(): string | null {
  return currentSessionId
}
