/**
 * 浏览器侧 · 插件详情页里的「功能开关」区块。
 *
 * 注册在 `plugins.bundle.config`（以本包名为键）上，因此它只出现在本插件的
 * 组合包详情页，不占用设置页，也不影响其他插件。每个功能一行：标题 + 说明 +
 * 开关；写入即时生效（volatile commit，插件不重挂载）。
 *
 * 样式自持：Harness 的组件库不向插件包开放，因此开关本体是这里自绘的
 * `<input type="checkbox">` + 轨道/滑块两段 `<span>`，只用 `--dsw-alias-*`
 * 颜色变量，类名前缀 `dtk-` 以免与宿主样式互相影响。
 */
import * as React from 'react'
import type { ReactElement } from 'react'

import { FEATURE_LIST, type FeatureConfigKey } from '../features.js'
import { useToggles } from './use-toggles.js'
import { toggleStore } from './toggles.js'

const { useState } = React

/** `plugins.bundle.config` 交给占用者的 props。 */
export interface ToggleSectionProps {
  /** 绑定到本插件命名空间的翻译函数。 */
  t: (key: string) => string
  /** 页面用 `view: 'page'` 渲染带保存控件的表单；本区块自管写入，故忽略。 */
  view?: string
}

/** 区块样式。类名统一加 `dtk-` 前缀，避免影响宿主或其他插件。 */
const SECTION_CSS = `
.dtk-toggles {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 8px;
}
.dtk-toggles-title {
  margin: 0;
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dtk-toggles-desc {
  margin: 0 0 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dtk-toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--dsw-alias-border-l2);
}
.dtk-toggle-row:last-of-type {
  border-bottom: none;
}
.dtk-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.dtk-toggle-name {
  font-size: 14px;
  line-height: 22px;
  color: var(--dsw-alias-label-primary);
}
.dtk-toggle-note {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dtk-toggle-status {
  margin: 2px 0 0;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.dtk-switch {
  position: relative;
  display: inline-flex;
  flex: none;
  cursor: pointer;
}
.dtk-switch-input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
}
.dtk-switch-track {
  display: inline-flex;
  align-items: center;
  width: 36px;
  height: 20px;
  padding: 2px;
  box-sizing: border-box;
  border-radius: 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.dtk-switch-thumb {
  display: block;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-label-tertiary);
  transition: transform 0.15s ease, background 0.15s ease;
}
.dtk-switch:hover .dtk-switch-track {
  border-color: var(--dsw-alias-label-dimmed);
}
.dtk-switch-input:checked + .dtk-switch-track {
  border-color: var(--dsw-alias-button-primary-fill);
  background: var(--dsw-alias-button-primary-fill);
}
.dtk-switch-input:checked + .dtk-switch-track .dtk-switch-thumb {
  transform: translateX(16px);
  background: var(--dsw-alias-bg-layer-3);
}
.dtk-switch-input:focus-visible + .dtk-switch-track {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dtk-switch-input:disabled + .dtk-switch-track {
  opacity: 0.5;
  cursor: not-allowed;
}
`

/** 自绘开关：真实 checkbox 承载语义与焦点，轨道/滑块只负责外观。 */
function Switch(props: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (next: boolean) => void
}): ReactElement {
  const { checked, disabled, label, onChange } = props
  return (
    <label className="dtk-switch">
      <input
        type="checkbox"
        className="dtk-switch-input"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          onChange(event.currentTarget.checked)
        }}
      />
      <span className="dtk-switch-track" aria-hidden="true">
        <span className="dtk-switch-thumb" />
      </span>
    </label>
  )
}

/** 详情页的功能开关区块。 */
export function ToggleSection({ t }: ToggleSectionProps): ReactElement | null {
  const snapshot = useToggles()
  const store = toggleStore()
  const [failed, setFailed] = useState<FeatureConfigKey | null>(null)

  const writable = snapshot.status === 'ready'

  return (
    <section className="dtk-toggles">
      <style>{SECTION_CSS}</style>
      <h4 className="dtk-toggles-title">{t('toolkit.sectionTitle')}</h4>
      <p className="dtk-toggles-desc">{t('toolkit.sectionDescription')}</p>
      {FEATURE_LIST.map((feature) => {
        const key = feature.configKey
        const checked = snapshot.value[key] === true
        return (
          <div className="dtk-toggle-row" key={feature.id}>
            <div className="dtk-toggle-text">
              <span className="dtk-toggle-name">{t(feature.titleKey)}</span>
              <span className="dtk-toggle-note">{t(feature.descriptionKey)}</span>
            </div>
            <Switch
              checked={checked}
              disabled={!writable}
              label={t(feature.titleKey)}
              onChange={(next) => {
                void store.set(key, next).then((accepted) => {
                  setFailed(accepted ? null : key)
                })
              }}
            />
          </div>
        )
      })}
      {snapshot.status === 'loading' ? (
        <p className="dtk-toggle-status">{t('toolkit.status.loading')}</p>
      ) : null}
      {snapshot.status === 'unavailable' ? (
        <p className="dtk-toggle-status">{t('toolkit.status.unavailable')}</p>
      ) : null}
      {snapshot.status === 'ready' && !writable ? (
        <p className="dtk-toggle-status">{t('toolkit.status.readonly')}</p>
      ) : null}
      {failed !== null ? <p className="dtk-toggle-status">{t('toolkit.status.failed')}</p> : null}
    </section>
  )
}
