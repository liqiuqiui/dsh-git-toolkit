/**
 * 浏览器侧 · 通过 `<style>` 元素注入的样式表字符串。
 *
 * 浏览器 bundle 不能触碰 `document.body`，也不能创建 portal，因此每个组件
 * 改为自带一个 `<style>` 子元素：React 随组件一起挂载它，并在卸载时移除。
 * 所有颜色都来自 `--dsw-*` 主题 token，没有任何硬编码，因此 UI 会跟随
 * 亮/暗主题与品牌覆盖。
 */

/**
 * 触发器胶囊（`conversation.hero.options` 的占用者）。
 *
 * 尺寸、颜色与字重对齐 Host 自身的 hero 行控件 —— 工作区 chip
 * （`._8tPydW_workspace`）与 agent 预设座位（`.ufIuna_seat`），二者都以
 * 13px/500 搭配 `padding:0 8px` 读取 `label-primary`。正是与这两者完全一致
 * 才让整行看起来统一；composer 的模型选择器是更轻的 400 字重控件，不是此处
 * 正确的参照。
 *
 * 最后一条规则是位置修正。Host 把这个 slot 包在
 * `div.heroOptions { margin-left: auto }` 内，而后者位于
 * `div.heroWorkspaceRow { display:flex; gap:2px }` 中，因此 margin auto 会把
 * 该胶囊顶到最右侧。Host 自己的单占用者 slot（`conversation.hero.workspace` 与
 * `conversation.hero.agentPreset`）位于该 div 之前，而本 slot 无法移动，
 * 所以改为在包装层上抵消 auto margin：一个包含 `.gtk-seat`、且直接子节点为
 * `[data-slot="conversation.hero.options"]` 的 `div`。该选择器权重为
 * `(0,2,1)`，面对 Host 的 `(0,1,0)` `.heroOptions` 规则，因此无论顺序如何
 * 都会胜出；又因为它要求 `.gtk-seat`，在触发器隐藏时（session 不在 git
 * work tree 中）永远不会生效，该行的其他占用者不受影响。
 */
export const TRIGGER_CSS = `
.gtk-seat{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(100%,240px);min-height:28px;color:var(--dsw-alias-label-primary);white-space:nowrap;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 8px;font-family:var(--dsw-font-family);font-size:13px;font-weight:500;line-height:20px;display:inline-flex;cursor:pointer}
.gtk-seat:not(:disabled):hover,.gtk-seat[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover)}
.gtk-seat:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gtk-seat-icon{color:var(--dsw-alias-label-primary);flex:none;display:inline-flex}
.gtk-seat-label{text-overflow:ellipsis;white-space:nowrap;overflow:hidden;min-width:0}
.gtk-seat-chevron{color:var(--dsw-alias-label-caption);flex:none;display:inline-flex;transition:transform .12s}
.gtk-seat-chevron[data-open=true]{transform:rotate(180deg)}
div:has(> [data-slot="conversation.hero.options"]):has(.gtk-seat){margin-left:0}
`

/**
 * 运行中对话下方的分支指示器（`conversation.input.left` 的占用者）。
 *
 * `conversation.input.left` 渲染在 `div.tools`（composer 工具栏行）内部，
 * 与附件按钮、权限预设（`.SJRB_q_trigger`）和计划预设同为 flex 兄弟节点 ——
 * slot 锚点是 `display:contents`，因此该行自身的 `gap` 就能给这个 chip 留出
 * 间距，无需额外 margin。所以它复制的是该行的度量而非 hero 行的：
 * `height:28px`、`radius-sm`、`label-secondary`、`gap:4px`、
 * `padding:0 4px 0 8px`、13px/500/20px，以及 14px 图标（权限触发器设为
 * `.triggerIcon svg{14px}` —— composer 比 hero 行更紧凑，后者图标是 16px）。
 *
 * 只读，因此与 hero 胶囊不同：没有 hover 底色，也没有 pointer 光标与
 * focus ring：它必须看起来不可切换。
 *
 * 第一条规则在 **New Session** 页面隐藏该 chip。Host 用同一个 composer
 * 组件渲染该页面与运行中的对话，并在对话根节点上标记当前是哪一种：
 * `data-phase = settling ? "settling" : hero ? "hero" : "active"`（其中
 * `hero = sessionId === undefined || shellPhase === "blank" && (openState ===
 * "open" || summaryBlank)`）。按该属性隐藏能让判定与 Host 自身的
 * hero/active 切换完全同步，而 `session.blank` hook 只能近似；并且它不需要
 * 占用者 prop，因此即便 hook 缺失，chip 也无法破坏 composer。
 *
 * 在 `settling` 阶段也必须保持隐藏：该阶段是 Host 仍在两个页面之间做决定，
 * 让 chip 在那里出现会使它在进入过程中闪烁。
 *
 * 该属性出现在两个取值相同的载体上，因此两者都列出：完整对话的
 * `.root[data-phase]`，以及嵌入对话的 `.embeddedBody[data-content-phase]`
 * （Host 在自己的嵌入布局规则中用了后一个名字）。编辑器也带有
 * `data-phase`，但它从不包含该 chip。
 */
export const BADGE_CSS = `
[data-phase=hero] .gtk-badge,[data-phase=settling] .gtk-badge,[data-content-phase=hero] .gtk-badge,[data-content-phase=settling] .gtk-badge{display:none}
.gtk-badge{border-radius:var(--dsw-radius-sm);min-width:0;max-width:220px;height:28px;color:var(--dsw-alias-label-secondary);align-items:center;gap:4px;padding:0 4px 0 8px;font-family:var(--dsw-font-family);font-size:13px;font-weight:500;line-height:20px;display:inline-flex;cursor:default;user-select:none}
.gtk-badge-icon{color:var(--dsw-alias-label-secondary);flex:none;display:inline-flex}
.gtk-badge-label{text-overflow:ellipsis;white-space:nowrap;overflow:hidden;min-width:0}
.gtk-badge-detail{color:var(--dsw-alias-label-caption);flex:none;font-family:var(--ds-font-family-code,monospace);font-size:11px;line-height:16px}
`

/**
 * 面板（`shell.overlay` 的占用者）。
 *
 * 对齐 Host 自身的菜单表面：`--dsw-specific-menu` 背景、菜单背景滤镜、
 * radius-lg，以及由 `box-shadow` + `--dsw-elevation-stroke-color` 提供的高度
 * 描边 —— 刻意不用 1px solid 边框，那正是上一版实现看起来像外来组件的原因。
 *
 * 字体排版沿用 Host 的 Hero 行菜单（`dsh-client-ui-workspace` 中的工作区
 * 选择器），二者是同一行中的同类表面：主列表文本 14px/20px，次要文本与分区
 * 标签 12px，搜索框 14px。每个文本元素都自行声明尺寸而不继承，字体族取自
 * `--dsw-font-family`（`body` 所用的那个）而非 `inherit`，因此即使面板挂载
 * 在 `shell.overlay` 中、位于 composer 子树之外，也能保持产品字体。
 */
export const POPOVER_CSS = `
.gtk-pop{z-index:1100;position:fixed;box-sizing:border-box;display:flex;flex-direction:column;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);border-radius:var(--dsw-radius-lg);border:0;box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);padding:4px;overflow:hidden;width:min(320px,100vw - 24px);max-height:min(360px,100vh - 96px);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);font-family:var(--dsw-font-family);font-size:14px;font-weight:400;font-style:normal;line-height:20px;letter-spacing:normal;text-align:left;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
.gtk-search{flex-shrink:0;position:relative;margin:2px 0 3px}
.gtk-search-icon{position:absolute;left:7px;top:50%;transform:translateY(-50%);color:var(--dsw-alias-label-caption);pointer-events:none;display:inline-flex}
.gtk-input{border-radius:var(--dsw-radius-md);background:0 0;border:.5px solid transparent;outline:none;margin:2px;padding:5px 7px 5px 25px;font-family:var(--dsw-font-family);font-size:14px;font-weight:400;line-height:20px;letter-spacing:normal;color:var(--dsw-alias-label-primary);width:100%;box-sizing:border-box}
.gtk-input::placeholder{color:var(--dsw-alias-label-caption)}
.gtk-input:focus-visible{border-color:var(--dsw-alias-border-l1)}
.gtk-input-plain{padding-left:7px}
.gtk-label{flex:none;color:var(--dsw-alias-label-tertiary);font-family:var(--dsw-font-family);font-size:12px;font-weight:500;line-height:20px;padding:4px 7px 2px;user-select:none}
.gtk-list{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;max-height:280px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}
.gtk-row,.gtk-create{box-sizing:border-box;width:100%;min-height:34px;display:flex;align-items:center;gap:6px;padding:5px 7px;border-radius:var(--dsw-radius-md);background:0 0;border:none;outline:none;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:14px;font-weight:400;line-height:20px;letter-spacing:normal;text-align:left;cursor:pointer;min-width:0}
.gtk-row:hover,.gtk-row:focus-visible,.gtk-row[data-active=true],.gtk-create:hover,.gtk-create:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.gtk-row:disabled,.gtk-create:disabled{cursor:default;opacity:.6}
.gtk-row:disabled:hover,.gtk-create:disabled:hover{background:0 0}
.gtk-create{flex:none;color:var(--dsw-alias-label-secondary)}
.gtk-row-icon{color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex}
.gtk-row-name{text-overflow:ellipsis;white-space:nowrap;overflow:hidden;min-width:0;flex:1}
.gtk-row-check{color:var(--dsw-alias-label-primary);flex:none;margin-left:auto;display:inline-flex;width:14px;height:14px}
.gtk-row-folder{min-height:30px;color:var(--dsw-alias-label-secondary)}
.gtk-folder-icon{color:var(--dsw-alias-label-tertiary);flex:none;display:inline-flex}
.gtk-folder-name{color:var(--dsw-alias-label-secondary)}
.gtk-row-upstream{flex:0 1 auto;min-width:0;max-width:45%;margin-left:auto;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px}
.gtk-row-upstream[data-gone=true]{color:var(--dsw-alias-state-error-primary)}
.gtk-create-icon{color:var(--dsw-alias-label-caption);flex:none;display:inline-flex}
.gtk-create-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gtk-divider{height:1px;background:var(--dsw-alias-border-l1);margin:4px 2px;flex:none;border:0}
.gtk-empty{display:flex;flex-shrink:0;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-tertiary);padding:7px 8px;font-family:var(--dsw-font-family);font-size:12px;font-weight:400;line-height:20px}
.gtk-error{flex-shrink:0;color:var(--dsw-alias-state-error-primary);padding:7px 8px;font-family:var(--dsw-font-family);font-size:12px;font-weight:400;line-height:18px;overflow-wrap:anywhere}
.gtk-create-form{display:flex;flex-direction:column;gap:6px;padding:0 0 2px}
.gtk-create-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;margin:0 2px 2px}
.gtk-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border-radius:var(--dsw-radius-sm);font-family:var(--dsw-font-family);font-size:13px;font-weight:400;line-height:20px;letter-spacing:normal;background:0 0;border:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap;outline:none}
.gtk-btn:not(:disabled):hover{background:var(--dsw-alias-interactive-bg-hover)}
.gtk-btn:focus-visible{box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}
.gtk-btn-primary{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);font-weight:500}
.gtk-btn:disabled{opacity:.5;cursor:default}
.gtk-spin{box-sizing:border-box;display:inline-block;flex:none;width:12px;height:12px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);animation:gtk-spin .7s linear infinite}
@keyframes gtk-spin{to{transform:rotate(360deg)}}
`
