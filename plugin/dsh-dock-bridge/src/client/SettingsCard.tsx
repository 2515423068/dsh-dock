/**
 * Settings card: mirrors the DSH Dock WebUI settings page — the network
 * group (proxy / mirrors / registry with shortcut chips, two-box port pool,
 * auto-open switch with hints, scope note, bottom save button) plus the
 * new-container initial-config template group. The bridge's own service
 * address (baseUrl) stays as a third group because it lives in the plugin's
 * activation row. When the service is unreachable the DSH-Dock groups
 * degrade away; the baseUrl group stays usable.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconQuestionOutline14, Input, Pill, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockSettings } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ModelConfigGroup } from './ModelConfigGroup.tsx'
import { ConfirmDialog, ErrorNote, SectionCard } from './parts.tsx'

const EMPTY: DockSettings = {
  proxy: '',
  githubMirror: '',
  npmRegistry: '',
  containerPortRange: '',
  autoOpenUiOnStart: true,
  skipFirstOpenPrompts: true,
}

/** Same shortcut chips the WebUI offers under the mirror fields. */
const GH_PRESETS = [
  { label: 'gh-proxy.com', value: 'https://gh-proxy.com' },
  { label: 'ghfast.top', value: 'https://ghfast.top' },
  { label: 'hk.gh-proxy.com', value: 'https://hk.gh-proxy.com' },
]
const NPM_PRESETS = [
  { label: 'npmmirror', value: 'https://registry.npmmirror.com' },
  { label: '腾讯云', value: 'https://mirrors.cloud.tencent.com/npm' },
  { label: '华为云', value: 'https://mirrors.huaweicloud.com/repository/npm' },
  { label: 'npm 官方', value: 'https://registry.npmjs.org' },
]

/** Split a stored `start-end` range into its two boxes. */
function splitRange(raw: string): [string, string] {
  const match = raw.match(/^\s*([^-]*?)\s*(?:-\s*([^-]*?))?\s*$/)
  return [(match?.[1] ?? '').trim(), (match?.[2] ?? '').trim()]
}

/** Inline `?` hint: the label stays clean, the explanation rides a tooltip. */
function Hint({ text }: { text: string }): ReactNode {
  return (
    <Tooltip label={text} side="right" maxWidth={320}>
      <span className={css.hintIcon} tabIndex={0} role="img" aria-label={text}>
        <IconQuestionOutline14 size={12} />
      </span>
    </Tooltip>
  )
}

/** The settings card body. */
export function SettingsCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [draft, setDraft] = useState<DockSettings>(EMPTY)
  const [portStart, setPortStart] = useState('')
  const [portEnd, setPortEnd] = useState('')
  const [baseUrl, setBaseUrlField] = useState('')
  const [savedNote, setSavedNote] = useState<string>()
  const opError = store.opErrorFor(['settings', 'baseUrl', 'modelConfig'])

  useEffect(() => {
    if (store.settings !== undefined) {
      setDraft(store.settings)
      const [start, end] = splitRange(store.settings.containerPortRange)
      setPortStart(start)
      setPortEnd(end)
    }
  }, [store.settings])
  useEffect(() => {
    if (store.status !== undefined) setBaseUrlField(store.status.baseUrl)
  }, [store.status])

  const dirty = store.settings !== undefined && (
    draft.proxy !== store.settings.proxy
    || draft.githubMirror !== store.settings.githubMirror
    || draft.npmRegistry !== store.settings.npmRegistry
    || draft.containerPortRange !== store.settings.containerPortRange
    || draft.autoOpenUiOnStart !== store.settings.autoOpenUiOnStart)

  const setRange = (start: string, end: string): void => {
    setPortStart(start)
    setPortEnd(end)
    const trimmedStart = start.trim()
    const trimmedEnd = end.trim()
    setDraft(previous => ({
      ...previous,
      containerPortRange: trimmedStart.length === 0 && trimmedEnd.length === 0
        ? ''
        : `${trimmedStart}-${trimmedEnd}`,
    }))
  }

  const save = async (): Promise<void> => {
    setSavedNote(undefined)
    const saved = await store.saveSettings(draft)
    setSavedNote(saved ? t('settings.saved') : t('error.operationFailed'))
  }

  const saveBaseUrl = async (): Promise<void> => {
    setSavedNote(undefined)
    const saved = await store.setBaseUrl(baseUrl.trim())
    setSavedNote(saved ? t('status.baseUrlSaved') : t('error.operationFailed'))
  }

  const chip = (label: string, apply: () => void): ReactNode => (
    <Pill key={label} onClick={apply}>{label}</Pill>
  )

  return (
    <SectionCard title={t('settings.title')}>
      <p className={css.intro}>{t('settings.intro')}</p>
      {store.settingsError !== undefined && (
        <ErrorNote title={store.settingsError.title} detail={store.settingsError.detail} />
      )}
      {opError !== undefined && (
        <ErrorNote title={opError.title} detail={opError.detail} output={opError.output} />
      )}
      {savedNote !== undefined && <p className={css.footerNote}>{savedNote}</p>}

      {store.serviceUp && (
        <>
          <h4 className={css.subTitle}>{t('settings.network')} <Hint text={t('settings.scopeNote')} /></h4>
          <div className={css.rowLine}>
            <span className={css.labelCol}>{t('settings.proxy')}</span>
            <Input
              className={css.grow}
              value={draft.proxy}
              onChange={event => { setDraft({ ...draft, proxy: event.target.value }) }}
            />
          </div>
          <div className={css.rowLine}>
            <span className={css.labelCol} />
            <div className={css.chipRow}>
              {chip(t('settings.clear'), () => { setDraft({ ...draft, proxy: '' }) })}
            </div>
          </div>

          <div className={css.rowLine}>
            <span className={css.labelCol}>{t('settings.githubMirror')}</span>
            <Input
              className={css.grow}
              value={draft.githubMirror}
              onChange={event => { setDraft({ ...draft, githubMirror: event.target.value }) }}
            />
          </div>
          <div className={css.rowLine}>
            <span className={css.labelCol} />
            <div className={css.chipRow}>
              {GH_PRESETS.map(preset => chip(preset.label, () => { setDraft({ ...draft, githubMirror: preset.value }) }))}
            </div>
          </div>

          <div className={css.rowLine}>
            <span className={css.labelCol}>{t('settings.npmRegistry')}</span>
            <Input
              className={css.grow}
              value={draft.npmRegistry}
              onChange={event => { setDraft({ ...draft, npmRegistry: event.target.value }) }}
            />
          </div>
          <div className={css.rowLine}>
            <span className={css.labelCol} />
            <div className={css.chipRow}>
              {NPM_PRESETS.map(preset => chip(preset.label, () => { setDraft({ ...draft, npmRegistry: preset.value }) }))}
            </div>
          </div>

          <div className={css.rowLine}>
            <span className={css.labelCol}>{t('settings.portRange')} <Hint text={t('settings.portRangeHint')} /></span>
            <Input
              className={css.rangeInput}
              value={portStart}
              inputMode="numeric"
              placeholder={t('settings.portRangeStart')}
              onChange={event => { setRange(event.target.value, portEnd) }}
            />
            <span aria-hidden="true">-</span>
            <Input
              className={css.rangeInput}
              value={portEnd}
              inputMode="numeric"
              placeholder={t('settings.portRangeEnd')}
              onChange={event => { setRange(portStart, event.target.value) }}
            />
          </div>

          <div className={css.rowLine}>
            <span className={css.labelCol}>{t('settings.autoOpen')} <Hint text={t('settings.autoOpenHint')} /></span>
            <label className={css.checkboxRow}>
              <input
                type="checkbox"
                checked={draft.autoOpenUiOnStart}
                onChange={event => { setDraft({ ...draft, autoOpenUiOnStart: event.target.checked }) }}
              />
            </label>
          </div>

          <div className={css.rowLine}>
            <span className={css.labelCol}>{t('settings.skipPrompts')} <Hint text={t('settings.skipPromptsHint')} /></span>
            <label className={css.switchLine}>
              <input
                type="checkbox"
                checked={draft.skipFirstOpenPrompts}
                onChange={event => { setDraft({ ...draft, skipFirstOpenPrompts: event.target.checked }) }}
              />
            </label>
          </div>

          <div className={css.saveRow}>
            <Button
              size="sm"
              variant="primary"
              disabled={!dirty || store.isBusy('settings')}
              onClick={() => { void save() }}
            >
              {store.isBusy('settings') ? t('settings.saving') : t('settings.save')}
            </Button>
          </div>
        </>
      )}

      <div className={css.formGrid}>
        <div className={css.formRow}>
          <span className={css.formLabel}>{t('settings.baseUrl')} <Hint text={t('settings.baseUrlNote')} /></span>
          <div className={css.baseUrlRow}>
            <Input
              className={css.grow}
              value={baseUrl}
              placeholder={t('status.baseUrlPlaceholder')}
              onChange={event => { setBaseUrlField(event.target.value) }}
            />
            <Button
              size="sm"
              variant="primary"
              disabled={store.isBusy('baseUrl') || baseUrl.trim().length === 0 || baseUrl === store.status?.baseUrl}
              onClick={() => { void saveBaseUrl() }}
            >
              {t('status.baseUrlSave')}
            </Button>
          </div>
        </div>
      </div>

      <ModelConfigGroup t={t} store={store} />
    </SectionCard>
  )
}
