/**
 * 浏览器侧 · 文件夹视图背后的纯分支树模型。
 *
 * 分支名是以斜杠分隔的 ref 名（`fix/released`、`feat/ui/button`），
 * 因此面板像文件浏览器那样分组，而不是平铺列出。
 * 本模块刻意不依赖 React 与 DOM：它把快照中的分支列表转为嵌套树，
 * 把该树摊平成面板渲染的行，并报告必须展开哪些文件夹才能让
 * 指定分支可见。保持模型纯粹，使排序、单链压缩与搜索行为
 * 易于推理和测试。
 *
 * 排序规则：分支保持 Host 的顺序（最近提交的在前）。文件夹占据
 * 其第一个分支的位置，其子节点重复同一规则，因此任何层级都不会
 * 按字母重新排序。
 */
import type { BranchEntry } from '../shared.js'

/** 树中的一个分支叶子节点。 */
export interface BranchLeaf {
  readonly kind: 'leaf'
  /** 最后一个路径段；完整的分支名在 {@link BranchLeaf.branch} 上。 */
  readonly label: string
  readonly branch: BranchEntry
}

/** 一个文件夹：共享同一路径前缀的一组分支。 */
export interface BranchFolder {
  readonly kind: 'folder'
  /** 文件夹的完整斜杠路径，例如 `fix` 或 `feat/ui`。 */
  readonly path: string
  /**
   * 文件夹行上显示的文本。对于压缩链（`feat/ui`）它等于
   * {@link BranchFolder.path}，否则就是单个路径段。
   */
  readonly label: string
  readonly children: readonly BranchNode[]
}

/** 两种树节点之一。 */
export type BranchNode = BranchLeaf | BranchFolder

/** 由 {@link flattenTree} 产出的一个文件夹行。 */
export interface FolderRow {
  readonly kind: 'folder'
  /** 在展开/折叠集合中用作稳定标识。 */
  readonly path: string
  /** 行上显示的文本；压缩链会把所有路径段用 `/` 连接保留。 */
  readonly label: string
  /** 从 0 开始的嵌套深度；渲染器将其映射为左内边距。 */
  readonly depth: number
  /** 该文件夹当前是否展开。 */
  readonly open: boolean
}

/** 由 {@link flattenTree} 产出的一个分支行。 */
export interface LeafRow {
  readonly kind: 'leaf'
  /** 最后一个路径段；完整的分支名在 {@link LeafRow.branch} 上。 */
  readonly label: string
  readonly branch: BranchEntry
  /** 从 0 开始的嵌套深度；渲染器将其映射为左内边距。 */
  readonly depth: number
  /** 在可见叶子中的索引，即键盘光标的坐标。 */
  readonly index: number
}

/** 一行渲染内容：文件夹表头或分支叶子。 */
export type TreeRow = FolderRow | LeafRow

/** 子节点仍在分组中的文件夹。 */
interface DirDraft {
  readonly path: string
  readonly label: string
  readonly branches: BranchEntry[]
}

/** 构建顺序中的条目：直接放置的叶子，或稍后填充的文件夹。 */
type Draft =
  | { readonly kind: 'leaf'; readonly leaf: BranchLeaf }
  | { readonly kind: 'dir'; readonly dir: DirDraft }

/**
 * 把共享前缀 `basePath` 的分支归入树的一层。
 * 文件夹创建在其第一个分支的位置；递归随后从同一份保持顺序的列表
 * 中归组它自己的子节点。
 * @param basePath - 正在构建的层级路径；根层为空。
 * @param branches - 属于该文件夹的分支。
 * @returns 一层的树节点，已完成单链压缩。
 */
function buildLevel(basePath: string, branches: readonly BranchEntry[]): readonly BranchNode[] {
  const drafts: Draft[] = []
  const dirs = new Map<string, DirDraft>()
  for (const branch of branches) {
    const name = branch.name
    if (name === '') continue
    const rest = basePath === '' ? name : name.slice(basePath.length + 1)
    const slash = rest.indexOf('/')
    // 没有分隔符、存在空路径段，或以斜杠结尾：普通叶子。
    if (slash <= 0 || slash === rest.length - 1) {
      drafts.push({ kind: 'leaf', leaf: { kind: 'leaf', label: rest, branch } })
      continue
    }
    const segment = rest.slice(0, slash)
    let dir = dirs.get(segment)
    if (dir === undefined) {
      const path = basePath === '' ? segment : `${basePath}/${segment}`
      dir = { path, label: segment, branches: [] }
      dirs.set(segment, dir)
      drafts.push({ kind: 'dir', dir })
    }
    dir.branches.push(branch)
  }
  const nodes: BranchNode[] = []
  for (const draft of drafts) {
    if (draft.kind === 'leaf') {
      nodes.push(draft.leaf)
      continue
    }
    const { dir } = draft
    nodes.push({
      kind: 'folder',
      path: dir.path,
      label: dir.label,
      children: buildLevel(dir.path, dir.branches),
    })
  }
  return compressChains(nodes)
}

/**
 * 把恰好只有一个子节点、且该子节点也是文件夹的文件夹合并为一行
 * （`feat` > `ui` 变为 `feat/ui`），更长的链重复此过程。这样深层路径
 * 保持简短，又不会凭空造出单元素层级。包含任何叶子的文件夹保持不变，
 * 叶子因此保留自己的行。
 * @param nodes - 树的一层，子节点已压缩。
 * @returns 合并文件夹链后的同一层。
 */
function compressChains(nodes: readonly BranchNode[]): readonly BranchNode[] {
  return nodes.map((node) => {
    if (node.kind === 'leaf') return node
    let folder: BranchFolder = node
    while (folder.children.length === 1) {
      const only: BranchNode | undefined = folder.children[0]
      if (only === undefined || only.kind !== 'folder') break
      folder = {
        kind: 'folder',
        path: only.path,
        label: `${folder.label}/${only.label}`,
        children: only.children,
      }
    }
    return folder
  })
}

/**
 * 为一个快照构建文件夹树。
 * @param branches - Host 的分支列表，按其自身的提交日期顺序。
 * @returns 根节点；不含斜杠的叶子与文件夹并列位于根层。
 */
export function buildTree(branches: readonly BranchEntry[]): readonly BranchNode[] {
  return buildLevel('', branches)
}

/** 对一个分支的完整名称做大小写不敏感的子串匹配。 */
function matches(branch: BranchEntry, needle: string): boolean {
  return branch.name.toLowerCase().includes(needle)
}

/**
 * 深度优先地把树摊平成面板渲染的行。
 *
 * 查询为空时，文件夹默认展开，除非它在 `collapsed` 中；查询非空时，
 * 每个命中的文件夹都展开，没有命中后代的文件夹消失，因此搜索始终
 * 是对完整分支名（`fix/released`，大小写不敏感）的一次简单全树匹配。
 * @param tree - 由 {@link buildTree} 构建的树。
 * @param collapsed - 用户已折叠的文件夹路径；搜索期间忽略。
 * @param query - 原始搜索文本；此处做 trim 与小写化。
 * @returns 可见行，各自携带深度，叶子还携带索引。
 */
export function flattenTree(
  tree: readonly BranchNode[],
  collapsed: ReadonlySet<string>,
  query: string,
): readonly TreeRow[] {
  const needle = query.trim().toLowerCase()
  const searching = needle !== ''
  const memo = new Map<BranchNode, boolean>()
  const hasMatch = (node: BranchNode): boolean => {
    const known = memo.get(node)
    if (known !== undefined) return known
    const result =
      node.kind === 'leaf'
        ? matches(node.branch, needle)
        : node.children.some((child) => hasMatch(child))
    memo.set(node, result)
    return result
  }
  const rows: TreeRow[] = []
  let leafIndex = 0
  const visit = (nodes: readonly BranchNode[], depth: number): void => {
    for (const node of nodes) {
      if (node.kind === 'leaf') {
        if (searching && !hasMatch(node)) continue
        rows.push({ kind: 'leaf', label: node.label, branch: node.branch, depth, index: leafIndex })
        leafIndex += 1
        continue
      }
      if (searching && !hasMatch(node)) continue
      const open = searching || !collapsed.has(node.path)
      rows.push({ kind: 'folder', path: node.path, label: node.label, depth, open })
      if (open) visit(node.children, depth + 1)
    }
  }
  visit(tree, 0)
  return rows
}

/**
 * 展开通往某个分支的路径上的所有文件夹，使该分支在面板打开时
 * 不会藏在被折叠的祖先之后。
 * @param tree - 由 {@link buildTree} 构建的树。
 * @param collapsed - 用户已折叠的文件夹。
 * @param branchName - 必须保持可见的分支的完整名称。
 * @returns 无需展开时返回 `collapsed` 本身，否则返回新集合。
 */
export function revealBranch(
  tree: readonly BranchNode[],
  collapsed: ReadonlySet<string>,
  branchName: string,
): ReadonlySet<string> {
  if (collapsed.size === 0) return collapsed
  let changed = false
  const next = new Set(collapsed)
  const visit = (node: BranchNode): boolean => {
    if (node.kind === 'leaf') return node.branch.name === branchName
    let found = false
    for (const child of node.children) {
      if (visit(child)) found = true
    }
    if (found && next.delete(node.path)) changed = true
    return found
  }
  for (const node of tree) visit(node)
  return changed ? next : collapsed
}
