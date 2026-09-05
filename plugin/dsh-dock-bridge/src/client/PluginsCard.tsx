/**
 * Plugins card: the profile's extension plugins — view (name/version/source/
 * state), local-directory install, enable/disable (hot on web profiles),
 * uninstall. The bridge itself is marked built-in with no actions. Works
 * without the DSH Dock service.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconPlusOutline16, IconTrashOutline16, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginRow } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ConfirmDialog, ErrorNote, SectionCard } from './parts.tsx'

/** Source label key for one row's dependency spec kind. */
function sourceLabel(t: DockT, row: PluginRow): string {
  if (row.kind === 'file') return t('plugins.source.file')
  if (row.kind === 'link') return t('plugins.source.link')
  if (row.kind === 'registry') return t('plugins.source.registry')
  return t('plugins.notInstalled')
}

/** The plugins card body; always rendered (independent of service state). */
export function PluginsCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [installing, setInstalling] = useState(false)
  const [spec, setSpec] = useState('')
  const [confirmName, setConfirmName] = useState<string>()
  const [notice, setNotice] = useState<{ title: string; detail?: string; output?: readonly string[] }>()

  const rows = store.plugins?.plugins ?? []

  const submitInstall = async (): Promise<void> => {
    setInstalling(true)
    setNotice(undefined)
    try {
      const answer = await store.installPlugin(spec.trim())
      if (answer.ok) {
        setSpec('')
        setInstalling(false)
        if (answer.hint !== undefined) setNotice({ title: answer.hint })
      } else {
        setNotice({ title: answer.error ?? t('error.operationFailed'), detail: answer.hint, output: answer.output })
      }
    } finally {
      setInstalling(false)
    }
  }

  const toggle = async (row: PluginRow): Promise<void> => {
    setNotice(undefined)
    const answer = await store.setPluginEnabled(row.name, !row.active)
    if (!answer.ok) setNotice({ title: answer.error ?? t('error.operationFailed'), detail: answer.hint })
  }

  const submitUninstall = async (name: string): Promise<void> => {
    setNotice(undefined)
    const answer = await store.uninstallPlugin(name)
    if (!answer.ok) setNotice({ title: answer.error ?? t('error.operationFailed'), detail: answer.hint, output: answer.output })
  }

  return (
    <SectionCard
      title={t('plugins.title')}
      actions={(
        <Button size="sm" icon={<IconPlusOutline16 size={14} />} onClick={() => { setInstalling(value => !value); setNotice(undefined) }}>
          {t('plugins.install')}
        </Button>
      )}
    >
      <p className={css.intro}>{t('plugins.intro')}</p>
      {installing && (
        <div className={css.inlineForm}>
          <div className={css.inlineFormRow}>
            <Input
              className={css.grow}
              value={spec}
              placeholder={t('plugins.pathPlaceholder')}
              onChange={event => { setSpec(event.target.value) }}
            />
            <Button size="sm" variant="primary" disabled={spec.trim().length === 0 || store.isBusy('pluginInstall')} onClick={() => { void submitInstall() }}>
              {store.isBusy('pluginInstall') ? t('plugins.installing') : t('plugins.install')}
            </Button>
            <Button size="sm" variant="outline" aria-label={t('cancel')} onClick={() => { setInstalling(false); setNotice(undefined) }}>×</Button>
          </div>
        </div>
      )}
      {store.pluginsError !== undefined && (
        <ErrorNote title={store.pluginsError.title} detail={store.pluginsError.detail} />
      )}
      {notice !== undefined && <ErrorNote title={notice.title} detail={notice.detail} output={notice.output} />}
      {store.plugins?.recognized === false && <ErrorNote title={t('plugins.patchUnrecognized')} />}
      {rows.length === 0 && <p className={css.empty}>{t('plugins.empty')}</p>}
      <ul className={css.rows}>
        {rows.map(row => {
          const busy = store.isBusy(`pluginOp:${row.name}`)
          return (
            <li key={row.name} className={css.row}>
              <div className={css.rowMain}>
                <span className={css.rowTitle}>{row.name}</span>
                {row.self && <span className={css.builtinBadge}>{t('plugins.builtin')}</span>}
                <span className={css.rowMeta}>
                  {row.version ?? t('plugins.versionUnknown')}
                  {` · ${sourceLabel(t, row)}`}
                  {` · ${row.active ? t('plugins.activeState') : row.disabled ? t('plugins.disabledState') : t('plugins.inactive')}`}
                </span>
              </div>
              {!row.self && (
                <div className={css.rowActions}>
                  <Button size="sm" disabled={busy || !row.installed && !row.disabled} onClick={() => { void toggle(row) }}>
                    {row.active ? t('plugins.disable') : t('plugins.enable')}
                  </Button>
                  <Button
                    size="sm"
                    icon={<IconTrashOutline16 size={14} />}
                    disabled={busy || !row.installed}
                    onClick={() => { setConfirmName(row.name) }}
                  >
                    {t('plugins.uninstall')}
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <ConfirmDialog
        open={confirmName !== undefined}
        title={confirmName !== undefined ? `${t('plugins.uninstall')} · ${confirmName}` : ''}
        body={confirmName !== undefined ? t('plugins.uninstallConfirm', { name: confirmName }) : ''}
        confirmLabel={t('plugins.uninstall')}
        cancelLabel={t('cancel')}
        danger
        onConfirm={() => {
          const name = confirmName
          setConfirmName(undefined)
          if (name !== undefined) void submitUninstall(name)
        }}
        onClose={() => { setConfirmName(undefined) }}
      />
    </SectionCard>
  )
}
