/**
 * Settings card: DSH Dock service settings (network, port pool, auto-open)
 * plus the bridge's own service address (baseUrl). When the service is
 * unreachable the DSH-Dock fields degrade into the guide; the baseUrl field
 * stays usable because it lives in the plugin's activation row.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockSettings } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ErrorNote, SectionCard } from './parts.tsx'

const EMPTY: DockSettings = {
  proxy: '',
  githubMirror: '',
  npmRegistry: '',
  containerPortRange: '',
  autoOpenUiOnStart: true,
}

/** The settings card body. */
export function SettingsCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [draft, setDraft] = useState<DockSettings>(EMPTY)
  const [baseUrl, setBaseUrlField] = useState('')
  const [savedNote, setSavedNote] = useState<string>()
  const opError = store.opErrorFor(['settings', 'baseUrl'])

  useEffect(() => {
    if (store.settings !== undefined) setDraft(store.settings)
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

  const field = (key: 'proxy' | 'githubMirror' | 'npmRegistry' | 'containerPortRange', label: string): ReactNode => (
    <div className={css.formRow}>
      <span className={css.formLabel}>{label}</span>
      <Input value={draft[key]} onChange={event => { setDraft({ ...draft, [key]: event.target.value }) }} />
    </div>
  )

  return (
    <SectionCard
      title={t('settings.title')}
      actions={store.serviceUp && (dirty || savedNote !== undefined)
        ? (
          <Button size="sm" variant="primary" disabled={store.isBusy('settings')} onClick={() => { void save() }}>
            {store.isBusy('settings') ? t('settings.saving') : t('settings.save')}
          </Button>
        )
        : undefined}
    >
      <p className={css.intro}>{t('settings.intro')}</p>
      {store.settingsError !== undefined && (
        <ErrorNote title={store.settingsError.title} detail={store.settingsError.detail} />
      )}
      {opError !== undefined && (
        <ErrorNote title={opError.title} detail={opError.detail} output={opError.output} />
      )}
      {savedNote !== undefined && <p className={css.footerNote}>{savedNote}</p>}

      {store.serviceUp && (
        <div className={css.formGrid}>
          {field('proxy', t('settings.proxy'))}
          {field('githubMirror', t('settings.githubMirror'))}
          {field('npmRegistry', t('settings.npmRegistry'))}
          {field('containerPortRange', t('settings.portRange'))}
          <div className={css.formRow}>
            <span className={css.formLabel}>{t('settings.autoOpen')}</span>
            <label className={css.checkboxRow}>
              <input
                type="checkbox"
                checked={draft.autoOpenUiOnStart}
                onChange={event => { setDraft({ ...draft, autoOpenUiOnStart: event.target.checked }) }}
              />
            </label>
          </div>
        </div>
      )}

      <div className={css.formGrid}>
        <div className={css.formRow}>
          <span className={css.formLabel}>{t('settings.baseUrl')}</span>
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
          <p className={css.formHint}>{t('settings.baseUrlNote')}</p>
        </div>
      </div>
    </SectionCard>
  )
}
