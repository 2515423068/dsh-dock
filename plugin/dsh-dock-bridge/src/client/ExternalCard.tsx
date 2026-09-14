/**
 * "外部 DSH 与备份" 卡片:上半部是**只读**的外部 DSH 检测(官方 ~/.dsh、npx/全局
 * 安装、源码检出、正在运行的实例),唯一可做的动作是「复制为备份」;下半部是配置
 * 备份(自动备份开关、目录与保留份数、立即备份全部、备份列表 + 从备份新建容器 /
 * 删除)。检测只读:不改动任何外部实例,导入一律**只复制、绝不软链**。
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconRefreshOutline16, IconWarningOutline16, Input, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BackupRow, ExternalCheck } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ConfirmDialog, ErrorNote, SectionCard } from './parts.tsx'

/** 外部检测卡里一份待复制为备份的 home(勾选确认后才允许提交)。 */
interface ImportTarget {
  readonly path: string
  readonly name: string
  readonly inUse: boolean
  readonly hasCredentials: boolean
  readonly sessions: number
  readonly bytes: number
}

/** 字节数 → 与服务端恢复指南同口径的易读大小。 */
function formatBytes(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

/** 备份原因 → 本机化文案(未知原因原样显示服务端的值)。 */
function reasonLabel(t: DockT, reason: string): string {
  switch (reason) {
    case 'manual': return t('backup.reason.manual')
    case 'import': return t('backup.reason.import')
    case 'created': return t('backup.reason.created')
    case 'pre-delete': return t('backup.reason.preDelete')
    case 'pre-update': return t('backup.reason.preUpdate')
    default: return reason
  }
}

/** 备份时间戳(秒)→ 本地时间;缺失时显示占位符。 */
function formatWhen(t: DockT, createdAt: number | null): string {
  return createdAt !== null ? new Date(createdAt * 1000).toLocaleString() : t('backup.unknownTime')
}

/** 备份名 → 合法的默认容器名(容器名只允许字母/数字/./_/-,≤64 字符)。 */
function defaultContainerName(name: string): string {
  const sanitized = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return `${(sanitized.length > 0 ? sanitized : 'restored').slice(0, 56)}-restore`
}

/** 该容器 tab 的卡片主体:外部检测 + 配置备份两张卡。 */
export function ExternalCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  return (
    <>
      <ExternalDetectCard t={t} store={store} />
      <BackupCard t={t} store={store} />
    </>
  )
}

/** 外部 DSH 检测卡(只读;唯一动作 = 复制为备份)。 */
function ExternalDetectCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [importTarget, setImportTarget] = useState<ImportTarget>()
  const [acknowledged, setAcknowledged] = useState(false)
  const [importNote, setImportNote] = useState<string>()
  const [checkPath, setCheckPath] = useState('')
  const [checked, setChecked] = useState<ExternalCheck>()
  const [checkNote, setCheckNote] = useState<string>()
  const external = store.external
  const opError = store.opErrorFor(['external'])
  const homes = external?.homes ?? []
  const checkouts = external?.checkouts ?? []
  const installed = external?.installed ?? []
  const running = external?.running ?? []

  const openImport = (target: ImportTarget): void => {
    setImportNote(undefined)
    setAcknowledged(false)
    setImportTarget(target)
  }

  const submitImport = async (): Promise<void> => {
    const target = importTarget
    if (target === undefined) return
    const imported = await store.importExternal({ sourcePath: target.path, name: target.name, acknowledge: true })
    if (imported) {
      setImportTarget(undefined)
      setAcknowledged(false)
      setImportNote(t('external.imported', { name: target.name.length > 0 ? target.name : target.path }))
    } else {
      setImportNote(t('error.operationFailed'))
    }
  }

  const submitCheck = async (): Promise<void> => {
    const path = checkPath.trim()
    if (path.length === 0) return
    setCheckNote(undefined)
    const result = await store.checkExternal(path)
    setChecked(result)
    if (result === undefined) {
      setCheckNote(t('error.operationFailed'))
      return
    }
    setCheckNote(result.isHome
      ? t('external.checkHome', { sessions: String(result.home.sessions) })
      : result.isHarness
        ? t('external.checkHarness', { version: result.harness.version.length > 0 ? result.harness.version : '-' })
        : t('external.checkNone'))
  }

  return (
    <SectionCard
      title={t('external.title')}
      actions={(
        <Button
          size="sm"
          icon={<IconRefreshOutline16 size={14} />}
          onClick={() => { void store.refreshExternal() }}
        >
          {t('external.refresh')}
        </Button>
      )}
    >
      <p className={css.intro}>{t('external.intro')}</p>
      {store.externalError !== undefined && (
        <ErrorNote title={store.externalError.title} detail={store.externalError.detail} />
      )}
      {opError !== undefined && (
        <ErrorNote title={opError.title} detail={opError.detail} output={opError.output} />
      )}
      {importNote !== undefined && <p className={css.footerNote}>{importNote}</p>}
      {external !== undefined && external.canDetectUsage !== true && (
        <p className={css.warnNote}>
          <IconWarningOutline16 size={14} />
          {t('external.usageUnknown')}
        </p>
      )}

      <h4 className={css.subTitle}>{t('external.homesTitle')}</h4>
      {homes.length === 0 && <p className={css.empty}>{t('external.homesEmpty')}</p>}
      <ul className={css.rows}>
        {homes.map(home => (
          <li key={home.path} className={css.row}>
            <div className={css.rowHead}>
              <span className={css.rowTitle}><code className={css.mono}>{home.path}</code></span>
              {home.inUse && (
                <Pill>{t('external.inUse', { pid: home.pid !== null ? String(home.pid) : '-' })}</Pill>
              )}
            </div>
            <div className={css.rowMeta}>
              {t('external.homeFacts', {
                sessions: String(home.sessions),
                files: String(home.files),
                size: formatBytes(home.bytes),
              })}
              {home.hasCredentials ? ` · ${t('external.hasCredentials')}` : ''}
              {home.hasSettings ? ` · ${t('external.hasSettings')}` : ''}
            </div>
            <div className={css.rowActions}>
              <Button
                size="sm"
                onClick={() => {
                  openImport({
                    path: home.path,
                    name: home.path === external?.officialHome ? t('external.officialName') : '',
                    inUse: home.inUse,
                    hasCredentials: home.hasCredentials,
                    sessions: home.sessions,
                    bytes: home.bytes,
                  })
                }}
              >
                {t('external.copyAsBackup')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {external !== undefined && (
        <p className={css.footerNote}>{t('external.officialHomeNote', { path: external.officialHome })}</p>
      )}

      <h4 className={css.subTitle}>{t('external.versionsTitle')}</h4>
      {checkouts.length === 0 && installed.length === 0 && <p className={css.empty}>{t('external.versionsEmpty')}</p>}
      <ul className={css.rows}>
        {checkouts.map(item => (
          <li key={item.path} className={css.row}>
            <div className={css.rowHead}>
              <span className={css.rowTitle}><code className={css.mono}>{item.path}</code></span>
              <Pill>{item.prebuilt ? t('external.prebuilt') : t('external.notPrebuilt')}</Pill>
            </div>
            <div className={css.rowMeta}>
              {t('external.checkoutVersion', { version: item.version.length > 0 ? item.version : '-' })}
            </div>
          </li>
        ))}
        {installed.map(item => (
          <li key={`${item.kind}:${item.path}`} className={css.row}>
            <div className={css.rowHead}>
              <span className={css.rowTitle}><code className={css.mono}>{item.path}</code></span>
              <Pill>{t(`external.kind.${item.kind}`)}</Pill>
            </div>
            <div className={css.rowMeta}>
              {t('external.installedVersion', { version: item.version.length > 0 ? item.version : '-' })}
            </div>
          </li>
        ))}
      </ul>

      <h4 className={css.subTitle}>{t('external.runningTitle')}</h4>
      {running.length === 0 && <p className={css.empty}>{t('external.runningEmpty')}</p>}
      {running.length > 0 && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('external.pid')}</th>
              <th>{t('external.port')}</th>
              <th>{t('external.home')}</th>
            </tr>
          </thead>
          <tbody>
            {running.map(item => (
              <tr key={item.pid}>
                <td>{item.pid}</td>
                <td>{item.port !== null ? item.port : '-'}</td>
                <td>
                  <code className={css.mono}>{item.home ?? '-'}</code>
                  <div className={css.mutedCell}>{item.cmdline}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className={css.inlineForm}>
        <div className={css.inlineFormRow}>
          <span className={css.formLabel}>{t('external.checkLabel')}</span>
          <Input
            className={css.grow}
            value={checkPath}
            placeholder={t('external.checkPlaceholder')}
            onChange={event => { setCheckPath(event.target.value) }}
          />
          <Button
            size="sm"
            variant="primary"
            disabled={checkPath.trim().length === 0 || store.isBusy('externalCheck')}
            onClick={() => { void submitCheck() }}
          >
            {t('external.check')}
          </Button>
        </div>
        {checkNote !== undefined && <p className={css.footerNote}>{checkNote}</p>}
        {checked?.isHome === true && (
          <div className={css.inlineFormActions}>
            <Button
              size="sm"
              onClick={() => {
                openImport({
                  path: checked.path,
                  name: '',
                  inUse: checked.usage.inUse,
                  hasCredentials: checked.home.hasCredentials,
                  sessions: checked.home.sessions,
                  bytes: checked.home.bytes,
                })
              }}
            >
              {t('external.copyAsBackup')}
            </Button>
          </div>
        )}
      </div>

      {importTarget !== undefined && (
        <div className={css.inlineForm}>
          <div className={css.inlineFormRow}>
            <span className={css.formLabel}>{t('external.importTitle')} · <code className={css.mono}>{importTarget.path}</code></span>
          </div>
          <div className={css.rowMeta}>
            {t('external.importFacts', {
              sessions: String(importTarget.sessions),
              size: formatBytes(importTarget.bytes),
            })}
          </div>
          <ul className={css.riskList}>
            <li className={css.riskItem}>{t('external.riskCopy')}</li>
            <li className={css.riskItem}>{t('external.riskCredentials')}</li>
            <li className={css.riskItem}>{importTarget.inUse ? t('external.riskInUse') : t('external.riskStop')}</li>
            {importTarget.hasCredentials && <li className={css.riskItem}>{t('external.riskPlaintext')}</li>}
          </ul>
          <label className={css.checkboxRow}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={event => { setAcknowledged(event.target.checked) }}
            />
            <span>{t('external.acknowledge')}</span>
          </label>
          <div className={css.inlineFormActions}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setImportTarget(undefined); setAcknowledged(false) }}
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!acknowledged || store.isBusy('externalImport')}
              onClick={() => { void submitImport() }}
            >
              {store.isBusy('externalImport') ? t('external.importing') : t('external.importConfirm')}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

/** 配置备份卡:开关 / 目录 / 保留份数 + 立即备份全部 + 备份列表。 */
function BackupCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [enabled, setEnabled] = useState(false)
  const [dir, setDir] = useState('')
  const [keep, setKeep] = useState('10')
  const [note, setNote] = useState<string>()
  const [restoreFor, setRestoreFor] = useState<BackupRow>()
  const [restoreName, setRestoreName] = useState('')
  const [restoreVersion, setRestoreVersion] = useState('')
  const [deleteFor, setDeleteFor] = useState<BackupRow>()
  const opError = store.opErrorFor(['backup'])
  const items = store.backups?.items ?? []
  const installedVersions = (store.versions?.versions ?? [])
    .filter(entry => entry.installed)
    .map(entry => entry.tag)

  useEffect(() => {
    if (store.settings !== undefined) {
      setEnabled(store.settings.backupEnabled === true)
      setDir(store.settings.backupDir ?? '')
      setKeep(String(store.settings.backupKeep ?? 10))
    }
  }, [store.settings])

  const dirty = store.settings !== undefined && (
    enabled !== (store.settings.backupEnabled === true)
    || dir.trim() !== (store.settings.backupDir ?? '')
    || keep.trim() !== String(store.settings.backupKeep ?? 10))

  const saveSettings = async (): Promise<void> => {
    setNote(undefined)
    const saved = await store.saveBackupSettings({
      backupEnabled: enabled,
      backupDir: dir.trim(),
      backupKeep: Math.max(0, Number(keep) || 0),
    })
    setNote(saved ? t('settings.saved') : t('error.operationFailed'))
  }

  const backupNow = async (): Promise<void> => {
    setNote(undefined)
    const done = await store.backupNow()
    setNote(done ? t('backup.nowDone') : t('error.operationFailed'))
  }

  const openRestore = (row: BackupRow): void => {
    setNote(undefined)
    setRestoreFor(row)
    setRestoreName(defaultContainerName(row.name))
    setRestoreVersion(row.version !== null && row.version.length > 0 ? row.version : installedVersions[0] ?? '')
  }

  const submitRestore = async (): Promise<void> => {
    const row = restoreFor
    if (row === undefined) return
    const name = restoreName.trim()
    if (name.length === 0 || restoreVersion.length === 0) return
    const started = await store.restoreBackup(row.id, { name, version: restoreVersion, profile: row.profile })
    if (started) {
      setRestoreFor(undefined)
      setNote(t('backup.restoreStarted', { name }))
    } else {
      setNote(t('error.operationFailed'))
    }
  }

  return (
    <SectionCard
      title={t('backup.cardTitle')}
      actions={(
        <Button size="sm" variant="primary" disabled={store.isBusy('backupNow')} onClick={() => { void backupNow() }}>
          {store.isBusy('backupNow') ? t('backup.nowRunning') : t('backup.now')}
        </Button>
      )}
    >
      <p className={css.intro}>{t('backup.intro')}</p>
      {store.backupsError !== undefined && (
        <ErrorNote title={store.backupsError.title} detail={store.backupsError.detail} />
      )}
      {store.settingsError !== undefined && (
        <ErrorNote title={store.settingsError.title} detail={store.settingsError.detail} />
      )}
      {opError !== undefined && (
        <ErrorNote title={opError.title} detail={opError.detail} output={opError.output} />
      )}
      {note !== undefined && <p className={css.footerNote}>{note}</p>}

      <div className={css.rowLine}>
        <span className={css.labelCol}>{t('backup.enable')}</span>
        <label className={css.checkboxRow}>
          <input type="checkbox" checked={enabled} onChange={event => { setEnabled(event.target.checked) }} />
          <span>{t('backup.enableHint')}</span>
        </label>
      </div>
      <div className={css.rowLine}>
        <span className={css.labelCol}>{t('backup.dir')}</span>
        <Input
          className={css.grow}
          value={dir}
          placeholder={store.backups?.dir ?? ''}
          onChange={event => { setDir(event.target.value) }}
        />
      </div>
      <div className={css.rowLine}>
        <span className={css.labelCol}>{t('backup.keep')}</span>
        <Input
          className={css.narrow}
          value={keep}
          inputMode="numeric"
          onChange={event => { setKeep(event.target.value) }}
        />
        <span className={css.footerNote}>{t('backup.keepHint')}</span>
      </div>
      <div className={css.saveRow}>
        <Button size="sm" variant="primary" disabled={!dirty || store.isBusy('backupSettings')} onClick={() => { void saveSettings() }}>
          {store.isBusy('backupSettings') ? t('settings.saving') : t('settings.save')}
        </Button>
      </div>

      {items.length === 0 && <p className={css.empty}>{t('backup.empty')}</p>}
      {items.length > 0 && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('backup.name')}</th>
              <th>{t('backup.version')}</th>
              <th>{t('backup.sessions')}</th>
              <th>{t('backup.size')}</th>
              <th>{t('backup.createdAt')}</th>
              <th>{t('backup.reason')}</th>
              <th className={css.cellAction}>{t('backup.action')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                <td>
                  <b>{item.name}</b>
                  {item.hasCredentials && <div className={css.mutedCell}>{t('external.hasCredentials')}</div>}
                </td>
                <td>{item.version ?? '-'}</td>
                <td>{item.sessions}</td>
                <td>{formatBytes(item.bytes)}</td>
                <td>{formatWhen(t, item.createdAt)}</td>
                <td>
                  {reasonLabel(t, item.reason)}
                  {item.note.length > 0 && <div className={css.mutedCell}>{item.note}</div>}
                </td>
                <td className={css.cellAction}>
                  <Button size="sm" disabled={store.isBusy(`backupRestore:${item.id}`)} onClick={() => { openRestore(item) }}>
                    {t('backup.restore')}
                  </Button>
                  <Button size="sm" disabled={store.isBusy(`backupDelete:${item.id}`)} onClick={() => { setDeleteFor(item) }}>
                    {t('backup.delete')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {restoreFor !== undefined && (
        <div className={css.inlineForm}>
          <div className={css.inlineFormRow}>
            <span className={css.formLabel}>{t('backup.restore')} · {restoreFor.name}</span>
            <Input
              className={css.grow}
              value={restoreName}
              placeholder={t('containers.namePlaceholder')}
              onChange={event => { setRestoreName(event.target.value) }}
            />
            <select className={css.narrow} value={restoreVersion} onChange={event => { setRestoreVersion(event.target.value) }}>
              <option value="">{t('containers.versionLabel')}</option>
              {installedVersions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={restoreName.trim().length === 0 || restoreVersion.length === 0 || store.isBusy(`backupRestore:${restoreFor.id}`)}
              onClick={() => { void submitRestore() }}
            >
              {t('containers.confirm')}
            </Button>
            <Button size="sm" variant="outline" aria-label={t('cancel')} onClick={() => { setRestoreFor(undefined) }}>×</Button>
          </div>
          <p className={css.footerNote}>{t('backup.restoreHint')}</p>
        </div>
      )}

      <ConfirmDialog
        open={deleteFor !== undefined}
        title={deleteFor !== undefined ? `${t('backup.delete')} · ${deleteFor.name}` : ''}
        body={deleteFor !== undefined ? t('backup.deleteConfirm', { name: deleteFor.name }) : ''}
        confirmLabel={t('backup.delete')}
        cancelLabel={t('cancel')}
        danger
        busy={deleteFor !== undefined && store.isBusy(`backupDelete:${deleteFor.id}`)}
        onConfirm={() => {
          const row = deleteFor
          setDeleteFor(undefined)
          if (row !== undefined) void store.deleteBackup(row.id)
        }}
        onClose={() => { setDeleteFor(undefined) }}
      />
    </SectionCard>
  )
}
