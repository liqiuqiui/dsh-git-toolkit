/**
 * 浏览器侧 · 文件右键菜单。
 *
 * 两件事合在一个占用者里，因为它们的生命周期必须一致：
 *
 *   1. **安装文档级 `contextmenu` 监听器**。Host 的 Markdown 渲染器没有给文件
 *      提及留任何回调口子（它的 `onClick` 固定走「打开资源」），也没有任何既有
 *      插件在监听 `contextmenu`，因此这条路必须走 DOM 委托：命中文件提及就
 *      `preventDefault()` 换成自己的菜单，没命中就什么都不做，交还给浏览器。
 *      监听器只在功能开启时存在（外层 `gated`），关闭功能不会留下全局副作用。
 *   2. **渲染菜单本体**。挂在 `shell.overlay` 上以免被对话流裁剪；位置取自右键
 *      时的光标坐标，并在视口边缘处翻转。
 *
 * 菜单项与宿主能力的对应关系全部在 `actions.ts` 里，这里只负责交互：加载
 * 「打开方式」、键盘导航、子菜单、动作反馈与关闭时机。
 */
import * as React from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'

import { writeClipboard } from '../../clipboard.js'
import {
  baseNameOf,
  beginSave,
  canOpenOnDesktop,
  isCancelled,
  isUnavailable,
  listApplications,
  messageKeyOf,
  messageOf,
  openFile,
  openWithApplication,
  readFileText,
  readWholeFile,
  resolveAbsolutePath,
  revealFile,
} from './actions.js'
import {
  AppFallbackIcon,
  AppIcon,
  CheckIcon,
  ChevronRightIcon,
  CopyIcon,
  FileIcon,
  RevealIcon,
  SaveIcon,
} from './icons.js'
import { pickEditor } from './preferred.js'
import { getCurrentSession, getRemote } from './runtime.js'
import { closeMenu, getState, openMenu, setState, useStore } from './store.js'
import { MENU_CSS } from './styles.js'
import { findMention, isAbsolutePath } from './target.js'

const { useEffect, useRef, useState } = React

/** 菜单宽度（CSS 像素）。 */
const MENU_WIDTH = 240

/** 子菜单宽度，用于判定往左还是往右展开。 */
const SUBMENU_WIDTH = 200

/** 一行的高度，用于估算菜单总高以决定向上还是向下展开。 */
const ROW_HEIGHT = 30

/** 分隔线的高度（含外边距）。 */
const SEPARATOR_HEIGHT = 9

/** 顶部反馈条的高度。 */
const NOTE_HEIGHT = 26

/** 菜单自身的内边距。 */
const MENU_PADDING = 8

/** 与视口边缘的最小距离。 */
const EDGE = 8

/** 动作成功后菜单自行关闭前的停留时间，让「已复制」这类反馈能被看见。 */
const CLOSE_DELAY_MS = 700

/** Host 传给 `shell.overlay` 占用者的 props。 */
export interface FileMenuProps {
  /** 绑定命名空间的翻译函数（`dsh-toolkit/file-menu`）。 */
  t: (key: string, params?: Record<string, unknown>) => string
}

/** 可直接触发的一行。 */
interface ActionRow {
  readonly kind: 'action'
  readonly id: string
  readonly icon: ReactNode
  readonly label: string
  readonly run: () => void
  readonly disabled: boolean
}

/** 展开子菜单的一行。 */
interface SubmenuRow {
  readonly kind: 'submenu'
  readonly id: string
  readonly icon: ReactNode
  readonly label: string
  readonly disabled: boolean
}

/** 分隔线。 */
interface SeparatorRow {
  readonly kind: 'separator'
  readonly id: string
}

/** 菜单里的一行。 */
type Row = ActionRow | SubmenuRow | SeparatorRow

/** 可聚焦、可被键盘选中的行（分隔线之外的全部）。 */
type FocusableRow = ActionRow | SubmenuRow

/** 菜单本体。 */
export function FileMenu({ t }: FileMenuProps): ReactElement | null {
  const state = useStore()
  const menuRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const focusableRef = useRef<readonly FocusableRow[]>([])
  const submenuActiveRef = useRef(0)
  const [submenuActive, setSubmenuActive] = useState(0)
  const [submenuFlipped, setSubmenuFlipped] = useState(false)

  // ---- 监听器：整个功能生命周期只装一次 ----

  useEffect(() => {
    function onContextMenu(event: MouseEvent): void {
      const hit = findMention(event.target)
      if (hit === null) return
      const sessionId = getCurrentSession() ?? ''
      // 相对路径要靠会话工作区才能换算成宿主绝对路径；没有会话时我们连菜单都
      // 弹不出来，此时**不要** preventDefault —— 把这次右键原样交还给浏览器，
      // 总好过吞掉菜单却什么都不显示。
      if (sessionId === '' && !isAbsolutePath(hit.path)) return
      // 命中文件提及才接管；否则保留浏览器原生菜单。
      event.preventDefault()
      openMenu({
        sessionId,
        path: hit.path,
        x: event.clientX,
        y: event.clientY,
        anchorEl: hit.anchorEl,
      })
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
    }
  }, [])

  // ---- 打开时解析路径与「打开方式」 ----

  useEffect(() => {
    if (!state.open) return undefined
    const controller = new AbortController()
    abortRef.current = controller
    const { signal } = controller
    const remote = getRemote()
    const sessionId = state.sessionId === null ? '' : state.sessionId

    void (async () => {
      let absolutePath: string
      if (isAbsolutePath(state.path)) {
        absolutePath = state.path
      } else if (sessionId !== '') {
        absolutePath = await resolveAbsolutePath(remote, sessionId, state.path, signal)
      } else {
        // 相对路径又不知道会话，无法映射到宿主文件系统：不弹菜单。
        closeMenu()
        return
      }
      if (signal.aborted) return
      const desktop = await canOpenOnDesktop(remote)
      if (signal.aborted) return
      const applications = desktop ? await listApplications(remote, absolutePath, signal) : []
      if (signal.aborted) return
      // 应用查询失败（`null`）说明这个路径无法交给桌面打开 —— 与「没有登记处理器」
      // （空数组）不同。这时收掉打开类菜单项，只留下复制与另存为。
      setState({
        absolutePath,
        desktop: desktop && applications !== null,
        applications: applications ?? [],
        phase: 'ready',
        active: 0,
      })
    })().catch((error: unknown) => {
      if (signal.aborted) return
      // 能力整块缺席（没有 remote、或路径无法映射到宿主文件系统）时直接不弹菜单，
      // 让这次右键表现得像没被接管。
      if (isUnavailable(error)) {
        closeMenu()
        return
      }
      setState({ phase: 'failed', message: describe(error, t('readFailed')) })
    })

    return () => {
      controller.abort()
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [state.open, state.path, state.sessionId])

  // 关闭时清理延时关闭定时器与进行中的动作。
  useEffect(() => {
    if (state.open) return undefined
    if (closeTimerRef.current !== null) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    return undefined
  }, [state.open])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current)
      abortRef.current?.abort()
    }
  }, [])

  // 面板之外的 mousedown 关闭菜单；菜单本身的点击不关。
  useEffect(() => {
    if (!state.open) return undefined
    function onMouseDown(event: MouseEvent): void {
      const target = event.target
      if (!(target instanceof Node)) return
      const menu = menuRef.current
      if (menu !== null && menu.contains(target)) return
      closeMenu()
    }
    function onResize(): void {
      closeMenu()
    }
    document.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('resize', onResize)
    }
  }, [state.open])

  // ---- 行为 ----

  /**
   * 把一次失败变成可展示文案。
   *
   * 本功能知道的失败（二进制内容、超过上限、缺少会话）带自己的文案键，因此用用户
   * 的语言说话；宿主给出的其他失败保留它的消息 —— 那通常是最具体的线索。
   */
  function describe(error: unknown, fallback: string): string {
    const localised = messageKeyOf(error)
    if (localised === null) return messageOf(error, fallback)
    return t(localised.key, localised.params)
  }

  /**
   * 显示一条结果。
   *
   * 成功的「打开」类动作没有需要展示的文案（窗口已经切走了），因此空字符串直接
   * 收起菜单；有文案的成功动作停留一下再收起，让反馈能被读到。
   */
  function settle(message: string, succeeded: boolean): void {
    setState({ phase: succeeded ? 'done' : 'failed', message })
    if (succeeded && message === '') {
      closeMenu()
      return
    }
    if (!succeeded) return
    if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      closeTimerRef.current = null
      closeMenu()
    }, CLOSE_DELAY_MS)
  }

  /** 跑一个动作：期间菜单置忙，结果变成顶部反馈。 */
  async function perform(run: (signal: AbortSignal) => Promise<string>): Promise<void> {
    const snapshot = getState()
    if (snapshot.phase === 'busy') return
    const controller = new AbortController()
    abortRef.current = controller
    setState({ phase: 'busy', message: null, submenuOpen: false })
    try {
      const message = await run(controller.signal)
      if (controller.signal.aborted) return
      settle(message, true)
    } catch (error: unknown) {
      if (controller.signal.aborted) return
      // 用户自己取消（关掉保存对话框）不是失败：收起菜单，不报红。
      if (isCancelled(error)) {
        closeMenu()
        return
      }
      settle(describe(error, t('openFailed')), false)
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  /** 复制路径：优先绝对路径（可直接粘到终端或编辑器里）。 */
  function doCopyPath(): void {
    const { absolutePath, path } = getState()
    const text = absolutePath ?? path
    void perform(async () => {
      const ok = await writeClipboard(text)
      if (!ok) throw new Error(t('copyFailed'))
      return t('copiedPath')
    })
  }

  /** 复制文件内容：按 UTF-8 文本读取整个文件。 */
  function doCopyContents(): void {
    void perform(async (signal) => {
      const { absolutePath, sessionId } = getState()
      if (absolutePath === null) throw new Error(t('unresolved'))
      if (sessionId === null || sessionId === '') throw new Error(t('noSession'))
      const text = await readFileText(getRemote(), sessionId, absolutePath, signal)
      const ok = await writeClipboard(text)
      if (!ok) throw new Error(t('copyFailed'))
      return t('copiedContents')
    })
  }

  /** 另存为：先要保存位置，再读字节写入（详见 `beginSave`）。 */
  function doSaveAs(): void {
    void perform(async (signal) => {
      const { absolutePath, sessionId } = getState()
      if (absolutePath === null) throw new Error(t('unresolved'))
      if (sessionId === null || sessionId === '') throw new Error(t('noSession'))
      const saver = await beginSave(baseNameOf(absolutePath))
      const { data } = await readWholeFile(getRemote(), sessionId, absolutePath, signal)
      const channel = await saver.write(data)
      return channel === 'dialog' ? t('savedDialog') : t('savedDownload')
    })
  }

  /** 用系统默认程序打开。 */
  function doOpen(): void {
    void perform(async (signal) => {
      const { absolutePath } = getState()
      if (absolutePath === null) throw new Error(t('unresolved'))
      await openFile(getRemote(), absolutePath, signal)
      return ''
    })
  }

  /** 用指定程序打开。 */
  function doOpenWith(application: string): void {
    void perform(async (signal) => {
      const { absolutePath } = getState()
      if (absolutePath === null) throw new Error(t('unresolved'))
      await openWithApplication(getRemote(), absolutePath, application, signal)
      return ''
    })
  }

  /** 在文件管理器中定位。 */
  function doReveal(): void {
    void perform(async (signal) => {
      const { absolutePath } = getState()
      if (absolutePath === null) throw new Error(t('unresolved'))
      await revealFile(getRemote(), absolutePath, signal)
      return ''
    })
  }

  // ---- 行模型 ----

  const editor = pickEditor(state.applications)
  const canRead = state.sessionId !== null && state.sessionId !== ''
  const busy = state.phase === 'busy' || state.phase === 'loading'
  const rows: Row[] = []
  if (state.desktop) {
    rows.push({
      kind: 'action',
      id: 'open',
      icon: <FileIcon />,
      label: t('open'),
      run: doOpen,
      disabled: busy || state.absolutePath === null,
    })
    if (editor !== null) {
      rows.push({
        kind: 'action',
        id: 'open-with-editor',
        icon: <AppIcon icon={editor.icon} />,
        label: t('openWith', { name: editor.name }),
        run: () => {
          doOpenWith(editor.id)
        },
        disabled: busy,
      })
    }
    if (state.applications.length > 0) {
      rows.push({
        kind: 'submenu',
        id: 'open-with',
        icon: <AppFallbackIcon />,
        label: t('openWithSubmenu'),
        disabled: busy,
      })
    }
    rows.push({ kind: 'separator', id: 'sep-1' })
  }
  rows.push({
    kind: 'action',
    id: 'save-as',
    icon: <SaveIcon />,
    label: t('saveAs'),
    run: doSaveAs,
    disabled: busy || !canRead,
  })
  rows.push({
    kind: 'action',
    id: 'copy-path',
    icon: <CopyIcon />,
    label: t('copyPath'),
    run: doCopyPath,
    disabled: busy,
  })
  rows.push({
    kind: 'action',
    id: 'copy-contents',
    icon: <CopyIcon />,
    label: t('copyContents'),
    run: doCopyContents,
    disabled: busy || !canRead,
  })
  if (state.desktop) {
    rows.push({ kind: 'separator', id: 'sep-2' })
    rows.push({
      kind: 'action',
      id: 'reveal',
      icon: <RevealIcon />,
      label: t('reveal'),
      run: doReveal,
      disabled: busy || state.absolutePath === null,
    })
  }

  // 可聚焦行（分隔线跳过）；键盘索引只在这些行之间移动。
  const focusable: readonly FocusableRow[] = rows.filter(
    (row): row is FocusableRow => row.kind !== 'separator',
  )
  const activeIndex = Math.max(0, Math.min(state.active, focusable.length - 1))
  const activeRow = focusable[activeIndex]
  const submenuIndex = activeRow !== undefined && activeRow.kind === 'submenu' ? activeIndex : -1
  focusableRef.current = focusable
  submenuActiveRef.current = submenuActive

  // ---- 键盘 ----

  // 文档级监听器只装一次，但它要触发的动作随会话/路径变化；用 ref 转一层，
  // 避免每次状态变化都重装监听器。
  const openWithRef = useRef<(application: string) => void>(doOpenWith)
  openWithRef.current = doOpenWith

  useEffect(() => {
    if (!state.open) return undefined
    function onKeyDown(event: KeyboardEvent): void {
      if (event.defaultPrevented) return
      if (event.isComposing || event.keyCode === 229) return
      const snapshot = getState()
      const key = event.key
      const count = focusableRef.current.length

      if (key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (snapshot.submenuOpen) setState({ submenuOpen: false })
        else closeMenu()
        return
      }
      if (snapshot.submenuOpen) {
        const total = snapshot.applications.length
        if (key === 'ArrowDown' || key === 'ArrowUp') {
          event.preventDefault()
          const step = key === 'ArrowDown' ? 1 : -1
          if (total > 0) setSubmenuActive((current) => (current + step + total) % total)
          return
        }
        if (key === 'ArrowLeft') {
          event.preventDefault()
          setState({ submenuOpen: false })
          return
        }
        if (key === 'Enter') {
          event.preventDefault()
          const application = snapshot.applications[submenuActiveRef.current]
          if (application !== undefined) openWithRef.current(application.id)
          return
        }
      }
      if (count === 0) return
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        event.preventDefault()
        const step = key === 'ArrowDown' ? 1 : -1
        setState({ active: (snapshot.active + step + count) % count, submenuOpen: false })
        return
      }
      if (key === 'ArrowRight' && submenuIndex >= 0 && snapshot.applications.length > 0) {
        event.preventDefault()
        setState({ submenuOpen: true })
        setSubmenuActive(0)
        return
      }
      if (key === 'Enter') {
        event.preventDefault()
        const row = focusableRef.current[snapshot.active]
        if (row === undefined) return
        if (row.kind === 'submenu') {
          if (snapshot.applications.length > 0) {
            setState({ submenuOpen: true })
            setSubmenuActive(0)
          }
          return
        }
        if (!row.disabled) row.run()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [state.open, submenuIndex])

  // 高亮行获得焦点（roving tabindex），这样方向键与 Enter 的语义和读屏器一致。
  useEffect(() => {
    if (!state.open) return
    const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[data-row="true"]')
    if (buttons === undefined) return
    const target = buttons[state.active]
    if (target === undefined) return
    try {
      target.focus({ preventScroll: true })
    } catch {
      // 菜单在这之间被卸载了；没有可聚焦的目标。
    }
  }, [state.open, state.active])

  /** 子菜单展开方向：右侧放不下就往左。 */
  useEffect(() => {
    if (!state.submenuOpen) return
    const width = window.innerWidth
    setSubmenuFlipped(state.x + MENU_WIDTH + SUBMENU_WIDTH > width - EDGE)
  }, [state.submenuOpen, state.x])

  // ---- 渲染（位于所有 hook 之后） ----

  if (!state.open) return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const width = Math.min(MENU_WIDTH, viewportWidth - EDGE * 2)
  const measure = (list: readonly Row[]): number =>
    list.reduce(
      (total, row) => total + (row.kind === 'separator' ? SEPARATOR_HEIGHT : ROW_HEIGHT),
      MENU_PADDING,
    ) + (state.message === null ? 0 : NOTE_HEIGHT)
  const estimate = measure(rows) + (state.phase === 'loading' ? NOTE_HEIGHT : 0)
  const height = Math.min(estimate, viewportHeight - EDGE * 2)
  const left = Math.max(EDGE, Math.min(state.x, viewportWidth - width - EDGE))
  const top =
    state.y + height + EDGE > viewportHeight
      ? Math.max(EDGE, state.y - height)
      : Math.max(EDGE, state.y)
  const position: CSSProperties = {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    maxHeight: `${viewportHeight - EDGE * 2}px`,
  }

  /** 「打开方式」子菜单；绝对定位在所在行右侧（空间不足时改到左侧）。 */
  const renderSubmenu = (): ReactElement => {
    const style: CSSProperties = submenuFlipped
      ? { left: 'auto', right: '100%', top: '-5px' }
      : { left: '100%', right: 'auto', top: '-5px' }
    return (
      <div className="ctxm-sub" role="menu" aria-label={t('openWithSubmenu')} style={style}>
        {state.applications.map((application, index) => (
          <button
            key={application.id}
            type="button"
            className="ctxm-item"
            data-active={index === submenuActive ? 'true' : 'false'}
            role="menuitem"
            tabIndex={-1}
            onMouseEnter={() => {
              setSubmenuActive(index)
            }}
            onClick={() => {
              doOpenWith(application.id)
            }}
          >
            <span className="ctxm-icon">
              <AppIcon icon={application.icon} />
            </span>
            <span className="ctxm-label">{application.name}</span>
            {application.default ? (
              <span className="ctxm-chevron">
                <CheckIcon size={12} />
              </span>
            ) : null}
          </button>
        ))}
      </div>
    )
  }

  const renderRow = (row: Row): ReactElement => {
    if (row.kind === 'separator') {
      return <div key={row.id} className="ctxm-sep" role="separator" />
    }
    const index = focusable.indexOf(row)
    const isActive = index === activeIndex
    const open = row.kind === 'submenu' && state.submenuOpen && submenuIndex === index
    return (
      <div key={row.id} className="ctxm-row">
        <button
          type="button"
          className="ctxm-item"
          data-row="true"
          data-active={isActive ? 'true' : 'false'}
          role="menuitem"
          {...(row.kind === 'submenu'
            ? { 'aria-haspopup': 'menu', 'aria-expanded': open ? 'true' : 'false' }
            : {})}
          tabIndex={isActive ? 0 : -1}
          disabled={row.disabled}
          onMouseEnter={() => {
            if (index !== state.active) setState({ active: index })
            if (row.kind === 'submenu') {
              setState({ submenuOpen: true })
              setSubmenuActive(0)
            } else if (state.submenuOpen) {
              setState({ submenuOpen: false })
            }
          }}
          onFocus={() => {
            if (index !== state.active) setState({ active: index })
          }}
          onClick={() => {
            if (row.kind === 'submenu') {
              setState({ submenuOpen: true })
              setSubmenuActive(0)
              return
            }
            row.run()
          }}
        >
          <span className="ctxm-icon">{row.icon}</span>
          <span className="ctxm-label">{row.label}</span>
          {row.kind === 'submenu' ? (
            <span className="ctxm-chevron">
              <ChevronRightIcon size={12} />
            </span>
          ) : null}
        </button>
        {open ? renderSubmenu() : null}
      </div>
    )
  }

  return (
    <>
      <style>{MENU_CSS}</style>
      <div
        ref={menuRef}
        className="ctxm-menu"
        style={position}
        role="menu"
        aria-label={state.path}
        tabIndex={-1}
      >
        {state.phase === 'loading' ? (
          <div className="ctxm-note">
            <span className="ctxm-spin" aria-hidden="true" /> {t('loading')}
          </div>
        ) : null}
        {state.message === null ? null : (
          <div className="ctxm-note" data-error={state.phase === 'failed' ? 'true' : 'false'}>
            {state.message}
          </div>
        )}
        {rows.map(renderRow)}
      </div>
    </>
  )
}
