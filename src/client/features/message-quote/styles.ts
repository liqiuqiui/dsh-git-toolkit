/**
 * message-quote 功能 · 样式。
 *
 * 分为两块：输入框上的浮层（`QUOTE_MENU_CSS`）与已发送消息里的引用 chip
 * （`QUOTE_NODE_CSS`），两者的挂载时机不同，因此不合并。
 *
 * 与本插件其他组件一致：浏览器 bundle 不能触碰 `document.body`、也不创建 portal，
 * 因此每个组件自带一个 `<style>` 子元素，随组件挂载与卸载。颜色全部取自
 * `--dsw-*` 主题 token，跟随亮/暗主题。
 *
 * 两条关键约束：
 *
 * - `position:fixed` 能相对**视口**定位。已核对 composer 祖先链上没有任何
 *   `transform` / `filter` / `backdrop-filter` / `will-change` / `contain` /
 *   `perspective`，因此不会被拉成相对某个祖先的定位。
 * - `z-index` 取本插件既有的 1100，高于同槽位 `context-modal` 的 200/300。
 */
export const QUOTE_MENU_CSS = `
.gtk-quote-menu{position:fixed;z-index:1100;display:flex;align-items:center;gap:2px;padding:3px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-elevated,var(--dsw-specific-input-major));box-shadow:var(--dsw-elevation-soft);border:1px solid var(--dsw-alias-border-l2)}
.gtk-quote-item{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border:none;border-radius:var(--dsw-radius-sm);background:0 0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;font-weight:500;line-height:20px;white-space:nowrap;cursor:pointer}
.gtk-quote-item:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}
.gtk-quote-item:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gtk-quote-item-icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-secondary)}
.gtk-quote-remove{position:fixed;z-index:1101;display:grid;place-items:center;width:20px;height:20px;margin:0;padding:0;transform:translateY(-50%);border:1px solid var(--dsw-alias-border-l2);border-radius:50%;background-color:var(--dsw-specific-input-major)!important;color:var(--dsw-alias-label-primary);opacity:1!important;box-shadow:0 1px 4px rgb(0 0 0 / 24%);cursor:pointer}
.gtk-quote-remove:hover{background-color:var(--dsw-specific-input-major)!important;color:var(--dsw-alias-label-primary);opacity:1!important}
.gtk-quote-remove:focus-visible{outline:none;box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gtk-quote-remove svg{width:12px;height:12px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round}
.gtk-quote-remove-error{position:fixed;z-index:1101;right:16px;bottom:16px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-elevated,var(--dsw-specific-input-major));color:var(--dsw-alias-label-primary);font:12px/18px var(--dsw-font-family);box-shadow:var(--dsw-elevation-soft)}
`

/**
 * 已发送消息里的引用 chip 样式。
 *
 * 与 {@link QUOTE_MENU_CSS} 分开导出，因为两者的挂载点不同：浮层始终在
 * `conversation.input.overlay` 里（每条消息都不必有），而这段只在渲染引用节点时
 * 才需要，跟着 `QuoteNodeView` 走。
 *
 * 三条约束都来自宿主气泡的既有样式：
 *
 * - 气泡是 `white-space:pre-wrap`，换行与连续空白都会被保留。chip 必须自己改回
 *   `nowrap`，否则摘要里的空白会把标签撑开。
 * - 气泡宽度不定，`max-width:100%` + `min-width:0` 才能让 `text-overflow` 真的
 *   生效（flex 子项的默认 `min-width:auto` 会阻止收缩）。
 * - 颜色全部取 `--dsw-*` token，跟随亮/暗主题；不写死背景色。
 */
export const QUOTE_NODE_CSS = `
.gtk-quote-node{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:1px 7px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-markdown-code-block,var(--dsw-specific-input-major));color:var(--dsw-alias-label-secondary);font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;white-space:nowrap;vertical-align:baseline}
.gtk-quote-node-icon{display:inline-flex;flex:none;color:var(--dsw-alias-label-tertiary)}
.gtk-quote-node-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`

/**
 * 引用内容浮窗的样式。
 *
 * 刻意**不做箭头**：需求要的是组件库那种干净的小浮窗，三角形箭头会让人以为它
 * 与 chip 有指向关系，而引用正文本身较长，箭头只会增加视觉噪音。
 *
 * 与 `QUOTE_MENU_CSS` 一致使用 `position:fixed` 与 `z-index:1100`：浮窗跟着 chip
 * 的视口坐标走，不受聊天区滚动容器裁剪；层级高于 composer 的粘贴层。
 *
 * `max-height` + `overflow:auto` 是必需的：引用正文最多 2000 字符，长引用若撑满
 * 整个视口就会挡住对话本身。滚动条沿用宿主 token，跟随亮/暗主题。
 */
export const QUOTE_TIP_CSS = `
.gtk-quote-tip{position:fixed;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;gap:6px;width:max-content;min-width:240px;max-width:min(460px,calc(100vw - 24px));max-height:min(360px,calc(100vh - 24px));padding:10px 12px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-elevated,var(--dsw-specific-menu));color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));box-shadow:var(--dsw-elevation-panel)}
.gtk-quote-tip[data-measured=false]{visibility:hidden}
.gtk-quote-tip-head{display:flex;flex:none;align-items:center;gap:5px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
.gtk-quote-tip-head-icon{display:inline-flex;flex:none}
.gtk-quote-tip-body{display:block;min-height:0;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;word-break:break-word;overflow-wrap:anywhere}
.gtk-quote-tip-plain{display:block;white-space:pre-wrap}
.gtk-quote-tip-note{display:block;flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px}
`
