# dsh-toolkit

DeepSeek Harness（dsh）的小功能工具包。每个功能互相独立，在**插件详情页**里可以单独开关；关掉一个功能，它的界面和后端接口同时停用，其余功能不受影响。

插件在插件管理器里显示为 **Toolkit**。

## 功能

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| **Git 分支** `git-branch` | 已提供 | 新建会话时选择工作区要用的分支；已开始的对话里显示当前分支。 |
| **引用消息** `message-quote` | 已提供 | 选中会话里的文字，浮出「引用」菜单，把选中片段作为参考材料加入输入框。 |
| **文件右键菜单** `file-menu` | 已提供 | 在会话里的文件链接上右键，用系统程序打开、另存为、复制路径或内容。 |

### Git 分支

- **新建会话时切换分支**：新会话输入框上方、模式切换控件右侧有一个 `⑂ 分支名 ⌄` 按钮，点开即可看到当前工作区的本地分支并切换。
- **分支按目录折叠**：`fix/released` 会显示为 `fix` 文件夹下的 `released`，点击文件夹行展开或折叠。
- **搜索分支**：浮层顶部可输入关键字过滤。
- **新建分支**：浮层底部的「+ 创建并检出新分支...」会执行 `git checkout -b`。
- **显示远程关联**：每个分支右侧显示它跟踪的远程分支；远程已被删除的分支会标红提示。
- **对话中显示当前分支**：已开始的对话在输入框下方的工具行里显示一个分支标签，悬停可看完整的远程跟踪名；游离 HEAD 时显示提交短哈希。
- **点击复制分支名**：鼠标移到分支标签上，图标会从分支换成复制符号；点一下就把分支名写进剪贴板，图标短暂变成勾号表示已复制（游离 HEAD 时复制的是提交短哈希）。标签本身不会切换分支。

工作区不是 git 仓库时，这一功能不显示任何内容。

切换分支是「开会话之前」的决定：如果运行中的对话也能切，点一下就会把工作区从正在执行的 agent 脚下换掉。需要换分支时，请新开一个会话。

### 引用消息

- **选中即弹菜单**：在**助手回复**里拖选一段文字，选区旁边会浮出一个「引用」按钮。不需要去消息末尾找入口。
- **只引选中片段**：选中多少就引用多少。想要更多上下文，多选一些即可。
- **以引用 chip 进入草稿**：点「引用」后，输入框里出现一个 `@ 引用 第3轮：选中的开头…` 这样的内联标签。标签视觉上仍是单行摘要；悬停 chip 会浮出**内容浮窗**显示完整正文（最多 2000 字符，与实际提交的引用载荷一致），复制 chip 则保留短摘要。
- **悬停删除引用**：鼠标移到本功能添加的引用 chip 上时，右侧出现圆形叉号；点击即可只删除这段引用。若草稿正在提交或内容版本已变化，宿主会拒绝过期删除，不会误删其他文字。
- **发送后仍显示为引用 chip**：交给模型的正文是 Markdown blockquote（可溯源、带轮次），但聊天消息里显示成**与输入框一致**的引用 chip——双引号图标加 `引用 第N轮：摘要…`，悬停同样浮出完整正文。不会露出 `>`、`**` 这些源码标记，也不是另起一种引用块样式。
- 引用正文最多 2000 字符；超长时浮窗底部会标出原文长度与截断状态，不会静默丢内容。

几条边界行为：

- **只引用助手回复**：引用你自己发过的消息没有意义，也容易让人以为那是新内容，所以用户消息、工具调用过程都不弹菜单。
- 在**输入框里**选中文字不弹菜单（那是要改写自己的草稿，不是引用）。
- 只选 1 个字符不弹（通常是误触）。
- 跨区域拖选（正文 → 输入框、正文 → 侧栏）不弹。
- chip 通道不可用时**退化为纯文本**，直接把引用块插入草稿，功能不会彻底失效。退化的那一行会在控制台留一条 `[dsh-toolkit] message-quote：已退化为纯文本插入` 记录，便于排查。
- 失败时按钮就地显示「无法写入输入框」——多数情况是输入框正在提交，稍后重试即可。

引用是**快照**：源文本之后变化不会同步。

引用时保留**格式**：捕获的不是 `selection.toString()` 的纯文本，而是把选中的 DOM 还原成 Markdown。行内代码、代码块（含语言标识）、粗体、列表、链接、引用块都跟着一起被引用，因此模型拿到的是一段有结构的材料，浮窗里也能原样渲染。认不出的元素会保留其文字内容而不是丢弃。

文件引用会还原成**含完整路径**的行内代码。宿主给本地文件引用只显示短名字（它把 `[serialize.ts](src/client/…)` 渲染成一个只显示 `serialize.ts` 的按钮，完整路径放在 `title` 里），所以引用时会把路径补回来——否则拿到引用的模型和用户都不知道那是哪个文件。注意宿主有两种形态：链接形态是 `<button class="fileMention fileLink">`，行内代码形态是 `<code><button class="fileMention">`，两者的 `title` 都是路径，而 `aria-label` 是「打开 xxx」这类界面文案，因此取 `title`。

> 两处的 chip 都仍是**内联**标记，不是独立的卡片：输入框里用宿主提供的 `@` 前缀，发送后用自己的双引号图标；删除入口只在输入框里、以悬停时出现的圆形叉号提供（已发送的消息是历史记录，不支持改）。chip 的可见标签是**纯文本**摘要，所以会先剥掉 Markdown 标记并压成一行（否则标签里会露出 `##`、反引号与星号）。

悬停浮窗是自己画的，不是浏览器原生 `title`：原生提示只能显示单行、出现与消失都有约 1 秒的固定延时、样式也不跟主题。浮窗按主题 token 配色、延时可控，且**不带指示箭头**——引用正文本身较长，箭头只会增加视觉噪音。长引用的正文可在浮窗内滚动，指针移进浮窗时不会收起。

浮窗正文用**助手回复同一个 Markdown 渲染器**（宿主的 `MarkdownText`）：引用的代码块、列表、行内代码、表格都和它在消息里长得一样，代码块甚至带着同样的复制与换行按钮。这不是照着样式仿的，而是直接复用了宿主的渲染器 —— 宿主把它作为 `@deepseek-ai/dsh-client-ui-primitives` 暴露在 loader 的静态模块白名单里，与其自带的文件引用插件用法一致。拿不到这个模块时（更旧的宿主），浮窗退回保留换行的纯文本，功能不会整个失效。

引用正文过长会截断（默认 2000 字）并显式标注。截断点若落在代码块中间，会自动补一个闭合围栏 —— 否则渲染器会把后面的截断提示一起吞进代码块里。

引用块会自己带上首尾换行，因此你在 chip 后面接着输入的文字不会被卷进引用里——它既留在模型的上下文之外，也不会在显示时被引用 chip 吞掉。

### 文件右键菜单

对话里出现的文件引用（`src/client/features/git-branch/BranchBadge.tsx` 这种）右键即出菜单：

- **打开文件** —— 用系统默认程序打开；
- **在 <编辑器> 中打开** —— 直接提一个最可能的编辑器，行文案随实际程序变化（装了 Cursor 就是「在 Cursor 中打开」）。名字与图标都来自这台机器上真实的处理器登记；一个已知编辑器都没有时这一行不出现；
- **打开方式 ▸** —— 完整的应用列表，每项带应用自己的图标，当前默认程序有勾；
- **另存为…** —— 先弹出系统保存对话框选去向，再读文件写入；
- **复制路径** / **复制文件内容** —— 复制绝对路径（可直接粘进终端）或整份文本内容（2 MB 以内、且必须是 UTF-8 文本）；
- **在 Finder 中显示** —— 在文件管理器里定位该文件。

有文本选区时右键不会接管，仍然弹浏览器原生菜单 —— 那时用户的意图多半是「复制这段文字」。

几条刻意的取舍：

- **只用宿主已有的能力**。打开/定位走会话控制器的 `openWorkspacePath`，读文件走 `workspaceFiles`，因此这个功能**没有自己的后端接口**（`host.ts` 的 `register` 是空的）。少一套要维护的传输、少一处要鉴权的读写路径。
- **右键监听是 DOM 委托**。Markdown 渲染器没有给文件引用留回调，任何既有插件也不监听 `contextmenu`，所以这里在 `document` 上装一个捕获监听器；命中文件引用才 `preventDefault()`，其余位置保留浏览器原生菜单。功能关掉时监听器一并消失。
- **相对路径先翻译再交给宿机**。`openWorkspacePath` 要求绝对路径，而会话里的文件引用是相对**会话工作区**写的；中间用 `workspaceFiles.stat` 换算，否则会按宿主进程的 cwd 解析到错误的位置。
- **另存为在浏览器侧落地，而且先问去向再读字节**。宿主没有保存对话框能力，因此优先用 File System Access API 的原生对话框，不可用时退回浏览器下载通道；不为此新增 Host 路由。顺序是刻意的：系统对话框需要「用户手势」，而读文件是一次异步往返，先弹框既不必依赖手势仍然有效，也让大文件不必在对话框出现前先等传输；用户在对话框里按取消只是收起菜单，不算失败。
- **能力缺席就逐项降级**。`remote.session` 缺失时不显示打开/定位类项，`remote.workspaceFiles` 缺失时不显示读内容类项，两个都缺时这个右键菜单根本不接管 —— 而不是弹一个全是灰条的空菜单。`workspacePathApplications` 查询失败（而不是返回空列表）时同样收掉打开类项：那说明这个路径交不给原生桌面，留着只会点了必报错。

## 开关功能

插件详情页（插件管理器 → Toolkit → 该组合包）里有「功能开关」区块，每个功能一行。打开或关闭会**立即生效**，不需要重启 dsh、也不会丢失当前会话的状态：

- 关闭后，该功能在会话界面里的控件立刻消失；
- 关闭后，它的后端接口统一返回 `404 feature-disabled`；
- 重新打开立刻恢复，不需要刷新页面。

开关保存在 dsh 的设置文档里（namespace 是插件条目 id `dsh-toolkit`），可以随 profile 一起备份或迁移。本插件声明了 `auto: false`，所以它不占用设置页，只在插件详情页出现。

## 架构

```
src/
├── features.ts                 # 唯一的「功能清单」：id + Config 字段名 + 文案键
├── shared.ts                   # 跨功能的线协议常量与信封（ApiResult）
├── diagnostics.ts              # 功能注册的故障隔离（一个功能抛错不拖垮其他）
├── host-api.ts                 # Host 服务的最小结构化类型
├── features/
│   ├── registry.ts             # Record<FeatureId, HostFeature>，与浏览器侧对称
│   ├── git-branch/
│   │   ├── host.ts             # 该功能的 Host 表面：3 条 JSON 路由 + git 调用
│   │   └── shared.ts           # 该功能的线协议类型（BranchEntry / RepoStatus…）
│   ├── message-quote/
│   │   └── host.ts             # 空实现：该功能纯浏览器，只为满足注册表完整性
│   └── file-menu/
│       └── host.ts             # 没有自有接口：全部动作复用宿主已有的 Remote
├── host/
│   ├── http.ts                 # JSON 路由的传输层：信封、错误码 → 状态码
│   └── feature.ts              # HostFeature 契约 + 功能注册上下文
├── index.ts                    # Host 入口：Config、settings 策略、遍历注册表
└── client/
    ├── index.tsx               # 浏览器入口：locale、可选 settings、遍历注册表
    ├── feature.ts              # ClientFeature 契约 + 功能注册上下文
    ├── features/
    │   ├── registry.ts         # Record<FeatureId, ClientFeatureEntry>
    │   ├── git-branch/         # 该功能全部 UI（pill / 浮层 / 徽标 / 文案）
    │   ├── message-quote/      # 选区探测、引用块拼装、插入通道、浮层菜单、已发送消息的显示
    │   └── file-menu/          # 右键菜单：
    │       ├── index.ts        #   装配：文档级监听 + 两个 slot 占用者
    │       ├── FileMenu.tsx    #   菜单本体：行模型、键盘、子菜单、反馈
    │       ├── actions.ts      #   每个动作 ↔ 一条宿主能力的封装（可单测）
    │       ├── target.ts       #   从右键目标回溯到文件引用（DOM 委托的判定）
    │       ├── preferred.ts    #   从「打开方式」里挑要提到一级的编辑器
    │       ├── store.ts        #   模块级状态（useSyncExternalStore）
    │       ├── runtime.ts      #   会话 id 与 Remote 面的运行期持有
    │       ├── SessionSeat.tsx #   把 composer 的 sessionId 转达给菜单
    │       ├── icons.tsx       #   内联 SVG（bundle 不能引图标包）
    │       ├── styles.ts       #   注入的样式表（全部走主题 token）
    │       └── locale.ts       #   文案
    ├── clipboard.ts            # 跨功能的剪贴板写入（Clipboard API → execCommand 兜底）
    ├── toggles.ts              # 开关状态机（无框架依赖，可单测）
    ├── use-toggles.ts          # 订阅开关的 React hook
    ├── gate.tsx                # 按开关渲染的包装器（关掉即不渲染）
    ├── settings.ts             # 把开关接到 Host 设置文档 + 注册详情页区块
    ├── ToggleSection.tsx       # 详情页的「功能开关」区块（自绘开关）
    └── locale.ts               # 工具包自身的文案
```

几条刻意的约束：

- **两半对称的注册表**都是 `Record<FeatureId, …>`。新增一个功能却漏写任何一侧，都是**类型错误**，而不是一个上线后才发现永远不生效的开关。
- **功能之间不互相引用**。入口只认 `HostFeature` / `ClientFeature` 契约；功能需要的共享设施（JSON 路由、slot 占位、开关读数）都从注册上下文取。
- **开关是 `volatile` 字段**。普通配置字段变化会让 Loader 重新挂载整个插件（会话里的 UI 状态会丢），volatile 写入只把新值提交进正在运行的那个 fiber 的配置引用。代价是 `apply` 只跑一次，因此「功能是否开启」一律在**用到时**读取，而不是注册时求值一次。
- **功能关闭时保留注册，只在渲染/请求时判断开关**。这样打开开关不需要等 slot 重新出现，也不会有注册表抖动。
- **每个功能的注册都在故障隔离里跑**（`diagnostics.ts`）。某个功能的 `register` 抛错时，它自己缺席、其余照常装配，并在控制台留下带功能 id 的记录 —— 一个功能的 bug 不会让整个工具箱不可用。
- **功能依赖的 Harness 服务用 `whenService` 取，不写进插件级 `inject`**。`inject` 是整包依赖：缺一个服务整个浏览器侧都不加载，其他功能跟着消失；`whenService` 缺服务时只让本功能降级。

## 新增一个功能

1. 在 `src/features.ts` 的 `FEATURES` 里加一条（id、`configKey`、默认值、标题/说明的 locale key）；
2. 写 `src/features/<id>/host.ts`，导出 `HostFeature`（`id` + `register`）；
3. 写 `src/client/features/<id>/index.tsx`，导出 `ClientFeature`（`id` + `locale` + `register`）；
4. 在 `src/features/registry.ts` 与 `src/client/features/registry.ts` 各加一行 —— 漏了会编译失败；
5. 在两个 `locale.ts` 里补上标题/说明的文案。

功能内部的自有资源请**自带命名空间**，避免与其他功能相撞（这些由 review 守，编译器不管）：

- API 路径：每个功能占 `${API_BASE}/<功能>` 一个子路径；
- slot 占用者 id：`toolkit-<功能>-<用途>`；
- CSS 类名前缀：每个功能自持一个前缀（`git-branch` 用 `gtk-`，`message-quote` 用 `gtk-quote-`，`file-menu` 用 `ctxm-`，工具包自身用 `dtk-`）；
- DOM 标记：功能若需在渲染出的 HTML 上定位元素，用 `data-<前缀>-*` 而不是全局 class；
- 文案键：已按功能隔离，功能内部写 `title` 也不会撞车。

需要在浏览器侧用 Harness 服务（例如 `sessions`）时：

```ts
feature.whenService<SomeService>('sessions', (sessions) => {
  // 服务就绪后运行；服务不存在时整段不运行，其他功能不受影响。
})
```

`whenService` 在**注册期**解析服务，适合「服务在就装配一块 UI」的场景。若要在**点击时**惰性、弱依赖地取一个服务，用 `ctx.get(name)`（`message-quote` 取 `conversation` 就是这样）—— 它不建立依赖也不会让插件因缺服务而整体不加载，但名字未知时实现可能抛错，调用方必须自己兜住。

Config schema、详情页开关行、设置 namespace 的接线都由上面这些声明自动派生，不需要手写。

## 安装

从 npm 安装（推荐）：在插件管理器里安装 `dsh-toolkit`，或在 dsh profile 的 `package.json` 中加入依赖，并在 `dsh.profile.bundles` 里登记包名：

```json
{
  "dependencies": {
    "dsh-toolkit": "0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-toolkit"]
    }
  }
}
```

本地开发改用本地目录（dsh 会直接链接工作副本，不需要每次重装）：

```json
{
  "dependencies": {
    "dsh-toolkit": "link:/path/to/dsh-toolkit"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-toolkit"]
    }
  }
}
```

装好后重启 dsh。

> **不要用 `github:` 直接安装本仓库。** dsh 安装 bundle 时只复制包内文件，不会执行构建；`lib/` 不纳入版本管理，所以 GitHub 源码包里没有 `lib/index.js`，启用时会报 `ERR_MODULE_NOT_FOUND`。请走 npm 安装或本地目录安装。
>
> 仓库中的 `lib/` 是构建产物（不纳入版本管理）。更新源码后需在仓库里执行 `pnpm install && pnpm build`；之后刷新页面即可看到客户端改动，Host 侧改动需完全退出并重开 dsh。
>
> 开发时可用 `pnpm watch:client` 监听客户端源码并自动重新打包。

## 开发

```bash
pnpm install
pnpm typecheck     # Host 与浏览器两半一起检查
pnpm test          # 构建后跑 node:test（真实 git 临时仓库，不启动 Harness）
pnpm build         # tsc（Host）+ tsdown（浏览器 → lib/client.js）
```

## 发布到 npm

`package.json` 里已配置 `prepack`，发布前会自动执行构建（`clean` → `tsc` → `tsdown`），所以 npm 包里始终带最新构建产物：

```bash
npm login          # 首次发布
npm publish        # prepack 构建并打包含 lib/ 的 tarball
```

## License

MIT，见 [LICENSE](LICENSE)。
