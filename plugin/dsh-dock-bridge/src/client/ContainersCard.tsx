/**
 * Containers card: the roster with status dots, self badge, and inline
 * actions; the new-container inline form; per-row task progress; and the
 * destructive confirmations (delete always, and the self-container strong
 * path for stop/update/delete with an acknowledge step).
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconEllipsisOutline16, IconPlayOutline16, IconPlusOutline16, IconRightUpOutline16, IconStopFill16, Input, Menu,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContainerRow, DockTask } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ConfirmDialog, ErrorNote, SectionCard, StatusDotFor, TaskInline } from './parts.tsx'

/** One pending destructive action awaiting confirmation. */
type ConfirmAction =
  | { readonly kind: 'delete'; readonly row: ContainerRow }
  | { readonly kind: 'stop'; readonly row: ContainerRow }
  | { readonly kind: 'update'; readonly row: ContainerRow; readonly version: string }

/** Newest running (else failed) task across a row's kinds. */
function rowTask(store: DockStore, row: ContainerRow): DockTask | undefined {
  const candidates = [
    store.taskFor('container-create', row.id),
    store.taskFor('container-start', row.id),
    store.taskFor('container-update', row.id),
  ]
  return candidates.find(entry => entry?.status === 'running') ?? candidates.find(entry => entry?.status === 'failed')
}

/** The containers card body; rendered only when the service side is usable. */
export function ContainersCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [creating, setCreating] = useState(false)
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>()
  const [portFor, setPortFor] = useState<ContainerRow>()
  const [portValue, setPortValue] = useState('')
  const [portNote, setPortNote] = useState<string>()
  const [menuFor, setMenuFor] = useState<string>()
  const [updateFor, setUpdateFor] = useState<ContainerRow>()
  const [updateVersion, setUpdateVersion] = useState('')

  const installedVersions = (store.versions?.versions ?? [])
    .filter(entry => entry.installed)
    .map(entry => entry.tag)
  const opError = store.opErrorFor(['create', 'start:', 'stop:', 'update:', 'delete:', 'port:', 'protect:'])

  const submitCreate = async (input: { name: string; version: string; profile: string }): Promise<void> => {
    try {
      await store.createContainer(input)
      setCreating(false)
    } catch {
      // The op error note renders the failure; the form stays open to fix.
    }
  }

  const submitPort = async (): Promise<void> => {
    if (portFor === undefined) return
    const saved = await store.setPort(portFor.id, Number(portValue))
    if (saved) {
      setPortFor(undefined)
      setPortValue('')
    } else {
      setPortNote(t('error.operationFailed'))
    }
  }

  const confirmTitle = confirmAction === undefined
    ? ''
    : confirmAction.kind === 'update'
      ? `${t('containers.update')} · ${confirmAction.row.name}`
      : `${t('containers.delete')} · ${confirmAction.row.name}`
  const confirmBody = confirmAction === undefined
    ? ''
    : confirmAction.kind === 'update'
      ? `${confirmAction.row.name} → ${confirmAction.version}`
      : t('containers.deleteConfirm', { name: confirmAction.row.name })
  const selfDanger = confirmAction !== undefined && confirmAction.row.self

  return (
    <SectionCard
      title={t('containers.title')}
      actions={(
        <Button size="sm" icon={<IconPlusOutline16 size={14} />} onClick={() => { setCreating(value => !value) }}>
          {t('containers.new')}
        </Button>
      )}
    >
      {creating && (
        <CreateForm
          t={t}
          versions={installedVersions}
          busy={store.isBusy('create')}
          onSubmit={input => { void submitCreate(input) }}
          onCancel={() => { setCreating(false) }}
        />
      )}
      {store.containersError !== undefined && (
        <ErrorNote title={store.containersError.title} detail={store.containersError.detail} />
      )}
      {opError !== undefined && (
        <ErrorNote title={opError.title} detail={opError.detail} output={opError.output} />
      )}
      {store.containers.length === 0 && <p className={css.empty}>{t('containers.empty')}</p>}
      <ul className={css.rows}>
        {store.containers.map(row => {
          const task = rowTask(store, row)
          const rowBusy = store.pending('container-create', row.id)
            || store.pending('container-start', row.id)
            || store.pending('container-update', row.id)
            || store.isBusy(`stop:${row.id}`) || store.isBusy(`delete:${row.id}`)
          const stoppable = row.status === 'running' || row.status === 'starting'
          const startable = row.status === 'stopped' || row.status === 'failed'
          return (
            <li key={row.id} className={css.row}>
              <div className={css.rowMain}>
                <StatusDotFor status={row.status} />
                <span className={css.rowTitle}>{row.name}</span>
                {row.self && <span className={css.selfBadge}>{t('containers.self')}</span>}
                <span className={css.rowMeta}>
                  {row.version ?? ''}
                  {row.profile !== undefined && ` · ${row.profile}`}
                  {row.port !== undefined && ` · ${String(row.port)}`}
                </span>
                <span className={css.statusLabel}>{t(`containers.status.${row.status}`)}</span>
              </div>
              <div className={css.rowActions}>
                {row.url !== undefined && (
                  <a className={css.link} href={row.url} target="_blank" rel="noreferrer">
                    {t('containers.open')} <IconRightUpOutline16 size={12} />
                  </a>
                )}
                {startable && (
                  <Button size="sm" icon={<IconPlayOutline16 size={14} />} disabled={rowBusy} onClick={() => { void store.startContainer(row.id).catch(() => {}) }}>
                    {t('containers.start')}
                  </Button>
                )}
                {stoppable && (
                  <Button
                    size="sm"
                    icon={<IconStopFill16 size={14} />}
                    disabled={rowBusy}
                    onClick={() => { if (row.self) setConfirmAction({ kind: 'stop', row }); else void store.stopContainer(row.id).catch(() => {}) }}
                  >
                    {t('containers.stop')}
                  </Button>
                )}
                <Menu
                  open={menuFor === row.id}
                  anchor={(
                    <Button size="sm" aria-label={t('more')} onClick={() => { setMenuFor(value => value === row.id ? undefined : row.id) }}>
                      <IconEllipsisOutline16 size={14} />
                    </Button>
                  )}
                  items={[
                    { id: 'update', label: t('containers.update') },
                    { id: 'port', label: t('containers.port') },
                    { id: 'protect', label: row.devProtect === true ? t('containers.protectOn') : t('containers.protectOff') },
                    { id: 'delete', label: t('containers.delete'), danger: true },
                  ]}
                  onSelect={(id) => {
                    setMenuFor(undefined)
                    if (id === 'update') {
                      setUpdateFor(row)
                      setUpdateVersion('')
                    } else if (id === 'port') {
                      setPortFor(row)
                      setPortValue(row.port !== undefined ? String(row.port) : '')
                      setPortNote(undefined)
                    } else if (id === 'protect') {
                      void store.setProtect(row.id, row.devProtect !== true)
                    } else if (id === 'delete') {
                      setConfirmAction({ kind: 'delete', row })
                    }
                  }}
                  onClose={() => { setMenuFor(undefined) }}
                  align="end"
                  compact
                />
              </div>
              {task !== undefined && (
                <TaskInline
                  task={task}
                  runningLabel={store.pending('container-create', row.id)
                    ? t('containers.creating')
                    : store.pending('container-start', row.id) ? t('containers.starting') : t('containers.updating')}
                  failedLabel={t('containers.taskFailed')}
                />
              )}
            </li>
          )
        })}
      </ul>

      {portFor !== undefined && (
        <div className={css.inlineForm}>
          <div className={css.inlineFormRow}>
            <span className={css.formLabel}>{t('containers.port')} · {portFor.name}</span>
            <Input
              className={css.narrow}
              value={portValue}
              placeholder={t('containers.portPlaceholder')}
              onChange={event => { setPortValue(event.target.value) }}
            />
            <Button size="sm" variant="primary" disabled={store.isBusy(`port:${portFor.id}`)} onClick={() => { void submitPort() }}>
              {t('containers.confirm')}
            </Button>
            <Button size="sm" variant="outline" aria-label={t('cancel')} onClick={() => { setPortFor(undefined); setPortNote(undefined) }}>×</Button>
          </div>
          {portNote !== undefined && <p className={css.footerNote}>{portNote}</p>}
        </div>
      )}

      {updateFor !== undefined && (
        <div className={css.inlineForm}>
          <div className={css.inlineFormRow}>
            <span className={css.formLabel}>{t('containers.update')} · {updateFor.name}</span>
            <select className={css.narrow} value={updateVersion} onChange={event => { setUpdateVersion(event.target.value) }}>
              <option value="">—</option>
              {installedVersions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={updateVersion.length === 0 || store.isBusy(`update:${updateFor.id}`)}
              onClick={() => {
                const target = updateFor
                const version = updateVersion
                setUpdateFor(undefined)
                if (target.self) setConfirmAction({ kind: 'update', row: target, version })
                else void store.updateContainer(target.id, version).catch(() => {})
              }}
            >
              {t('containers.confirm')}
            </Button>
            <Button size="sm" variant="outline" aria-label={t('cancel')} onClick={() => { setUpdateFor(undefined) }}>×</Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmAction !== undefined}
        title={confirmTitle}
        body={confirmBody}
        confirmLabel={confirmAction?.kind === 'stop' ? t('containers.stop') : confirmAction?.kind === 'update' ? t('containers.confirm') : t('containers.delete')}
        cancelLabel={t('cancel')}
        danger
        acknowledgeLabel={selfDanger ? t('containers.selfAcknowledge') : undefined}
        busy={confirmAction !== undefined && store.isBusy(`${confirmAction.kind}:${confirmAction.row.id}`)}
        onConfirm={() => {
          const action = confirmAction
          setConfirmAction(undefined)
          if (action === undefined) return
          if (action.kind === 'stop') void store.stopContainer(action.row.id, true).catch(() => {})
          else if (action.kind === 'update') void store.updateContainer(action.row.id, action.version, true).catch(() => {})
          else void store.deleteContainer(action.row.id, action.row.self).catch(() => {})
        }}
        onClose={() => { setConfirmAction(undefined) }}
      />
    </SectionCard>
  )
}

/** New-container inline form: name, version select (fed by the versions card), profile select. */
function CreateForm({ t, versions, busy, onSubmit, onCancel }: {
  t: DockT
  versions: readonly string[]
  busy: boolean
  onSubmit: (input: { name: string; version: string; profile: string }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [profile, setProfile] = useState('web')
  const valid = name.trim().length > 0 && version.length > 0
  return (
    <div className={css.inlineForm}>
      <div className={css.inlineFormRow}>
        <Input className={css.grow} value={name} placeholder={t('containers.namePlaceholder')} onChange={event => { setName(event.target.value) }} />
        <select className={css.narrow} value={version} onChange={event => { setVersion(event.target.value) }}>
          <option value="">{t('containers.versionLabel')}</option>
          {versions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
        </select>
        <select className={css.narrow} value={profile} onChange={event => { setProfile(event.target.value) }}>
          <option value="web">web</option>
          <option value="headless">headless</option>
        </select>
      </div>
      <div className={css.inlineFormActions}>
        <Button size="sm" variant="outline" aria-label={t('cancel')} onClick={onCancel}>×</Button>
        <Button size="sm" variant="primary" disabled={!valid || busy} onClick={() => { onSubmit({ name: name.trim(), version, profile }) }}>
          {busy ? t('containers.creating') : t('containers.create')}
        </Button>
      </div>
    </div>
  )
}
