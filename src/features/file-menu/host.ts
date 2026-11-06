/**
 * file-menu 功能 · Host 侧。
 *
 * 这个功能**没有自己的端点**，因为菜单里的每个动作都落在 Host 已经提供的能力上：
 *
 * - 用系统程序打开、在文件管理器中定位 → `remote.session.openWorkspacePath`；
 * - 枚举「打开方式」中的应用 → `remote.session.workspacePathApplications`；
 * - 读取文件内容（复制内容、另存为）→ `remote.workspaceFiles.read/readBytes`；
 * - 剪贴板与另存为本身完全在浏览器侧完成。
 *
 * 再包一层 `/api/dsh-toolkit/file-menu/*` 只会把同一份能力实现第二遍，并且要自己
 * 重新处理路径校验、会话授权与平台差异 —— 这些都是上述 Host 服务已经负责的事。
 *
 * 但实现仍然保留：`FEATURES` 里的每个 id 都必须在两侧注册表里有归属，两侧注册表
 * 声明为 `Record<FeatureId, …>`，于是「新增功能却漏了某一侧」是类型错误。空的
 * `register` 就是「本功能没有 Host 表面」的显式写法。
 */
import type { FeatureId } from '../../features.js'
import type { HostFeature, HostFeatureContext } from '../../host/feature.js'

/** file-menu 功能的 Host 实现：不注册任何路由（见模块文档）。 */
export const fileMenuFeature: HostFeature = {
  id: 'file-menu' satisfies FeatureId,
  register(_feature: HostFeatureContext): void {
    // 本功能的全部表面在浏览器侧；菜单动作调用的是既有的 Remote 能力。
  },
}
