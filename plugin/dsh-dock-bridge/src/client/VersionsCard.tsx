/**
 * Versions card: the catalog as a WebUI-shaped table (version / status /
 * actions), install with inline progress under the status label, delete with
 * confirmation, and catalog refresh. Feeds the containers card's version
 * selects through the store.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconDownloadOutline16, IconRefreshOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ConfirmDialog, ErrorNote, SectionCard } from './parts.tsx'

/** The versions card body; rendered only when the service side is usable. */
export function VersionsCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [confirmTag, setConfirmTag] = useState<string>()

  const rows = store.versions?.versions ?? []
  const opError = store.opErrorFor(['install:', 'versionDelete:'])
  const cachedAt = store.versions?.fetchedAt !== undefined
    ? t('versions.cachedAt', { time: new Date(store.versions.fetchedAt * 1000).toLocaleString() })
    : undefined

  return (
    <SectionCard
      title={t('versions.title')}
      actions={(
        <Button
          size="sm"
          icon={<IconRefreshOutline16 size={14} className={store.isBusy('versionsRefresh') ? css.spin : undefined} />}
          disabled={store.isBusy('versionsRefresh')}
          onClick={() => { void store.refreshVersions(true).catch(() => {}) }}
        >
          {store.isBusy('versionsRefresh') ? t('versions.refreshing') : t('versions.refresh')}
        </Button>
      )}
    >
      {store.versionsError !== undefined && (
        <ErrorNote title={store.versionsError.title} detail={store.versionsError.detail} />
      )}
      {store.versions?.warning !== undefined && <ErrorNote title={store.versions.warning} />}
      {opError !== undefined && (
        <ErrorNote title={opError.title} detail={opError.detail} output={opError.output} />
      )}
      {rows.length === 0 && <p className={css.empty}>{t('versions.empty')}</p>}
      {cachedAt !== undefined && rows.length > 0 && <p className={css.footerNote}>{cachedAt}</p>}
      {rows.length > 0 && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('versions.version')}</th>
              <th>{t('versions.state')}</th>
              <th className={css.cellRight}>{t('versions.action')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => {
              const installing = store.pending('version-install', row.tag)
              const task = store.taskFor('version-install', row.tag)
              const lastLine = task?.lines !== undefined && task.lines.length > 0
                ? task.lines[task.lines.length - 1]
                : undefined
              return (
                <tr key={row.tag}>
                  <td><b>{row.tag}</b></td>
                  <td>
                    <span className={css.statusLabel} data-status={row.installed ? 'running' : 'stopped'}>
                      {row.installed ? t('versions.installed') : t('versions.remote')}
                    </span>
                    {/* 安装动态并入状态列(原「动态」列已删除) */}
                    {row.remote
                      ? (lastLine !== undefined && <div className={css.mutedCell}>{lastLine}</div>)
                      : <div className={css.mutedCell}>{t('versions.remoteExtra')}</div>}
                  </td>
                  <td className={css.cellRight}>
                    {!row.installed && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<IconDownloadOutline16 size={14} />}
                        disabled={installing}
                        onClick={() => { void store.installVersion(row.tag).catch(() => {}) }}
                      >
                        {installing ? t('versions.installing') : t('versions.install')}
                      </Button>
                    )}
                    {row.installed && (
                      <Button
                        size="sm"
                        icon={<IconTrashOutline16 size={14} />}
                        disabled={store.isBusy(`versionDelete:${row.tag}`)}
                        onClick={() => { setConfirmTag(row.tag) }}
                      >
                        {t('versions.delete')}
                      </Button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <ConfirmDialog
        open={confirmTag !== undefined}
        title={confirmTag !== undefined ? `${t('versions.delete')} · ${confirmTag}` : ''}
        body={confirmTag !== undefined ? t('versions.confirmDelete', { tag: confirmTag }) : ''}
        confirmLabel={t('versions.delete')}
        cancelLabel={t('cancel')}
        danger
        busy={confirmTag !== undefined && store.isBusy(`versionDelete:${confirmTag}`)}
        onConfirm={() => {
          const tag = confirmTag
          setConfirmTag(undefined)
          if (tag !== undefined) void store.deleteVersion(tag).catch(() => {})
        }}
        onClose={() => { setConfirmTag(undefined) }}
      />
    </SectionCard>
  )
}
