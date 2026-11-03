# dsh-toolkit

DeepSeek Harness（dsh）的小功能工具包。每个功能互相独立，在**插件详情页**里可以单独开关；关掉一个功能，它的界面和后端接口同时停用，其余功能不受影响。

插件在插件管理器里显示为 **Toolkit**。

## 功能

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| **Git 分支** `git-branch` | 已提供 | 新建会话时选择工作区要用的分支；已开始的对话里显示当前分支。 |

### Git 分支

- **新建会话时切换分支**：新会话输入框上方、模式切换控件右侧有一个 `⑂ 分支名 ⌄` 按钮，点开即可看到当前工作区的本地分支并切换。
- **分支按目录折叠**：`fix/released` 会显示为 `fix` 文件夹下的 `released`，点击文件夹行展开或折叠。
- **搜索分支**：浮层顶部可输入关键字过滤。
- **新建分支**：浮层底部的「+ 创建并检出新分支...」会执行 `git checkout -b`。
- **显示远程关联**：每个分支右侧显示它跟踪的远程分支；远程已被删除的分支会标红提示。
- **对话中显示当前分支**：已开始的对话在输入框下方显示一个只读的分支标签，悬停可看完整的远程跟踪名；游离 HEAD 时显示提交短哈希。

工作区不是 git 仓库时，这一功能不显示任何内容。

切换分支是「开会话之前」的决定：如果运行中的对话也能切，点一下就会把工作区从正在执行的 agent 脚下换掉。需要换分支时，请新开一个会话。

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
│   └── git-branch/
│       ├── host.ts             # 该功能的 Host 表面：3 条 JSON 路由 + git 调用
│       └── shared.ts           # 该功能的线协议类型（BranchEntry / RepoStatus…）
├── host/
│   ├── http.ts                 # JSON 路由的传输层：信封、错误码 → 状态码
│   └── feature.ts              # HostFeature 契约 + 功能注册上下文
├── index.ts                    # Host 入口：Config、settings 策略、遍历注册表
└── client/
    ├── index.tsx               # 浏览器入口：locale、可选 settings、遍历注册表
    ├── feature.ts              # ClientFeature 契约 + 功能注册上下文
    ├── features/
    │   ├── registry.ts         # Record<FeatureId, ClientFeatureEntry>
    │   └── git-branch/         # 该功能全部 UI（pill / 浮层 / 徽标 / 文案）
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
- CSS 类名前缀：每个功能自持一个前缀（`git-branch` 用 `gtk-`，工具包自身用 `dtk-`）；
- 文案键：已按功能隔离，功能内部写 `title` 也不会撞车。

需要在浏览器侧用 Harness 服务（例如 `sessions`）时：

```ts
feature.whenService<SomeService>('sessions', (sessions) => {
  // 服务就绪后运行；服务不存在时整段不运行，其他功能不受影响。
})
```

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
