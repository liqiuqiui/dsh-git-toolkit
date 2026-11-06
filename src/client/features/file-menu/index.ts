/**
 * file-menu 功能 · 浏览器侧装配。
 *
 * 两个 slot 占用者，加上两条服务接线：
 *
 * - `shell.overlay` —— 菜单本体（同时负责安装文档级 `contextmenu` 监听器）。
 * - `conversation.input.left` —— 一个不渲染任何东西的座位，只把当前会话 id 转达给
 *   菜单；相对路径的解析与文件读取需要它（见 `SessionSeat`）。
 * - `remote.session` / `remote.workspaceFiles` —— 菜单要用的两个 Remote 命名空间。
 *   它们在 `register` 里用 `whenService` 取，到达后交给 `runtime.ts` 持有。这两个
 *   都**不进**插件级 `inject`：那里缺一个服务会让整个浏览器侧都不加载。它们也可能
 *   真的都缺席（例如没有会话控制器的极简装配）—— 那时菜单不接管右键，功能整体
 *   静默缺席，其余功能不受影响。
 *
 * 「打开方式」列表在菜单打开的那一刻才请求，因此这里不做任何预热。
 */
import type { FeatureId } from '../../../features.js'
import type { ClientFeature, ClientFeatureContext } from '../../feature.js'
import { gated } from '../../gate.js'
import { FileMenu } from './FileMenu.js'
import { EN, ZH } from './locale.js'
import { setRemote } from './runtime.js'
import { SessionSeat } from './SessionSeat.js'
import type { RemoteFace, SessionRemote, WorkspaceFilesRemote } from './types.js'

/** `shell.overlay` 菜单的 props。 */
interface OverlayProps {
  /** 绑定命名空间的翻译函数（`dsh-toolkit/file-menu`）。 */
  t: (key: string, params?: Record<string, unknown>) => string
}

/** composer 工具行座位的 props。 */
interface InputLeftProps {
  /** composer 所属的会话。 */
  sessionId: string
}

const GatedMenu = gated('fileMenu', FileMenu)
const GatedSeat = gated('fileMenu', SessionSeat)

/** file-menu 功能的浏览器实现。 */
export const fileMenuClientFeature: ClientFeature = {
  id: 'file-menu' satisfies FeatureId,
  locale: { zh: ZH, en: EN },
  register(feature: ClientFeatureContext): void {
    // 两个命名空间由不同插件提供、到达时间各不相同，因此各自到位时重新发布一次
    // 「当前已就绪的那部分」。发布用条件展开而不是赋 undefined：在
    // `exactOptionalPropertyTypes` 下「缺席」与「存在但为 undefined」是不同类型，
    // 而消费方只关心缺席。
    let face: RemoteFace = {}
    feature.whenService<SessionRemote>('remote.session', (session) => {
      face = { ...face, session }
      setRemote(face)
    })
    feature.whenService<WorkspaceFilesRemote>('remote.workspaceFiles', (workspaceFiles) => {
      face = { ...face, workspaceFiles }
      setRemote(face)
    })

    feature.occupy<OverlayProps>(
      'shell.overlay',
      { id: 'toolkit-file-menu', order: 1000 },
      GatedMenu,
    )
    feature.occupy<InputLeftProps>(
      'conversation.input.left',
      { id: 'toolkit-file-menu-session', order: 20 },
      GatedSeat,
    )
  },
}
