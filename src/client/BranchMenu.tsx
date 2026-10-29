/**
 * 浏览器侧 · 分支面板。
 *
 * 注册在 `shell.overlay` 上，以免被 Hero 行裁剪。它只读写共享 store：触发器在
 * 打开面板时捕获了锚点几何信息，面板据此快照计算自身的固定定位
 * （与触发器右对齐，上方有空间时显示在上方，否则显示在下方）。
 *
 * 列表把斜杠分隔的分支名渲染成目录树（由 `branch-tree.ts` 中的纯模型构建）：
 * 目录行折叠/展开，叶子行执行检出，每个叶子右对齐显示其配置的上游分支。键盘
 * 导航只在叶子之间移动，因此 Enter 永远不会落在目录上。搜索、创建表单、
 * 外部点击与 resize 关闭、以及 abort 处理均与扁平列表版本保持一致。
 */
import * as React from 'react'
import type { CSSProperties, ChangeEvent, ReactElement } from 'react'

import {
  branchList,
  currentBranchName,
  fetchStatus,
  formatError,
  requestCreate,
  requestSwitch,
} from './api.js'
import { buildTree, flattenTree, revealBranch } from './branch-tree.js'
import type { FolderRow, LeafRow } from './branch-tree.js'
import { BranchIcon, CheckIcon, FolderIcon, PlusIcon, SearchIcon } from './icons.js'
import type { ClientState } from './store.js'
import { closePopover, getState, setState, useStore } from './store.js'
import { POPOVER_CSS } from './styles.js'

const { useEffect, useMemo, useRef, useState } = React

/** 面板宽度（CSS 像素，同时也是翻转阈值）。 */
const POPOVER_WIDTH = 320

/** 锚点上方空间超过该值时面板向上展开；小于该值时向下翻转。 */
const FLIP_SPACE = 320

/** 触发器与面板之间的间距。 */
const GAP = 8

/** 面板与视口边缘之间的最小距离，用于面板自身的左右收边。 */
const EDGE = 8

/** 响应式宽度内缩：`min(320px, 100vw - 24px)`，与样式表一致。 */
const WIDTH_INSET = 24

/** 层叠顺序：位于 shell overlay 外壳之上。 */
const Z_INDEX = 1100

/** `.gtk-row` 自身的左内边距；树的缩进在此基础上叠加。 */
const ROW_PADDING_LEFT = 7

/** 每一层嵌套额外增加的左内边距。 */
const INDENT = 14

/** Host 传给 `shell.overlay` 占用者的 props。 */
export interface BranchMenuProps {
  /** 绑定命名空间的翻译函数（`git-toolkit`）。 */
  t: (key: string) => string
}

/**
 * 文档级监听器调用的键盘处理函数。最新的快照保存在一个 ref 中，使监听器在每次
 * 打开/关闭时只安装一次，而不必在每次按键驱动的状态变化时重新安装。
 */
interface LiveHandlers {
  readonly state: ClientState
  readonly onEscape: () => void
  readonly onMove: (delta: number) => void
  readonly onPick: () => boolean
  readonly onCreate: () => void
}

/** 面板。 */
export function BranchMenu({ t }: BranchMenuProps): ReactElement | null {
  const state = useStore()
  const popRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const newNameRef = useRef<HTMLInputElement | null>(null)
  const liveRef = useRef<LiveHandlers | null>(null)
  const switchAbortRef = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(false)
  const [newName, setNewName] = useState('')
  // 折叠的目录以路径集合表示；空集合表示默认的「全部展开」。
  // 用「已折叠路径」集合（而非「已展开路径」）可以让新出现的目录保持展开，
  // 而无需触碰此状态。
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>())

  const status = state.status
  const branches = branchList(status)
  const current = currentBranchName(status)
  const busy = state.busy
  const busySwitchingName = busy !== null && busy.kind === 'switch' ? busy.name : null
  const busyCreating = busy !== null && busy.kind === 'create'

  // 树模型：快照变化时重建，折叠状态或搜索文本变化时展平。`leaves` 是键盘
  // 唯一的作用域。
  const tree = useMemo(() => buildTree(branches), [branches])
  const rows = useMemo(() => flattenTree(tree, collapsed, state.query), [tree, collapsed, state.query])
  const leaves = useMemo(() => rows.filter((row): row is LeafRow => row.kind === 'leaf'), [rows])

  const activeIndex = Math.max(0, Math.min(state.active, leaves.length - 1))

  // 打开（以及保持打开）时会刷新状态，避免列表过期。
  useEffect(() => {
    if (!state.open || state.sessionId === null || state.sessionId === '') return undefined
    const controller = new AbortController()
    setLoading(true)
    fetchStatus(state.sessionId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        setLoading(false)
        if (!value.isRepo) {
          setState({ status: null })
          closePopover()
          return
        }
        setState({ status: value })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setLoading(false)
        setState({ error: formatError(error, t('requestFailed')) })
      })
    return () => {
      controller.abort()
    }
  }, [state.open, state.sessionId])

  // 面板消失时取消进行中的切换/创建请求。
  useEffect(() => {
    return () => {
      if (switchAbortRef.current !== null) {
        switchAbortRef.current.abort()
        switchAbortRef.current = null
      }
    }
  }, [])

  // 焦点：打开时聚焦搜索框，进入创建模式时聚焦名称输入框。
  useEffect(() => {
    if (!state.open) return undefined
    const target = state.creating ? newNameRef.current : searchRef.current
    if (target === null) return undefined
    const timer = setTimeout(() => {
      try {
        target.focus()
      } catch {
        // 该字段在渲染与定时器之间被卸载了；没有可聚焦的目标。
      }
    }, 0)
    return () => {
      clearTimeout(timer)
    }
  }, [state.open, state.creating])

  // 每次打开都从默认的「全部展开」状态开始，因此其他会话遗留的折叠状态
  // （面板关闭时仍保持挂载）不会隐藏另一个仓库中的目录。面板打开期间所做的
  // 折叠会被保留，包括跨越一次会临时展开全部目录的搜索之后。
  useEffect(() => {
    if (!state.open) return
    setCollapsed((previous) => (previous.size === 0 ? previous : new Set<string>()))
  }, [state.open])

  // 已检出分支所在的目录在打开时以及分支变化时展开，因此当前分支永远不会
  // 被折叠隐藏。之后用户仍可折叠这样的目录；该状态会被保留。
  useEffect(() => {
    if (!state.open) return
    setCollapsed((previous) => revealBranch(tree, previous, current))
  }, [state.open, tree, current])

  // 面板及其触发器之外的 mousedown 会关闭面板。
  useEffect(() => {
    if (!state.open) return undefined
    function onMouseDown(event: MouseEvent): void {
      const target = event.target
      if (!(target instanceof Node)) return
      const pop = popRef.current
      if (pop !== null && pop.contains(target)) return
      const anchor = getState().anchorEl
      if (anchor !== null && anchor.contains(target)) return
      closePopover()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
    }
  }, [state.open])

  // resize 会让固定定位的面板指向错误的位置。
  useEffect(() => {
    if (!state.open) return undefined
    function onResize(): void {
      closePopover()
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
    }
  }, [state.open])

  // 键盘：只使用一个文档级监听器，因为焦点可能在搜索框、名称输入框或按钮上。
  useEffect(() => {
    if (!state.open) return undefined
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented) return
      if (event.isComposing || event.keyCode === 229) return
      const live = liveRef.current
      if (live === null) return
      const key = event.key
      if (key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        live.onEscape()
        return
      }
      const target = event.target
      const onButton = target instanceof Element && target.closest('button') !== null
      if (live.state.creating) {
        // 创建模式下，输入框中的 Enter 提交；在按钮上则等同于点击。
        if (key === 'Enter' && !onButton) {
          event.preventDefault()
          live.onCreate()
        }
        return
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault()
        live.onMove(key === 'ArrowDown' ? 1 : -1)
        return
      }
      // 在按钮上，Enter 保持原生点击行为；否则它会选中当前行。
      if (key === 'Enter' && !onButton && live.onPick()) event.preventDefault()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [state.open])

  // ---- 行为 ----

  function resetCreate(): void {
    setNewName('')
  }

  function exitCreate(): void {
    setState({ creating: false, error: null })
    resetCreate()
  }

  function enterCreate(): void {
    if (getState().busy !== null) return
    setState({ creating: true, error: null, active: 0 })
  }

  /** 折叠或展开一个目录行。目录永远不会成为分支目标。 */
  function toggleFolder(path: string): void {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }

  /** 检出一个已有分支，成功后关闭面板。 */
  function doSwitch(name: string): void {
    const snapshot = getState()
    if (!snapshot.open || snapshot.busy !== null) return
    if (name === '') return
    const sessionId = snapshot.sessionId
    if (sessionId === null || sessionId === '') return
    if (name === currentBranchName(snapshot.status)) {
      closePopover()
      return
    }
    const controller = new AbortController()
    switchAbortRef.current = controller
    setState({ busy: { kind: 'switch', name }, error: null })
    requestSwitch(sessionId, name, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        if (switchAbortRef.current === controller) switchAbortRef.current = null
        if (!value.isRepo) {
          setState({ busy: null })
          closePopover()
          return
        }
        setState({ status: value, busy: null })
        closePopover()
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (switchAbortRef.current === controller) switchAbortRef.current = null
        setState({ busy: null, error: formatError(error, t('requestFailed')) })
      })
  }

  /** 从 HEAD 创建分支并检出，成功后关闭面板。 */
  function doCreate(): void {
    const snapshot = getState()
    if (!snapshot.open || snapshot.busy !== null) return
    const sessionId = snapshot.sessionId
    if (sessionId === null || sessionId === '') return
    const name = newName.trim()
    if (name === '') {
      setState({ error: t('emptyName') })
      return
    }
    const controller = new AbortController()
    switchAbortRef.current = controller
    setState({ busy: { kind: 'create' }, error: null })
    requestCreate(sessionId, name, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return
        if (switchAbortRef.current === controller) switchAbortRef.current = null
        if (!value.isRepo) {
          setState({ busy: null })
          closePopover()
          return
        }
        setState({ status: value, busy: null })
        resetCreate()
        closePopover()
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (switchAbortRef.current === controller) switchAbortRef.current = null
        setState({ busy: null, error: formatError(error, t('requestFailed')) })
      })
  }

  /** 只在可见叶子上移动键盘光标，并循环回绕。 */
  function onMove(delta: number): void {
    const snapshot = getState()
    const length = leaves.length
    if (length === 0) return
    const next = (Math.max(0, Math.min(snapshot.active, length - 1)) + delta + length) % length
    setState({ active: next })
  }

  /** 检出高亮的叶子；目录无法从这里到达。 */
  function onPick(): boolean {
    const row = leaves[activeIndex]
    if (row === undefined) return false
    doSwitch(row.branch.name)
    return true
  }

  function onEscape(): void {
    if (getState().creating) exitCreate()
    else closePopover()
  }

  // 保持文档监听器看到的处理函数为最新，而不必在每次状态变化时重新安装。
  liveRef.current = { state, onEscape, onMove, onPick, onCreate: doCreate }

  // ---- 渲染（位于所有 hook 之后） ----

  if (!state.open || state.anchorRect === null) return null

  const rect = state.anchorRect
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.max(0, Math.min(POPOVER_WIDTH, viewportWidth - WIDTH_INSET))
  const left = Math.max(EDGE, Math.min(rect.right - width, viewportWidth - width - EDGE))
  const position: CSSProperties = {
    position: 'fixed',
    left: `${left}px`,
    width: `${width}px`,
    zIndex: Z_INDEX,
  }
  if (rect.top >= FLIP_SPACE) {
    // 上方空间充足：把面板底边挂在触发器上方。
    position.bottom = `${viewportHeight - rect.top + GAP}px`
  } else {
    position.top = `${Math.min(rect.bottom + GAP, Math.max(EDGE, viewportHeight - EDGE))}px`
  }

  const renderSearch = (): ReactElement => (
    <div className="gtk-search">
      <span className="gtk-search-icon">
        <SearchIcon size={14} />
      </span>
      <input
        ref={searchRef}
        className="gtk-input"
        type="text"
        value={state.query}
        placeholder={t('searchPlaceholder')}
        aria-label={t('searchPlaceholder')}
        spellCheck={false}
        autoComplete="off"
        disabled={busy !== null}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setState({ query: event.target.value, active: 0 })
        }}
      />
    </div>
  )

  /** 目录表头：仅切换折叠，从不检出分支。 */
  /**
   * 目录行：切换折叠状态。折叠状态由 Host 自带的目录图标表达——展开时为打开、
   * 折叠时为关闭——这也是 Host 渲染工作区目录的方式，因此不使用单独的展开箭头。
   */
  const renderFolder = (row: FolderRow): ReactElement => (
    <button
      key={`folder:${row.path}`}
      type="button"
      className="gtk-row gtk-row-folder"
      aria-expanded={row.open ? 'true' : 'false'}
      aria-label={`${row.open ? t('collapseFolder') : t('expandFolder')} ${t('branchFolder')}: ${row.path}`}
      title={row.path}
      disabled={busy !== null}
      style={{ paddingLeft: `${ROW_PADDING_LEFT + row.depth * INDENT}px` }}
      onClick={() => {
        toggleFolder(row.path)
      }}
    >
      <FolderIcon className="gtk-folder-icon" open={row.open} size={16} />
      <span className="gtk-row-name gtk-folder-name">{row.label}</span>
    </button>
  )

  /** 分支叶子：检出该分支；上游分支右对齐显示。 */
  const renderLeaf = (row: LeafRow): ReactElement => {
    const name = row.branch.name
    const isCurrent = row.branch.current || name === current
    const isSwitching = busySwitchingName === name
    const upstream = row.branch.upstream
    const gone = upstream !== undefined && row.branch.upstreamGone === true
    const upstreamText =
      upstream === undefined ? '' : gone ? `${upstream} (${t('upstreamGone')})` : upstream
    const accessibleName = upstreamText === '' ? name : `${name} (${upstreamText})`
    return (
      <button
        key={`branch:${name}`}
        type="button"
        className="gtk-row"
        role="option"
        title={isSwitching ? `${t('switching')} ${name}` : name}
        aria-label={isSwitching ? `${t('switching')} ${name}` : accessibleName}
        data-current={isCurrent ? 'true' : 'false'}
        data-active={row.index === activeIndex ? 'true' : 'false'}
        aria-selected={isCurrent ? 'true' : 'false'}
        disabled={busy !== null}
        style={{ paddingLeft: `${ROW_PADDING_LEFT + row.depth * INDENT}px` }}
        onClick={() => {
          doSwitch(name)
        }}
        onMouseEnter={() => {
          if (row.index !== activeIndex) setState({ active: row.index })
        }}
      >
        {isSwitching ? (
          <span className="gtk-spin" aria-hidden="true" />
        ) : (
          <BranchIcon className="gtk-row-icon" size={16} />
        )}
        <span className="gtk-row-name">{row.label}</span>
        {upstream === undefined ? null : (
          <span
            className="gtk-row-upstream"
            data-gone={gone ? 'true' : 'false'}
            title={upstreamText}
          >
            {upstreamText}
          </span>
        )}
        {isCurrent ? <CheckIcon className="gtk-row-check" /> : null}
      </button>
    )
  }

  const renderList = (): ReactElement => {
    if (loading && status === null) {
      return (
        <div className="gtk-empty">
          <span className="gtk-spin" aria-hidden="true" />
          <span>{t('loading')}</span>
        </div>
      )
    }
    if (rows.length === 0) return <div className="gtk-empty">{t('noMatch')}</div>
    return (
      <div className="gtk-list" role="listbox" aria-label={t('branchesLabel')}>
        {rows.map((row) => (row.kind === 'folder' ? renderFolder(row) : renderLeaf(row)))}
      </div>
    )
  }

  const renderCreateRow = (): ReactElement => (
    <button
      type="button"
      className="gtk-create"
      disabled={busy !== null}
      onClick={enterCreate}
    >
      <PlusIcon className="gtk-create-icon" size={16} />
      <span className="gtk-create-text">{t('createNew')}</span>
    </button>
  )

  const renderCreateForm = (): ReactElement => (
    <div className="gtk-create-form">
      <div className="gtk-label">{t('createTitle')}</div>
      <input
        ref={newNameRef}
        className="gtk-input gtk-input-plain"
        type="text"
        value={newName}
        placeholder={t('newBranchName')}
        aria-label={t('newBranchName')}
        spellCheck={false}
        autoComplete="off"
        disabled={busyCreating}
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          setNewName(event.target.value)
        }}
      />
      <div className="gtk-create-actions">
        <button type="button" className="gtk-btn" disabled={busyCreating} onClick={exitCreate}>
          {t('cancel')}
        </button>
        <button
          type="button"
          className="gtk-btn gtk-btn-primary"
          disabled={busyCreating || newName.trim() === ''}
          onClick={doCreate}
        >
          {busyCreating ? <span className="gtk-spin" aria-hidden="true" /> : null}
          <span>{busyCreating ? t('creating') : t('createAndCheckout')}</span>
        </button>
      </div>
    </div>
  )

  return (
    <>
      <style>{POPOVER_CSS}</style>
      <div
        ref={popRef}
        className="gtk-pop"
        style={position}
        role="dialog"
        aria-label={t('switchBranch')}
      >
        {state.creating ? null : renderSearch()}
        {state.error !== null ? (
          <div className="gtk-error" role="alert">
            {state.error}
          </div>
        ) : null}
        {state.creating ? (
          renderCreateForm()
        ) : (
          <>
            <div className="gtk-label">{t('branchesLabel')}</div>
            {renderList()}
            <div className="gtk-divider" />
            {renderCreateRow()}
          </>
        )}
      </div>
    </>
  )
}
