/**
 * 浏览器侧 · 通过 `<style>` 元素注入的样式表字符串。
 *
 * 浏览器 bundle 不能触碰 `document.body`，也不能创建 portal，因此组件自带一个
 * `<style>` 子元素：React 随组件挂载它、卸载时移除。所有颜色都来自 `--dsw-*`
 * 主题 token，没有硬编码，因此菜单跟随亮/暗主题与品牌覆盖。
 *
 * 表面处理沿用 Host 自己的菜单配方（`--dsw-specific-menu` 背景、菜单背景滤镜、
 * radius-lg、`--dsw-elevation-prominent` + `--dsw-elevation-stroke-color` 的
 * 高度描边），这正是宿主工作区选择器与分支面板所用的同一套值；差异只在尺寸：
 * 右键菜单是**指针**菜单，因此行高比键盘面板更紧（30px）、字号 13px，
 * 与 macOS 的上下文菜单密度一致。
 */
export const MENU_CSS = `
/* shell.overlay 这一层本身是「点击穿透」的：宿主把整个浮动层做成不吃指针事件，
   由每个占用者自己 opt-in，否则一层空容器会挡住下面的应用。菜单必须显式要回
   指针事件，否则它看起来正常但点不动。 */
.ctxm-menu{position:fixed;z-index:1200;pointer-events:auto;box-sizing:border-box;display:flex;flex-direction:column;min-width:200px;max-width:min(280px,100vw - 16px);padding:4px;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);border-radius:var(--dsw-radius-lg);border:0;box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;font-weight:400;line-height:20px;letter-spacing:normal;text-align:left;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;outline:none}
.ctxm-item{box-sizing:border-box;width:100%;min-height:30px;display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:var(--dsw-radius-md);background:0 0;border:none;outline:none;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:13px;font-weight:400;line-height:20px;text-align:left;cursor:pointer;min-width:0}
.ctxm-item:hover,.ctxm-item:focus-visible,.ctxm-item[data-active=true]{background:var(--dsw-alias-interactive-bg-hover)}
.ctxm-item:disabled{cursor:default;opacity:.45}
.ctxm-item:disabled:hover{background:0 0}
.ctxm-icon{flex:none;width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary)}
.ctxm-icon img{width:16px;height:16px;display:block;object-fit:contain}
.ctxm-label{flex:1 1 auto;min-width:0;text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.ctxm-chevron{flex:none;display:inline-flex;align-items:center;color:var(--dsw-alias-label-caption)}
/* 每一行都是子菜单的定位容器：子菜单要贴着「打开方式」这一行展开，
   而不是贴着整个菜单的顶边。 */
.ctxm-row{position:relative;display:flex;flex-direction:column;min-width:0}
.ctxm-sep{flex:none;height:1px;margin:4px 6px;background:var(--dsw-alias-border-l1)}
.ctxm-note{flex:none;padding:4px 8px 6px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.ctxm-note[data-error=true]{color:var(--dsw-alias-state-error-primary)}
.ctxm-sub{position:absolute;pointer-events:auto;top:-4px;box-sizing:border-box;display:flex;flex-direction:column;min-width:180px;max-width:min(240px,100vw - 16px);max-height:min(320px,100vh - 32px);overflow-y:auto;overscroll-behavior:contain;padding:4px;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);border-radius:var(--dsw-radius-lg);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.ctxm-spin{flex:none;width:14px;height:14px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:ctxm-spin .8s linear infinite}
@keyframes ctxm-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion: reduce){.ctxm-spin{animation-duration:2s}}
`
