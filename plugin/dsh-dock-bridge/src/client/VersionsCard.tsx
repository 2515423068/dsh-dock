/**
 * Versions card: the catalog as rows (tag + installed/remote-only state),
 * install with inline progress, delete with confirmation, and catalog
 * refresh. Feeds the containers card's version selects through the store.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button, IconDownloadOutline16, IconRefreshOutline16, IconTrashOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ConfirmDialog, ErrorNote, SectionCard, TaskInline } from './parts.tsx'

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
      <ul className={css.rows}>
        {rows.map(row => {
          const installing = store.pending('version-install', row.tag)
          const task = store.taskFor('version-install', row.tag)
          return (
            <li key={row.tag} className={css.row}>
              <div className={css.rowMain}>
                <span className={css.rowTitle}>{row.tag}</span>
                <span className={css.rowMeta}>{row.installed ? t('versions.installed') : t('versions.remote')}</span>
              </div>
              <div className={css.rowActions}>
                {!row.installed && (
                  <Button
                    size="sm"
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
              </div>
              {task !== undefined && (
                <TaskInline task={task} runningLabel={t('versions.installing')} failedLabel={t('task.failed')} />
              )}
            </li>
          )
        })}
      </ul>

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
