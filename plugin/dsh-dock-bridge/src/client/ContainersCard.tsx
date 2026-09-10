/**
 * Containers card: one WebUI-shaped card per container (head with name and
 * status pill; meta with the inline version select, port chip, profile and
 * creation time; log path; url; flat actions plus the protect checkbox),
 * the new-container inline form, per-row task progress, and the destructive
 * confirmations (delete always, and the self-container strong path for
 * stop/update/delete with an acknowledge step).
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconPlayOutline16, IconPlusOutline16, IconStopFill16, Input, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContainerRow, DockTask } from './api.ts'
import type { DockT } from './locales.ts'
import { markProtectChoice } from './use-dock.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ConfirmDialog, ErrorNote, SectionCard, TaskInline } from './parts.tsx'

/** One pending destructive action awaiting confirmation. */
type ConfirmAction =
  | { readonly kind: 'delete'; readonly row: ContainerRow }
  | { readonly kind: 'stop'; readonly row: ContainerRow }
  | { readonly kind: 'update'; readonly row: ContainerRow; readonly version: string }
  | { readonly kind: 'port'; readonly row: ContainerRow; readonly port: number }

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
    const port = Number(portValue)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setPortNote(t('containers.portPlaceholder'))
      return
    }
    // Retargeting the self container's port takes effect on next start and
    // invalidates the current bookmarked address: confirm it explicitly.
    if (portFor.self) {
      setConfirmAction({ kind: 'port', row: portFor, port })
      return
    }
    const saved = await store.setPort(portFor.id, port)
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
      : confirmAction.kind === 'port'
        ? `${t('containers.port')} · ${confirmAction.row.name}`
        : confirmAction.kind === 'stop'
          ? `${t('containers.stop')} · ${confirmAction.row.name}`
          : `${t('containers.delete')} · ${confirmAction.row.name}`
  const confirmBody = confirmAction === undefined
    ? ''
    : confirmAction.kind === 'update'
      ? `${confirmAction.row.name} → ${confirmAction.version}`
      : confirmAction.kind === 'port'
        ? t('containers.portSelfConfirm', { name: confirmAction.row.name, port: String(confirmAction.port) })
        : confirmAction.kind === 'stop' && confirmAction.row.self
          ? t('containers.selfDanger')
          : t('containers.deleteConfirm', { name: confirmAction.row.name })
  const selfDanger = confirmAction !== undefined
    && confirmAction.kind !== 'port'
    && confirmAction.row.self

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
        {[...store.containers].sort((a, b) => Number(b.self) - Number(a.self)).map(row => {
          const task = rowTask(store, row)
          const rowBusy = store.pending('container-create', row.id)
            || store.pending('container-start', row.id)
            || store.pending('container-update', row.id)
            || store.isBusy(`stop:${row.id}`) || store.isBusy(`delete:${row.id}`)
          const creatingOrUpdating = store.pending('container-create', row.id)
            || store.pending('container-update', row.id)
          return (
            <li key={row.id} className={css.row}>
              <div className={css.rowHead}>
                <span className={css.rowTitle}>{row.name}{row.devProtect === true ? ' 🛡' : ''}</span>
                {row.self && <span className={css.selfBadge}>{t('containers.self')}</span>}
                <span className={css.statusLabel} data-status={row.status}>{t(`containers.status.${row.status}`)}</span>
              </div>
              <div className={css.rowMeta}>
                <select
                  className={css.verSelect}
                  value={row.version ?? ''}
                  disabled={rowBusy}
                  aria-label={t('containers.versionLabel')}
                  onChange={event => {
                    const next = event.target.value
                    if (next.length === 0 || next === row.version) return
                    setUpdateFor(row)
                    setUpdateVersion(next)
                  }}
                >
                  {row.version === undefined && <option value="">—</option>}
                  {[...new Set([...installedVersions, ...(row.version === undefined ? [] : [row.version])])].map(tag => (
                    <option key={tag} value={tag}>{tag}</option>
                  ))}
                </select>
                {' · '}
                <Pill
                  onClick={() => {
                    setPortFor(row)
                    setPortValue(row.port !== undefined ? String(row.port) : '')
                    setPortNote(undefined)
                  }}
                >
                  {row.port !== undefined ? t('containers.portChip', { port: String(row.port) }) : t('containers.portUnset')}
                </Pill>
                {` · profile ${row.profile ?? ''} · ${t('containers.createdAt', { time: row.createdAt !== undefined ? new Date(row.createdAt * 1000).toLocaleString() : '-' })}`}
              </div>
              <div className={css.logPath}>{t('containers.logPath')} {row.logPath ?? `DSHDock_Data/containers/${row.id}/logs/host.log`}</div>
              {row.url !== undefined && (
                <div className={css.rowUrl}>
                  <a className={css.link} href={row.url} target="_blank" rel="noreferrer">
                    {row.url}
                  </a>
                </div>
              )}
              <div className={css.rowActions}>
                {creatingOrUpdating
                  ? (
                    <Button size="sm" disabled>
                      {store.pending('container-create', row.id) ? t('containers.creating') : t('containers.updating')}
                    </Button>
                    )
                  : row.status === 'running'
                    ? (
                      <>
                        {row.url !== undefined && (
                          <Button size="sm" variant="primary" onClick={() => { window.open(row.url, '_blank', 'noopener,noreferrer') }}>
                            {t('containers.open')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          icon={<IconStopFill16 size={14} />}
                          disabled={store.isBusy(`stop:${row.id}`)}
                          onClick={() => { if (row.self) setConfirmAction({ kind: 'stop', row }); else void store.stopContainer(row.id).catch(() => {}) }}
                        >
                          {t('containers.stop')}
                        </Button>
                      </>
                      )
                    : row.status === 'starting'
                      ? <Button size="sm" disabled>{t('containers.starting')}</Button>
                      : (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<IconPlayOutline16 size={14} />}
                          disabled={store.isBusy(`start:${row.id}`)}
                          onClick={() => { void store.startContainer(row.id).catch(() => {}) }}
                        >
                          {t('containers.start')}
                        </Button>
                        )}
                <Button
                  size="sm"
                  disabled={store.isBusy(`delete:${row.id}`)}
                  onClick={() => { setConfirmAction({ kind: 'delete', row }) }}
                >
                  {t('containers.delete')}
                </Button>
                <label className={css.checkboxRow} title={t('containers.protectHint')}>
                  <input
                    type="checkbox"
                    checked={row.devProtect === true}
                    disabled={store.isBusy(`protect:${row.id}`)}
                    onChange={() => {
                      if (row.self) markProtectChoice(row.id)
                      void store.setProtect(row.id, row.devProtect !== true)
                    }}
                  />
                  <span>{t('containers.protect')}</span>
                </label>
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
        confirmLabel={confirmAction?.kind === 'stop' ? t('containers.stop') : confirmAction?.kind === 'delete' ? t('containers.delete') : t('containers.confirm')}
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
          else if (action.kind === 'port') {
            const target = action.row
            const port = action.port
            void (async () => {
              const saved = await store.setPort(target.id, port)
              if (saved) {
                setPortFor(undefined)
                setPortValue('')
                setPortNote(undefined)
              } else {
                setPortNote(t('error.operationFailed'))
              }
            })()
          }
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
