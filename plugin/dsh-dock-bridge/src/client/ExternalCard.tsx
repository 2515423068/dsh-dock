/**
 * "外部 DSH 与配置" 卡片:上半部是**只读**的外部 DSH 检测(官方 ~/.dsh、npx/全局
 * 安装、源码检出、正在运行的实例),唯一可做的动作是「保存为配置」;下半部是配置
 * (自动保存开关、目录[可调用宿主机文件夹选择器]、保存配置 → 生成自包含配置文件、
 * 配置文件列表 + 从配置创建容器 / 删除)。检测只读:不改动任何外部实例,保存一律
 * **只复制、绝不软链**。
 */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Button, IconRefreshOutline16, IconWarningOutline16, Input, Pill,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConfigInspectItem, ConfigRow, ExternalCheck } from './api.ts'
import type { DockT } from './locales.ts'
import type { DockStore } from './use-dock.ts'
import css from './DockSection.module.css'
import { ConfirmDialog, ErrorNote, SectionCard } from './parts.tsx'

/** 外部检测卡里一份待保存为配置的 home(勾选确认后才允许提交)。 */
interface SaveTarget {
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

/** 配置原因 → 本机化文案(未知原因原样显示服务端的值)。 */
function reasonLabel(t: DockT, reason: string | undefined): string {
  switch (reason) {
    case 'manual': return t('config.reason.manual')
    case 'import': return t('config.reason.import')
    case 'created': return t('config.reason.created')
    case 'pre-delete': return t('config.reason.preDelete')
    case 'pre-update': return t('config.reason.preUpdate')
    case undefined: return '-'
    default: return reason
  }
}

/** 来源:优先显示打包时的原始 DSH_HOME,缺失时退回来源容器 id。 */
function sourceLabel(item: ConfigRow): string {
  const source = item.source
  if (source !== undefined && source !== null && source.length > 0) return source
  const containerId = item.containerId
  if (containerId !== undefined && containerId !== null && containerId.length > 0) return containerId
  return '-'
}

/** 配置时间戳(秒)→ 本地时间;缺失时显示占位符。 */
function formatWhen(t: DockT, createdAt: number | null | undefined): string {
  return createdAt !== undefined && createdAt !== null
    ? new Date(createdAt * 1000).toLocaleString()
    : t('config.unknownTime')
}

/** 配置名 → 合法的默认容器名(容器名只允许字母/数字/./_/-,≤64 字符)。 */
function defaultContainerName(name: string): string {
  const sanitized = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return `${(sanitized.length > 0 ? sanitized : 'restored').slice(0, 56)}-new`
}

/**
 * 待恢复的配置目标:配置目录里的文件名(`file`)或磁盘上任意位置的路径
 * (`path`),二选一,原样交给 `/api/configs/restore`。
 */
interface RestoreTarget {
  readonly file?: string
  readonly path?: string
  /** 表单标题里显示的目标(列表行用配置名,系统对话框选的带原始文件名)。 */
  readonly label: string
  readonly profile?: string
}

/** 恢复目标的 busy key 后缀:file / path 二选一,缺失时用空串兜底。 */
function restoreKey(target: RestoreTarget | undefined): string {
  if (target === undefined) return ''
  return target.file ?? target.path ?? ''
}

/** 已安装版本里挑默认项:优先配置自己的版本,不在列表里就回退第一个已安装版本。 */
function defaultVersion(configured: string | null | undefined, installed: readonly string[]): string {
  const value = configured ?? ''
  return value.length > 0 && installed.includes(value) ? value : installed[0] ?? ''
}

/** 该容器 tab 的卡片主体:外部检测 + 配置两张卡。 */
export function ExternalCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  return (
    <>
      <ExternalDetectCard t={t} store={store} />
      <ConfigCard t={t} store={store} />
    </>
  )
}

/** 外部 DSH 检测卡(只读;唯一动作 = 保存为配置)。 */
function ExternalDetectCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [saveTarget, setSaveTarget] = useState<SaveTarget>()
  const [acknowledged, setAcknowledged] = useState(false)
  const [saveNote, setSaveNote] = useState<string>()
  const [checkPath, setCheckPath] = useState('')
  const [checked, setChecked] = useState<ExternalCheck>()
  const [checkNote, setCheckNote] = useState<string>()
  const external = store.external
  const opError = store.opErrorFor(['external'])
  const homes = external?.homes ?? []
  const checkouts = external?.checkouts ?? []
  const installed = external?.installed ?? []
  const running = external?.running ?? []

  const openSave = (target: SaveTarget): void => {
    setSaveNote(undefined)
    setAcknowledged(false)
    setSaveTarget(target)
  }

  const submitSave = async (): Promise<void> => {
    const target = saveTarget
    if (target === undefined) return
    const saved = await store.saveExternalAsConfig({ sourcePath: target.path, name: target.name, acknowledge: true })
    if (saved) {
      setSaveTarget(undefined)
      setAcknowledged(false)
      setSaveNote(t('external.savedConfig', { name: target.name.length > 0 ? target.name : target.path }))
    } else {
      setSaveNote(t('error.operationFailed'))
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
      {saveNote !== undefined && <p className={css.footerNote}>{saveNote}</p>}
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
                  openSave({
                    path: home.path,
                    name: home.path === external?.officialHome ? t('external.officialName') : '',
                    inUse: home.inUse,
                    hasCredentials: home.hasCredentials,
                    sessions: home.sessions,
                    bytes: home.bytes,
                  })
                }}
              >
                {t('external.saveAsConfig')}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {external !== undefined && (
        <p className={css.footerNote}>
          {t('external.managedNote', {
            containers: String(external.containers.length),
            running: String(external.managedRunning),
          })}
        </p>
      )}
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
                openSave({
                  path: checked.path,
                  name: '',
                  inUse: checked.usage.inUse,
                  hasCredentials: checked.home.hasCredentials,
                  sessions: checked.home.sessions,
                  bytes: checked.home.bytes,
                })
              }}
            >
              {t('external.saveAsConfig')}
            </Button>
          </div>
        )}
      </div>

      {saveTarget !== undefined && (
        <div className={css.inlineForm}>
          <div className={css.inlineFormRow}>
            <span className={css.formLabel}>{t('external.saveConfigTitle')} · <code className={css.mono}>{saveTarget.path}</code></span>
          </div>
          <div className={css.rowMeta}>
            {t('external.saveConfigFacts', {
              sessions: String(saveTarget.sessions),
              size: formatBytes(saveTarget.bytes),
            })}
          </div>
          <ul className={css.riskList}>
            <li className={css.riskItem}>{t('external.riskCopy')}</li>
            <li className={css.riskItem}>{t('external.riskCredentials')}</li>
            <li className={css.riskItem}>{saveTarget.inUse ? t('external.riskInUse') : t('external.riskStop')}</li>
            {saveTarget.hasCredentials && <li className={css.riskItem}>{t('external.riskPlaintext')}</li>}
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
              onClick={() => { setSaveTarget(undefined); setAcknowledged(false) }}
            >
              {t('cancel')}
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!acknowledged || store.isBusy('externalConfig')}
              onClick={() => { void submitSave() }}
            >
              {store.isBusy('externalConfig') ? t('external.savingConfig') : t('external.saveConfigConfirm')}
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

/** 配置卡:开关 / 目录(含文件夹选择器)+ 从配置文件创建 + 保存配置 + 配置文件列表。 */
function ConfigCard({ t, store }: {
  t: DockT
  store: DockStore
}): ReactNode {
  const [enabled, setEnabled] = useState(false)
  const [dir, setDir] = useState('')
  const [saveFor, setSaveFor] = useState('')
  const [note, setNote] = useState<string>()
  const [restoreFor, setRestoreFor] = useState<RestoreTarget>()
  const [restoreName, setRestoreName] = useState('')
  const [restoreVersion, setRestoreVersion] = useState('')
  const [deleteFor, setDeleteFor] = useState<ConfigRow>()
  // 目录输入框最后一次成功提交的值:失焦与回车都会触发保存,靠它跳过重复提交。
  const dirSaved = useRef('')
  const opError = store.opErrorFor(['config'])
  const items = store.configs?.items ?? []
  const installedVersions = (store.versions?.versions ?? [])
    .filter(entry => entry.installed)
    .map(entry => entry.tag)

  useEffect(() => {
    if (store.settings !== undefined) {
      setEnabled(store.settings.configAutoSave === true)
      setDir(store.settings.configDir ?? '')
      dirSaved.current = store.settings.configDir ?? ''
    }
  }, [store.settings])

  /** 自动保存开关:勾选/取消后立即保存(没有「保存设置」按钮)。 */
  const toggleAutoSave = async (next: boolean): Promise<void> => {
    setEnabled(next)
    setNote(undefined)
    const saved = await store.saveConfigSettings({ configAutoSave: next })
    setNote(saved
      ? (next ? t('config.autoSaveOn') : t('config.autoSaveOff'))
      : t('error.operationFailed'))
  }

  /**
   * 配置目录立即保存(回车或失焦触发):保存时沿用 saveConfigSettings 的合并写法,
   * 只改 configDir,不会把 proxy 等字段覆盖成空。值没变就直接跳过,并在发起请求前
   * **同步**记账,挡住「失焦后又按回车」把同一次修改提交两遍。服务端会在新目录里立刻
   * 写一份《手动恢复指南.md》。
   */
  const commitDir = async (): Promise<void> => {
    const next = dir.trim()
    if (next === dirSaved.current) return
    dirSaved.current = next
    setNote(undefined)
    const saved = await store.saveConfigSettings({ configDir: next })
    if (saved) {
      setNote(next.length > 0 ? t('config.dirSet', { path: next }) : t('config.dirReset'))
      return
    }
    // 失败不记账(退回服务端现值),这样失焦/回车还能重试。
    dirSaved.current = store.settings?.configDir ?? ''
    setNote(t('error.operationFailed'))
  }

  /** 打开宿主机的文件夹选择器:选中后填入输入框并立即保存;取消/失败给出提示。 */
  const pickDir = async (): Promise<void> => {
    setNote(undefined)
    const picked = await store.pickDirectory()
    if (picked === undefined) {
      setNote(t('error.operationFailed'))
      return
    }
    if (picked.path === null) {
      setNote(picked.error !== undefined ? picked.error : t('config.dirPickCancelled'))
      return
    }
    setDir(picked.path)
    const saved = await store.saveConfigSettings({ configDir: picked.path })
    if (!saved) {
      setNote(t('error.operationFailed'))
      return
    }
    dirSaved.current = picked.path
    setNote(t('config.dirSet', { path: picked.path }))
  }

  /** 用系统文件对话框挑一个配置文件,读元信息后进入「从配置创建」表单。 */
  const pickConfigFile = async (): Promise<void> => {
    setNote(undefined)
    const picked = await store.pickFile()
    if (picked === undefined) {
      setNote(t('error.operationFailed'))
      return
    }
    if (picked.path === null) {
      setNote(picked.error !== undefined ? picked.error : t('config.createFromFileCancelled'))
      return
    }
    const item = await store.inspectConfig({ path: picked.path })
    if (item === undefined) {
      setNote(t('error.operationFailed'))
      return
    }
    openPicked(item)
  }

  const saveNow = async (): Promise<void> => {
    setNote(undefined)
    const done = await store.saveConfigNow(saveFor)
    setNote(done ? t('config.saveNowDone') : t('error.operationFailed'))
  }

  /** 列表行的「从配置创建」:目标指向配置目录里的文件名。 */
  const openRestore = (row: ConfigRow): void => {
    setNote(undefined)
    setRestoreFor({ file: row.file, label: row.name, profile: row.profile })
    setRestoreName(defaultContainerName(row.name))
    setRestoreVersion(defaultVersion(row.version, installedVersions))
  }

  /** 系统对话框选中的配置文件:目标指向磁盘路径,版本回退规则与列表行一致。 */
  const openPicked = (item: ConfigInspectItem): void => {
    setNote(undefined)
    setRestoreFor({ path: item.path, label: `${item.name}(${item.file})`, profile: item.profile })
    setRestoreName(defaultContainerName(item.name))
    setRestoreVersion(defaultVersion(item.version, installedVersions))
  }

  const submitRestore = async (): Promise<void> => {
    const target = restoreFor
    if (target === undefined) return
    const name = restoreName.trim()
    if (name.length === 0 || restoreVersion.length === 0) return
    const started = await store.createFromConfig(
      target.file !== undefined ? { file: target.file } : { path: target.path },
      { name, version: restoreVersion, profile: target.profile },
    )
    if (started) {
      setRestoreFor(undefined)
      setNote(t('config.createStarted', { name }))
    } else {
      setNote(t('error.operationFailed'))
    }
  }

  return (
    <SectionCard
      title={t('config.cardTitle')}
      actions={(
        <div className={css.inlineFormRow}>
          <select className={css.narrow} value={saveFor} onChange={event => { setSaveFor(event.target.value) }}>
            <option value="">{t('config.saveTargetAll')}</option>
            {store.containers.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          <Button size="sm" variant="primary" disabled={store.isBusy('configSave')} onClick={() => { void saveNow() }}>
            {store.isBusy('configSave') ? t('config.saveNowRunning') : t('config.saveNow')}
          </Button>
          <Button
            size="sm"
            disabled={store.isBusy('configFilePick') || store.isBusy('configInspect')}
            onClick={() => { void pickConfigFile() }}
          >
            {store.isBusy('configFilePick') || store.isBusy('configInspect')
              ? t('config.createFromFilePicking')
              : t('config.createFromFile')}
          </Button>
        </div>
      )}
    >
      <p className={css.intro}>{t('config.intro')}</p>
      {store.configsError !== undefined && (
        <ErrorNote title={store.configsError.title} detail={store.configsError.detail} />
      )}
      {store.settingsError !== undefined && (
        <ErrorNote title={store.settingsError.title} detail={store.settingsError.detail} />
      )}
      {opError !== undefined && (
        <ErrorNote title={opError.title} detail={opError.detail} output={opError.output} />
      )}
      {note !== undefined && <p className={css.footerNote}>{note}</p>}

      <div className={css.rowLine}>
        <span className={css.labelCol}>{t('config.enable')}</span>
        <label className={css.checkboxRow}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={event => { void toggleAutoSave(event.target.checked) }}
          />
          <span>{t('config.enableHint')}</span>
        </label>
      </div>
      <div className={css.rowLine}>
        <span className={css.labelCol}>{t('config.dir')}</span>
        <Input
          className={css.grow}
          value={dir}
          placeholder={store.configs?.dir ?? ''}
          onChange={event => { setDir(event.target.value) }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commitDir()
            }
          }}
          onBlur={() => { void commitDir() }}
        />
        <Button
          size="sm"
          disabled={store.isBusy('configPick')}
          onClick={() => { void pickDir() }}
        >
          {store.isBusy('configPick') ? t('config.dirPicking') : t('config.dirPick')}
        </Button>
      </div>

      {items.length === 0 && <p className={css.empty}>{t('config.empty')}</p>}
      {items.length > 0 && (
        <table className={css.table}>
          <thead>
            <tr>
              <th>{t('config.file')}</th>
              <th>{t('config.source')}</th>
              <th>{t('config.version')}</th>
              <th>{t('config.sessions')}</th>
              <th>{t('config.size')}</th>
              <th>{t('config.createdAt')}</th>
              <th>{t('config.reason')}</th>
              <th className={css.cellAction}>{t('config.action')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.file}>
                <td>
                  <b>{item.name}</b>
                  {item.file !== item.name && <div className={css.mutedCell}><code className={css.mono}>{item.file}</code></div>}
                  {item.hasCredentials === true && <div className={css.mutedCell}>{t('external.hasCredentials')}</div>}
                  {item.valid !== true && (
                    <div className={css.mutedCell}>
                      {item.error !== null && item.error !== undefined ? `${t('config.invalid')}: ${item.error}` : t('config.invalid')}
                    </div>
                  )}
                </td>
                <td><code className={css.mono}>{sourceLabel(item)}</code></td>
                <td>{item.version ?? '-'}</td>
                <td>{item.sessions ?? 0}</td>
                <td>{formatBytes(item.bytes)}</td>
                <td>{formatWhen(t, item.createdAt ?? item.modifiedAt)}</td>
                <td>
                  {reasonLabel(t, item.reason)}
                  {item.note !== undefined && item.note.length > 0 && <div className={css.mutedCell}>{item.note}</div>}
                </td>
                <td className={css.cellAction}>
                  {item.valid === true && (
                    <Button size="sm" disabled={store.isBusy(`configRestore:${item.file}`)} onClick={() => { openRestore(item) }}>
                      {t('config.create')}
                    </Button>
                  )}
                  <Button size="sm" disabled={store.isBusy(`configDelete:${item.file}`)} onClick={() => { setDeleteFor(item) }}>
                    {t('config.delete')}
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
            <span className={css.formLabel}>{t('config.create')} · {restoreFor.label}</span>
            <Input
              className={css.grow}
              value={restoreName}
              placeholder={t('containers.namePlaceholder')}
              onChange={event => { setRestoreName(event.target.value.replace(/[^A-Za-z0-9._-]/g, '')) }}
            />
            <select className={css.narrow} value={restoreVersion} onChange={event => { setRestoreVersion(event.target.value) }}>
              <option value="">{t('containers.versionLabel')}</option>
              {installedVersions.map(tag => <option key={tag} value={tag}>{tag}</option>)}
            </select>
            <Button
              size="sm"
              variant="primary"
              disabled={restoreName.trim().length === 0 || restoreVersion.length === 0 || store.isBusy(`configRestore:${restoreKey(restoreFor)}`)}
              onClick={() => { void submitRestore() }}
            >
              {t('containers.confirm')}
            </Button>
            <Button size="sm" variant="outline" aria-label={t('cancel')} onClick={() => { setRestoreFor(undefined) }}>×</Button>
          </div>
          <p className={css.footerNote}>{t('config.createHint')}</p>
        </div>
      )}

      <ConfirmDialog
        open={deleteFor !== undefined}
        title={deleteFor !== undefined ? `${t('config.delete')} · ${deleteFor.name}` : ''}
        body={deleteFor !== undefined ? t('config.deleteConfirm', { name: deleteFor.name }) : ''}
        confirmLabel={t('config.delete')}
        cancelLabel={t('cancel')}
        danger
        busy={deleteFor !== undefined && store.isBusy(`configDelete:${deleteFor.file}`)}
        onConfirm={() => {
          const row = deleteFor
          setDeleteFor(undefined)
          if (row !== undefined) void store.deleteConfig(row.file)
        }}
        onClose={() => { setDeleteFor(undefined) }}
      />
    </SectionCard>
  )
}
